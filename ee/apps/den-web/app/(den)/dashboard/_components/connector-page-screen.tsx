"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessageSquare, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { getLibraryConnectorShareRoute, getLibraryRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { ownedAccessStatus } from "./access-summary";
import { connectorChatDeepLink, connectorChatPrompt } from "./connector-catalog";
import { connectorAccountReady } from "./connector-detail";
import { toolSummary, toolTitle, useMemberSignIn } from "./connector-setup";
import { useDenToast } from "./den-toast";
import { formatAddedDate } from "./item-dates";
import { ItemHeader, ItemPage, SectionTitle } from "./item-header";
import { DetailRows, ItemMenu, removeEntry, ItemPanel, LinkButton } from "./item-list";
import { ConnectorLogo } from "./item-logo";
import { libraryQueryKeys, useLibrary } from "./library-data";
import { isOwnedByViewer, libraryItemDescription, receivedStatus } from "./library-view";
import { personalApiKeyStatus, personalApiKeyStatusLabel } from "./member-api-key";
import { MemberApiKeyDialog } from "./member-api-key-dialog";
import {
  type ExternalMcpTool,
  useDeleteMcpConnection,
  useDisconnectMyProviderAccount,
  useMcpConnections,
  useMcpConnectionTools,
} from "./mcp-connections-data";

const TOOLS_PREVIEW = 3;

export function WhatYourAiCanDo({ tools, loading, signedIn, error }: {
  tools: readonly ExternalMcpTool[];
  loading: boolean;
  signedIn: boolean;
  error: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tools : tools.slice(0, TOOLS_PREVIEW);
  const count = tools.length === 1 ? "1 项" : `${tools.length} 项内容`;
  return (
    <section className="flex flex-col gap-2.5" data-testid="what-your-ai-can-do">
      <SectionTitle title="你的 AI 可以做什么" meta={tools.length > 0 ? count : undefined} />
      <ItemPanel>
        {!signedIn ? <p className="px-5 py-4 text-[13px] text-gray-500">登录后将在此显示。</p> : null}
        {signedIn && loading ? <p className="px-5 py-4 text-[13px] text-gray-500">正在读取…</p> : null}
        {signedIn && error ? <p className="px-5 py-4 text-[13px] text-gray-500">OpenWork 暂时无法读取，请稍后重试。</p> : null}
        {visible.map((tool) => (
          <div key={tool.name} className="px-5 py-3" data-testid="connector-tool">
            <p className="text-[14px] font-medium leading-5 text-gray-900">{toolTitle(tool)}</p>
            {toolSummary(tool) ? <p className="text-[13px] leading-[18px] text-gray-500">{toolSummary(tool)}</p> : null}
          </div>
        ))}
        {tools.length > TOOLS_PREVIEW ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1.5 px-5 py-3 text-left text-[13px] font-medium text-gray-700 hover:text-gray-900"
          >
            {expanded ? "收起" : `显示全部 ${tools.length} 项`}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
        ) : null}
      </ItemPanel>
    </section>
  );
}

export function ChatButton({ name }: { name: string }) {
  return (
    <DenButton icon={MessageSquare} href={connectorChatDeepLink({ connector: name, prompt: connectorChatPrompt(name) })}>
      聊天
    </DenButton>
  );
}

/** A6: a connector in My Library. */
export function LibraryConnectorScreen({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useDenToast();
  const { orgSlug, orgContext } = useOrgDashboard();
  const library = useLibrary();
  const usable = useMcpConnections("usable");
  const signIn = useMemberSignIn();
  const deleteConnection = useDeleteMcpConnection();
  const disconnect = useDisconnectMyProviderAccount();
  const connection = usable.data?.find((entry) => entry.id === connectionId) ?? null;
  const item = library.data?.find((entry) => entry.type === "connection" && entry.id === connectionId) ?? null;
  const signedIn = Boolean(connection && (connection.authType === "none" || connectorAccountReady(connection)));
  const apiKeyStatus = connection ? personalApiKeyStatus(connection) : null;
  const tools = useMcpConnectionTools(connectionId, signedIn);
  const viewerId = orgContext?.currentMember.id ?? null;
  const mine = Boolean(connection?.access) || Boolean(item && isOwnedByViewer(item, viewerId, new Set()));
  const back = { href: getLibraryRoute(orgSlug), label: "我的资源库" };

  if (!connection && (usable.isLoading || library.isLoading)) {
    return <ItemPage><ItemHeader back={back} title="正在加载…" /></ItemPage>;
  }
  if (!connection && (usable.error || library.error)) {
    return <ItemPage><ItemHeader back={back} title="加载失败" description="请重新加载页面后重试。" /></ItemPage>;
  }
  if (!connection) {
    return <ItemPage><ItemHeader back={back} title="不在你的资源库中" description="此项可能已移除，或已不再与你共享。" /></ItemPage>;
  }

  const name = connection.name;
  const personEdge = item?.edges.find((edge) => edge.kind === "person");
  const added = formatAddedDate(personEdge?.kind === "person" ? personEdge.grantedAt : connection.connectedAt);
  const who = mine && orgContext
    ? ownedAccessStatus(connection.access, orgContext, viewerId)
    : item ? receivedStatus(item.edges) : "";

  async function remove() {
    await deleteConnection.mutateAsync(connectionId);
    await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items });
    toast({ title: `已移除 ${name}`, description: "此项已不再可供任何人使用。" });
    router.push(getLibraryRoute(orgSlug));
  }

  async function signOut() {
    if (!connection) return;
    await disconnect.mutateAsync(connection);
    await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items });
  }

  return (
    <ItemPage testId="library-connector">
      <ItemHeader
        back={back}
        logo={<ConnectorLogo name={name} url={connection.url} size="lg" />}
        title={name}
        description={item ? libraryItemDescription(item) : undefined}
        actions={(
          <>
            <ItemMenu
              size="md"
              label={`${name} 的更多操作`}
              entries={[
                ...(connection.connectedForMe && connection.credentialMode === "per_member" ? [{ label: apiKeyStatus ? "移除密钥" : "退出登录", onSelect: () => void signOut() }] : []),
                ...(mine ? [removeEntry(name, remove)] : []),
              ]}
            />
            {mine ? (
              <LinkButton href={getLibraryConnectorShareRoute(orgSlug, connectionId)}>
                <UserPlus className="h-4 w-4" aria-hidden />
                分享
              </LinkButton>
            ) : null}
            <ChatButton name={name} />
          </>
        )}
      />
      <WhatYourAiCanDo tools={tools.data?.tools ?? []} loading={tools.isLoading} signedIn={signedIn} error={Boolean(tools.error)} />
      <section className="flex flex-col gap-2.5">
        <SectionTitle title="详情" />
        <DetailRows
          rows={[
            { label: "谁可以使用", value: who },
            ...(connection.authType === "none" ? [] : [{
              label: connection.authType === "apikey" ? "名称" : "当前登录账户",
              value: apiKeyStatus === "saved_unverified" || apiKeyStatus === "ready"
                ? personalApiKeyStatusLabel(apiKeyStatus)
                : apiKeyStatus === "missing" || apiKeyStatus === "reconnect_required"
                  ? <DenButton variant="secondary" size="xs" loading={signIn.pendingId === connectionId} onClick={() => void signIn.signIn(connection)}>{apiKeyStatus === "reconnect_required" ? "替换密钥" : "添加密钥"}</DenButton>
                  : signedIn
                    ? connection.authType === "apikey" ? "组织密钥已就绪" : connection.externalAccountId ?? "你"
                    : connection.authType === "apikey"
                      ? "请联系管理员替换组织密钥"
                      : <DenButton variant="secondary" size="xs" loading={signIn.pendingId === connectionId} onClick={() => void signIn.signIn(connection)}>登录</DenButton>,
            }]),
            ...(added ? [{ label: "已添加", value: added }] : []),
          ]}
        />
      </section>
      <MemberApiKeyDialog target={signIn.apiKeyTarget} onClose={signIn.closeApiKey} />
    </ItemPage>
  );
}
