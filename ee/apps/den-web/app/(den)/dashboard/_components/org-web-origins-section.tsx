"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import {
  ORGANIZATION_WEB_ORIGIN_LIMIT,
  normalizeExactHttpsOrigin,
  type OrganizationWebOrigin,
} from "@openwork/types/den/organization-web-origins";
import { ChevronRight, CircleAlert, Lock, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { DenButton } from "../../_components/ui/button";
import { permissionLockReason } from "../../_lib/den-org";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { DenList, DenListRow } from "../../_components/ui/list-row";
import {
  useApproveOrgWebOrigin,
  useOrgWebOrigins,
  useRemoveOrgWebOrigin,
} from "./org-web-origins-data";

const INVALID_ORIGIN_MESSAGE =
  "输入准确的 HTTPS 来源，例如 https://workspace.example.com，可包含端口，但不能包含路径。";
const DUPLICATE_ORIGIN_MESSAGE = "此来源已获批准。";

function formatApprovedDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(DEFAULT_DEN_LOCALE, { year: "numeric", month: "short", day: "numeric" });
}

function approvedMeta(entry: OrganizationWebOrigin): string {
  const by = entry.createdByName?.trim() || "工作区所有者";
  const date = formatApprovedDate(entry.createdAt);
  return date ? `由 ${by} 于 ${date} 批准` : `由 ${by} 批准`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function countLabel(count: number): string {
  if (count === 0) return "无";
  return count === 1 ? "1 个来源" : `${count} 个来源`;
}

export function OrgWebOriginsSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const inputId = useId();
  const errorId = useId();
  const query = useOrgWebOrigins(orgId);
  const approve = useApproveOrgWebOrigin(orgId);
  const remove = useRemoveOrgWebOrigin(orgId);
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);

  const origins = query.data?.origins ?? [];
  const limit = query.data?.limit ?? ORGANIZATION_WEB_ORIGIN_LIMIT;
  const atLimit = origins.length >= limit;
  const busy = approve.isPending || remove.isPending;

  async function approveOrigin(origin: string): Promise<boolean> {
    setActionError(null);
    try {
      await approve.mutateAsync(origin);
      return true;
    } catch (error) {
      setActionError(errorMessage(error, `无法批准 ${origin}，请重试。`));
      return false;
    }
  }

  async function handleApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || atLimit) return;
    const normalized = normalizeExactHttpsOrigin(draft);
    if (!normalized) {
      setInputError(INVALID_ORIGIN_MESSAGE);
      return;
    }
    if (origins.some((entry) => entry.origin.toLowerCase() === normalized.toLowerCase())) {
      setInputError(DUPLICATE_ORIGIN_MESSAGE);
      return;
    }
    setInputError(null);
    setRemoved(null);
    if (await approveOrigin(normalized)) setDraft("");
  }

  async function handleRemove(entry: OrganizationWebOrigin) {
    if (busy) return;
    setActionError(null);
    setInputError(null);
    setRemoved(null);
    try {
      await remove.mutateAsync(entry);
      setRemoved(entry.origin);
    } catch (error) {
      setActionError(errorMessage(error, `无法移除 ${entry.origin}，请重试。`));
    }
  }

  async function handleUndo() {
    if (!removed || busy) return;
    if (await approveOrigin(removed)) setRemoved(null);
  }

  const summaryState = query.isPending ? (
    <span
      aria-hidden="true"
      data-testid="web-origins-summary-skeleton"
      className="inline-block h-3 w-14 rounded bg-gray-100 motion-safe:animate-pulse"
    />
  ) : query.isError ? (
    "不可用"
  ) : (
    countLabel(origins.length)
  );

  return (
    <DenCard size="comfortable" className="mt-6 overflow-hidden !p-0" data-section="org-web-origins">
      <details className="group">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-6 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gray-900 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <ChevronRight
              size={16}
              strokeWidth={1.5}
              aria-hidden="true"
              className="shrink-0 text-gray-400 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="text-[13px] font-semibold text-gray-900">已批准的网页来源</span>
          </span>
          <span className="shrink-0 text-[13px] text-gray-500" data-testid="web-origins-summary-state">
            {query.isPending ? <span className="sr-only">正在加载</span> : null}
            {summaryState}
          </span>
        </summary>

        <div className="grid gap-4 border-t border-gray-100 px-6 py-4 text-[13px] leading-5">
          {query.isPending ? (
            <div aria-hidden="true" className="grid gap-2">
              {[0, 1].map((index) => (
                <div key={index} className="h-10 rounded-lg bg-gray-100 motion-safe:animate-pulse" />
              ))}
            </div>
          ) : query.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-red-700">
              <span className="flex items-center gap-2">
                <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
                无法加载已批准来源，请重试。
              </span>
              <DenButton variant="ghost" size="xs" onClick={() => void query.refetch()}>
                重试
              </DenButton>
            </div>
          ) : origins.length === 0 ? (
            <p className="text-gray-500">尚未批准任何来源。</p>
          ) : (
            <DenList className="-mx-6 !rounded-none !border-0">
              {origins.map((entry) => (
                <DenListRow
                  key={entry.id}
                  dataAttributes={{ "data-web-origin": entry.origin }}
                  title={<span className="block whitespace-normal break-all font-mono text-[13px] font-medium">{entry.origin}</span>}
                  meta={approvedMeta(entry)}
                  action={(
                    <DenButton
                      variant="ghost"
                      size="xs"
                      aria-label={`移除 ${entry.origin}`}
                      title={canManage ? "移除" : permissionLockReason("web_origins.manage")}
                      disabled={!canManage || busy}
                      onClick={() => void handleRemove(entry)}
                    >
                      <X size={16} strokeWidth={1.5} aria-hidden="true" />
                    </DenButton>
                  )}
                />
              ))}
            </DenList>
          )}

          {removed ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 text-gray-600">
              <span className="min-w-0 truncate">已移除 {removed}</span>
              <DenButton variant="ghost" size="xs" loading={approve.isPending} onClick={() => void handleUndo()}>
                撤销
              </DenButton>
            </div>
          ) : null}

          {!query.isError ? (
            <form className="grid gap-2" onSubmit={(event) => void handleApprove(event)} noValidate>
              <label htmlFor={inputId} className="sr-only">待批准来源</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <DenInput
                  id={inputId}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://workspace.example.com"
                  value={draft}
                  disabled={!canManage || atLimit || query.isPending}
                  aria-invalid={inputError ? true : undefined}
                  aria-describedby={inputError ? errorId : undefined}
                  className="font-mono text-[13px]"
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setInputError(null);
                  }}
                />
                <DenButton
                  type="submit"
                  variant="secondary"
                  loading={approve.isPending && !removed}
                  disabled={!canManage || atLimit || query.isPending || busy}
                  className="h-[42px] shrink-0"
                >
                  批准来源
                </DenButton>
              </div>
              {inputError || actionError ? (
                <p id={errorId} role="alert" className="text-red-700">
                  {inputError ?? actionError}
                </p>
              ) : null}
              {canManage ? (
                <p className="text-gray-500">
                  {atLimit
                    ? `请先移除一个来源再批准其他来源，最多允许 ${limit} 个。`
                    : "成员在已批准来源登录时，会与该网站共享 OpenWork 会话。"}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-gray-500">
                  <Lock size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
                  {`已锁定。${permissionLockReason("web_origins.manage")}`}
                </p>
              )}
            </form>
          ) : null}
        </div>
      </details>
    </DenCard>
  );
}
