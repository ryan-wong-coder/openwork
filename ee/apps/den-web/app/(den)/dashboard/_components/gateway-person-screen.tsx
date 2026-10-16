"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { DenBadge } from "../../_components/ui/badge";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import type { GatewayUsageBucket, GatewayUsageLimitPolicy, GatewayUsageStatus } from "@openwork/types/den/gateway-usage-limits";
import { getAiGatewayLimitRoute, getAiGatewayProvidersRoute, getAiGatewayUsersTeamsRoute, getNewAiGatewayLimitRoute, type DenOrgMember, type DenOrgTeam } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { formatUsageCost } from "../_features/analytics/stacked-daily-chart";
import { accessReason, directoryAccess, memberSubject, providerAudienceLabel } from "./gateway-directory-data";
import { initials, ModelMark, ShareBar } from "./gateway-spend-breakdown";
import { useGatewayAccessProviders } from "./gateway-subject-access-data";
import { gatewayUsageTotals, useGatewayUsage } from "./gateway-usage-data";
import { formatLimitMoney, timeframePeriods, useGatewayMemberUsage, useGatewayPolicies } from "./gateway-usage-limits-data";
import { GatewayLimitsQueryFeedback, GatewayMemberUsageDetails } from "./gateway-usage-limits-section";
import { getProviderIconSlug } from "./llm-provider-data";

const CARD = "rounded-[12px] border border-gray-100 bg-white p-4";
const CARD_TITLE = "text-[13px] font-medium text-gray-900";

export function GatewayPersonScreen({ memberId }: { memberId: string }) {
  const { orgId, orgSlug, orgContext } = useOrgDashboard();
  if (!orgId || !orgContext) return <p role="status" className="text-sm text-gray-500">正在加载…</p>;
  const member = orgContext.members.find((entry) => entry.id === memberId);
  if (!member) return <DenNotice tone="info" message="此人员不在你的组织中。" />;
  return <GatewayPerson key={`${orgId}:${memberId}`} orgId={orgId} orgSlug={orgSlug} member={member} teams={orgContext.teams} members={orgContext.members} />;
}

export function GatewayPerson({ orgId, orgSlug, member, teams, members }: { orgId: string; orgSlug: string | null | undefined; member: DenOrgMember; teams: DenOrgTeam[]; members: DenOrgMember[] }) {
  const name = member.user.name || member.user.email;
  const memberTeams = teams.filter((team) => team.memberIds.includes(member.id));
  return (
    <div className="flex flex-col gap-3" data-testid="gateway-person">
      <Link href={getAiGatewayUsersTeamsRoute(orgSlug)} className="inline-flex w-fit items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />返回用户与团队
      </Link>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-gray-100 text-[13px] font-semibold text-gray-700">{initials(name)}</span>
        <h2 className="text-[20px] font-medium tracking-[-0.01em] text-gray-950">{name}</h2>
        {memberTeams.map((team) => <DenBadge key={team.id}>{team.name}</DenBadge>)}
      </div>
      <PersonSpend orgId={orgId} memberId={member.id} />
      <PersonAccess orgId={orgId} orgSlug={orgSlug} member={member} teams={teams} members={members} />
      <PersonLimit orgId={orgId} orgSlug={orgSlug} memberId={member.id} name={name} teams={teams} />
      <PersonModels orgId={orgId} memberId={member.id} />
    </div>
  );
}

function PersonSpend({ orgId, memberId }: { orgId: string; memberId: string }) {
  const usage = useGatewayUsage(orgId, "person", [memberId]);
  const total = usage.data ? gatewayUsageTotals(usage.data).find((row) => row.id === memberId) : undefined;
  return (
    <section className={CARD} aria-label="最近 31 天" data-testid="gateway-person-spend">
      <h3 className={CARD_TITLE}>最近 31 天</h3>
      {usage.isPending ? <p role="status" className="mt-2 text-[13px] text-gray-500">正在加载…</p>
        : usage.isError ? <ErrorRetry message={usage.error.message} onRetry={() => void usage.refetch()} />
          : (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums text-gray-950">{total?.unpriced && !total.costMicroUsd ? "未知" : formatUsageCost(total?.costMicroUsd ?? 0)}</span>
              <span className="text-[13px] text-gray-500">{(total?.tokens ?? 0).toLocaleString(DEFAULT_DEN_LOCALE)} Token</span>
            </div>
          )}
    </section>
  );
}

function PersonAccess({ orgId, orgSlug, member, teams, members }: { orgId: string; orgSlug: string | null | undefined; member: DenOrgMember; teams: DenOrgTeam[]; members: DenOrgMember[] }) {
  const providers = useGatewayAccessProviders(orgId);
  const granted = providers.data ? directoryAccess(providers.data, memberSubject(member, teams)) : [];
  const withheld = (providers.data ?? []).filter((provider) => provider.status !== "disabled" && !granted.some((entry) => entry.provider.id === provider.id));
  return (
    <section className={CARD} aria-label="可用内容" data-testid="gateway-person-access">
      <div className="flex items-center justify-between gap-3">
        <h3 className={CARD_TITLE}>可用内容</h3>
        <Link href={getAiGatewayProvidersRoute(orgSlug)} className="text-[12px] font-medium text-gray-700 hover:text-gray-950">在 AI 提供商中更改</Link>
      </div>
      {providers.isPending ? <p role="status" className="mt-2 text-[13px] text-gray-500">正在加载…</p>
        : providers.isError ? <ErrorRetry message={providers.error.message} onRetry={() => void providers.refetch()} />
          : granted.length === 0 && withheld.length === 0 ? <p role="status" className="mt-2 text-[13px] text-gray-500">暂无提供商，请在“AI 提供商”中添加。</p>
            : (
              <ul className="mt-1 divide-y divide-gray-100">
                {granted.map(({ provider, sources }) => (
                  <li key={provider.id} className="flex items-center gap-3 py-2.5" data-testid="gateway-person-access-row">
                    <DenBrandMark name={provider.name} simpleIconSlug={getProviderIconSlug(provider.providerId)} className="h-7 w-7 shrink-0 rounded-[8px]" imageClassName="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-900">{provider.name}</span>
                    <span className="shrink-0 text-[12px] text-gray-500">{accessReason(sources, teams)}</span>
                  </li>
                ))}
                {withheld.map((provider) => (
                  <li key={provider.id} className="flex items-center gap-3 py-2.5 opacity-60" data-testid="gateway-person-access-withheld">
                    <DenBrandMark name={provider.name} simpleIconSlug={getProviderIconSlug(provider.providerId)} className="h-7 w-7 shrink-0 rounded-[8px]" imageClassName="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700">{provider.name}</span>
                    <DenBadge>{providerAudienceLabel(provider, teams, members)}</DenBadge>
                  </li>
                ))}
              </ul>
            )}
    </section>
  );
}

function stateLabel(state: GatewayUsageStatus["state"]) {
  return state === "blocked" ? "已暂停" : state === "over_limit" ? "已超出限额" : "未超出限额";
}

function LimitRows({ buckets, active, orgSlug }: { buckets: GatewayUsageBucket[]; active: GatewayUsageLimitPolicy[]; orgSlug: string | null | undefined }) {
  return (
    <ul className="divide-y divide-gray-100">
      {buckets.map((bucket) => (
        <li key={bucket.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="gateway-person-limit-row">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-gray-900">{formatLimitMoney(bucket.allowanceMicroUsd)} {timeframePeriods[bucket.timeframe]}</span>
            <span className="block text-[12px] text-gray-500">{bucket.policyName} · {bucket.hardLimit ? "达到限额时暂停" : "仅警告"}</span>
          </span>
          <span className="flex w-36 flex-col gap-1">
            <ShareBar value={Math.min(bucket.usedMicroUsd, bucket.allowanceMicroUsd)} max={bucket.allowanceMicroUsd} label={`已用 ${formatLimitMoney(bucket.usedMicroUsd)} / ${formatLimitMoney(bucket.allowanceMicroUsd)}`} />
            <span className="text-[11px] tabular-nums text-gray-500">已用 {formatLimitMoney(bucket.usedMicroUsd)}</span>
          </span>
          {active.some((policy) => policy.id === bucket.policyId)
            ? <Link href={getAiGatewayLimitRoute(orgSlug, bucket.policyId)} className={buttonVariants({ variant: "secondary", size: "sm" })}>编辑</Link>
            : null}
        </li>
      ))}
    </ul>
  );
}

function PersonLimit({ orgId, orgSlug, memberId, name, teams }: { orgId: string; orgSlug: string | null | undefined; memberId: string; name: string; teams: DenOrgTeam[] }) {
  const status = useGatewayMemberUsage(orgId, memberId);
  const policies = useGatewayPolicies(orgId);
  const active = policies.data?.policies.filter((policy) => !policy.archivedAt) ?? [];
  const providers = status.data?.providers ?? [];
  return (
    <section className={CARD} aria-label="消费限额" data-testid="gateway-person-limit">
      <h3 className={CARD_TITLE}>消费限额</h3>
      <div className="mt-2">
        <GatewayLimitsQueryFeedback query={status} label="消费限额" />
      </div>
      {!status.isError && status.data ? (
        <>
          {providers.length && status.data.state === "unlimited" ? <h4 className="mb-2 mt-1 text-[12px] font-medium text-gray-700">其他提供商</h4> : null}
          {status.data.state === "unlimited" ? (
            <div className="flex flex-wrap items-center gap-3">
              <DenBadge>无限制</DenBadge>
              <span className="min-w-0 flex-1 text-[13px] text-gray-500">{providers.length ? `${name} 的其他提供商没有暂停限制。` : `${name} 的模型没有暂停限制。`}</span>
              <Link href={getNewAiGatewayLimitRoute(orgSlug, { memberId })} className={buttonVariants({ variant: "secondary", size: "sm" })} data-testid="gateway-person-set-limit">设置限额</Link>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                {providers.length ? <h4 className="text-[12px] font-medium text-gray-700">其他提供商</h4> : null}
                <DenBadge tone={status.data.state === "within_limit" ? "neutral" : "warning"}>{stateLabel(status.data.state)}</DenBadge>
              </div>
              <LimitRows buckets={status.data.buckets} active={active} orgSlug={orgSlug} />
            </>
          )}
          {providers.map((provider) => (
            <div key={provider.providerId} className="mt-3 border-t border-gray-100 pt-3" data-testid="gateway-person-provider-limit">
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-[12px] font-medium text-gray-700">仅 {provider.providerName}</h4>
                <DenBadge tone={provider.state === "within_limit" ? "neutral" : "warning"}>{stateLabel(provider.state)}</DenBadge>
              </div>
              <LimitRows buckets={provider.buckets} active={active} orgSlug={orgSlug} />
            </div>
          ))}
          {status.data.state !== "unlimited" ? (
            <details className="group mt-2 text-[12px] text-gray-500">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                技术详情
              </summary>
              <div className="pt-3">
                <GatewayMemberUsageDetails status={status.data} policies={active.filter((policy) => !policy.providerId)} teams={teams} />
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function PersonModels({ orgId, memberId }: { orgId: string; memberId: string }) {
  const usage = useGatewayUsage(orgId, "model", [], memberId);
  const rows = usage.data ? gatewayUsageTotals(usage.data) : [];
  const max = rows[0]?.costMicroUsd ?? 0;
  return (
    <section className={CARD} aria-label="使用的模型" data-testid="gateway-person-models">
      <h3 className={CARD_TITLE}>使用的模型</h3>
      {usage.isPending ? <p role="status" className="mt-2 text-[13px] text-gray-500">正在加载…</p>
        : usage.isError ? <ErrorRetry message={usage.error.message} onRetry={() => void usage.refetch()} />
          : rows.length === 0 ? <p role="status" className="mt-2 text-[13px] text-gray-500">最近 31 天没有请求。</p>
            : (
              <ul className="mt-1 divide-y divide-gray-100">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 py-2.5" data-testid="gateway-person-model-row">
                    <ModelMark seriesId={row.id} label={row.label} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-900">{row.label}</span>
                    <ShareBar value={row.costMicroUsd} max={max} label={`已消费 ${formatUsageCost(row.costMicroUsd)}`} />
                    <span className="w-20 shrink-0 text-right text-[13px] font-medium tabular-nums text-gray-950">{row.unpriced && !row.costMicroUsd ? "未知" : formatUsageCost(row.costMicroUsd)}</span>
                  </li>
                ))}
              </ul>
            )}
    </section>
  );
}

function ErrorRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-2 flex flex-col items-start gap-3" role="alert">
      <DenNotice tone="error" message={message} />
      <DenButton size="sm" variant="secondary" onClick={onRetry}>重试</DenButton>
    </div>
  );
}
