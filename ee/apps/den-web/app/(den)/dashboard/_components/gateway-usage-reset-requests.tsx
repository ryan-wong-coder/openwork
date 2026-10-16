"use client";

import { DEFAULT_DEN_LOCALE, denStatusLabel } from "../../../_lib/locale";

import { useState } from "react";
import type { GatewayUsageResetPage, GatewayUsageResetRequest } from "@openwork/types/den/gateway-usage-limits";
import { DenBadge } from "../../_components/ui/badge";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenNotice } from "../../_components/ui/notice";
import { DenTable, type DenTableColumn } from "../../_components/ui/table";
import type { DenOrgMember } from "../../_lib/den-org";
import { formatLimitMoney, useGatewayLimitsMutation, useGatewayPolicies, useGatewayResetHistoryAvailable, useGatewayResetRequests } from "./gateway-usage-limits-data";
import { GatewayLimitsQueryFeedback, GatewayLimitTimestamp } from "./gateway-usage-limits-section";
import { timeframeLabels } from "./gateway-usage-limits-data";

function extensionPreview(request: GatewayUsageResetRequest) {
  const extension = Number((BigInt(request.baseAllowanceMicroUsd) + 3n) / 4n);
  return { extension, total: request.allowanceMicroUsd + extension };
}

function RequestTimestamp({ value }: { value: string }) {
  const date = new Date(value);
  return <time dateTime={value} title={date.toLocaleString(DEFAULT_DEN_LOCALE)} className="whitespace-nowrap text-xs text-[var(--ow-muted)]">{date.toLocaleString(DEFAULT_DEN_LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>;
}

function RequestBucketContext({ request }: { request: GatewayUsageResetRequest }) {
  const preview = extensionPreview(request);
  return <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-[var(--ow-muted)]">
    <span>{request.policyName} - {timeframeLabels[request.timeframe]}</span>
    {request.providerId ? <span data-testid="gateway-reset-provider">仅 {request.providerName ?? "已移除的提供商"}</span> : null}
    <span>{formatLimitMoney(request.usedMicroUsd)} 已用 / {formatLimitMoney(request.allowanceMicroUsd)} 额度</span>
    <span>基础额度： {formatLimitMoney(request.baseAllowanceMicroUsd)}</span>
    <span>重置时间： <GatewayLimitTimestamp value={request.resetAt} /></span>
    {request.status === "expired" ? <span>已过期 / 不符合条件</span> : null}
    {request.status === "pending" ? <span id={`gateway-reset-impact-${request.id}`}>+{formatLimitMoney(preview.extension)} 额度（{formatLimitMoney(preview.total)} 总额）；可能增加提供商费用，无法撤销。</span> : null}
    {request.status === "pending" && Date.parse(request.resetAt) <= Date.now() ? <span className="text-[var(--ow-warning)]">此周期已结束，请刷新申请以检查当前状态。</span> : null}
    {request.status === "pending" && request.baseAllowanceMicroUsd === 0 ? <span className="text-[var(--ow-warning)]">基础额度为零时，按百分比增加额度无效。</span> : null}
    {request.status === "pending" && request.usedMicroUsd >= preview.total ? <span className="text-[var(--ow-warning)]">批准后此项额度仍将耗尽。</span> : null}
  </div>;
}

function ResetRequestPages({ query, view, columns, onRefresh = query.restart, refreshing = query.isFetching }: {
  query: ReturnType<typeof useGatewayResetRequests>;
  view: GatewayUsageResetPage["view"];
  columns: DenTableColumn<GatewayUsageResetRequest>[];
  onRefresh?: () => Promise<unknown>;
  refreshing?: boolean;
}) {
  const label = view === "pending" ? "提额申请" : "申请历史";
  const rows = [...new Map(query.data?.pages.flatMap((page) => page.requests.map((request) => [request.id, request] satisfies [string, GatewayUsageResetRequest]))).values()];
  if (!query.data || (query.isError && !query.isFetchNextPageError)) {
    return <GatewayLimitsQueryFeedback query={{ ...query, refetch: onRefresh }} label={label} />;
  }
  return <div className="flex flex-col gap-3" aria-label={view === "pending" ? "待处理提额申请分页" : "提额申请历史分页"}>
    {rows.length ? <DenCard className="overflow-hidden p-0"><DenTable rows={rows} getRowKey={(row) => row.id} columns={columns} headerTone="plain" rowClassName="align-top" renderRowDetail={(request) => <RequestBucketContext request={request} />} /></DenCard> : <p role="status" className="text-sm text-[var(--ow-muted)]">{view === "pending" ? "没有待处理申请" : "没有历史申请"}</p>}
    {query.isFetchNextPageError ? <DenNotice tone="error" message={`${query.error?.message ?? "无法加载下一页，请重试。"} 仅显示之前已加载的条目。`} /> : null}
    {query.hasNextPage ? <DenButton variant="secondary" disabled={query.isFetching} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchNextPageError ? "重试加载更多" : "加载更多"} {view === "pending" ? "项待处理申请" : "历史记录"}</DenButton> : null}
    <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--ow-muted)]">
      <span>上次检查： <time dateTime={new Date(query.dataUpdatedAt).toISOString()}>{new Date(query.dataUpdatedAt).toLocaleString(DEFAULT_DEN_LOCALE)}</time> -</span>
      <DenButton variant="ghost" size="sm" className="h-auto px-0 py-0 text-xs underline-offset-4 hover:underline" disabled={refreshing} onClick={() => void onRefresh()}>刷新</DenButton>
    </div>
  </div>;
}

function ResetRequestHistory({ orgId, columns, members }: { orgId: string; columns: DenTableColumn<GatewayUsageResetRequest>[]; members: DenOrgMember[] }) {
  const history = useGatewayResetRequests(orgId, "history");
  return <section id="gateway-reset-history" className="flex flex-col gap-3" aria-label="申请历史">
    <ResetRequestPages query={history} view="history" columns={[...columns,
      { key: "status", header: "决策", render: (request) => <div className="flex flex-col gap-2"><DenBadge tone={request.status === "approved" ? "success" : "neutral"}>{denStatusLabel(request.status)}</DenBadge><span className="text-xs">{request.reviewedBy ? `审核人：${members.find((member) => member.id === request.reviewedBy)?.user.name ?? request.reviewedBy}` : "无审核人"}</span>{request.reviewedAt ? <GatewayLimitTimestamp value={request.reviewedAt} /> : null}</div> },
    ]} />
  </section>;
}

export function GatewayUsageResetRequests({ orgId, members }: { orgId: string; members: DenOrgMember[] }) {
  const policies = useGatewayPolicies(orgId);
  if (!policies.data?.policies.some((policy) => !policy.archivedAt)) return null;
  return <GatewayResetQueue key={orgId} orgId={orgId} members={members} />;
}

function GatewayResetQueue({ orgId, members }: { orgId: string; members: DenOrgMember[] }) {
  const requests = useGatewayResetRequests(orgId, "pending");
  const previousRequests = useGatewayResetHistoryAvailable(orgId);
  const mutation = useGatewayLimitsMutation(orgId);
  const [history, setHistory] = useState(false);
  const refreshing = requests.isFetching || previousRequests.isFetching;
  const refreshRequests = () => Promise.all([requests.restart(), previousRequests.refetch()]);
  const requestColumns: DenTableColumn<GatewayUsageResetRequest>[] = [
    { key: "user", header: "用户", render: (request) => <div className="flex flex-col gap-1"><span className="font-medium">{request.memberName}</span><span className="break-words text-xs text-[var(--ow-muted)]">{request.memberEmail}</span></div> },
    { key: "reason", header: "原因", render: (request) => <p className="min-w-32 max-w-sm whitespace-pre-wrap break-words">{request.reason}</p> },
    { key: "requested", header: "已申请", render: (request) => <RequestTimestamp value={request.createdAt} /> },
  ];
  const disabled = mutation.isPending || requests.isFetching || requests.isError;
  return <section aria-labelledby="gateway-reset-requests-heading" className="mb-10 flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="gateway-reset-requests-heading" className="text-lg font-semibold">限额提额申请</h2><DenButton variant="secondary" disabled={refreshing} onClick={() => void refreshRequests()}>刷新申请</DenButton></div>
    {mutation.error ? <DenNotice tone="error" message={mutation.error.message} /> : null}
    {mutation.isSuccess && mutation.data && "status" in mutation.data ? <DenNotice tone={mutation.data.status === "expired" ? "warning" : "info"} message={mutation.data.status === "expired" ? "此申请已过期或策略已更改，本次决定未授予额外额度，请检查当前额度。" : `请求${denStatusLabel(mutation.data.status)}。请查看队列和历史记录了解最新状态。`} /> : null}
    <ResetRequestPages query={requests} view="pending" onRefresh={refreshRequests} refreshing={refreshing} columns={[...requestColumns,
      { key: "actions", header: "操作", align: "right", render: (request) => <div className="flex flex-wrap justify-end gap-2">
        <DenButton size="sm" disabled={disabled || request.status !== "pending" || request.baseAllowanceMicroUsd === 0 || Date.parse(request.resetAt) <= Date.now()} aria-label={`为 ${request.memberName} 批准 25%，${timeframeLabels[request.timeframe]}`} aria-describedby={request.status === "pending" ? `gateway-reset-impact-${request.id}` : undefined} onClick={() => mutation.mutate({ type: "approve", requestId: request.id })}>批准增加 25%</DenButton>
        <DenButton size="sm" variant="secondary" disabled={disabled || request.status !== "pending"} aria-label={`拒绝 ${request.memberName} 的请求，${timeframeLabels[request.timeframe]}`} onClick={() => mutation.mutate({ type: "deny", requestId: request.id })}>拒绝</DenButton>
      </div> },
    ]} />
    {previousRequests.isError ? <DenNotice tone="error" message="无法检查历史申请，请刷新后重试。" /> : null}
    {previousRequests.data || history ? <details className="text-sm" open={history} onToggle={(event) => setHistory(event.currentTarget.open)}>
      <summary className="cursor-pointer text-[var(--ow-muted)]">历史申请</summary>
      {history ? <div className="pt-3"><ResetRequestHistory orgId={orgId} columns={requestColumns} members={members} /></div> : null}
    </details> : null}
  </section>;
}
