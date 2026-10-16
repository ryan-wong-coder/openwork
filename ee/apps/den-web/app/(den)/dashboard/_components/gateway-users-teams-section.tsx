"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ChevronRight, Globe, Search, Users, X } from "lucide-react";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenSegmented } from "../../_components/ui/segmented";
import {
  getAiGatewayLimitRoute,
  getAiGatewayPersonRoute,
  getAiGatewayUsersTeamsRoute,
  getMembersRoute,
  getNewAiGatewayLimitRoute,
  type DenOrgContext,
  type DenOrgTeam,
} from "../../_lib/den-org";
import { formatUsageCost } from "../_features/analytics/stacked-daily-chart";
import { directoryAccess, directoryLimit, limitSourceLabel, limitSummary, memberSubject, type DirectorySubject } from "./gateway-directory-data";
import { initials } from "./gateway-spend-breakdown";
import { useGatewayAccessProviders, type GatewayAccessProvider } from "./gateway-subject-access-data";
import { gatewayUsageTotals, useGatewayUsage } from "./gateway-usage-data";
import { useGatewayPolicies } from "./gateway-usage-limits-data";
import { getProviderIconSlug } from "./llm-provider-data";
import type { GatewayUsageLimitPolicy } from "@openwork/types/den/gateway-usage-limits";

type DirectoryView = "people" | "teams";

const ROW = "grid grid-cols-[32px_minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.5fr)_80px_14px] items-center gap-3.5 px-4";
const PAGE_SIZE = 50;
const VISIBLE_MARKS = 4;

function ProviderMarks({ providers }: { providers: GatewayAccessProvider[] }) {
  if (!providers.length) return <span className="text-[12px] text-gray-400">暂无内容</span>;
  const hidden = providers.length - VISIBLE_MARKS;
  return (
    <span className="flex items-center gap-1" aria-label={`可使用 ${providers.map((provider) => provider.name).join(", ")}`} role="img">
      {providers.slice(0, VISIBLE_MARKS).map((provider) => (
        <DenBrandMark key={provider.id} name={provider.name} simpleIconSlug={getProviderIconSlug(provider.providerId)} className="size-7 rounded-[8px]" imageClassName="size-4" />
      ))}
      {hidden > 0 ? <span className="pl-1 text-[12px] text-gray-500">+{hidden}</span> : null}
    </span>
  );
}

function Avatar({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-700">{children}</span>;
}

function Spend({ value, state }: { value: number | undefined; state: "ready" | "loading" | "error" }) {
  return (
    <span className="text-right text-[13px] font-semibold tabular-nums text-gray-950">
      {state === "ready" ? formatUsageCost(value ?? 0) : <span className="font-normal text-gray-400">{state === "loading" ? "…" : "—"}</span>}
    </span>
  );
}

function LimitCell({ summary, source }: { summary: string; source: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-px">
      <span className={`truncate text-[13px] ${summary === "No limit" ? "text-gray-500" : "text-gray-700"}`}>{summary}</span>
      {source ? <span className="truncate text-[11px] text-gray-500">{source}</span> : null}
    </span>
  );
}

function Columns({ first }: { first: string }) {
  return (
    <div aria-hidden="true" className={`${ROW} h-9 border-b border-gray-100 text-[11px] font-medium text-gray-500`}>
      <span />
      <span>{first}</span>
      <span>可使用</span>
      <span>限额</span>
      <span className="text-right">最近 31 天</span>
      <span />
    </div>
  );
}

function Directory({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-[12px] border border-gray-100 bg-white">
      <div className="min-w-[680px]" data-testid={testId}>{children}</div>
    </div>
  );
}

export function GatewayUsersTeamsSection({ orgId, orgSlug, orgContext }: { orgId: string; orgSlug: string | null | undefined; orgContext: DenOrgContext }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const providers = useGatewayAccessProviders(orgId);
  const policies = useGatewayPolicies(orgId);
  const personUsage = useGatewayUsage(orgId, "person", []);
  const teamUsage = useGatewayUsage(orgId, "team", []);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState(1);

  const teamId = searchParams.get("team");
  const view: DirectoryView = !teamId && searchParams.get("view") === "teams" ? "teams" : "people";
  const team = teamId ? orgContext.teams.find((item) => item.id === teamId) : undefined;

  function setView(next: DirectoryView) {
    router.push(next === "teams" ? getAiGatewayUsersTeamsRoute(orgSlug, { view: "teams" }) : getAiGatewayUsersTeamsRoute(orgSlug), { scroll: false });
  }

  const dataError = providers.error?.message ?? policies.error?.message;
  if (providers.isPending || policies.isPending) {
    return <section aria-label="用户和团队" data-testid="gateway-users-teams"><p role="status" className="text-[13px] text-gray-500">正在加载人员与团队…</p></section>;
  }
  if (dataError || !providers.data || !policies.data) {
    return (
      <section aria-label="用户和团队" data-testid="gateway-users-teams" className="flex flex-col items-start gap-3">
        <DenNotice tone="error" message={dataError ?? "无法加载人员与团队，请重试。"} />
        <DenButton size="sm" variant="secondary" onClick={() => { void providers.refetch(); void policies.refetch(); }}>重试</DenButton>
      </section>
    );
  }

  const providerList = providers.data;
  const policyList = policies.data.policies;
  const spendState = (usage: typeof personUsage) => usage.isPending ? "loading" : usage.isError ? "error" : "ready";
  const personSpend = new Map((personUsage.data ? gatewayUsageTotals(personUsage.data) : []).map((row) => [row.id, row.costMicroUsd]));
  const teamSpend = new Map((teamUsage.data ? gatewayUsageTotals(teamUsage.data) : []).map((row) => [row.id, row.costMicroUsd]));
  const usable = (subject: DirectorySubject) => directoryAccess(providerList, subject).map((entry) => entry.provider);
  const needle = query.trim().toLowerCase();
  const people = orgContext.members
    .filter((member) => !team || team.memberIds.includes(member.id))
    .filter((member) => !needle || `${member.user.name} ${member.user.email}`.toLowerCase().includes(needle))
    .sort((a, b) => (personSpend.get(b.id) ?? 0) - (personSpend.get(a.id) ?? 0) || (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email));
  const teams = orgContext.teams
    .filter((item) => !needle || item.name.toLowerCase().includes(needle))
    .sort((a, b) => (teamSpend.get(b.id) ?? 0) - (teamSpend.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const everyone: DirectorySubject = { type: "organization" };
  const everyoneLimit = directoryLimit(policyList, everyone);

  return (
    <section aria-label="用户和团队" data-testid="gateway-users-teams" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DenSegmented<DirectoryView>
          aria-label="显示"
          value={view}
          onChange={setView}
          options={[
            { value: "people", label: `成员 · ${orgContext.members.length}` },
            { value: "teams", label: `团队 · ${orgContext.teams.length}` },
          ]}
        />
        {teamId ? (
          <Link href={getAiGatewayUsersTeamsRoute(orgSlug)} scroll={false} data-testid="gateway-directory-team-filter" aria-label={`清除团队筛选 ${team?.name ?? ""}`.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white pl-3 pr-2 text-[12px] hover:border-gray-300">
            <span className="text-gray-500">团队</span>
            <span className="font-medium text-gray-900">{team?.name ?? "已移除的团队"}</span>
            <X className="size-3.5 text-gray-400" aria-hidden="true" />
          </Link>
        ) : view === "people" || orgContext.teams.length ? (
          <div className="w-full sm:w-[240px]">
            <DenInput icon={Search} iconSize={14} value={query} onChange={(event) => { setQuery(event.target.value); setPages(1); }}
              placeholder="按名称筛选" aria-label={view === "teams" ? "按名称筛选团队" : "按姓名筛选人员"} className="h-8 text-[12px]" />
          </div>
        ) : null}
      </div>

      {teamId && !team ? (
        <DenNotice tone="info" message="此团队已不存在，清除筛选以查看所有人。" />
      ) : team ? (
        <TeamStrip team={team} orgSlug={orgSlug} policies={policyList}
          providers={usable({ type: "team", teamId: team.id })} spend={teamSpend.get(team.id)} spendState={spendState(teamUsage)} />
      ) : (
        <div className={`${ROW} h-16 rounded-[12px] border border-gray-100 bg-white`} data-testid="gateway-directory-everyone">
          <Avatar><Globe className="size-4 text-gray-700" /></Avatar>
          <span className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-[13px] font-medium text-gray-900">所有人，所属组织： {orgContext.organization.name}</span>
            <span className="truncate text-[12px] text-gray-500">{orgContext.members.length} {"人"}，以及之后加入的成员</span>
          </span>
          <ProviderMarks providers={usable(everyone)} />
          <LimitCell summary={limitSummary(everyoneLimit, true)} source={limitSourceLabel(everyoneLimit, everyone, orgContext.teams)} />
          <Spend value={personUsage.data?.totalCostMicroUsd} state={spendState(personUsage)} />
          <span />
        </div>
      )}

      {view === "teams" ? (
        orgContext.teams.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[12px] border border-gray-100 bg-white px-8 py-14 text-center" data-testid="gateway-teams-empty">
            <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-[10px] bg-gray-50"><Users className="size-4 text-gray-700" /></span>
            <span className="flex flex-col gap-1">
              <span className="text-[15px] font-medium text-gray-950">暂无团队</span>
              <span className="text-[13px] text-gray-500">将人员分组为团队，即可统一分配模型与共享限额。</span>
            </span>
            <Link href={getMembersRoute(orgSlug)} className={buttonVariants({ variant: "primary", size: "sm" })}>创建团队</Link>
            <span className="text-[12px] text-gray-500">在“成员”中管理团队。</span>
          </div>
        ) : (
          <Directory testId="gateway-directory-teams">
            <Columns first="团队" />
            {teams.length === 0 ? <p role="status" className="px-4 py-6 text-[13px] text-gray-500">没有匹配的团队：“{query.trim()}”.</p> : null}
            <ul className="divide-y divide-gray-100">
              {teams.map((item) => {
                const subject: DirectorySubject = { type: "team", teamId: item.id };
                const limit = directoryLimit(policyList, subject);
                return (
                  <li key={item.id}>
                    <Link href={getAiGatewayUsersTeamsRoute(orgSlug, { teamId: item.id })} scroll={false} data-testid="gateway-directory-team-row" data-team-id={item.id}
                      className={`${ROW} h-14 hover:bg-gray-50`}>
                      <Avatar><Users className="size-4 text-gray-700" /></Avatar>
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="truncate text-[13px] font-medium text-gray-900">{item.name}</span>
                        <span className="text-[12px] text-gray-500">{item.memberIds.length} {"人"}</span>
                      </span>
                      <ProviderMarks providers={usable(subject)} />
                      <LimitCell summary={limitSummary(limit, true)} source={limitSourceLabel(limit, subject, orgContext.teams)} />
                      <Spend value={teamSpend.get(item.id)} state={spendState(teamUsage)} />
                      <ChevronRight className="size-3.5 text-gray-400" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Directory>
        )
      ) : teamId && !team ? null : (
        <Directory testId="gateway-directory-people">
          <Columns first="人员" />
          {people.length === 0 ? (
            <p role="status" className="px-4 py-6 text-[13px] text-gray-500">
              {needle ? `没有与“${query.trim()}”匹配的成员。` : team ? "此团队暂无成员。" : "暂无人员。"}
            </p>
          ) : null}
          <ul className="divide-y divide-gray-100">
            {people.slice(0, pages * PAGE_SIZE).map((member) => {
              const subject = memberSubject(member, orgContext.teams);
              const limit = directoryLimit(policyList, subject);
              const memberTeams = orgContext.teams.filter((item) => item.memberIds.includes(member.id)).map((item) => item.name);
              const name = member.user.name || member.user.email;
              return (
                <li key={member.id}>
                  <Link href={getAiGatewayPersonRoute(orgSlug, member.id)} data-testid="gateway-directory-person-row" data-member-id={member.id}
                    className={`${ROW} h-14 hover:bg-gray-50`}>
                    <Avatar>{initials(name)}</Avatar>
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="truncate text-[13px] font-medium text-gray-900">{name}</span>
                      <span className="truncate text-[12px] text-gray-500">{memberTeams.length ? memberTeams.join(", ") : member.user.email}</span>
                    </span>
                    <ProviderMarks providers={usable(subject)} />
                    <LimitCell summary={limitSummary(limit, false)} source={limitSourceLabel(limit, subject, orgContext.teams)} />
                    <Spend value={personSpend.get(member.id)} state={spendState(personUsage)} />
                    <ChevronRight className="size-3.5 text-gray-400" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {people.length > pages * PAGE_SIZE ? (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-[12px]">
              <span className="text-gray-500">还有 {people.length - pages * PAGE_SIZE} 人</span>
              <button type="button" className="font-medium text-gray-700 hover:text-gray-950" onClick={() => setPages(pages + 1)}>显示更多</button>
            </div>
          ) : null}
        </Directory>
      )}
      {personUsage.isError || teamUsage.isError ? (
        <p className="text-[12px] text-gray-500">无法加载费用，请重试。 <button type="button" className="underline underline-offset-4" onClick={() => { void personUsage.refetch(); void teamUsage.refetch(); }}>重试</button></p>
      ) : null}
    </section>
  );
}

function TeamStrip({ team, orgSlug, policies, providers, spend, spendState }: {
  team: DenOrgTeam;
  orgSlug: string | null | undefined;
  policies: GatewayUsageLimitPolicy[];
  providers: GatewayAccessProvider[];
  spend: number | undefined;
  spendState: "ready" | "loading" | "error";
}) {
  const subject: DirectorySubject = { type: "team", teamId: team.id };
  const limit = directoryLimit(policies, subject);
  const teamPolicy = policies.find((policy) => !policy.archivedAt && policy.assignments.some((assignment) => assignment.teamId === team.id));
  return (
    <div className={`${ROW} h-16 rounded-[12px] border border-gray-100 bg-white`} data-testid="gateway-directory-team-strip">
      <Avatar><Users className="size-4 text-gray-700" /></Avatar>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[13px] font-medium text-gray-900">{team.name}</span>
        <span className="text-[12px] text-gray-500">{team.memberIds.length} {"人"}</span>
      </span>
      <ProviderMarks providers={providers} />
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-[13px] text-gray-700">{limitSummary(limit, true)}</span>
        <Link href={teamPolicy ? getAiGatewayLimitRoute(orgSlug, teamPolicy.id) : getNewAiGatewayLimitRoute(orgSlug, { teamId: team.id })}
          data-testid="gateway-directory-team-limit" className="w-fit text-[11px] font-medium text-gray-900 underline underline-offset-2 hover:text-gray-600">
          {teamPolicy ? "编辑团队限额" : "设置团队限额"}
        </Link>
      </span>
      <Spend value={spend} state={spendState} />
      <span />
    </div>
  );
}
