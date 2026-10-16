"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { ChevronRight, Gauge, Globe, LockKeyhole, User, Users } from "lucide-react";
import type { GatewayUsageLimitPolicy, GatewayUsageStatus } from "@openwork/types/den/gateway-usage-limits";
import { DenBadge } from "../../_components/ui/badge";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenCombobox } from "../../_components/ui/combobox";
import { DenNotice } from "../../_components/ui/notice";
import { DenTable } from "../../_components/ui/table";
import { getAiGatewayLimitRoute, getAiGatewayLimitsRoute, getAiGatewayPersonRoute, getNewAiGatewayLimitRoute, type DenOrgMember, type DenOrgTeam } from "../../_lib/den-org";
import { useGatewayAccessProviders } from "./gateway-subject-access-data";
import { describeWho } from "./gateway-limit-editor-screen";
import { formatLimitMoney, timeframeLabels, timeframePeriods, useGatewayLimitsMutation, useGatewayMembers, useGatewayPolicies, type GatewayUsageMember } from "./gateway-usage-limits-data";

type Directory = { teams: DenOrgTeam[]; members: DenOrgMember[] };
type OrgSlug = string | null | undefined;

export function GatewayLimitsQueryFeedback({ query, label }: { query: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown }; label: string }) {
  if (query.isError) return <div className="flex flex-col gap-3" role="alert"><DenNotice tone="error" message={query.error?.message ?? `无法加载${label}。`} /><DenButton variant="secondary" onClick={() => void query.refetch()}>重试 {label}</DenButton></div>;
  if (query.isPending) return <p role="status" className="text-sm text-[var(--ow-muted)]">正在加载 {label}…</p>;
  return null;
}

export function GatewayLimitTimestamp({ value }: { value: string }) {
  return <time dateTime={value} title={value}>{new Date(value).toLocaleString(DEFAULT_DEN_LOCALE, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short", hour12: false })} UTC</time>;
}

function MemberInitials({ member }: { member: GatewayUsageMember }) {
  return <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ow-line)] text-xs font-semibold uppercase">
    {(member.name || member.email).split(" ").map((part) => part[0]).join("").slice(0, 2)}
  </span>;
}

export function MemberSearch({ orgId, label, onSelect }: { orgId: string; label: string; onSelect: (member: GatewayUsageMember) => void }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const results = useGatewayMembers(orgId, deferredQuery);
  const pending = results.isPending || results.isFetching || deferredQuery !== query;
  const optionsDisabled = pending || results.isError;
  return <div className="flex flex-col gap-3">
    <DenCombobox
      ariaLabel={label}
      value=""
      placeholder="选择人员"
      searchPlaceholder="按姓名或邮箱搜索人员"
      emptyLabel="没有匹配的人员"
      searchFeedback={optionsDisabled ? <GatewayLimitsQueryFeedback query={{ ...results, isPending: pending, isError: deferredQuery === query && results.isError }} label="成员" /> : null}
      maxSearchLength={200}
      serverFiltered
      optionsDisabled={optionsDisabled}
      onSearchChange={setQuery}
      options={(results.isError ? [] : results.data?.members ?? []).map((member) => ({
        value: member.id,
        label: member.name || member.email,
        description: member.email,
        icon: <MemberInitials member={member} />,
      }))}
      onChange={(id) => {
        if (optionsDisabled) return;
        const member = results.data?.members.find((person) => person.id === id);
        if (member) onSelect(member);
      }}
    />
  </div>;
}

function GatewayUsageCoverage({ coverage }: { coverage: GatewayUsageStatus["coverage"] }) {
  const historicalUnknown = coverage.historicalCoverage === "unknown" || coverage.historicalUnknownReason != null;
  const incomplete = !coverage.complete || historicalUnknown || coverage.unpricedRequests > 0
    || (coverage.incompleteRequests ?? 0) > 0 || (coverage.quarantinedRequests ?? 0) > 0;
  const history = !historicalUnknown ? "" : coverage.historicalUnknownReason === "tracking_not_started"
    ? "用量跟踪尚未开始，之前的用量未知。"
    : coverage.historicalUnknownReason === "period_predates_tracking"
      ? "此时段包含用量跟踪开始前的时间，之前的用量未知。"
      : coverage.historicalUnknownReason === "legacy_counter"
        ? "用量历史包含统计覆盖率未知的旧计数。"
        : "历史用量统计覆盖率未知。";
  const details = [
    history,
    coverage.unpricedRequests > 0 ? `${coverage.unpricedRequests} 条已记录请求的费用尚未确定，未知费用不代表零费用。` : "",
    (coverage.incompleteRequests ?? 0) > 0 ? `${coverage.incompleteRequests} 条已记录请求的计费信息不完整。` : "",
    (coverage.quarantinedRequests ?? 0) > 0 ? `${coverage.quarantinedRequests} 条未解决的历史请求已隔离，未重复扣费。` : "",
  ].filter(Boolean).join(" ");
  return <>
    {incomplete ? <DenNotice tone="warning" message={`计费信息不完整。${details}${details ? " " : ""}已知费用为小计，并非完整消费金额。`} />
      : <p className="text-sm text-[var(--ow-muted)]">已记录用量统计完整，所有费用均为估算值。</p>}
    {coverage.settlementReady !== true ? typeof coverage.pendingRequests === "number" && coverage.pendingRequests > 0 ? <p role="status" className="text-sm text-[var(--ow-muted)]">{coverage.pendingRequests} 项已跟踪请求正在等待结算。</p>
      : coverage.pendingRequests === null ? <p role="status" className="text-sm text-[var(--ow-muted)]">待结算数量不可用。</p>
        : coverage.settlementReady === false ? <p role="status" className="text-sm text-[var(--ow-muted)]">结算尚未确认。</p> : null : null}
    {coverage.trackingStartedAt || coverage.lastSettlementAt || coverage.settlementReady === true ? <details className="group text-sm text-[var(--ow-muted)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} aria-hidden="true" className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
        用量统计详情
      </summary>
      <div className="flex flex-col gap-2 pt-3">
        {coverage.trackingStartedAt ? <p>用量跟踪开始时间： <GatewayLimitTimestamp value={coverage.trackingStartedAt} /></p> : null}
        {coverage.settlementReady === true ? <p>没有已跟踪请求等待结算。</p> : null}
        {coverage.lastSettlementAt ? <p>上次结算： <GatewayLimitTimestamp value={coverage.lastSettlementAt} /></p> : null}
      </div>
    </details> : null}
  </>;
}

export function GatewayMemberUsageDetails({ status, policies, teams }: { status: GatewayUsageStatus; policies: GatewayUsageLimitPolicy[]; teams: DenOrgTeam[] }) {
  const matchingPolicies = policies.filter((policy) => !policy.archivedAt && policy.assignments.some((assignment) => assignment.organization || assignment.memberId === status.memberId || teams.some((team) => team.id === assignment.teamId && team.memberIds.includes(status.memberId))));
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-3"><DenBadge tone={status.state === "over_limit" ? "warning" : "neutral"} icon={status.state === "blocked" ? LockKeyhole : undefined}>{status.state === "unlimited" ? "不限额" : status.state === "blocked" ? "已阻止" : status.state === "over_limit" ? "已超出额度" : "未超出额度"}</DenBadge><span className="text-xs text-[var(--ow-muted)]">已更新 <GatewayLimitTimestamp value={status.serverTime} /></span></div>
    {status.state === "unlimited" ? <p>尚未分配用量限额策略，其他提供商、订阅和服务限额仍适用。</p> : null}
    {status.state === "over_limit" ? <DenNotice tone="warning" message="已超出估算用量额度；这些为软限额，请求仍可执行。" /> : null}
    {status.state === "blocked" ? <DenNotice tone="warning" message="硬限额耗尽后将阻止后续网关请求，所有阻止请求的额度均恢复后才能继续访问。" /> : null}
    <GatewayUsageCoverage coverage={status.coverage} />
    {status.buckets.length > 0 ? <DenCard className="overflow-hidden p-0">
      <DenTable rows={status.buckets} getRowKey={(bucket) => bucket.id} headerTone="plain" rowClassName="align-top" columns={[
        { key: "policy", header: "策略", width: "100%", render: (bucket) => (
          <div className="flex min-w-64 flex-col gap-3">
            <div className="flex flex-col items-start gap-2">
              <span className="break-words font-medium">{bucket.policyName} - {timeframeLabels[bucket.timeframe]}</span>
              <div className="flex flex-wrap gap-2">
                <DenBadge>{bucket.hardLimit ? "硬限额" : "软限额"}</DenBadge>
                <DenBadge>{bucket.allowRequestReset ? "提额申请已开启" : "提额申请已关闭"}</DenBadge>
              </div>
            </div>
            <dl aria-label={`${bucket.policyName} 至 ${timeframeLabels[bucket.timeframe]} 的额度`} className="flex flex-wrap gap-x-5 gap-y-2 text-sm tabular-nums">
              <div className="flex items-baseline gap-2"><dt className="text-[var(--ow-muted)]">基础额度</dt><dd className="font-medium">{formatLimitMoney(bucket.baseAllowanceMicroUsd)}</dd></div>
              <div className="flex items-baseline gap-2"><dt className="text-[var(--ow-muted)]">额外额度</dt><dd className="font-medium">{formatLimitMoney(bucket.extensionMicroUsd)}</dd></div>
              <div className="flex items-baseline gap-2"><dt className="text-[var(--ow-muted)]">总计</dt><dd className="font-medium">{formatLimitMoney(bucket.allowanceMicroUsd)}</dd></div>
            </dl>
          </div>
        ) },
        { key: "usage", header: "用量", align: "right", render: (bucket) => (
          <div className="flex flex-col gap-1 whitespace-nowrap text-sm tabular-nums">
            <span className="font-medium">已用 {formatLimitMoney(bucket.usedMicroUsd)}</span>
            <span className={bucket.remainingMicroUsd < 0 ? "text-[var(--ow-warning)]" : "text-[var(--ow-muted)]"}>{bucket.remainingMicroUsd < 0 ? `超出额度 ${formatLimitMoney(-bucket.remainingMicroUsd)}` : `剩余 ${formatLimitMoney(bucket.remainingMicroUsd)}`}</span>
            <span className="mt-1 text-xs text-[var(--ow-muted)]">重置时间 <GatewayLimitTimestamp value={bucket.resetAt} /></span>
          </div>
        ) },
      ]} renderRowDetail={(bucket) => <details className="group text-sm">
        <summary aria-label={`${bucket.policyName} 至 ${timeframeLabels[bucket.timeframe]} 的生效策略与分配情况`} className="flex cursor-pointer list-none items-center gap-2 text-[var(--ow-muted)] [&::-webkit-details-marker]:hidden">
          <ChevronRight size={16} aria-hidden="true" className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
          生效策略与分配信息
        </summary>
        <div className="flex flex-col gap-2 pt-3">
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex gap-1"><dt>提额申请</dt><dd>{bucket.allowRequestReset ? "允许" : "已禁用"}</dd></div>
            <div className="flex gap-1"><dt>申请状态</dt><dd>{bucket.resetRequestStatus ?? (bucket.canRequestReset ? "可申请提额" : "当前不符合提额条件")}</dd></div>
          </dl>
          <p>各周期采用最高额度及其硬限额和提额设置。额度相同时依次优先选择硬限额、允许提额的策略，再按策略 ID 确定。</p>
          <section aria-label="服务器选定的分配快照" className="flex flex-col gap-2">
            <h5 className="font-medium">服务器选定的快照</h5>
            <dl className="flex flex-wrap gap-x-4 gap-y-1">
              <div className="flex gap-1"><dt>策略</dt><dd>{bucket.policyName}</dd></div>
              <div className="flex gap-1"><dt>修订版本</dt><dd>{bucket.policyRevision ?? "此快照中不可用"}</dd></div>
            </dl>
            {bucket.provenance?.length ? <ul className="flex flex-col gap-2">{bucket.provenance.map((source) => <li key={source.assignmentId}>
              {source.kind === "organization" ? "组织中的所有人" : source.kind === "direct" ? "直接分配" : `团队：${source.teamName}`}
            </li>)}</ul> : <p className="text-[var(--ow-muted)]">此快照未提供分配来源。</p>}
          </section>
          <h5 className="font-medium">当前目录策略对比</h5>
          <p className="text-[var(--ow-muted)]">这些对比策略与成员关系来自当前组织目录，并非上方服务器选定的快照。</p>
          <ul className="flex flex-col gap-2">{matchingPolicies.flatMap((policy) => policy.limits.filter((limit) => limit.timeframe === bucket.timeframe).map((limit) => <li key={policy.id}>
            <dl className="flex flex-wrap gap-x-4 gap-y-1">
              <div className="flex gap-1"><dt>策略</dt><dd>{policy.name}</dd></div>
              <div className="flex gap-1"><dt>修订版本</dt><dd>{policy.revision}</dd></div>
              <div className="flex gap-1"><dt>额度</dt><dd>{formatLimitMoney(limit.costLimitMicroUsd)}</dd></div>
              <div className="flex gap-1"><dt>选择情况</dt><dd>{policy.id === bucket.policyId ? "已选策略" : "未选中"}</dd></div>
              <div className="flex gap-1"><dt>分配</dt><dd>{policy.assignments.flatMap((assignment) => {
                if (assignment.organization) return ["组织中的所有人"];
                if (assignment.memberId === status.memberId) return ["直接分配"];
                const team = teams.find((item) => item.id === assignment.teamId && item.memberIds.includes(status.memberId));
                return team ? [`团队：${team.name}`] : [];
              }).join(", ")}</dd></div>
            </dl>
          </li>))}</ul>
        </div>
      </details>} />
    </DenCard> : null}
  </div>;
}

const periodOrder = { day: 0, week: 1, month: 2 };

export function describeLimitAmounts(policy: GatewayUsageLimitPolicy): string {
  return [...policy.limits].sort((a, b) => periodOrder[a.timeframe] - periodOrder[b.timeframe])
    .map((limit) => `${formatLimitMoney(limit.costLimitMicroUsd)} ${timeframePeriods[limit.timeframe]}`).join(", ");
}

function policyWho(policy: GatewayUsageLimitPolicy, teams: DenOrgTeam[], members: DenOrgMember[]) {
  return describeWho({
    organization: policy.assignments.some((assignment) => assignment.organization),
    teamIds: policy.assignments.flatMap((assignment) => assignment.teamId ? [assignment.teamId] : []),
    memberIds: policy.assignments.flatMap((assignment) => assignment.memberId ? [assignment.memberId] : []),
  }, teams, members);
}

function targetKind(policy: GatewayUsageLimitPolicy): string {
  if (policy.assignments.some((assignment) => assignment.organization)) return "组织中的所有人";
  const teams = policy.assignments.filter((assignment) => assignment.teamId).length;
  const people = policy.assignments.filter((assignment) => assignment.memberId).length;
  return [teams ? `${teams} 个团队` : "", people ? `${people} 人` : ""].filter(Boolean).join(", ");
}

function LimitIcon({ policy }: { policy: GatewayUsageLimitPolicy }) {
  const Icon = policy.assignments.some((assignment) => assignment.organization) ? Globe
    : policy.assignments.every((assignment) => assignment.memberId) && policy.assignments.length > 0 ? User : Users;
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500"><Icon className="h-4 w-4" aria-hidden="true" /></span>;
}

function DeletedLimitNote({ orgId, orgSlug, policy }: { orgId: string; orgSlug: OrgSlug; policy: GatewayUsageLimitPolicy }) {
  const router = useRouter();
  const mutation = useGatewayLimitsMutation(orgId);
  if (!policy.archivedAt) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-[13px] text-gray-700" data-testid="gateway-limit-deleted">
      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden="true" />
      <span>已删除 {policy.name}，此限制不再适用于任何人。</span>
      <DenButton variant="ghost" size="sm" className="h-auto px-1 py-0 text-[13px] underline underline-offset-4" loading={mutation.isPending}
        data-testid="gateway-limit-undo"
        onClick={() => mutation.mutate({ type: "restore", policy: { id: policy.id, revision: policy.revision } }, { onSuccess: () => router.replace(getAiGatewayLimitsRoute(orgSlug)) })}>
        撤销
      </DenButton>
      {mutation.error ? <DenNotice tone="error" message={mutation.error.message} /> : null}
    </div>
  );
}

function PersonLookup({ orgId, orgSlug }: { orgId: string; orgSlug: OrgSlug }) {
  const router = useRouter();
  return (
    <section aria-label="查看人员用量" className="flex max-w-md flex-col gap-2">
      <h3 className="text-[13px] font-medium text-gray-900">查看人员用量</h3>
      <MemberSearch orgId={orgId} label="查找人员" onSelect={(member) => router.push(getAiGatewayPersonRoute(orgSlug, member.id))} />
    </section>
  );
}

/** Name of the provider a limit is for, or "All providers" for a default limit. */
export function providerLimitLabel(providerId: string | null | undefined, providers: { id: string; name: string }[] | undefined): string {
  if (!providerId) return "所有提供商";
  if (!providers) return "一个提供商";
  return providers.find((provider) => provider.id === providerId)?.name ?? "已移除的提供商";
}

/** One spend limit: who it applies to, its provider, amounts, what happens at the limit, and Edit. */
export function GatewayLimitRow({ policy, orgSlug, teams, members, providerColumn, providerLimits, providers, canEdit = true }: {
  policy: GatewayUsageLimitPolicy;
  orgSlug: OrgSlug;
  providerColumn: boolean;
  providerLimits: boolean;
  providers: { id: string; name: string }[] | undefined;
  canEdit?: boolean;
} & Directory) {
  const who = policyWho(policy, teams, members);
  return (
    <li className="flex items-center gap-3 px-4 py-3" data-testid="gateway-limit-row" data-policy-id={policy.id}>
      <LimitIcon policy={policy} />
      <span className="flex min-w-0 flex-[1.2] flex-col">
        <span className="truncate text-[13px] font-medium text-gray-900">{policy.name}</span>
        <span className="truncate text-[12px] text-gray-500">{!who ? "尚未应用到任何人" : who === policy.name ? targetKind(policy) : who}</span>
      </span>
      {providerColumn ? (
        <span className="flex w-36 shrink-0 flex-col" data-testid="gateway-limit-provider-label">
          <span className="truncate text-[12px] text-gray-700">{providerLimitLabel(policy.providerId, providers)}</span>
          {policy.providerId && !providerLimits ? <span className="text-[11px] text-gray-500">关闭时不执行限制</span> : null}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-[13px] tabular-nums text-gray-700">每人 {describeLimitAmounts(policy)}</span>
      <span className="w-28 shrink-0 text-[12px] text-gray-600">{policy.hardLimit ? "暂停模型" : "仅警告"}</span>
      {canEdit ? <Link href={getAiGatewayLimitRoute(orgSlug, policy.id)} aria-label={`编辑 ${policy.name}`} data-testid="gateway-limit-edit" className={buttonVariants({ variant: "secondary", size: "sm" })}>编辑</Link> : null}
    </li>
  );
}

export function GatewayUsageLimitsSection({ orgId, orgSlug, teams, members, providerLimits = false }: { orgId: string; orgSlug: OrgSlug; providerLimits?: boolean } & Directory) {
  const policies = useGatewayPolicies(orgId);
  const searchParams = useSearchParams();
  const deletedId = searchParams?.get("deleted") ?? null;
  // Default limits first, then each provider's limits together.
  const active = (policies.data?.policies.filter((policy) => !policy.archivedAt) ?? [])
    .map((policy, index) => ({ policy, index }))
    .sort((a, b) => (a.policy.providerId ?? "").localeCompare(b.policy.providerId ?? "") || a.index - b.index)
    .map(({ policy }) => policy);
  const hasProviderLimits = providerLimits || active.some((policy) => policy.providerId);
  const providers = useGatewayAccessProviders(orgId, hasProviderLimits);
  const deleted = deletedId ? policies.data?.policies.find((policy) => policy.id === deletedId) : undefined;
  return (
    <section aria-labelledby="gateway-usage-limits-heading" className="flex flex-col gap-5" data-testid="gateway-limits">
      {deleted ? <DeletedLimitNote orgId={orgId} orgSlug={orgSlug} policy={deleted} /> : null}
      <GatewayLimitsQueryFeedback query={policies} label="limits" />
      {!policies.isError && policies.data && active.length === 0 ? (
        <DenCard className="flex flex-col items-center gap-4 px-8 py-16 text-center" data-testid="gateway-limits-empty">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-gray-50 text-gray-600"><Gauge className="h-[18px] w-[18px]" aria-hidden="true" /></span>
          <span className="flex flex-col gap-1">
            <h2 id="gateway-usage-limits-heading" className="text-[15px] font-medium text-gray-950">暂无消费限额</h2>
            <span className="text-[13px] text-gray-500">为所有人、团队或个人设置每日、每周或每月额度。</span>
          </span>
          <Link href={getNewAiGatewayLimitRoute(orgSlug)} className={buttonVariants({ variant: "primary", size: "sm" })} data-testid="gateway-limit-new">新建限额</Link>
          <span className="text-[12px] text-gray-500">OpenWork 模型有独立的内含用量。</span>
        </DenCard>
      ) : null}
      {!policies.isError && active.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="gateway-usage-limits-heading" className="text-[16px] font-medium tracking-[-0.01em] text-gray-950">限额</h2>
            <Link href={getNewAiGatewayLimitRoute(orgSlug)} className={buttonVariants({ variant: "primary", size: "sm" })} data-testid="gateway-limit-new">新建限额</Link>
          </div>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-[12px] border border-gray-100 bg-white" aria-label="消费限额">
            {active.map((policy) => (
              <GatewayLimitRow key={policy.id} policy={policy} orgSlug={orgSlug} teams={teams} members={members} providerColumn={hasProviderLimits} providerLimits={providerLimits} providers={providers.data} />
            ))}
          </ul>
          <PersonLookup orgId={orgId} orgSlug={orgSlug} />
        </>
      ) : null}
    </section>
  );
}
