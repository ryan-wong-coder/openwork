"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  auditCaptureUpdateSchema,
  type AuditCaptureUpdate,
  type AuditUsageResponse,
  auditEventsResponseSchema,
  auditEventTypesResponseSchema,
  auditOperationsResponseSchema,
  auditUsageResponseSchema,
  type AuditOperationSummary,
} from "@openwork/types/den/audit";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { getReauthRequiredError, isReauthRequiredError, requestJson } from "../../_lib/den-flow";
import { getOrgAccessFlags } from "../../_lib/den-org";
import { ORG_SCOPE_HEADER } from "../../_lib/org-scope";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export type AuditScope = { orgId: string; memberId: string };
export type AuditFilters = Partial<{
  from: string;
  to: string;
  actorId: string;
  action: string;
  outcome: AuditOperationSummary["outcome"];
  origin: AuditOperationSummary["origin"];
  resourceId: string;
  searchId: string;
}>;

type AuditCursor = { cursor: string | null; snapshot: string | null; cursors: string[]; ids: string[] };
const firstPage: AuditCursor = { cursor: null, snapshot: null, cursors: [], ids: [] };
// Reads retry once on 503: two first reads at once can collide while the audit policy is set up.
const retryUnavailableOnce = (failureCount: number, error: Error) => failureCount < 1 && error instanceof AuditReadError && error.status === 503;
const defaults = { retry: retryUnavailableOnce, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false };
export const auditPageSize = 50;

export class AuditReadError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(status === 403 ? "此账户无法查看审计历史。" : "无法验证审计历史，请重试。");
  }
}

export function isAuditAccessError(error: unknown): error is AuditReadError {
  return error instanceof AuditReadError && (error.status === 403 || error.status === 401
    || (error.status === 404 && error.code === "organization_not_found"));
}

export function auditQueryKey(scope: AuditScope) {
  return ["audit", scope.orgId, scope.memberId];
}

async function readAudit<T>(scope: AuditScope, path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const { response, payload } = await requestJson(path, {
    method: "GET", headers: { [ORG_SCOPE_HEADER]: scope.orgId }, cache: "no-store", signal,
  }, 15000);
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : null;
    throw new AuditReadError(response.status, code);
  }
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error("审计历史响应无效，请刷新以验证。");
  return result.data;
}

export function auditFilterParams(filters: AuditFilters) {
  const params = new URLSearchParams({ limit: String(auditPageSize) });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params;
}

function verifyPage(page: { nextCursor: string | null; snapshotAt: string }, param: AuditCursor, ids: string[]) {
  if ((param.snapshot !== null && page.snapshotAt !== param.snapshot)
    || ids.length > auditPageSize || new Set(ids).size !== ids.length || ids.some((id) => param.ids.includes(id))
    || (page.nextCursor !== null && (!page.nextCursor || !ids.length || page.nextCursor === param.cursor || param.cursors.includes(page.nextCursor)))) {
    throw new Error("审计分页已更改，请从第一页刷新以验证历史记录。");
  }
}

function nextPage(page: { nextCursor: string | null; snapshotAt: string }, param: AuditCursor, ids: string[]): AuditCursor | undefined {
  if (!page.nextCursor) return undefined;
  return { cursor: page.nextCursor, snapshot: page.snapshotAt, cursors: [...param.cursors, page.nextCursor], ids: [...param.ids, ...ids] };
}

export async function getAuditOperations(scope: AuditScope, filters: AuditFilters, param: AuditCursor = firstPage, signal?: AbortSignal) {
  const params = auditFilterParams(filters);
  if (param.cursor) params.set("cursor", param.cursor);
  const page = await readAudit(scope, `/v1/audit/operations?${params}`, auditOperationsResponseSchema, signal);
  verifyPage(page, param, page.operations.map((operation) => operation.id));
  return page;
}

export function useAuditOperations(scope: AuditScope, filters: AuditFilters) {
  return useInfiniteQuery({
    ...defaults, queryKey: [...auditQueryKey(scope), "operations", filters], initialPageParam: firstPage,
    queryFn: ({ signal, pageParam }) => getAuditOperations(scope, filters, pageParam, signal),
    getNextPageParam: (page, _pages, param) => nextPage(page, param, page.operations.map((operation) => operation.id)),
  });
}

export async function getAuditEvents(scope: AuditScope, operationId: string, param: AuditCursor = firstPage, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: String(auditPageSize) });
  if (param.cursor) params.set("cursor", param.cursor);
  const page = await readAudit(scope, `/v1/audit/operations/${encodeURIComponent(operationId)}/events?${params}`, auditEventsResponseSchema, signal);
  if (page.events.some((event) => event.organizationId !== scope.orgId || event.operationId !== operationId)) {
    throw new Error("审计事件与当前工作区及操作不匹配，请刷新以验证历史记录。");
  }
  verifyPage(page, param, page.events.map((event) => event.id));
  return page;
}

export function useAuditEvents(scope: AuditScope, operationId: string) {
  return useInfiniteQuery({
    ...defaults, queryKey: [...auditQueryKey(scope), "events", operationId], initialPageParam: firstPage,
    queryFn: ({ signal, pageParam }) => getAuditEvents(scope, operationId, pageParam, signal),
    getNextPageParam: (page, _pages, param) => nextPage(page, param, page.events.map((event) => event.id)),
  });
}

export async function getAuditEventTypes(scope: AuditScope, signal?: AbortSignal) {
  return readAudit(scope, "/v1/audit/event-types", auditEventTypesResponseSchema, signal);
}

export function useAuditEventTypes(scope: AuditScope) {
  return useQuery({ ...defaults, queryKey: [...auditQueryKey(scope), "event-types"], queryFn: ({ signal }) => getAuditEventTypes(scope, signal) });
}

function verifyAuditUsage(scope: AuditScope, usage: AuditUsageResponse) {
  if (usage.policy && usage.policy.organizationId !== scope.orgId) throw new Error("审计策略与当前工作区不匹配，请刷新以验证。");
  return usage;
}

export async function getAuditUsage(scope: AuditScope, signal?: AbortSignal) {
  return verifyAuditUsage(scope, await readAudit(scope, "/v1/audit/usage", auditUsageResponseSchema, signal));
}

export function useAuditUsage(scope: AuditScope) {
  return useQuery({ ...defaults, queryKey: [...auditQueryKey(scope), "usage"], queryFn: ({ signal }) => getAuditUsage(scope, signal) });
}

async function withAuditDeadline<T>(signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try { return await action(controller.signal); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export async function updateAuditCapture(scope: AuditScope, input: AuditCaptureUpdate, signal?: AbortSignal) {
  const body = auditCaptureUpdateSchema.parse(input);
  const { response, payload } = await withAuditDeadline(signal, (requestSignal) => requestJson("/v1/audit/settings", {
    method: "PATCH", headers: { [ORG_SCOPE_HEADER]: scope.orgId }, cache: "no-store",
    body: JSON.stringify(body), signal: requestSignal,
  }, 15000));
  if (!response.ok) {
    const reauth = getReauthRequiredError(payload, response);
    if (reauth) throw reauth;
    const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : null;
    throw new AuditReadError(response.status, code);
  }
  const result = auditUsageResponseSchema.safeParse(payload);
  if (!result.success) throw new Error("审计记录设置响应无效，请刷新状态以验证。");
  return verifyAuditUsage(scope, result.data);
}

export function auditCaptureLockReason(usage: AuditUsageResponse): string | null {
  if (!usage.entitlement.enabled) return "记录审计需要企业版或实例授权，请联系组织所有者或实例运维人员检查可用性。";
  if (!usage.captureAvailable) return "此部署无法记录审计，请联系实例运维人员启用。";
  if (!usage.policy) return "无法验证审计默认设置，请刷新状态或联系实例管理员检查服务。";
  return null;
}

type CaptureFeedback = { message: string; tone: "neutral" | "error" };
type CaptureSession = { active: boolean; busy: boolean; controller: AbortController };

export function useAuditCapture(scope: AuditScope, onAccessError: (error: AuditReadError) => void) {
  const query = useAuditUsage(scope);
  const client = useQueryClient();
  const dashboard = useOrgDashboard();
  const member = dashboard.orgContext?.currentMember;
  const auditLogs = dashboard.orgContext?.capabilities.auditLogs === true;
  const memberAccess = member ? getOrgAccessFlags(member.role, member.isOwner, member.permissions) : null;
  // Reading capture status needs `audit.view`; changing it needs `audit.manage`.
  const canChange = memberAccess?.canManageAuditCapture === true;
  const allowed = dashboard.orgId === scope.orgId && dashboard.orgContext?.organization.id === scope.orgId
    && auditLogs
    && member?.id === scope.memberId && memberAccess?.canViewAuditLogs === true
    && !dashboard.orgBusy && !dashboard.orgError && dashboard.mutationBusy !== "switch-organization";
  const sessionRef = useRef<CaptureSession | null>(null);
  const [feedback, setFeedback] = useState<CaptureFeedback | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useLayoutEffect(() => {
    const session: CaptureSession = { active: allowed, busy: false, controller: new AbortController() };
    sessionRef.current = session;
    return () => { session.active = false; session.controller.abort(); };
  }, [allowed, auditLogs, scope.orgId, scope.memberId, member?.userId, member?.role, member?.isOwner, member?.permissions]);

  const isCurrent = (session: CaptureSession) => session.active && sessionRef.current === session;
  async function refreshStatus(session = sessionRef.current, keepFeedback = false) {
    if (!session || !isCurrent(session)) return;
    setRefreshing(true);
    setNeedsRefresh(true);
    const key = [...auditQueryKey(scope), "usage"];
    try {
      await client.cancelQueries({ queryKey: key, exact: true });
      if (!isCurrent(session)) return;
      const usage = await withAuditDeadline(session.controller.signal, (signal) => getAuditUsage(scope, signal));
      if (!isCurrent(session)) return;
      await client.cancelQueries({ queryKey: key, exact: true });
      if (!isCurrent(session)) return;
      client.setQueryData(key, usage);
      setNeedsRefresh(false);
      if (!keepFeedback) setFeedback(null);
    } catch (error) {
      if (!isCurrent(session)) return;
      if (isAuditAccessError(error)) onAccessError(error);
      else setFeedback({ tone: "error", message: "无法验证审计记录状态，请先刷新状态再更改。" });
    } finally {
      if (isCurrent(session)) setRefreshing(false);
    }
  }

  const mutation = useMutation({
    mutationKey: [...auditQueryKey(scope), "capture"], retry: false, networkMode: "always",
    mutationFn: async (captureOn: boolean) => {
      const session = sessionRef.current;
      const usage = query.data;
      if (!canChange || !session || !isCurrent(session) || session.busy || refreshing || needsRefresh || query.isFetching || query.isError || !usage
        || captureOn === usage.captureOn || (captureOn && auditCaptureLockReason(usage))) return;
      session.busy = true;
      setFeedback(null);
      const pinnedScope = { ...scope };
      const input = { captureOn, expectedRevision: usage.policy?.revision ?? 0 };
      const key = [...auditQueryKey(pinnedScope), "usage"];
      let sent = false;
      let canSend = true;
      const ensureCurrent = () => {
        if (!isCurrent(session)) throw new Error("工作区或成员关系已更改。");
      };
      try {
        await client.cancelQueries({ queryKey: key, exact: true });
        ensureCurrent();
        await dashboard.runReauthableAction("update-audit-capture", async () => {
          ensureCurrent();
          if (!canSend) throw new Error("请先刷新状态再更改审计记录设置。");
          canSend = false;
          sent = true;
          let result: AuditUsageResponse;
          try {
            result = await updateAuditCapture(pinnedScope, input, session.controller.signal);
          } catch (error) {
            if (isReauthRequiredError(error)) { sent = false; canSend = true; }
            throw error;
          }
          ensureCurrent();
          await client.cancelQueries({ queryKey: key, exact: true });
          ensureCurrent();
          client.setQueryData(key, result);
        });
      } catch (error) {
        if (!isCurrent(session)) return;
        if (isAuditAccessError(error)) { onAccessError(error); return; }
        const changed = error instanceof AuditReadError && (error.status === 402
          || (error.status === 409 && ["audit_policy_changed", "audit_policy_not_configured", "audit_capture_unavailable"].includes(error.code ?? "")));
        if (changed) {
          setFeedback({ tone: "neutral", message: error.code === "audit_policy_changed"
            ? "审计记录设置已更改，请检查最新状态后重试。"
            : "审计记录可用性已更改，请检查最新限制后重试。" });
          await refreshStatus(session, true);
        } else {
          setNeedsRefresh(sent);
          setFeedback({ tone: "error", message: sent
            ? "无法验证审计记录设置更改，请刷新状态后重试。"
            : "审计记录设置更改尚未发送，请确认会话后重试。" });
        }
      } finally {
        canSend = false;
        if (isCurrent(session)) session.busy = false;
      }
    },
  });
  const busy = mutation.isPending || refreshing || query.isFetching;
  return {
    query, feedback, needsRefresh, busy,
    canChange,
    disabled: !allowed || !canChange || busy || needsRefresh || query.isError || !query.data
      || (!query.data.captureOn && Boolean(auditCaptureLockReason(query.data))),
    change: (captureOn: boolean) => mutation.mutate(captureOn),
    refresh: () => { if (!mutation.isPending && !refreshing) void refreshStatus(); },
  };
}
