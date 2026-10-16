"use client";

import { Laptop, Palette, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { type TabItem, UnderlineTabs } from "../../_components/ui/tabs";
import {
  getBrandAppearanceRoute,
  getDesktopPoliciesRoute,
  getMarketplacesRoute,
} from "../../_lib/den-org";
import { desktopPolicyScreenRemoved } from "../_lib/desktop-policy-screen-rollout";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export type AdvancedTab = "collections" | "desktop-policies" | "brand-appearance";

const ADVANCED_TABS: readonly TabItem<AdvancedTab>[] = [
  { value: "collections", label: "合集", icon: Store },
  { value: "desktop-policies", label: "桌面策略", icon: Laptop },
  { value: "brand-appearance", label: "品牌外观", icon: Palette },
];

const ADVANCED_DESCRIPTIONS: Record<AdvancedTab, string> = {
  collections: "集合包含插件。登录后，内置 OpenWork 集合与已分配集合将显示在桌面应用中。",
  "desktop-policies": "为整个组织、指定成员或团队设置可用的桌面功能。",
  "brand-appearance": "自定义工作区在 OpenWork 中的外观。",
};

export function AdvancedPageTemplate({ tab, children }: { tab: AdvancedTab; children: React.ReactNode }) {
  const router = useRouter();
  const { orgSlug, orgContext } = useOrgDashboard();

  function routeFor(next: AdvancedTab) {
    const routes: Record<AdvancedTab, string> = {
      collections: getMarketplacesRoute(orgSlug),
      "desktop-policies": getDesktopPoliciesRoute(orgSlug),
      "brand-appearance": getBrandAppearanceRoute(orgSlug),
    };
    return routes[next];
  }

  return (
    <DashboardPageTemplate
      title="高级"
      description={ADVANCED_DESCRIPTIONS[tab]}
    >
      <div data-testid="advanced-tabs" className="mb-6">
        <UnderlineTabs
          tabs={ADVANCED_TABS.filter((entry) => entry.value !== "desktop-policies" || !desktopPolicyScreenRemoved(orgContext))}
          activeTab={tab}
          onChange={(next) => router.push(routeFor(next))}
        />
      </div>
      {children}
    </DashboardPageTemplate>
  );
}
