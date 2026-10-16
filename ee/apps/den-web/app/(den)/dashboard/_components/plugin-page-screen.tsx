"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, MessageSquare, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import { useDenFlow } from "../../_providers/den-flow-provider";
import {
  getLibraryPluginShareRoute,
  getLibraryRoute,
  getOrgAccessFlags,
  getPluginDetailsRoute,
  getPluginsRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { type AccessDraft, accessAddedToast, ownedAccessStatus } from "./access-summary";
import { useDenToast } from "./den-toast";
import { formatAddedDate } from "./item-dates";
import { ItemHeader, ItemPage, SectionTitle } from "./item-header";
import { McpConnectionAppSetup } from "./mcp-connection-app-setup";
import { DetailRows, ItemMenu, removeEntry, ItemPanel, ItemRow, LinkButton } from "./item-list";
import { ConnectorLogo, KindTile, LetterTile, PluginLogo } from "./item-logo";
import { draftFromPluginGrants, useSavePluginAccess } from "./item-sharing";
import { type LibraryItem, libraryQueryKeys, useLibrary } from "./library-data";
import { receivedStatus } from "./library-view";
import { usePluginAccess } from "./plugin-access-data";
import { type DenPlugin, pluginQueryKeys, usePlugin } from "./plugin-data";
import { PluginPageSkeleton } from "./plugin-skeletons";
import { WhoCanUseIt } from "./who-can-use-it";

export function pluginChatDeepLink(plugin: Pick<DenPlugin, "name">): string {
  const params = new URLSearchParams({ prompt: `请使用 ${plugin.name} 帮我完成以下工作：` });
  return `openwork://chat?${params.toString()}`;
}

/** Skill names are stored as slugs; people read "Prep a sales call". */
export function skillTitle(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
  const words = name.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function WhatsInside({ plugin, appMcpServersEnabled = false }: { plugin: DenPlugin; appMcpServersEnabled?: boolean }) {
  const rows = [
    ...plugin.authoredApps.map((app) => ({
      key: `app:${app.id}`,
      logo: <LetterTile name={app.name} />,
      title: app.name,
      description: "",
      kind: "App",
      href: appMcpServersEnabled ? pluginChatDeepLink({ name: `来自 ${plugin.name} 的 ${app.name} 应用` }) : undefined,
    })),
    ...plugin.skills.map((skill) => ({
      key: `skill:${skill.id}`,
      logo: <KindTile kind="skill" />,
      title: skillTitle(skill.name),
      description: skill.description,
      kind: "Skill",
    })),
    ...plugin.mcps.map((mcp) => ({
      key: `mcp:${mcp.id}`,
      logo: <ConnectorLogo name={mcp.name} url={mcp.url} />,
      title: mcp.name,
      description: mcp.description,
      kind: "Connector",
    })),
    ...plugin.commands.map((command) => ({
      key: `command:${command.id}`,
      logo: <KindTile kind="command" />,
      title: command.name.startsWith("/") ? command.name : `/${command.name}`,
      description: command.description,
      kind: "Command",
    })),
  ];
  return (
    <section className="flex flex-col gap-2.5" data-testid="whats-inside">
      <SectionTitle title="包含的内容" />
      <ItemPanel>
        {rows.length === 0 ? <p className="px-5 py-4 text-[13px] text-gray-500">暂无内容。</p> : null}
        {rows.map((row) => (
          <ItemRow compact key={row.key} logo={row.logo} title={row.title} description={row.description || undefined} href={"href" in row && typeof row.href === "string" ? row.href : undefined} action={<span className="text-[12px] text-gray-500">{row.kind}</span>} />
        ))}
      </ItemPanel>
    </section>
  );
}

/** Each App is its own MCP server; its URL works in any MCP client with OpenWork sign-in. */
export function AppMcpServers({ plugin }: { plugin: DenPlugin }) {
  const { runtimeConfig, runtimeConfigLoaded } = useDenFlow();
  const { orgContext } = useOrgDashboard();
  // Den reports App servers only while its deployment switch and the
  // organization's member-facing MCP connections setting are both on.
  if (plugin.authoredApps.length === 0 || orgContext?.capabilities.appMcpServers !== true) return null;
  return (
    <section className="flex flex-col gap-2.5" data-testid="app-mcp-servers">
      <SectionTitle title="在其他应用中使用" />
      {plugin.authoredApps.map((app) => (
        <McpConnectionAppSetup
          key={app.id}
          connection={{ id: app.id, exposeDirectly: true, nativeProviderKey: null }}
          publicApiUrl={runtimeConfigLoaded ? runtimeConfig.denApiUrl : ""}
          enabled
          label={`${app.name} MCP URL`}
        />
      ))}
    </section>
  );
}

function useArchivePlugin() {
  const queryClient = useQueryClient();
  return async (pluginId: string) => {
    const { response, payload } = await requestJson(`/v1/plugins/${encodeURIComponent(pluginId)}/archive`, { method: "POST", body: "{}" }, 15000);
    if (!response.ok) throw getRequestError(payload, response, "无法移除此项，请重试。");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pluginQueryKeys.all }),
      queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items }),
    ]);
  };
}

/** B2 (a member's plugin) and D3 (Manage, with Who can use it inline). */
export function PluginPageScreen({ pluginId, mode }: { pluginId: string; mode: "member" | "admin" }) {
  return mode === "member" ? <MemberPluginPage pluginId={pluginId} /> : <PluginPage pluginId={pluginId} mode="admin" libraryItems={undefined} />;
}

/** My Library loads alongside the plugin; Manage pages never need it. */
function MemberPluginPage({ pluginId }: { pluginId: string }) {
  const library = useLibrary();
  return <PluginPage pluginId={pluginId} mode="member" libraryItems={library.data} />;
}

function PluginPage({ pluginId, mode, libraryItems }: { pluginId: string; mode: "member" | "admin"; libraryItems: LibraryItem[] | undefined }) {
  const router = useRouter();
  const toast = useDenToast();
  const { orgSlug, orgContext } = useOrgDashboard();
  const plugin = usePlugin(pluginId);
  const access = usePluginAccess(pluginId);
  const saveAccess = useSavePluginAccess();
  const archive = useArchivePlugin();
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const back = mode === "admin" ? { href: getPluginsRoute(orgSlug), label: "插件" } : { href: getLibraryRoute(orgSlug), label: "我的资源库" };

  if (plugin.isLoading) {
    return <PluginPageSkeleton back={back} mode={mode} compact />;
  }

  if (!plugin.data) {
    return (
      <ItemPage>
        <ItemHeader
          back={back}
          title={plugin.error ? "加载失败" : "未找到"}
          description={plugin.error ? "请重新加载页面后重试。" : "此项可能已被移除。"}
        />
      </ItemPage>
    );
  }

  const data = plugin.data;
  const viewerId = orgContext?.currentMember.id ?? null;
  const mine = data.createdByOrgMembershipId !== null && data.createdByOrgMembershipId === viewerId;
  const memberAccess = orgContext
    ? getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions)
    : null;
  const draft = access.data ? draftFromPluginGrants(access.data) : null;
  const item = libraryItems?.find((entry) => entry.type === "plugin" && entry.id === pluginId);
  // Creator, a manager on this plugin, or `sharing.manage_all` (manager on everything shared).
  const canManage = mine || (item?.type === "plugin" && item.role === "manager") || memberAccess?.canManageAllShared === true;
  const creator = orgContext?.members.find((member) => member.id === data.createdByOrgMembershipId);
  const who = mine && orgContext && draft
    ? ownedAccessStatus(draft, orgContext, viewerId)
    : item ? receivedStatus(item.edges) : "";

  async function changeAccess(next: AccessDraft) {
    if (!access.data || !orgContext || !draft) return;
    const previous = draft;
    setSavingAccess(true);
    setAccessError(null);
    try {
      await saveAccess({ pluginId, grants: access.data, next, ownerId: data.createdByOrgMembershipId });
      const message = accessAddedToast(previous, next, orgContext, data.createdByOrgMembershipId);
      if (message) {
        toast({
          ...message,
          action: {
            label: "撤销",
            onClick: async () => {
              const refreshed = await access.refetch();
              if (refreshed.data) await saveAccess({ pluginId, grants: refreshed.data, next: previous, ownerId: data.createdByOrgMembershipId });
            },
          },
        });
      }
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "更改保存失败，请重试。");
    } finally {
      setSavingAccess(false);
    }
  }

  async function remove() {
    await archive(pluginId);
    toast({ title: `已移除 ${data.name}`, description: "此项已不再可供任何人使用。" });
    router.push(back.href);
  }

  return (
    <ItemPage testId="plugin-page">
      <ItemHeader
        compact
        back={back}
        logo={<PluginLogo name={data.name} size="lg" />}
        title={data.name}
        actions={(
          <>
            {!canManage ? <DenButton variant="secondary" icon={LockKeyhole} disabled>管理</DenButton> : null}
            <ItemMenu
              size="md"
              label={`${data.name} 的更多操作`}
              entries={canManage ? [
                ...(mode === "admin" ? [{ label: "编辑内容", href: getPluginDetailsRoute(orgSlug, pluginId) }] : []),
                removeEntry(data.name, remove),
              ] : []}
            />
            {mode === "member" && mine ? (
              <LinkButton href={getLibraryPluginShareRoute(orgSlug, pluginId)}>
                <UserPlus className="h-4 w-4" aria-hidden />
                分享
              </LinkButton>
            ) : null}
            <DenButton icon={MessageSquare} href={pluginChatDeepLink(data)}>聊天</DenButton>
          </>
        )}
      />

      {mode === "admin" && orgContext && draft ? (
        <section className="flex flex-col gap-2.5">
          <SectionTitle title="谁可以使用" />
          <WhoCanUseIt
            value={draft}
            onChange={(next) => void changeAccess(next)}
            members={orgContext.members}
            teams={orgContext.teams}
            owner={creator ? { id: creator.id, name: creator.user.name || creator.user.email, isYou: creator.id === viewerId } : null}
            canShareWithEveryone={memberAccess?.canShareWithEveryone === true}
            everyoneOffDescription={draft.memberIds.filter((id) => id !== data.createdByOrgMembershipId).length === 0 && draft.teamIds.length === 0
              ? "已关闭，目前仅你自己可使用。"
              : "已关闭，仅下方人员和团队拥有此权限。"}
            disabled={savingAccess}
          />
          {accessError ? <p className="text-[13px] text-red-600">{accessError}</p> : null}
        </section>
      ) : null}

      <WhatsInside plugin={data} appMcpServersEnabled={orgContext?.capabilities.appMcpServers === true} />
      <AppMcpServers plugin={data} />

      {!canManage ? <p className="flex items-center gap-2 text-[13px] text-[var(--dls-text-secondary)]" data-testid="plugin-manage-locked"><LockKeyhole className="size-4 shrink-0" aria-hidden />仅插件管理员或组织管理员可编辑或移除。</p> : null}

      <section className="flex flex-col gap-2.5">
        <SectionTitle title="详情" />
        <DetailRows
          rows={[
            ...(data.description ? [{ label: "关于", value: data.description, wrap: true }] : []),
            ...(mode === "member" ? [{ label: "谁可以使用", value: who }] : []),
            { label: "创建者", value: mine ? "你" : creator?.user.name || "你的组织" },
            ...(formatAddedDate(data.createdAt) ? [{ label: "已添加", value: formatAddedDate(data.createdAt) }] : []),
          ]}
        />
      </section>
    </ItemPage>
  );
}
