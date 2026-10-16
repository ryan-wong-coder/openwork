import {
  BarChart3,
  Box,
  CalendarClock,
  Globe,
  Laptop,
  LibraryBig,
  LockKeyhole,
  MessageCircle,
  ScrollText,
  Server,
  Plug,
  SlidersHorizontal,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  type DenOrgAccessFlags,
  type DenOrgCapabilities,
  getAiGatewayRoute,
  getAnalyticsRoute,
  getApiKeysRoute,
  getAuditLogsRoute,
  getAutomationsRoute,
  getBillingRoute,
  getDesktopPoliciesRoute,
  getDiagnosticsRoute,
  getDeploymentsRoute,
  getLibraryRoute,
  getMarketplacesRoute,
  getMcpConnectionsRoute,
  getMembersRoute,
  getOrgSettingsRoute,
  getPermissionsRoute,
  getPluginsRoute,
  getScimRoute,
  getSsoRoute,
  getToolTesterRoute,
  getWebRoute,
  getWorkbotSettingsRoute,
} from "../../_lib/den-org";
import type { DenOrgMode } from "../../_lib/runtime-config";
import { canOpenAdminRoute } from "./admin-route-access";

export type DashboardNavChild = {
  href: string;
  label: string;
  badge?: string;
};

export type DashboardNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /** Quiet dot beside the label when something here is waiting on the viewer. */
  attention?: string;
  testId?: string;
  /** Extra pathname prefixes that select this entry. */
  matchHrefs?: string[];
  /** Grouped entries link to their own href and expand on parent or child pages. */
  children?: DashboardNavChild[];
};

export type DashboardNavSection = {
  label: string;
  items: DashboardNavItem[];
};

export type DashboardSearchItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  section: string;
  keywords: string[];
};

export type BuildDashboardNavSectionsInput = {
  orgSlug: string | null;
  access: DenOrgAccessFlags;
  capabilities: DenOrgCapabilities;
  orgMode: DenOrgMode;
  runtimeConfigLoaded: boolean;
  /** How many Library items wait on the viewer's sign-in. */
  libraryNeedsSignIn?: number;
  /** The organization has the `permissions` feature (orgFeatureEnabled). */
  permissionsEnabled?: boolean;
  /** teamRoles: roles live in Members › Roles, so Settings › Permissions steps aside. */
  teamRoles?: boolean;
  /** The managedDeployments feature is on for this organization. */
  managedDeployments?: boolean;
  /** Workbot is on: admins choose the organization's default model. */
  workbotSettings?: boolean;
  desktopPolicyScreenRemoved?: boolean;
};

export function buildDashboardNavSections({
  orgSlug,
  access,
  capabilities,
  runtimeConfigLoaded,
  libraryNeedsSignIn = 0,
  permissionsEnabled = false,
  teamRoles = false,
  managedDeployments = false,
  workbotSettings = false,
  desktopPolicyScreenRemoved = false,
}: BuildDashboardNavSectionsInput): DashboardNavSection[] {
  const workflowsEnabled = capabilities.workflows;
  const showWeb = runtimeConfigLoaded && capabilities.openworkWeb;
  const workItems: DashboardNavItem[] = [
    ...(capabilities.workbot
      ? [{ href: "/workbot", label: "Workbot", icon: MessageCircle, testId: "dashboard-nav-workbot" }]
      : []),
    {
      href: orgSlug ? getLibraryRoute(orgSlug) : "#",
      label: "我的资源库",
      icon: LibraryBig,
      ...(libraryNeedsSignIn > 0
        ? { attention: `${libraryNeedsSignIn} 项需要你登录` }
        : {}),
    },
    ...(workflowsEnabled && orgSlug
      ? [{ href: getAutomationsRoute(orgSlug), label: "我的自动化", icon: CalendarClock }]
      : []),
    ...(showWeb
      ? [{ href: orgSlug ? getWebRoute(orgSlug) : "#", label: "OpenWork Web", icon: Globe }]
      : []),
  ];

  // Admin-area entries appear only where the member holds the page's permission.
  const canOpen = (href: string) => canOpenAdminRoute(href, access);
  const manageItems: DashboardNavItem[] = orgSlug
    ? [
        { href: getPluginsRoute(orgSlug), label: "插件", icon: Box },
        { href: getMcpConnectionsRoute(orgSlug), label: "连接器", icon: Plug, badge: "MCPs" },
        { href: getAiGatewayRoute(orgSlug), label: "AI 网关", icon: Sparkles },
        ...(!desktopPolicyScreenRemoved ? [{ href: getDesktopPoliciesRoute(orgSlug), label: "桌面策略", icon: Laptop }] : []),
        ...(workbotSettings ? [{ href: getWorkbotSettingsRoute(orgSlug), label: "Workbot", icon: MessageCircle, testId: "dashboard-nav-workbot-settings" }] : []),
        ...(managedDeployments ? [{ href: getDeploymentsRoute(orgSlug), label: "部署", icon: Server }] : []),
      ].filter((item) => canOpen(item.href))
    : [];
  const observabilityItems: DashboardNavItem[] = orgSlug
    ? [
        ...(access.canViewUsageAnalytics ? [{ href: getAnalyticsRoute(orgSlug), label: "分析", icon: BarChart3 }] : []),
        ...(capabilities.auditLogs
          ? [{
              href: getAuditLogsRoute(orgSlug),
              label: "审计日志",
              icon: access.canViewAuditLogs ? ScrollText : LockKeyhole,
              ...(access.canViewAuditLogs ? {} : { badge: "已锁定" }),
            }]
          : []),
      ]
    : [];
  const settingsChildren: DashboardNavChild[] = orgSlug
    ? [
        ...[
          { href: getOrgSettingsRoute(orgSlug), label: "通用" },
          { href: getDiagnosticsRoute(orgSlug), label: "诊断" },
          { href: getBillingRoute(orgSlug), label: "账单" },
          { href: getApiKeysRoute(orgSlug), label: "API 密钥" },
        ].filter((item) => canOpen(item.href)),
        ...permissionsNavChildren(orgSlug, access, permissionsEnabled, teamRoles ? { membersOpen: canOpen(getMembersRoute(orgSlug)) } : null),
        ...(access.canViewSso ? [{ href: getSsoRoute(orgSlug), label: "SSO" }] : []),
        ...(access.canViewScim ? [{ href: getScimRoute(orgSlug), label: "SCIM" }] : []),
        ...(canOpen(getMarketplacesRoute(orgSlug))
          ? [{ href: getMarketplacesRoute(orgSlug), label: "高级" }]
          : []),
        ...(capabilities.mcpConnections && canOpen(getToolTesterRoute(orgSlug))
          ? [{ href: getToolTesterRoute(orgSlug), label: "工具测试" }]
          : []),
      ]
    : [];
  const settingsGroup: DashboardNavItem | null = settingsChildren.length > 0
    ? {
        href: settingsChildren[0].href,
        label: "设置",
        icon: SlidersHorizontal,
        children: settingsChildren,
      }
    : null;
  const teamItems: DashboardNavItem[] = [
    ...(orgSlug && canOpen(getMembersRoute(orgSlug))
      ? [{ href: getMembersRoute(orgSlug), label: "成员", icon: Users }]
      : []),
    ...(settingsGroup ? [settingsGroup] : []),
  ];

  return [
    { label: "工作", items: workItems },
    ...(manageItems.length > 0 ? [{ label: "管理", items: manageItems }] : []),
    ...(observabilityItems.length > 0 ? [{ label: "可观测性", items: observabilityItems }] : []),
    ...(teamItems.length > 0 ? [{ label: "团队", items: teamItems }] : []),
  ];
}

/**
 * Permissions appears for members who hold `permissions.view` while the feature
 * is on. While it is off, people who could manage it keep a locked entry that
 * says why (DESIGN.md P4); everyone else does not see it.
 *
 * With teamRoles, roles have one home, Members › Roles: the entry is dropped
 * for people who can open Members, and named Roles for anyone who can't.
 */
function permissionsNavChildren(orgSlug: string, access: DenOrgAccessFlags, enabled: boolean, teamRoles: { membersOpen: boolean } | null): DashboardNavChild[] {
  const href = getPermissionsRoute(orgSlug);
  if (enabled && teamRoles) return access.canViewPermissions && !teamRoles.membersOpen ? [{ href, label: "角色" }] : [];
  if (enabled) return access.canViewPermissions ? [{ href, label: "权限" }] : [];
  return access.canManagePermissions ? [{ href, label: "权限", badge: "企业版" }] : [];
}

// Alias order is ranking priority in the command palette.
const PAGE_KEYWORDS: Record<string, string[]> = {
  "高级": ["Advanced","高级","marketplace","collections","branding","brand appearance"],
  "AI 网关": ["AI Gateway","AI 网关","llm","provider","gateway","inference","usage"],
  "分析": ["Analytics","分析","usage","stats","workflow runs","history"],
  "审计日志": ["Audit logs","审计日志","audit","history","operations","changes","security"],
  "API 密钥": ["API Keys","API 密钥","token","secret"],
  "账单": ["Billing","账单","plan","invoice","payment"],
  "Bring Your Own Keys (Legacy)": ["Bring Your Own Keys (Legacy)","llm","provider","byok","API 密钥"],
  "连接器": ["Connectors","连接器","mcp","integrations","servers","connect"],
  "桌面策略": ["Desktop policies","桌面策略","policy","mdm","lock","desktop"],
  "部署": ["Deployments","部署","aws","self-hosted","byoc","install","health","status"],
  "Dashboards": ["Dashboards","boards","apps"],
  "诊断": ["Diagnostics","诊断","health","debug","troubleshooting"],
  "通用": ["General","通用","organization","workspace"],
  // Agent permissions live on Members › Teams (Everyone and each team's Agents tab).
  "成员": ["Members","成员","people","users","invite","teams","roles","代理权限","commands","websites","allow list","block list","desktop","prompt suggestions"],
  "Models": ["Models","llm","provider","byok","API 密钥"],
  "权限": ["Permissions","权限","access","roles","teams","admin","rbac"],
  "我的自动化": ["My Automations","我的自动化","schedule","recurring","tasks"],
  "我的资源库": ["My Library","我的资源库","skills","plugins","connections"],
  "OpenWork 模型": ["OpenWork Models","OpenWork 模型","llm","provider","managed","inference"],
  "OpenWork Web": ["OpenWork Web","cloud","sessions"],
  "插件": ["Plugins","插件","skills","commands","plugin directory"],
  "SCIM": ["SCIM","provisioning","directory","users"],
  "设置": ["Settings","设置","organization","workspace"],
  "SSO": ["SSO","single sign on","saml","oidc"],
  "工具测试": ["Tool Tester","工具测试","tools","test","mcp"],
  "Workbot": ["Workbot","model","default model","assistant","slack","automations"],
};

function keywordsFor(...labels: string[]): string[] {
  return [...new Set(labels.flatMap((label) => PAGE_KEYWORDS[label] ?? []))];
}

export function flattenNavigationForSearch(sections: DashboardNavSection[]): DashboardSearchItem[] {
  return sections.flatMap((section) => section.items.flatMap((item) => {
    if (item.children) {
      return item.children.map((child) => ({
        id: `page:${section.label}:${item.label}:${child.label}`,
        label: `${item.label} › ${child.label}`,
        href: child.href,
        icon: item.icon,
        section: section.label,
        keywords: keywordsFor(item.label, child.label),
      }));
    }

    return [{
      id: `page:${section.label}:${item.label}`,
      label: item.label,
      href: item.href,
      icon: item.icon,
      section: section.label,
      keywords: keywordsFor(item.label),
    }];
  }));
}
