"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { auditOperationOutcomeSchema, auditOriginSchema, type AuditOperationSummary } from "@openwork/types/den/audit";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenPageHeader } from "../../_components/ui/page-header";
import { DenSelect } from "../../_components/ui/select";
import { getOrgAccessFlags, type DenOrgContext, type DenOrgMember } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { ItemPanel, ItemRow, ItemRowsSkeleton } from "./item-list";
import { auditQueryKey, isAuditAccessError, useAuditEventTypes, useAuditOperations, type AuditFilters, type AuditReadError, type AuditScope } from "./audit-logs-data";
import {
  AuditChevron, AuditLocked, AuditOutcome, AuditReadFailure, AuditSkeleton, AuditTime, AuditTimeline, AuditUsage,
  auditActionSentence, auditActorLabel, auditLabel, auditOriginLabels, auditOutcomeLabels, auditResourceLabel, auditSummaryClass, auditTechnicalSummaryClass,
} from "./audit-logs-details";

export function getAuditAccess(input: {
  orgId: string | null; orgContext: DenOrgContext | null; orgBusy: boolean; orgError: string | null; mutationBusy: string | null;
}): "checking" | "error" | "unavailable" | "locked" | "allowed" {
  if (input.orgBusy || input.mutationBusy === "switch-organization") return "checking";
  if (input.orgError) return "error";
  if (!input.orgId || !input.orgContext || input.orgId !== input.orgContext.organization.id) return "checking";
  if (!input.orgContext.capabilities.auditLogs) return "unavailable";
  return getOrgAccessFlags(input.orgContext.currentMember.role, input.orgContext.currentMember.isOwner, input.orgContext.currentMember.permissions).canViewAuditLogs ? "allowed" : "locked";
}

function AuditPage({ children, action }: { children: ReactNode; action?: ReactNode }) {
  // Match ItemPage's centered column.
  return <section aria-label="审计日志" className="mx-auto flex w-full max-w-[896px] flex-col gap-7 px-6 py-10 text-[13px] text-[var(--dls-text-primary)] md:px-12">
    <DenPageHeader size="compact" title="审计日志" action={action} />{children}
  </section>;
}

export function AuditLogsScreen() {
  const dashboard = useOrgDashboard();
  const access = getAuditAccess(dashboard);
  if (access === "error") return <AuditPage><DenNotice tone="error" message="无法验证工作区访问权限，请重试。" /><DenButton variant="secondary" onClick={() => void dashboard.refreshOrgData()}>重新检查访问权限</DenButton></AuditPage>;
  if (access === "checking") return <AuditPage><AuditSkeleton /></AuditPage>;
  if (access === "unavailable") return <AuditPage><AuditLocked unavailable /></AuditPage>;
  if (access === "locked" || !dashboard.orgContext || !dashboard.orgId) return <AuditPage><AuditLocked /></AuditPage>;
  const member = dashboard.orgContext.currentMember;
  return <AuditLogsContent key={JSON.stringify([dashboard.orgId, member.id, member.userId, member.role, member.isOwner, member.permissions])} scope={{ orgId: dashboard.orgId, memberId: member.id }} members={dashboard.orgContext.members} />;
}

function AuditFiltersForm({ filters, members, operations, eventTypes, eventTypesPending, onApply }: {
  filters: AuditFilters; members: readonly DenOrgMember[]; operations: AuditOperationSummary[];
  eventTypes: readonly string[]; eventTypesPending: boolean; onApply: (filters: AuditFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  function localDate(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  const [from, setFrom] = useState(localDate(filters.from));
  const [to, setTo] = useState(localDate(filters.to));
  const [error, setError] = useState<string | null>(null);
  const actions = [...new Set([...eventTypes, ...(draft.action ? [draft.action] : [])])].sort();
  const actors = new Map(members.flatMap((member) => member.userId ? [[member.userId, member.user.name] satisfies [string, string]] : []));
  for (const { initiatingActor: actor, origin } of operations) {
    if (!actor.id || actors.has(actor.id)) continue;
    const label = auditActorLabel(actor, members, origin);
    actors.set(actor.id, label === "Platform administrator" ? `${label} (${actor.id})` : label);
  }
  if (draft.actorId && !actors.has(draft.actorId)) actors.set(draft.actorId, "Previously selected actor");
  function apply(event: FormEvent) {
    event.preventDefault();
    if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))) || (from && to && Date.parse(from) > Date.parse(to))) {
      setError("请选择有效日期范围，开始时间必须早于结束时间。");
      return;
    }
    setError(null);
    onApply({ ...draft, searchId: draft.searchId?.trim() || undefined, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined });
  }
  function clear() { setDraft({}); setFrom(""); setTo(""); setError(null); onApply({}); }
  return <form onSubmit={apply} aria-label="筛选审计操作" className="flex flex-col gap-3">
    <div className="grid grid-cols-1 items-end gap-3 lg:grid-cols-2" data-testid="audit-primary-filters">
      <label className="flex min-w-60 flex-1 flex-col gap-1">开始时间（本地时间）<DenInput type="datetime-local" aria-label="开始时间（本地时间）" title="操作开始时间" value={from} onChange={(event) => setFrom(event.target.value)} aria-invalid={Boolean(error)} /></label>
      <label className="flex min-w-60 flex-1 flex-col gap-1">结束时间（本地时间）<DenInput type="datetime-local" aria-label="结束时间（本地时间）" title="操作开始时间" value={to} onChange={(event) => setTo(event.target.value)} aria-invalid={Boolean(error)} /></label>
      <label className="flex min-w-56 flex-1 flex-col gap-1" aria-busy={eventTypesPending}>事件类型<DenSelect aria-label="事件类型" searchLabel="搜索事件类型" searchEmptyLabel="没有匹配的事件类型，请尝试其他关键词。" disabled={eventTypesPending} value={draft.action ?? ""} onChange={(event) => setDraft({ ...draft, action: event.target.value || undefined })}>
        <option value="">所有事件类型</option>{actions.map((action) => <option key={action} value={action}>{auditLabel(action)}</option>)}
      </DenSelect></label>
      <label className="flex min-w-56 flex-1 flex-col gap-1">搜索 ID<DenInput aria-label="搜索 ID" placeholder="精确 ID" title="精确的操作、事件、请求或资源 ID" maxLength={255} value={draft.searchId ?? ""} onChange={(event) => setDraft({ ...draft, searchId: event.target.value })} /></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <DenButton type="submit" variant="secondary">应用筛选</DenButton><DenButton variant="ghost" onClick={clear}>清除筛选</DenButton>
    </div>
    <details className="group"><summary className={auditSummaryClass}><AuditChevron />更多筛选</summary>
      <div className="flex flex-wrap gap-3 pb-3">
        <label className="flex min-w-44 flex-1 flex-col gap-1">操作人<DenSelect aria-label="操作人" value={draft.actorId ?? ""} onChange={(event) => setDraft({ ...draft, actorId: event.target.value || undefined })}>
          <option value="">所有操作人</option>{[...actors].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </DenSelect></label>
        <label className="flex min-w-44 flex-1 flex-col gap-1">结果<DenSelect aria-label="结果" value={draft.outcome ?? ""} onChange={(event) => setDraft({ ...draft, outcome: auditOperationOutcomeSchema.safeParse(event.target.value).data })}>
          <option value="">所有结果</option>{auditOperationOutcomeSchema.options.map((outcome) => <option key={outcome} value={outcome}>{auditOutcomeLabels[outcome]}</option>)}
        </DenSelect></label>
        <label className="flex min-w-44 flex-1 flex-col gap-1">来源<DenSelect aria-label="来源" value={draft.origin ?? ""} onChange={(event) => setDraft({ ...draft, origin: auditOriginSchema.safeParse(event.target.value).data })}>
          <option value="">所有来源</option>{auditOriginSchema.options.map((origin) => <option key={origin} value={origin}>{auditOriginLabels[origin]}</option>)}
        </DenSelect></label>
      </div>
    </details>
    {error ? <DenNotice tone="error" message={error} /> : null}
  </form>;
}

function AuditCompactOperations({ operations, scope, members, expanded, onExpand, onAccessError }: {
  operations: AuditOperationSummary[]; scope: AuditScope; members: readonly DenOrgMember[]; expanded: string | null;
  onExpand: (id: string | null) => void; onAccessError: (error: AuditReadError) => void;
}) {
  return <div data-testid="audit-compact-list"><ItemPanel>
    {operations.map((operation) => {
      const open = expanded === operation.id;
      const targets = [...new Set(operation.resources.filter((resource) => resource.relationship === "target").map((resource) => auditResourceLabel(resource)))].join(", ");
      return <details key={operation.id} open={open} data-testid="audit-compact-operation">
        <summary role="button" aria-label={`${open ? "隐藏" : "查看"}${auditLabel(operation.action)}的更改`} aria-expanded={open} aria-controls={`audit-operation-${operation.id}`}
          className="cursor-pointer list-none rounded-lg hover:bg-[var(--dls-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dls-border)] [&::-webkit-details-marker]:hidden"
          onClick={(event) => { event.preventDefault(); onExpand(open ? null : operation.id); }}>
          <ItemRow
            logo={<ChevronRight aria-hidden="true" strokeWidth={1.5} className={open
              ? "size-4 shrink-0 rotate-90 text-[var(--dls-text-secondary)] transition-transform duration-150 motion-reduce:transition-none"
              : "size-4 shrink-0 text-[var(--dls-text-secondary)] transition-transform duration-150 motion-reduce:transition-none"} />}
            title={<span className="block whitespace-normal break-words">{auditActorLabel(operation.initiatingActor, members, operation.origin)} {auditActionSentence(operation.action)}</span>}
            description={<span className="block whitespace-normal break-words">{targets}
              <span className="flex flex-wrap gap-x-2 sm:hidden"><AuditOutcome outcome={operation.outcome} /><AuditTime value={operation.startedAt} /></span>
            </span>}
            status={<span className="flex flex-col items-end gap-1"><AuditOutcome outcome={operation.outcome} /><AuditTime value={operation.startedAt} /></span>}
          />
        </summary>
        {open ? <div id={`audit-operation-${operation.id}`} className="px-5 pb-3">
          <AuditTimeline scope={scope} operationId={operation.id} members={members} onAccessError={onAccessError} />
          <details className="group/audit-technical"><summary className={auditTechnicalSummaryClass}><AuditChevron technical />技术详情</summary>
            <dl className="flex flex-col gap-2 break-all text-xs text-[var(--dls-text-secondary)]">
              <div><dt>操作</dt><dd className="font-mono">{operation.id}</dd></div>
              <div><dt>操作</dt><dd className="font-mono">{operation.action}</dd></div>
              <div><dt>操作人</dt><dd className="font-mono">{operation.initiatingActor.id ?? "未知"}</dd></div>
              <div><dt>范围</dt><dd className="font-mono">{operation.scope}</dd></div>
              <div><dt>来源</dt><dd>{auditOriginLabels[operation.origin]}</dd></div>
              <div><dt>来源可信度</dt><dd>{operation.originTrust === "reported" ? "已报告来源" : "已验证身份"}</dd></div>
              <div><dt>已记录事件</dt><dd>{operation.eventCount.toLocaleString(DEFAULT_DEN_LOCALE)}</dd></div>
              {operation.resources.map((resource) => <div key={`${resource.type}-${resource.id}-${resource.relationship}`}><dt>{auditLabel(resource.relationship)}</dt><dd>{auditResourceLabel(resource)}<span className="block font-mono">{resource.type}: {resource.id}</span></dd></div>)}
            </dl>
          </details>
        </div> : null}
      </details>;
    })}
  </ItemPanel></div>;
}

export function AuditLogsContent({ scope, members }: { scope: AuditScope; members: readonly DenOrgMember[] }) {
  const client = useQueryClient();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [detailAccessError, setDetailAccessError] = useState<AuditReadError | null>(null);
  const query = useAuditOperations(scope, filters);
  const eventTypes = useAuditEventTypes(scope);
  const operations = query.data?.pages.flatMap((page) => page.operations) ?? [];
  const accessError = isAuditAccessError(query.error) ? query.error : isAuditAccessError(eventTypes.error) ? eventTypes.error : detailAccessError;
  const refreshing = query.isFetching || eventTypes.isFetching;
  function applyFilters(next: AuditFilters) { setExpanded(null); setFilters(next); }
  if (accessError) return <AuditPage><AuditLocked error={accessError}>
    <DenButton variant="secondary" disabled={refreshing} onClick={() => {
      setExpanded(null); setUsageOpen(false);
      void Promise.all([query.refetch(), eventTypes.refetch()]).then((results) => { if (results.every((result) => !result.error)) setDetailAccessError(null); });
    }}>重新检查访问权限</DenButton>
  </AuditLocked></AuditPage>;
  return <AuditPage action={<DenButton variant="secondary" size="sm" disabled={refreshing} onClick={() => void client.invalidateQueries({ queryKey: auditQueryKey(scope) })}>刷新历史</DenButton>}>
    <AuditFiltersForm key={JSON.stringify(filters)} filters={filters} members={members} operations={operations} eventTypes={eventTypes.data?.eventTypes ?? []} eventTypesPending={eventTypes.isPending} onApply={applyFilters} />
    {eventTypes.isError ? <div className="flex flex-wrap items-center gap-3">
      <DenNotice tone="error" message={eventTypes.data ? "无法刷新事件类型，当前显示上次验证的目录。" : "无法加载事件类型，请重试。"} />
      <DenButton variant="secondary" size="sm" disabled={eventTypes.isFetching} onClick={() => void eventTypes.refetch()}>重新加载事件类型</DenButton>
    </div> : null}
    <div aria-busy={query.isFetching}>
      {query.isError ? <AuditReadFailure retained={Boolean(query.data)} verifiedAt={query.dataUpdatedAt} retry={() => { void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch()); }} busy={query.isFetching} /> : null}
      {query.isPending ? <ItemPanel><ItemRowsSkeleton label="正在加载审计历史" rows={5} /></ItemPanel> : operations.length ? <AuditCompactOperations operations={operations} scope={scope} members={members} expanded={expanded} onExpand={setExpanded} onAccessError={setDetailAccessError} /> : !query.isError ? <div role="status" className="flex flex-col items-start gap-3 py-8" data-testid="audit-empty">
        <p>{Object.values(filters).some(Boolean) ? "没有符合筛选条件的操作。" : "尚未保留审计操作，请在“记录与存储”中查看当前状态。"}</p>
        {Object.values(filters).some(Boolean) ? <DenButton variant="secondary" size="sm" onClick={() => applyFilters({})}>显示所有操作</DenButton> : null}
      </div> : null}
    </div>
    {query.hasNextPage ? <div className="flex items-center justify-between gap-3"><span className="text-[var(--dls-text-secondary)]">{operations.length} 项操作已加载</span><DenButton variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>加载更多操作</DenButton></div> : null}
    <details className="group border-t border-[var(--dls-border)]" onToggle={(event) => { if (event.currentTarget.open) setUsageOpen(true); }}>
      <summary className={auditSummaryClass}><AuditChevron />记录与存储</summary>
      {usageOpen ? <AuditUsage scope={scope} onAccessError={setDetailAccessError} /> : null}
    </details>
  </AuditPage>;
}
