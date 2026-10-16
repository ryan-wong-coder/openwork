"use client";

import { getMarketplaceRoute } from "../../_lib/den-org";
import { DenNotice } from "../../_components/ui/notice";
import { ItemMenu, ItemPanel, ItemRow, ItemRowsSkeleton } from "./item-list";
import { PluginLogo } from "./item-logo";
import { type TeamPluginAccessItem, useRevokeTeamPluginAccess, useTeamPluginAccess } from "./team-access-data";

/** Each access path stays separate: revoking a team grant does not revoke a catalog grant. */
export function TeamPluginAccessPanel({ teamId, teamName, orgSlug, canRevoke }: {
  teamId: string;
  teamName: string;
  orgSlug: string | null;
  canRevoke: boolean;
}) {
  const access = useTeamPluginAccess(teamId);
  const revoke = useRevokeTeamPluginAccess();
  const items = [...(access.data ?? [])].sort((a, b) => a.plugin.name.localeCompare(b.plugin.name) || a.edge.localeCompare(b.edge));
  const rolesVary = new Set(items.map((item) => item.role)).size > 1;
  const source = (item: TeamPluginAccessItem) => item.edge === "direct_team" ? "此团队"
    : item.edge === "org_wide" ? "所有人" : `通过 ${item.marketplace?.name}`;

  return <section aria-label="插件与连接" data-testid="team-plugin-access">
    <h2 className="mb-2 text-[13px] font-medium text-gray-700">插件与连接</h2>
    {access.error ? <DenNotice tone="error" message={access.data ? "无法刷新团队访问权限，当前显示上次加载的内容，请重新加载后重试。" : "无法加载团队访问权限，请重新加载后重试。"} /> : null}
    {!access.error || access.data ? <ItemPanel>
      {access.isLoading ? <ItemRowsSkeleton label="正在加载团队访问权限" /> : items.length ? items.map((item) => {
        const grantId = item.grantId;
        const accessSource = source(item);
        return <ItemRow
          key={`${item.plugin.id}-${item.edge}-${grantId ?? item.marketplace?.id ?? "org"}`}
          testId="team-plugin-access-row"
          logo={<PluginLogo name={item.plugin.name} />}
          title={item.plugin.name}
          description={`${item.plugin.componentCount} 个组件${rolesVary ? ` · ${item.role === "viewer" ? "可使用" : item.role === "editor" ? "可编辑" : "可管理"}` : ""}`}
          statusOnNarrow
          status={<span title={accessSource}>{accessSource}</span>}
          action={<ItemMenu label={`${item.plugin.name} 的更多操作，${accessSource}`} entries={item.edge === "direct_team" ? [{
            label: canRevoke ? "撤销" : "撤销，组织管理员可更改此项",
            disabled: !canRevoke || !grantId || revoke.isPending,
            destructive: true,
            confirm: {
              title: `撤销 ${item.plugin.name}？`,
              description: `移除 ${teamName} 对 ${item.plugin.name} 及其 ${item.plugin.componentCount} 个组件的直接访问权限。除非有其他授权，成员将失去此访问权限。其他团队和目录访问权限不受影响，管理员可重新授权。`,
              action: "Revoke",
            },
            onSelect: async () => { if (grantId) await revoke.mutateAsync({ teamId, pluginId: item.plugin.id, grantId }); },
          }] : item.edge === "via_catalog" && item.marketplace ? [{ label: "打开目录", href: getMarketplaceRoute(orgSlug, item.marketplace.id) }] : []} />}
        />;
      }) : <p className="px-5 py-4 text-[13px] text-gray-500">暂无插件访问权限，组织管理员可向此团队共享插件。</p>}
    </ItemPanel> : null}
  </section>;
}
