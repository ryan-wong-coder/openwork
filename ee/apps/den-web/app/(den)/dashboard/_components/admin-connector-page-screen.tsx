"use client";

import { ChevronDown, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { getMcpConnectionsRoute, getOrgAccessFlags, getToolTesterRoute, permissionLockReason } from "../../_lib/den-org";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { type AccessDraft, accessAddedToast } from "./access-summary";
import { signInSentence } from "./admin-connectors";
import { connectorAccountReady } from "./connector-detail";
import { ChatButton, WhatYourAiCanDo } from "./connector-page-screen";
import { GOOGLE_WORKSPACE_QUICK_ADD_ID, isNativeProviderCatalogId, MICROSOFT_365_QUICK_ADD_ID } from "./connector-catalog";
import { useMemberSignIn } from "./connector-setup";
import { ConnectorSettingsForm } from "./connector-settings";
import { useDenToast } from "./den-toast";
import { ItemHeader, ItemPage, SectionTitle } from "./item-header";
import { DetailRows, ItemMenu, removeEntry, ItemPanel } from "./item-list";
import { ConnectorLogo } from "./item-logo";
import { useSaveConnectionAccess } from "./item-sharing";
import { connectionMcpSetupUrl } from "./mcp-connection-app-setup";
import {
  type ExternalMcpConnection,
  isNativeProviderConnectionId,
  useDeleteMcpConnection,
  useDisconnectMcpConnection,
  useMcpConnectionTools,
  useUpdateMcpConnection,
} from "./mcp-connections-data";
import { NativeProviderSettings } from "./native-provider-setup";
import { SlackAssistantSetup } from "./slack-assistant-setup";
import { WhoCanUseIt } from "./who-can-use-it";

function UseInAnotherApp({ connection, lockedReason }: { connection: ExternalMcpConnection; lockedReason: string | null }) {
  const { runtimeConfig, runtimeConfigLoaded } = useDenFlow();
  const updateConnection = useUpdateMcpConnection();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = connectionMcpSetupUrl(runtimeConfigLoaded ? runtimeConfig.denApiUrl : "", connection.id);

  async function turnOn() {
    setError(null);
    try {
      await updateConnection.mutateAsync({
        connectionId: connection.id,
        expectedUpdatedAt: connection.updatedAt ?? new Date().toISOString(),
        name: connection.name,
        url: connection.url,
        authType: connection.authType,
        credentialMode: connection.credentialMode,
        exposeDirectly: true,
        access: connection.access ?? { orgWide: false, memberIds: [], teamIds: [] },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("复制失败，请选中地址后手动复制。");
    }
  }

  return (
    <ItemPanel>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-between gap-4 rounded-2xl px-5 py-3 text-left text-[13px] font-medium text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-gray-200"
      >
        在其他应用中使用
        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-5 py-4 text-[13px] leading-[18px] text-gray-500">
          {connection.exposeDirectly ? (
            <>
              <p>有权使用的人员 {connection.name} 可通过此地址将其添加到 Claude、Cursor 或其他 MCP 应用，然后登录 OpenWork。</p>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] text-gray-900">{url ?? "地址尚不可用，请重新加载页面。"}</p>
                <DenButton variant="secondary" size="sm" disabled={!url} onClick={() => void copy()}>{copied ? "已复制" : "复制"}</DenButton>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p>允许成员添加 {connection.name} 到 Claude、Cursor 或其他 MCP 应用。</p>
              <DenButton variant="secondary" size="sm" loading={updateConnection.isPending} disabled={lockedReason !== null} onClick={() => void turnOn()}>开启</DenButton>
            </div>
          )}
          {!connection.exposeDirectly && lockedReason ? (
            <p className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />{lockedReason}</p>
          ) : null}
          {error ? <p className="text-red-600" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </ItemPanel>
  );
}

function Disclosure({ label, open, onToggle, children, testId }: { label: string; open: boolean; onToggle: () => void; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col border-t border-gray-100">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        data-testid={testId}
        className="flex items-center justify-between gap-4 rounded-2xl px-5 py-3 text-left text-[13px] font-medium text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-gray-200"
      >
        {label}
        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? children : null}
    </section>
  );
}

/** Google Workspace or Microsoft 365, by the provider key its connection belongs to. */
function nativeKeyFor(connection: ExternalMcpConnection) {
  const key = connection.nativeProviderKey ?? connection.id;
  return isNativeProviderCatalogId(key) ? key : null;
}

/** C6: a connector in Manage, with Who can use it inline instead of Share. */
export function AdminConnectorPageScreen({ connection }: { connection: ExternalMcpConnection }) {
  const router = useRouter();
  const toast = useDenToast();
  const { orgSlug, orgContext } = useOrgDashboard();
  const memberAccess = orgContext
    ? getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions)
    : null;
  const canShareWithEveryone = memberAccess?.canShareWithEveryone === true;
  // People can always edit and remove connections they added.
  const editLockedReason = memberAccess?.canEditAnyConnection || connection.createdByYou ? null : permissionLockReason("connections.update");
  const canRemove = memberAccess?.canRemoveAnyConnection === true || connection.createdByYou === true;
  const saveAccess = useSaveConnectionAccess();
  const deleteConnection = useDeleteMcpConnection();
  const disconnect = useDisconnectMcpConnection();
  const signIn = useMemberSignIn();
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(Boolean(connection.setupRequired) || Boolean(connection.issuerReviewRequired)
    || (connection.oauthClientRequired === true && connection.oauthClientConfigured !== true)
    || (connection.authType === "apikey" && connection.credentialMode === "shared" && !connection.connected));
  const [error, setError] = useState<string | null>(null);
  const connectionId = connection.id;
  const name = connection.name;
  const native = isNativeProviderConnectionId(connection.id, connection.nativeProviderKey);
  const nativeKey = native ? nativeKeyFor(connection) : null;
  const aliasOnly = connection.id === GOOGLE_WORKSPACE_QUICK_ADD_ID || connection.id === MICROSOFT_365_QUICK_ADD_ID;
  const signedIn = connection.authType === "none" || connectorAccountReady(connection);
  const tools = useMcpConnectionTools(connectionId, signedIn && !native);
  const viewerId = orgContext?.currentMember.id ?? null;
  const draft: AccessDraft = connection.access
    ? { orgWide: connection.access.orgWide, memberIds: connection.access.memberIds, teamIds: connection.access.teamIds }
    : { orgWide: false, memberIds: [], teamIds: [] };
  const addedBy = connection.createdByName?.trim();

  async function changeAccess(next: AccessDraft) {
    if (!orgContext) return;
    const previous = draft;
    setSaving(true);
    setError(null);
    try {
      await saveAccess(connectionId, next);
      const message = accessAddedToast(previous, next, orgContext, viewerId);
      if (message) {
        toast({ ...message, action: { label: "撤销", onClick: () => saveAccess(connectionId, previous) } });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更改保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    await deleteConnection.mutateAsync(connectionId);
    toast({ title: `已移除 ${name}`, description: "此项已不再可供任何人使用。" });
    router.push(getMcpConnectionsRoute(orgSlug));
  }

  const accountValue = signedIn
    ? connection.authType === "none" ? "不需要" : connection.externalAccountId ?? "已登录"
    : connection.issuerReviewRequired ? <DenButton variant="secondary" size="xs" onClick={() => setSettingsOpen(true)}>检查登录服务器</DenButton>
    : <DenButton variant="secondary" size="xs" loading={signIn.pendingId === connectionId} onClick={() => void signIn.signIn(connection)}>登录</DenButton>;

  const details = [
    ...(connection.authType === "oauth"
      ? [{ label: connection.credentialMode === "shared" ? "组织账户" : "你的账号", value: accountValue }]
      : []),
    ...(addedBy ? [{ label: "添加者", value: addedBy }] : []),
  ];

  return (
    <ItemPage testId="admin-connector-page">
      <ItemHeader
        back={{ href: getMcpConnectionsRoute(orgSlug), label: "连接器" }}
        logo={<ConnectorLogo name={name} url={connection.url} size="lg" />}
        title={name}
        actions={(
          <>
            <ItemMenu
              size="md"
              label={`${name} 的更多操作`}
              entries={[
                { label: "编辑设置", onSelect: () => setSettingsOpen(true) },
                ...(!native && signedIn && memberAccess?.canManageConnections ? [{ label: "测试工具", href: `${getToolTesterRoute(orgSlug)}?connectionId=${encodeURIComponent(connectionId)}` }] : []),
                ...(!native && connection.authType !== "none" && connection.connected && memberAccess?.canDisconnectAnyConnection ? [{
                  label: "退出所有人的登录",
                  onSelect: async () => {
                    await disconnect.mutateAsync(connectionId);
                    toast({ title: `所有人已退出 ${name}`, description: "配置与使用权限保持不变。" });
                  },
                  confirm: { title: `让所有人退出 ${name}？`, description: "每人需要重新登录后使用。", action: "Sign everyone out" },
                }] : []),
                ...(aliasOnly ? [] : [canRemove ? removeEntry(name, remove) : { label: "移除", destructive: true, disabled: true }]),
              ]}
            />
            <ChatButton name={name} />
          </>
        )}
      />

      {orgContext && !connection.access ? (
        <section className="flex flex-col gap-2.5">
          <SectionTitle title="谁可以使用" meta={signInSentence(connection)} />
          <ItemPanel>
            <div className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]" data-testid="access-locked">
              <span className="font-medium text-gray-900">组织中的所有人</span>
              <span className="flex items-center gap-1.5 text-gray-500"><Lock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />在添加时设置</span>
            </div>
          </ItemPanel>
        </section>
      ) : null}

      {orgContext && connection.access ? (
        <section className="flex flex-col gap-2.5">
          <SectionTitle title="谁可以使用" meta={signInSentence(connection)} />
          <WhoCanUseIt
            value={draft}
            onChange={(next) => void changeAccess(next)}
            members={orgContext.members}
            teams={orgContext.teams}
            owner={null}
            canShareWithEveryone={canShareWithEveryone}
            everyoneOffDescription={draft.memberIds.length === 0 && draft.teamIds.length === 0
              ? "已关闭，尚未向任何人授予权限。"
              : "已关闭，仅下方人员和团队拥有此权限。"}
            disabled={saving}
          />
          {error ? <p className="text-[13px] text-red-600" role="alert">{error}</p> : null}
        </section>
      ) : null}

      {native ? null : <WhatYourAiCanDo tools={tools.data?.tools ?? []} loading={tools.isLoading} signedIn={signedIn} error={Boolean(tools.error)} />}

      {details.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <SectionTitle title="详情" />
          <DetailRows rows={details} />
          {signIn.failure?.id === connectionId ? (
            <p className="text-[13px] text-red-600" role="alert">{`无法登录 ${name}。${signIn.failure.message}`}</p>
          ) : null}
        </section>
      ) : null}

      {native ? null : <SlackAssistantSetup connection={connection} />}

      <Disclosure label="设置" open={settingsOpen} onToggle={() => setSettingsOpen((value) => !value)} testId="connector-settings-toggle">
        {nativeKey ? (
          <div className="px-5 py-4">
            <NativeProviderSettings
              providerKey={nativeKey}
              clientProviderId={connection.id}
              create={false}
              onSaved={() => toast({ title: `已保存 ${name}`, description: "之前已登录的成员可能需要重新登录。" })}
              footer={({ save, saving: savingSettings, disabled, label }) => (
                <div className="flex justify-end">
                  <DenButton size="sm" loading={savingSettings} disabled={disabled} onClick={save}>{label}</DenButton>
                </div>
              )}
            />
          </div>
        ) : (
          <ConnectorSettingsForm key={connection.updatedAt ?? connection.id} connection={connection} lockedReason={editLockedReason} onSaved={(message) => toast({ title: message })} />
        )}
      </Disclosure>

      {!aliasOnly && !canRemove ? (
        <p className="flex items-center gap-1.5 text-[13px] text-gray-500" data-testid="connector-remove-locked">
          <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
          {`只有添加 ${name} 的人可以将其移除。${permissionLockReason("connections.delete")}`}
        </p>
      ) : null}

      {native ? null : <UseInAnotherApp connection={connection} lockedReason={editLockedReason} />}
    </ItemPage>
  );
}
