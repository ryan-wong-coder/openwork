"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { useEffect, type ReactNode } from "react";
import { ChevronRight, LockKeyhole } from "lucide-react";
import type { AuditActor, AuditEventEnvelope, AuditOperationSummary, AuditUsageResponse } from "@openwork/types/den/audit";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { DenTable } from "../../_components/ui/table";
import { DenSwitch } from "../../_components/ui/switch";
import { permissionLockReason, type DenOrgMember } from "../../_lib/den-org";
import { DetailRows } from "./item-list";
import { auditCaptureLockReason, isAuditAccessError, useAuditCapture, useAuditEvents, type AuditReadError, type AuditScope } from "./audit-logs-data";

export const auditSummaryClass = "flex cursor-pointer list-none items-center gap-2 py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dls-accent)] [&::-webkit-details-marker]:hidden";

export const auditTechnicalSummaryClass = "flex cursor-pointer list-none items-center gap-2 py-3 text-[var(--dls-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dls-border)] [&::-webkit-details-marker]:hidden";

export function AuditChevron({ technical = false }: { technical?: boolean }) {
  return <ChevronRight aria-hidden="true" strokeWidth={1.5} className={technical
    ? "size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none group-open/audit-technical:rotate-90"
    : "size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none group-open:rotate-90"} />;
}

const auditAcronyms: Record<string, string> = {
  organization: "组织", organizations: "组织", org: "组织", member: "成员", members: "成员", team: "团队", teams: "团队",
  user: "用户", users: "用户", admin: "管理员", role: "角色", roles: "角色", permission: "权限", permissions: "权限",
  connection: "连接", connections: "连接", connector: "连接器", connectors: "连接器", account: "账户", accounts: "账户",
  plugin: "插件", plugins: "插件", skill: "技能", skills: "技能", workflow: "工作流", workflows: "工作流", run: "运行", runs: "运行",
  marketplace: "市场", collection: "集合", collections: "集合", configuration: "配置", config: "配置", settings: "设置", policy: "策略",
  key: "密钥", keys: "密钥", credential: "凭据", credentials: "凭据", token: "令牌", secret: "密钥", grant: "授权", access: "访问权限",
  billing: "账单", subscription: "订阅", inference: "推理", provider: "提供商", model: "模型", gateway: "网关", limit: "限制", usage: "用量",
  desktop: "桌面", browser: "浏览器", automation: "自动化", deployment: "部署", audit: "审计", capture: "捕获", export: "导出", retention: "保留",
  status: "状态", enabled: "已启用", disabled: "已禁用", name: "名称", description: "描述", created: "已创建", updated: "已更新", deleted: "已删除",
  api: "API", mcp: "MCP", sso: "SSO", scim: "SCIM", oauth: "OAuth", dpa: "DPA", oidc: "OIDC", saml: "SAML", url: "URL", id: "ID",
};

export function auditLabel(value: string): string {
  const words = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[._\-/]+/g, " ").trim().split(/\s+/).filter(Boolean)
    .map((word) => auditAcronyms[word.toLowerCase()] ?? (/^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()));
  if (!words.length) return "未记录";
  const [first, ...rest] = words;
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(" ");
}

const auditCollectionPrefix = "collection:";

export function auditResourceLabel(resource: AuditOperationSummary["resources"][number]) {
  if (resource.label) return resource.label;
  if (resource.id.startsWith(auditCollectionPrefix)) return `${auditLabel(resource.type)} 集合`;
  return auditLabel(resource.type);
}

function auditSentenceNoun(value: string): string {
  return auditLabel(value).replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase());
}

/** The stored action remains verbatim in Technical details. */
export function auditActionSentence(action: string): string {
  const parts = action.split(".");
  const ending = parts.pop() ?? "";
  const verbs: Record<string, { past: string; noun: string }> = {
    create: { past: "已创建", noun: "创建" }, update: { past: "已更新", noun: "更新" },
    delete: { past: "已删除", noun: "删除" }, remove: { past: "已移除", noun: "移除" },
    enable: { past: "已启用", noun: "启用" }, disable: { past: "已禁用", noun: "禁用" },
    read: { past: "已读取", noun: "读取" }, export: { past: "已导出", noun: "导出" },
  };
  const verb = parts.at(-1) ?? "";
  const conjugation = verbs[verb];
  if (conjugation && ["requested", "attempted", "succeeded", "failed", "committed", "denied"].includes(ending)) {
    parts.pop();
    const subject = auditSentenceNoun(parts.join("."));
    if (ending === "requested") return `已请求${conjugation.noun}${subject}`;
    if (ending === "attempted") return `尝试${conjugation.noun}${subject}`;
    if (ending === "failed") return `无法${conjugation.noun}${subject}`;
    if (ending === "denied") return `${conjugation.noun}${subject}的权限被拒绝`;
    return `${conjugation.past} ${subject}`;
  }
  const past: Record<string, string> = {
    created: "已创建", updated: "已更新", deleted: "已删除", removed: "已移除", enabled: "已启用",
    disabled: "已禁用", initialized: "已初始化", served: "已读取", exported: "已导出",
    granted: "已授予", revoked: "已撤销", started: "已开始", completed: "已完成",
  };
  return past[ending] ? `${past[ending]} ${auditSentenceNoun(parts.join("."))}` : `已记录${auditSentenceNoun(action)}`;
}

export const auditOutcomeLabels: Record<AuditOperationSummary["outcome"] | AuditEventEnvelope["outcome"], string> = {
  running: "正在运行", succeeded: "成功", failed: "失败", partial: "部分完成", denied: "拒绝", unknown: "未知",
};

export const auditOriginLabels: Record<AuditOperationSummary["origin"], string> = {
  api: "API", cloud_ui: "云端界面", mcp: "代理（MCP）", scheduler: "调度器", webhook: "Webhook", platform_admin: "平台管理员",
};

export function AuditOutcome({ outcome }: { outcome: AuditOperationSummary["outcome"] | AuditEventEnvelope["outcome"] }) {
  return <span data-audit-outcome={outcome} className={outcome === "failed" ? "text-[var(--ow-danger)]" : outcome === "partial" ? "text-[var(--ow-warning)]" : "text-[var(--dls-text-secondary)]"}>
    {outcome === "denied" ? <LockKeyhole aria-hidden="true" strokeWidth={1.5} className="mr-1 inline size-4" /> : null}{auditOutcomeLabels[outcome]}
  </span>;
}

export function auditActorLabel(actor: AuditActor, members: readonly DenOrgMember[], origin?: AuditOperationSummary["origin"]): string {
  if (actor.type === "system") return "系统";
  if (actor.type === "service") return actor.id ? `服务：${auditLabel(actor.id.split(":")[0] ?? actor.id)}` : "服务账户";
  if (actor.type === "unknown" || !actor.id) return "未知操作人";
  const member = members.find((entry) => entry.userId === actor.id || (actor.memberId !== undefined && entry.id === actor.memberId));
  if (member?.user.name) return member.user.name;
  return !actor.memberId && origin === "platform_admin" ? "平台管理员" : "成员不可用";
}

export function AuditTime({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{new Date(value).toLocaleString(DEFAULT_DEN_LOCALE)}</time> : <>未记录</>;
}

export function AuditSkeleton({ rows = 5 }: { rows?: number }) {
  return <div role="status" aria-label="正在加载审计历史" className="divide-y divide-[var(--dls-border)]" data-testid="audit-skeleton">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="flex min-h-12 items-center gap-6 px-3 py-3" aria-hidden="true">
      <div className="h-4 flex-1 rounded bg-[var(--dls-hover)]" /><div className="h-4 w-24 rounded bg-[var(--dls-hover)]" /><div className="h-4 w-32 rounded bg-[var(--dls-hover)]" />
    </div>)}
  </div>;
}

export function AuditLocked({ error, unavailable = false, children }: { error?: AuditReadError; unavailable?: boolean; children?: ReactNode }) {
  const message = unavailable || error?.code === "audit_feature_disabled"
    ? "此组织尚未启用审计日志。"
    : error?.code === "audit_visibility_disabled"
      ? "此部署已关闭审计日志查看，请联系实例管理员启用。"
      : error?.status === 401 ? "无法验证会话，请重新登录以查看审计历史。"
        : "查看审计历史需要“查看审计历史”权限，请联系组织所有者或管理员授权。";
  return <div className="flex flex-col gap-3 py-6" data-testid="audit-locked">
    <DenNotice tone="neutral" icon={LockKeyhole} message={message} />
    {children}
  </div>;
}

export function AuditReadFailure({ retained, verifiedAt, retry, busy }: { retained: boolean; verifiedAt: number; retry: () => void; busy: boolean }) {
  return <div className="flex flex-col items-start gap-2 py-3">
    <DenNotice tone="error" message={retained ? <>无法刷新审计历史，当前显示上次验证的结果，时间： <AuditTime value={verifiedAt ? new Date(verifiedAt).toISOString() : null} />.</> : "无法加载审计历史，请重试。"} />
    <DenButton variant="secondary" size="sm" disabled={busy} onClick={retry}>重试</DenButton>
  </div>;
}

function readableValue(value: unknown, depth = 0, localTimes = false): string {
  if (value === undefined) return "未记录";
  if (value === null) return "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (localTimes && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toLocaleString(DEFAULT_DEN_LOCALE);
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (depth >= 3) return "其他结构化值";
  if (Array.isArray(value)) return value.length ? value.map((entry) => readableValue(entry, depth + 1, localTimes)).join(", ") : "无";
  if (typeof value === "object") return Object.entries(value).map(([key, entry]) => `${auditLabel(key)}: ${safeChangeValue(key, entry, depth + 1, localTimes)}`).join("; ") || "无";
  return "未记录";
}

function safeChangeValue(field: string, value: unknown, depth = 0, localTimes = false): string {
  if (value !== null && value !== undefined && typeof value !== "boolean" && /(secret|password|token|api.?key|authorization|cookie|private.?key|credential.?material)/i.test(field)) return "隐藏";
  return readableValue(value, depth, localTimes);
}

function changeField(values: Record<string, unknown> | null, field: string): unknown {
  if (values === null) return null;
  if (Object.hasOwn(values, field)) return values[field];
  let value: unknown = values;
  for (const part of field.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    const entry = Object.entries(value).find(([key]) => key === part);
    if (!entry) return undefined;
    value = entry[1];
  }
  return value;
}

export function AuditChanges({ changes, technical = false }: { changes: AuditEventEnvelope["changes"]; technical?: boolean }) {
  if (!changes || !changes.changedFields.length) return null;
  const fields = [...new Set(changes.changedFields)].filter((field) => /(?:^|[._])id$|Ids?$/.test(field) === technical);
  if (!fields.length) return null;
  function valueFor(field: string, side: "before" | "after") {
    if ((field === "credentialMaterial" || field === "configuration")
      && changeField(changes?.before ?? null, field) === undefined && changeField(changes?.after ?? null, field) === undefined) {
      return side === "before" ? "未保留" : "已更改，未保留具体值";
    }
    return safeChangeValue(field, changeField(changes?.[side] ?? null, field), 0, true);
  }
  return <div className="[&_table]:w-full [&_table]:table-fixed [&_td]:break-words max-sm:[&_table]:block max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:block max-sm:[&_td]:block max-sm:[&_td]:py-1.5"><DenTable density="compact" columns={[
    { key: "field", header: "字段", render: (field: string) => <span className="font-medium">{auditLabel(field)}</span> },
    { key: "before", header: "变更前", render: (field: string) => <span className="whitespace-pre-wrap break-words"><span className="block text-xs text-[var(--dls-text-secondary)] sm:hidden">变更前</span><span>{valueFor(field, "before")}</span></span> },
    { key: "after", header: "变更后", render: (field: string) => <span className="whitespace-pre-wrap break-words"><span className="block text-xs text-[var(--dls-text-secondary)] sm:hidden">变更后</span><span>{valueFor(field, "after")}</span></span> },
  ]} rows={fields} getRowKey={(field) => field} /></div>;
}

type DetailProps = { scope: AuditScope; onAccessError: (error: AuditReadError) => void };

export function AuditTimeline({ scope, operationId, members, onAccessError }: DetailProps & { operationId: string; members: readonly DenOrgMember[] }) {
  const query = useAuditEvents(scope, operationId);
  const events = (query.data?.pages.flatMap((page) => page.events) ?? []).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const accessError = isAuditAccessError(query.error) ? query.error : null;
  useEffect(() => { if (accessError) onAccessError(accessError); }, [accessError, onAccessError]);
  if (accessError) return <AuditLocked error={accessError} />;
  return <div className="flex flex-col gap-3 py-3" aria-label="操作时间线">
    {query.isError ? <AuditReadFailure retained={Boolean(query.data)} verifiedAt={query.dataUpdatedAt} retry={() => { void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch()); }} busy={query.isFetching} /> : null}
    {query.isPending ? <AuditSkeleton rows={2} /> : !events.length && !query.isError ? <p>此操作没有保留的事件。</p> : null}
    <ol className="flex flex-col gap-4">
      {events.map((event) => <li key={event.id} className="flex flex-col gap-2 border-l border-[var(--dls-border)] pl-4" data-testid="audit-event">
        <div className="flex flex-wrap items-center justify-between gap-3"><span className="font-medium">{auditLabel(event.action)}</span><AuditOutcome outcome={event.outcome} /></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--dls-text-secondary)]"><span>{auditActorLabel(event.actor, members, event.operation.origin)}</span><AuditTime value={event.occurredAt} /></div>
        {event.resources.length ? <p>{[...new Set(event.resources.filter((resource) => resource.relationship === "target").map((resource) => auditResourceLabel(resource)))].join(", ")}</p> : null}
        {event.reasonCode ? <p>{auditLabel(event.reasonCode)}</p> : null}
        <AuditChanges changes={event.changes} />
        <details className="group/audit-technical"><summary className={auditTechnicalSummaryClass}><AuditChevron technical />技术详情</summary>
          <AuditChanges changes={event.changes} technical />
          <dl className="flex flex-col gap-2 break-all text-xs text-[var(--dls-text-secondary)]">
            <div><dt>事件</dt><dd className="font-mono">{event.id}</dd></div>
            <div><dt>操作</dt><dd className="font-mono">{event.action}</dd></div>
            <div><dt>操作人</dt><dd className="font-mono">{event.actor.id ?? "未知"}</dd></div>
            <div><dt>请求</dt><dd className="font-mono">{event.requestId ?? "未记录"}</dd></div>
            {event.http ? <div><dt>HTTP 请求</dt><dd className="font-mono">{event.http.method} {event.http.route}</dd></div> : null}
            {event.http?.status !== undefined ? <div><dt>HTTP 状态</dt><dd className="font-mono">{event.http.status}</dd></div> : null}
            <div><dt>已记录</dt><dd><AuditTime value={event.recordedAt} /></dd></div>
            {event.resources.map((resource) => <div key={`${resource.type}-${resource.id}-${resource.relationship}`}><dt>{auditLabel(resource.relationship)}</dt><dd className="font-mono">{resource.label ? `${resource.label}: ` : null}{resource.type}: {resource.id}</dd></div>)}
          </dl>
        </details>
      </li>)}
    </ol>
    {query.hasNextPage ? <DenButton variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>加载更多事件</DenButton> : null}
  </div>;
}

export function AuditUsageFacts({ usage, captureControl }: { usage: AuditUsageResponse; captureControl?: ReactNode }) {
  const policy = usage.policy;
  const facts: { label: string; value: ReactNode }[] = [
    { label: "可用", value: usage.entitlement.enabled
      ? usage.entitlement.source === "enterprise_plan" ? "企业版已包含" : usage.entitlement.source === "self_hosted" ? "已由实例运维人员启用" : "授权来源不可用"
      : "需要企业版" },
    { label: "记录审计日志", value: captureControl ?? (usage.captureOn ? "开启" : "关闭") },
    { label: "部署审计记录", value: usage.captureAvailable ? "可用" : "不可用" },
    { label: "实际记录状态", value: usage.captureEnabled ? "正在记录" : "未记录" },
    { label: "已保留操作", value: usage.retainedOperations.toLocaleString(DEFAULT_DEN_LOCALE) },
    { label: "已记录事件", value: usage.eventCount.toLocaleString(DEFAULT_DEN_LOCALE) },
    { label: "最早可用记录", value: <AuditTime value={usage.oldestAvailableAt} /> },
    { label: "逻辑存储", value: `${usage.logicalBytes.toLocaleString(DEFAULT_DEN_LOCALE)} 字节（非磁盘占用）` },
    // Retained operations, recorded events and logical storage are recomputed by a
    // daily refresh (den-audit-usage), not on every write.
    { label: "汇总上次刷新时间", value: usage.measuredAt ? <><AuditTime value={usage.measuredAt} />，每日刷新</> : "暂无，每日刷新" },
    { label: "策略来源", value: policy ? policy.source === "operator" ? "实例运维人员" : "云端" : "未配置" },
    { label: "类别", value: policy ? policy.categories.map(auditLabel).join(", ") || "无" : "未配置" },
    { label: "操作额度", value: policy ? policy.allowance.toLocaleString(DEFAULT_DEN_LOCALE) : "未配置" },
    { label: "已配置的超额策略", value: policy ? ({ delete_oldest: "删除最早记录", paid_overage: "超额付费", keep_all: "保留全部" })[policy.excessMode] : "未配置" },
    { label: "记录开始时间", value: <AuditTime value={policy?.captureStartedAt ?? null} /> },
    { label: "策略生效时间", value: <AuditTime value={policy?.effectiveAt ?? null} /> },
    { label: "策略版本", value: policy?.revision ?? "未配置" },
    { label: "关联请求窗口", value: policy ? `${policy.attachmentWindowSeconds} 秒` : "未配置" },
    { label: "账单", value: "Disabled" },
    { label: "清理", value: "Dry run only — no deletion" },
    { label: "外部日志导出", value: "Not configured" },
  ];
  const settingsRows = (rows: typeof facts) => rows.map(({ label, value }) => ({ label, value: <span className="block whitespace-normal break-words">{value}</span> }));
  return <div className="flex flex-col gap-3" data-testid="audit-compact-usage">
    <DetailRows rows={settingsRows(facts.slice(0, 9))} />
    <details className="group/audit-technical">
      <summary className={auditTechnicalSummaryClass}><AuditChevron technical />技术详情</summary>
      <DetailRows rows={settingsRows([{ label: "策略访问权限", value: "Read only" }, ...facts.slice(9)])} />
    </details>
  </div>;
}

export function AuditUsage({ scope, onAccessError }: DetailProps) {
  const capture = useAuditCapture(scope, onAccessError);
  const { query } = capture;
  const accessError = isAuditAccessError(query.error) ? query.error : null;
  const reason = query.data ? auditCaptureLockReason(query.data) : null;
  useEffect(() => { if (accessError) onAccessError(accessError); }, [accessError, onAccessError]);
  if (accessError) return <AuditLocked error={accessError} />;
  const control = <div className="flex items-center gap-3" aria-busy={capture.busy}>
    <span>{query.data ? query.data.captureOn ? "开启" : "关闭" : "未验证"}</span>
    <DenSwitch aria-label="记录审计日志" aria-describedby="audit-capture-status" checked={query.data?.captureOn ?? false} disabled={capture.disabled} onChange={capture.change} />
  </div>;
  return <div className="flex flex-col gap-3 py-3">
    <div id="audit-capture-status" className="flex flex-col gap-3">
      {query.isError ? <DenNotice tone="error" message={query.data
        ? <>无法刷新审计记录状态，当前显示上次验证的状态，时间： <AuditTime value={new Date(query.dataUpdatedAt).toISOString()} />.</>
        : "无法加载审计记录状态，请先刷新状态再更改。"} /> : null}
      {capture.feedback ? <DenNotice tone={capture.feedback.tone} message={<>{capture.feedback.message}{capture.needsRefresh && query.data && !query.isError
        ? <> 当前显示上次验证的状态，时间： <AuditTime value={new Date(query.dataUpdatedAt).toISOString()} />.</> : null}</>} /> : null}
      {reason ? <DenNotice tone="neutral" icon={LockKeyhole} message={reason} /> : null}
      {!capture.canChange ? <DenNotice tone="neutral" icon={LockKeyhole} message={`更改捕获设置：${permissionLockReason("audit.manage")}`} /> : null}
      {query.data && !query.data.captureEnabled && !capture.needsRefresh && !query.isError ? <p className="text-[var(--dls-text-secondary)]">新活动未记录，已保留的历史仍可查看。</p> : null}
    </div>
    {capture.needsRefresh || query.isError ? <div><DenButton variant="secondary" size="sm" disabled={capture.busy} onClick={capture.refresh}>刷新状态</DenButton></div> : null}
    {query.data ? <AuditUsageFacts usage={query.data} captureControl={control} /> : <>
      <div className="flex items-center justify-between gap-3 py-3"><span>记录审计日志</span>{control}</div>
      {query.isPending ? <AuditSkeleton rows={4} /> : null}
    </>}
  </div>;
}
