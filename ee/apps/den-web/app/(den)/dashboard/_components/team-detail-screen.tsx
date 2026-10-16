"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Laptop, Compass, KeyRound, Layers, ShieldCheck, SquareTerminal, Users } from "lucide-react";
import { DenBadge } from "../../_components/ui/badge";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { type TabItem, UnderlineTabs } from "../../_components/ui/tabs";
import { getMarketplaceRoute, getMembersRoute, getOrgAccessFlags, orgFeatureEnabled } from "../../_lib/den-org";
import { desktopPolicyScreenRemoved } from "../_lib/desktop-policy-screen-rollout";
import { DesktopSuggestionsPanel } from "./desktop-suggestions-panel";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { AgentsPanel, agentsTabVisible } from "./agent-permissions-editor";
import { TeamPermissionsPanel } from "./team-permissions-panel";
import { TeamPluginAccessPanel } from "./team-plugin-access-panel";
import { ModelsPanel, modelsTabVisible } from "./team-models-panel";
import { TeamDefaultModelSection } from "./default-model-section";
import { useDefaultModelFeatureOn } from "./default-model-data";
import { OrgMemberIdentity } from "./org-member-identity";
import { TeamAdminCheckbox } from "./team-admin-checkbox";
import { TeamRolePanel } from "./team-role-panel";
import { SharedTeamRolePanel } from "./shared-team-role-panel";
import { MemberTeamRoles } from "./member-team-roles";
import { useCustomRoleTeams, useSharedRolesOn } from "./permissions-data";
import {
  type TeamPluginAccessItem,
  useRevokeTeamPluginAccess,
  useTeamPluginAccess,
} from "./team-access-data";

export type TeamDetailTab = "role" | "overview" | "access" | "agents" | "browser" | "models" | "desktop";

function formatGrantedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(DEFAULT_DEN_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function AccessViaBadge({ item }: { item: TeamPluginAccessItem }) {
  if (item.edge === "direct_team") {
    return <DenBadge tone="success">直接授予团队</DenBadge>;
  }
  if (item.edge === "via_catalog") {
    return <DenBadge tone="info">来自目录： {item.marketplace?.name}</DenBadge>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-600">
      全组织
    </span>
  );
}

function RoleBadge({ role }: { role: TeamPluginAccessItem["role"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${
        role === "editor"
          ? "border border-amber-200 bg-amber-50 text-amber-700"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      {role}
    </span>
  );
}

export function TeamDetailScreen({ teamId, initialTab = null }: { teamId: string; initialTab?: TeamDetailTab | null }) {
  const { orgContext, orgId, orgSlug } = useOrgDashboard();
  const viewerAccess = orgContext
    ? getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions)
    : null;
  // Revoking a team's plugin grant needs manager access to the plugin (`sharing.manage_all`).
  const canRevokeAccess = viewerAccess?.canManageAllShared ?? false;
  // teamRoles: the team page opens on its one role (Member, Admin or Custom).
  const teamRoles = orgContext ? orgFeatureEnabled(orgContext, "teamRoles") : false;
  // sharedRoles: the role is picked from every custom role, and the unused desktop-policy editor leaves Access.
  const sharedRoles = useSharedRolesOn();
  // Members list each person's team roles the same way the Members page does.
  const customRoles = useCustomRoleTeams(orgId, teamRoles && Boolean(orgContext && orgFeatureEnabled(orgContext, "permissions")) && (viewerAccess?.canViewPermissions ?? false));
  // orgDefaultModel: the Access tab lets admins override the model new desktop chats start with.
  const defaultModelOn = useDefaultModelFeatureOn();
  // agentPermissions: the team's Agents tab holds what it changes from Everyone.
  const showAgents = agentsTabVisible(orgContext);
  // teamPageTabs: Open websites moves from Agents to its own Browser tab, and
  // the team's AI providers, spend limits and default model get a Models tab.
  const pageTabs = orgContext ? orgFeatureEnabled(orgContext, "teamPageTabs") : false;
  const showBrowser = pageTabs && showAgents;
  const showDesktop = desktopPolicyScreenRemoved(orgContext);
  const showModels = modelsTabVisible(orgContext);
  const [chosenTab, setChosenTab] = useState<TeamDetailTab | null>(initialTab);
  const defaultTab: TeamDetailTab = teamRoles ? "role" : "access";
  // The tab is in the address (?tab=agents), so a reload or a shared link opens it again.
  const setActiveTab = (tab: TeamDetailTab) => {
    setChosenTab(tab);
    const url = new URL(window.location.href);
    if (tab === defaultTab) url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  };
  const available = (tab: TeamDetailTab) => tab === "role" ? teamRoles
    : tab === "agents" ? showAgents
      : tab === "browser" ? showBrowser
        : tab === "desktop" ? showDesktop
        : tab === "models" ? showModels
          : true;
  const activeTab: TeamDetailTab = chosenTab && available(chosenTab) ? chosenTab : defaultTab;
  const accessQuery = useTeamPluginAccess(teamId);
  const revokeAccess = useRevokeTeamPluginAccess();
  const team = orgContext?.teams.find((entry) => entry.id === teamId);
  const membersById = new Map((orgContext?.members ?? []).map((member) => [member.id, member]));
  const teamMembers = (team?.memberIds ?? []).flatMap((memberId) => {
    const member = membersById.get(memberId);
    return member ? [member] : [];
  });
  const memberCount = team?.memberIds.length ?? 0;
  const agentsTab: readonly TabItem<TeamDetailTab>[] = [
    ...(showAgents ? [{ value: "agents" as const, label: "智能体", icon: SquareTerminal }] : []),
    ...(showBrowser ? [{ value: "browser" as const, label: "浏览器", icon: Compass }] : []),
    ...(showModels ? [{ value: "models" as const, label: "模型", icon: Layers }] : []),
    ...(showDesktop ? [{ value: "desktop" as const, label: "桌面端", icon: Laptop }] : []),
  ];
  const tabs: readonly TabItem<TeamDetailTab>[] = teamRoles
    ? [
      { value: "role", label: "角色", icon: ShieldCheck },
      { value: "overview", label: "成员", icon: Users },
      { value: "access", label: "访问权限", icon: KeyRound },
      ...agentsTab,
    ]
    : [
      { value: "overview", label: "概览", icon: Users },
      { value: "access", label: "访问权限", icon: ShieldCheck },
      ...agentsTab,
    ];

  return (
    <div className="mx-auto max-w-[860px] px-6 py-8 md:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href={getMembersRoute(orgSlug)}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 transition hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
      </div>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-950">
          {team?.name ?? "团队"}
        </h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-600">
          {memberCount} {"名成员"}
        </span>
      </header>
      {team && !teamRoles ? <TeamAdminCheckbox team={team} /> : null}

      <UnderlineTabs
        className="mt-6"
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      <div className="mt-6">
        {activeTab === "role" && team ? (
          <div role="tabpanel" aria-label="角色">
            {sharedRoles ? <SharedTeamRolePanel team={team} /> : <TeamRolePanel team={team} />}
          </div>
        ) : null}

        {activeTab === "overview" ? (
          <div role="tabpanel" aria-label="概览">
            {teamMembers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
                <p className="text-[14px] font-medium text-gray-800">此团队暂无成员。</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white">
                {teamMembers.map((member) => (
                  <div key={member.id} className="px-6 py-4">
                    <OrgMemberIdentity member={member} />
                    {teamRoles && orgContext ? (
                      <MemberTeamRoles member={member} teams={orgContext.teams} customTeamIds={customRoles.teamIds} customRoleNameByTeam={sharedRoles ? customRoles.nameByTeam : undefined} exceptTeamId={teamId} />
                    ) : member.adminTeams.length > 0 ? (
                      <p className="mt-2 text-[12px] text-gray-500">管理员权限来自 {member.adminTeams.map((entry) => entry.name).join(", ")}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "access" ? (
          <div role="tabpanel" aria-label="访问权限">
            {/* With the Models tab, the default model lives there instead. */}
            {defaultModelOn && viewerAccess?.canViewModelsSettings && !showModels ? (
              <TeamDefaultModelSection teamId={teamId} canManage={viewerAccess.canManageModelsSettings} />
            ) : null}
            {sharedRoles || showDesktop ? null : <TeamPermissionsPanel teamId={teamId} heading={teamRoles ? "在桌面应用中" : undefined} />}
            {orgContext && orgFeatureEnabled(orgContext, "teamAccessRows") ? (
              <TeamPluginAccessPanel teamId={teamId} teamName={team?.name ?? "此团队"} orgSlug={orgSlug} canRevoke={canRevokeAccess} />
            ) : <>
            <h2 className="mb-2 text-lg font-semibold text-gray-950">插件与连接</h2>
            {sharedRoles ? null : <p className="mb-4 text-sm text-gray-500">查看团队可用内容及访问权限来源。</p>}
            {accessQuery.isLoading ? (
              <div className="rounded-2xl border border-gray-100 bg-white px-6 py-8 text-[13px] text-gray-400">
                正在加载团队访问权限…
              </div>
            ) : accessQuery.error ? (
              <DenNotice
                tone="error"
                message={accessQuery.error instanceof Error ? accessQuery.error.message : "无法加载团队访问权限，请重试。"}
              />
            ) : accessQuery.data?.length ? (
              <div className="overflow-hidden rounded-2xl md:border md:border-gray-100 md:bg-white md:overflow-x-auto">
                <div className="md:min-w-[760px]">
                  <div className="hidden grid-cols-[minmax(0,1fr)_210px_100px_230px_110px] border-b border-gray-100 px-6 py-3 text-[11px] uppercase tracking-[0.14em] text-gray-400 md:grid">
                    <span>插件</span>
                    <span>权限来源</span>
                    <span>角色</span>
                    <span>授权方</span>
                    <span />
                  </div>
                  <div className="space-y-3 md:space-y-0 md:divide-y md:divide-gray-100">
                    {accessQuery.data.map((item) => {
                      const revoking = revokeAccess.isPending && revokeAccess.variables?.grantId === item.grantId;
                      return (
                        <div
                          key={`${item.plugin.id}-${item.edge}-${item.grantId ?? item.marketplace?.id ?? "org"}`}
                          className={`flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-4 md:grid md:grid-cols-[minmax(0,1fr)_210px_100px_230px_110px] md:items-center md:gap-0 md:rounded-none md:border-0 md:px-6 md:py-3.5 ${item.role === "editor" ? "bg-[var(--dls-hover)]" : ""}`}
                        >
                          <div className="min-w-0 md:pr-4">
                            <p className="truncate text-[14px] font-semibold text-gray-900">{item.plugin.name}</p>
                            <p className="mt-0.5 text-[12px] text-gray-400">
                              {item.plugin.componentCount} {"个组件"}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 md:contents">
                            <div className="md:pr-4">
                              <AccessViaBadge item={item} />
                            </div>
                            <div>
                              <RoleBadge role={item.role} />
                            </div>
                          </div>
                          <p className="text-[13px] text-gray-500 md:pr-4">
                            {item.grantedBy?.name ?? "—"} · {formatGrantedDate(item.grantedAt)}
                          </p>
                          {item.edge === "direct_team" && canRevokeAccess ? (
                            <div className="flex justify-end border-t border-gray-100 pt-3 md:border-0 md:pt-0">
                              <DenButton
                                variant="destructive"
                                size="sm"
                                disabled={!item.grantId}
                                loading={revoking}
                                onClick={() => {
                                  if (!item.grantId) return;
                                  revokeAccess.mutate({
                                    teamId,
                                    pluginId: item.plugin.id,
                                    grantId: item.grantId,
                                  });
                                }}
                              >
                                撤销
                              </DenButton>
                            </div>
                          ) : item.edge === "via_catalog" && item.marketplace ? (
                            <div className="flex justify-end border-t border-gray-100 pt-3 md:border-0 md:pt-0">
                              <DenButton
                                href={getMarketplaceRoute(orgSlug, item.marketplace.id)}
                                variant="secondary"
                                size="sm"
                              >
                                打开目录
                              </DenButton>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
                <p className="text-[14px] font-medium text-gray-800">此团队暂无插件访问权限。</p>
              </div>
            )}

            {revokeAccess.error ? (
              <DenNotice
                className="mt-4"
                tone="error"
                message={revokeAccess.error instanceof Error ? revokeAccess.error.message : "无法撤销插件访问权限，请重试。"}
              />
            ) : null}

            <p className="mt-4 text-[12px] text-gray-500">
              直接授权可在此撤销；目录授权需在目录中管理；组织范围授权由组织设置管理。
            </p>
            </>}
          </div>
        ) : null}

        {activeTab === "agents" && team ? (
          <div role="tabpanel" aria-label="智能体">
            <AgentsPanel team={{ id: team.id, name: team.name }} area={showBrowser ? "agents" : "all"} />
          </div>
        ) : null}

        {activeTab === "browser" && team ? (
          <div role="tabpanel" aria-label="浏览器">
            <AgentsPanel team={{ id: team.id, name: team.name }} area="browser" />
          </div>
        ) : null}

        {activeTab === "desktop" && team ? (<div role="tabpanel" aria-label="桌面端"><DesktopSuggestionsPanel team={{ id: team.id, name: team.name }} /></div>) : null}

        {activeTab === "models" && team ? (
          <div role="tabpanel" aria-label="模型">
            <ModelsPanel team={{ id: team.id, name: team.name }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
