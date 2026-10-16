"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { DenPageHeader } from "../../_components/ui/page-header";
import { getAddConnectorRoute, getMcpConnectionRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { managedAccessStatus } from "./access-summary";
import { usePrefetchConnectorCatalog } from "./connector-catalog-screen";
import { GOOGLE_WORKSPACE_QUICK_ADD_ID, MICROSOFT_365_QUICK_ADD_ID } from "./connector-catalog";
import { connectorAccountReady, displayedConnectorConnections } from "./connector-detail";
import { useDenToast } from "./den-toast";
import { ItemPage } from "./item-header";
import { FilterInput, ItemMenu, removeEntry, ItemPanel, ItemRow, ItemRowsSkeleton, LinkButton } from "./item-list";
import { ConnectorLogo } from "./item-logo";
import { ConnectorLogoStrip } from "./library-add-dialog";
import { DenButton } from "../../_components/ui/button";
import { connectorReadinessState, connectorReadinessNote } from "./connector-readiness";
import { useCheckMcpConnection } from "./mcp-connections-data";
import { getOrgAccessFlags } from "../../_lib/den-org";
import { connectorSetupUnfinished, finishSetupHref } from "./admin-connectors";
import { type ExternalMcpConnection, isNativeProviderConnectionId, useDeleteMcpConnection, useMcpConnections } from "./mcp-connections-data";

function ConnectorsEmpty({ orgSlug }: { orgSlug: string | null }) {
  const prefetchCatalog = usePrefetchConnectorCatalog();
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full flex-col items-center gap-5 rounded-2xl border border-gray-100 bg-white px-6 pb-14 pt-16 text-center" data-testid="connectors-empty">
        <ConnectorLogoStrip size="md" />
        <div className="flex flex-col gap-1.5">
          <p className="text-[15px] font-semibold leading-5 text-gray-900">暂无连接器</p>
          <p className="text-[13px] leading-[18px] text-gray-500">管理组织 AI 可使用的应用，并分配使用权限。</p>
        </div>
        <LinkButton variant="primary" href={getAddConnectorRoute(orgSlug)} onPointerEnter={prefetchCatalog} onFocus={prefetchCatalog}>
          <Plus className="h-4 w-4" aria-hidden />
          添加连接器
        </LinkButton>
      </div>
      <p className="text-[12px] leading-4 text-gray-400">成员仍可在“我的资源库”中添加自己的应用。</p>
    </div>
  );
}

/** C1 and C5: every connector the organization manages, and who has each one. */
export function AdminConnectorsScreen() {
  const toast = useDenToast();
  const { orgSlug, orgContext } = useOrgDashboard();
  const connections = useMcpConnections("manageable");
  const usable = useMcpConnections("usable");
  const deleteConnection = useDeleteMcpConnection();
  const checkConnection = useCheckMcpConnection();
  const canCheck = orgContext ? getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions).canManageConnections : false;
  const prefetchCatalog = usePrefetchConnectorCatalog();
  const [query, setQuery] = useState("");
  const viewerId = orgContext?.currentMember.id ?? null;
  const all = displayedConnectorConnections(connections.data ?? [], usable.data ?? []);
  const needle = query.trim().toLowerCase();
  const visible = needle ? all.filter((connection) => connection.name.toLowerCase().includes(needle)) : all;
  const empty = !connections.isLoading && !connections.error && all.length === 0;

  async function remove(connection: ExternalMcpConnection) {
    await deleteConnection.mutateAsync(connection.id);
    toast({ title: `已移除 ${connection.name}`, description: "此项已不再可供任何人使用。" });
  }

  return (
    <ItemPage testId="admin-connectors">
      <DenPageHeader
        title="连接器"
        className={all.some((connection) => connection.readiness !== undefined) ? "[&>div:first-child]:basis-full sm:[&>div:first-child]:basis-0" : undefined}
        description="组织 AI 可使用的应用。"
        action={empty ? undefined : (
          <LinkButton variant="primary" href={getAddConnectorRoute(orgSlug)} onPointerEnter={prefetchCatalog} onFocus={prefetchCatalog}>
            <Plus className="h-4 w-4" aria-hidden />
            添加连接器
          </LinkButton>
        )}
      />

      {connections.error ? (
        <p className="rounded-2xl border border-gray-100 bg-white px-5 py-4 text-[13px] text-red-600">
          {connections.error instanceof Error ? connections.error.message : "连接器加载失败，请重试。"}
        </p>
      ) : null}

      {empty ? <ConnectorsEmpty orgSlug={orgSlug} /> : null}

      {!empty && !connections.error ? (
        <>
          <div className="-mt-1 flex justify-end">
            <FilterInput value={query} onChange={setQuery} className="w-[240px]" />
          </div>
          {connections.isLoading ? <ItemPanel><ItemRowsSkeleton label="正在加载连接器" /></ItemPanel> : null}
          {visible.length > 0 ? (
            <ItemPanel>
              {visible.map((connection) => {
                const href = getMcpConnectionRoute(orgSlug, connection.id);
                const readinessState = connectorReadinessState(connection);
                const unfinished = connectorSetupUnfinished(connection);
                const status = unfinished
                  ? "配置未完成"
                  : !connection.access && isNativeProviderConnectionId(connection.id, connection.nativeProviderKey)
                    ? "所有人"
                    : orgContext ? managedAccessStatus(connection.access, orgContext, viewerId) : "";
                const signInNote = connection.credentialMode === "per_member" && connection.authType === "oauth"
                  ? "每人分别登录"
                  : connection.authType === "none" ? "无需登录" : connectorAccountReady(connection) ? "所有人共用一个账户" : undefined;
                return (
                  <div key={connection.id} data-connector-row={connection.name}>
                    <ItemRow
                      href={href}
                      logo={<ConnectorLogo name={connection.name} url={connection.url} />}
                      title={connection.name}
                      description={readinessState ? connectorReadinessNote(connection) ?? signInNote : signInNote}
                      status={readinessState ?? status}
                      statusOnNarrow={readinessState !== null}
                      wideAction={readinessState !== null}
                      wrapDescription={readinessState === "无法验证"}
                      action={readinessState === "无法验证" ? (
                        <DenButton size="xs" variant="secondary" disabled={!canCheck || checkConnection.isPending} title={!canCheck ? "管理员可以检查此连接。" : undefined}
                          onClick={() => void checkConnection.mutateAsync(connection.id).catch(() => toast({ title: "无法检查此连接", description: "请重试。" }))}>重新检查</DenButton>
                      ) : unfinished ? (
                        <LinkButton size="xs" href={finishSetupHref(orgSlug, connection)}>完成</LinkButton>
                      ) : (
                        <ItemMenu
                          label={`${connection.name} 的更多操作`}
                          entries={[
                            { label: "打开", href },
                            ...(readinessState && canCheck ? [{ label: "重新检查", onSelect: () => void checkConnection.mutateAsync(connection.id).catch(() => toast({ title: "无法检查此连接", description: "请重试。" })) }] : []),
                            ...(connection.id === GOOGLE_WORKSPACE_QUICK_ADD_ID || connection.id === MICROSOFT_365_QUICK_ADD_ID
                              ? []
                              : [removeEntry(connection.name, () => remove(connection))]),
                          ]}
                        />
                      )}
                    />
                  </div>
                );
              })}
            </ItemPanel>
          ) : null}
          {!connections.isLoading && visible.length === 0 ? (
            <p className="rounded-2xl border border-gray-100 bg-white px-5 py-6 text-center text-[13px] text-gray-500">没有匹配项。</p>
          ) : null}
        </>
      ) : null}
    </ItemPage>
  );
}
