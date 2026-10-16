"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Laptop, Compass, Layers, ShieldCheck, SquareTerminal } from "lucide-react";
import { type TabItem, UnderlineTabs } from "../../_components/ui/tabs";
import { getMembersTeamsRoute, getOrgAccessFlags, getPermissionSetRoute, orgFeatureEnabled } from "../../_lib/den-org";
import { desktopPolicyScreenRemoved } from "../_lib/desktop-policy-screen-rollout";
import { DesktopSuggestionsPanel } from "./desktop-suggestions-panel";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { IconTile } from "./access-rows";
import { AgentsPanel, agentsTabVisible } from "./agent-permissions-editor";
import { ItemPanel, ItemRow } from "./item-list";
import { ModelsPanel, modelsTabVisible } from "./team-models-panel";
import { usePermissionSets } from "./permissions-data";

export type EveryoneTab = "role" | "agents" | "browser" | "models" | "desktop";

/**
 * Members › Teams › Everyone: every member, including people in no team.
 * Its Agents tab is the base every team's Agents tab changes.
 */
export function EveryoneScreen({ initialTab }: { initialTab: EveryoneTab | null }) {
  const { orgContext, orgId, orgSlug } = useOrgDashboard();
  const access = orgContext
    ? getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions)
    : null;
  const showAgents = agentsTabVisible(orgContext);
  // teamPageTabs: Browser and Models hold the organization's defaults, as each team's page does.
  const pageTabs = orgContext ? orgFeatureEnabled(orgContext, "teamPageTabs") : false;
  const showBrowser = pageTabs && showAgents;
  const showDesktop = desktopPolicyScreenRemoved(orgContext);
  const showModels = modelsTabVisible(orgContext);
  const [chosenTab, setChosenTab] = useState<EveryoneTab | null>(initialTab);
  // The tab is in the address, so a reload or a shared link opens it again.
  const chooseTab = (tab: EveryoneTab) => {
    setChosenTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  };
  const activeTab: EveryoneTab = chosenTab === "agents" && showAgents ? "agents"
    : chosenTab === "browser" && showBrowser ? "browser"
      : chosenTab === "models" && showModels ? "models"
        : chosenTab === "desktop" && showDesktop ? "desktop" : "role";
  const memberCount = orgContext?.members.length ?? 0;
  const canViewSets = Boolean(orgContext && orgFeatureEnabled(orgContext, "permissions") && access?.canViewPermissions);
  const setsQuery = usePermissionSets(orgId, canViewSets);
  const memberSet = setsQuery.data?.find((set) => set.kind === "member_default");
  const tabs: readonly TabItem<EveryoneTab>[] = [
    { value: "role", label: "角色", icon: ShieldCheck },
    ...(showAgents ? [{ value: "agents" as const, label: "智能体", icon: SquareTerminal }] : []),
    ...(showBrowser ? [{ value: "browser" as const, label: "浏览器", icon: Compass }] : []),
    ...(showModels ? [{ value: "models" as const, label: "模型", icon: Layers }] : []),
    ...(showDesktop ? [{ value: "desktop" as const, label: "桌面端", icon: Laptop }] : []),
  ];

  return (
    <div className="mx-auto max-w-[860px] px-6 py-8 md:px-8" data-testid="everyone-screen">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href={getMembersTeamsRoute(orgSlug)}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 transition hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
      </div>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-950">所有人</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-600">
          {memberCount} {"名成员"}
        </span>
      </header>

      <UnderlineTabs className="mt-6" tabs={tabs} activeTab={activeTab} onChange={chooseTab} />

      <div className="mt-6">
        {activeTab === "desktop" ? (<div role="tabpanel" aria-label="桌面端"><DesktopSuggestionsPanel team={null} /></div>) : activeTab === "role" ? (
          <div role="tabpanel" aria-label="角色">
            <ItemPanel>
              <ItemRow
                logo={<IconTile icon={ShieldCheck} />}
                title="成员"
                description="所有人的权限"
                status="内置角色"
                href={memberSet ? getPermissionSetRoute(orgSlug, memberSet.id) : undefined}
                testId="everyone-role-member"
              />
            </ItemPanel>
          </div>
        ) : activeTab === "browser" ? (
          <div role="tabpanel" aria-label="浏览器">
            <AgentsPanel team={null} area="browser" />
          </div>
        ) : activeTab === "models" ? (
          <div role="tabpanel" aria-label="模型">
            <ModelsPanel team={null} />
          </div>
        ) : (
          <div role="tabpanel" aria-label="智能体">
            <AgentsPanel team={null} area={showBrowser ? "agents" : "all"} />
          </div>
        )}
      </div>
    </div>
  );
}
