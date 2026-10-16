"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  getAddConnectorRoute,
  getLibraryAddConnectorRoute,
  getLibraryConnectorRoute,
  getLibraryRoute,
  getMcpConnectionRoute,
  getMcpConnectionsRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { connectionForPresetUrl, GOOGLE_WORKSPACE_QUICK_ADD_ID, MICROSOFT_365_QUICK_ADD_ID } from "./connector-catalog";
import { displayedConnectorConnections } from "./connector-detail";
import { type CatalogEntry, catalogEntriesFromPresets, ConnectorPicker } from "./connector-picker";
import { ItemHeader, ItemPage } from "./item-header";
import { preloadConnectorLogo } from "./item-logo";
import {
  type ExternalMcpConnection,
  mcpConnectionPresetsQueryOptions,
  useMcpConnectionPresets,
  useMcpConnections,
} from "./mcp-connections-data";

export type ConnectorFlowMode = "member" | "admin";

export function customConnectorQuery(input: { name: string; url: string }): string {
  return `?${new URLSearchParams({ name: input.name, url: input.url }).toString()}`;
}

/** Loads the catalog and its logos ahead of "Add a connector", so it opens filled in. */
export function usePrefetchConnectorCatalog(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.fetchQuery(mcpConnectionPresetsQueryOptions()).then(
      (presets) => { for (const preset of presets) preloadConnectorLogo(preset.displayName, preset.url); },
      () => undefined,
    );
  };
}

/** Google Workspace and Microsoft 365 are org OAuth apps, set up by admins only. */
export const NATIVE_CATALOG_ENTRIES: CatalogEntry[] = [
  { id: GOOGLE_WORKSPACE_QUICK_ADD_ID, name: "Google Workspace", description: "Gmail、云端硬盘、日历、表格与 Chat", url: "https://workspace.google.com" },
  { id: MICROSOFT_365_QUICK_ADD_ID, name: "Microsoft 365", description: "Outlook、日历、OneDrive 与 Teams", url: "https://www.microsoft.com/microsoft-365" },
];

function nativeConnection(connections: readonly ExternalMcpConnection[], providerKey: string): ExternalMcpConnection | undefined {
  return connections.find((connection) => connection.id === providerKey || connection.nativeProviderKey === providerKey);
}

/** A1 to A3 and C1 to C2: pick what to connect. */
export function ConnectorCatalogScreen({ mode }: { mode: ConnectorFlowMode }) {
  const { orgSlug } = useOrgDashboard();
  const presets = useMcpConnectionPresets();
  const connections = useMcpConnections(mode === "admin" ? "manageable" : "usable");
  const usable = useMcpConnections("usable");
  const [customName, setCustomName] = useState<string | null>(null);
  const setupRoute = (catalogId?: string) => mode === "admin" ? getAddConnectorRoute(orgSlug, catalogId) : getLibraryAddConnectorRoute(orgSlug, catalogId);
  const openRoute = (connectionId: string) => mode === "admin" ? getMcpConnectionRoute(orgSlug, connectionId) : getLibraryConnectorRoute(orgSlug, connectionId);
  const known = mode === "admin"
    ? displayedConnectorConnections(connections.data ?? [], usable.data ?? [])
    : connections.data ?? [];

  const presetEntries = catalogEntriesFromPresets(presets.data ?? []).map((entry) => {
    const existing = connectionForPresetUrl(known, entry.url);
    return existing ? { ...entry, openHref: openRoute(existing.id) } : entry;
  });
  const nativeEntries = mode === "admin"
    ? NATIVE_CATALOG_ENTRIES.map((entry): CatalogEntry => {
      const existing = nativeConnection(known, entry.id);
      if (existing && entry.id === GOOGLE_WORKSPACE_QUICK_ADD_ID) {
        return { ...entry, addLabel: "添加其他" };
      }
      return existing ? { ...entry, openHref: openRoute(existing.id) } : entry;
    })
    : [];
  const entries = presets.isLoading ? [] : [...nativeEntries, ...presetEntries];

  return (
    <ItemPage testId="connector-catalog">
      <ItemHeader
        compact
        back={mode === "admin" ? { href: getMcpConnectionsRoute(orgSlug), label: "连接器" } : { href: getLibraryRoute(orgSlug), label: "我的资源库" }}
        title="添加连接器"
      />
      {presets.error ? (
        <p className="text-[13px] text-red-600">{presets.error instanceof Error ? presets.error.message : "列表加载失败，请重试。"}</p>
      ) : null}
      <ConnectorPicker
        entries={entries}
        loading={presets.isLoading}
        mode={mode}
        customName={customName}
        onCustomNameChange={setCustomName}
        addHref={(entry) => setupRoute(entry.id)}
        customHref={(input) => `${setupRoute("custom")}${customConnectorQuery(input)}`}
      />
    </ItemPage>
  );
}
