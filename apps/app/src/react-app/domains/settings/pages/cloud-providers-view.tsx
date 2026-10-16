/** @jsxImportSource react */
import * as React from "react";

import type { CloudImportedProvider } from "@/app/cloud/import-state";
import type { DesktopAppRestrictionChecker } from "@/app/cloud/desktop-app-restrictions";
import type { DenOrgLlmProvider, DenOrgLlmProviderAccess } from "@/app/lib/den";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { currentLocale, t } from "@/i18n";
import { GatewayConnectRow } from "./ai-view";
import { ProviderIcon } from "../../../design-system/provider-icon";
import { gatewayConnectProviderKey, type GatewayConnectProvider } from "../../connections/provider-auth/cloud-provider-config";
import { useCloudSession } from "@/react-app/domains/settings/cloud/cloud-session-provider";
import {
  CloudProvidersSection,
  type CloudProviderRow,
  type CloudProviderRowStatus,
} from "@/react-app/domains/settings/cloud/sections";
import {
  getCloudProviderEnv,
  getCloudManagedProviderId,
  isCloudProviderOutOfSync,
} from "@/react-app/domains/connections/provider-auth/cloud-provider-config";
import { isProviderAllowedByDesktopPolicy } from "@/react-app/domains/connections/provider-auth/provider-policy";
import type {
  CloudProviderServerSyncState,
  CloudProviderSyncError,
} from "@/react-app/domains/connections/provider-auth/store";
import { SettingsStack } from "@/react-app/domains/settings/settings-section";

/** "Everyone", the team names, or a member count; null when Den did not say. */
export function providerAccessLabel(access: DenOrgLlmProviderAccess | undefined): string | null {
  if (!access) return null;
  if (access.allMembers) return t("settings_extra.everyone");
  if (access.teamNames.length) return access.teamNames.join(", ");
  if (access.memberCount) return t("settings_extra.count_members", { count: access.memberCount });
  return null;
}

export type CloudProviderRowStateInput = {
  imported: boolean;
  outOfSync: boolean;
  allowed: boolean;
  importsUnavailable: boolean;
  needsCredential: boolean;
  needsServer: boolean;
  syncError: CloudProviderSyncError | null;
  /**
   * The server-side sync skipped this provider (from
   * /cloud-provider-sync/status skippedProviders, e.g. missing_credentials) —
   * an honest attention state instead of a silent, permanent "Syncing".
   */
  skippedByServer?: boolean;
  /**
   * The server still owes the engine a reload: the provider is materialized
   * on disk but its models are not served yet, so "Connected" would lie.
   */
  reloadPending?: boolean;
};

export function resolveCloudProviderRowStatus(
  input: CloudProviderRowStateInput,
): CloudProviderRowStatus {
  if (input.importsUnavailable) return "unavailable";
  if (!input.allowed) return "blocked";
  if (input.syncError) return input.syncError.kind;
  if (input.needsCredential || input.skippedByServer === true) return "needs_credential";
  if (input.needsServer) return "needs_server";
  return input.imported && !input.outOfSync && input.reloadPending !== true
    ? "connected"
    : "syncing";
}

export function canRetryCloudProviderRow(status: CloudProviderRowStatus) {
  return status === "error";
}

export type CloudProvidersViewProps = {
  checkDesktopAppRestriction: DesktopAppRestrictionChecker;
  cloudOrgProviders: DenOrgLlmProvider[];
  connectCloudProvider: (cloudProviderId: string) => Promise<string | void>;
  embedded?: boolean;
  importedCloudProviders: Record<string, CloudImportedProvider>;
  importsUnavailable: boolean;
  lastSyncError: Record<string, CloudProviderSyncError>;
  openworkServerAvailable: boolean;
  onOpenAccount: () => void;
  refreshCloudOrgProviders: (options?: { force?: boolean }) => Promise<DenOrgLlmProvider[]>;
  runCloudProviderSync: (reason: "manual") => Promise<unknown>;
  /** Server-side sync facts (reload pending, skips); null on the legacy renderer-import path. */
  serverSync: CloudProviderServerSyncState | null;
  gatewayConnectProviders?: GatewayConnectProvider[];
  connectingGatewayProviderId?: string | null;
  onConnectGatewayProvider?: (provider: GatewayConnectProvider) => void | Promise<void>;
  onOpenDen?: () => void;
  onOpenModelConnections?: () => void;
};

export function CloudProvidersView({
  checkDesktopAppRestriction,
  cloudOrgProviders,
  connectCloudProvider,
  embedded = false,
  importedCloudProviders,
  importsUnavailable,
  lastSyncError,
  openworkServerAvailable,
  onOpenAccount,
  refreshCloudOrgProviders,
  runCloudProviderSync,
  serverSync,
  gatewayConnectProviders = [],
  connectingGatewayProviderId,
  onConnectGatewayProvider,
  onOpenDen,
  onOpenModelConnections,
}: CloudProvidersViewProps) {
  const locale = currentLocale();
  const { activeOrganization, isSignedIn } = useCloudSession();
  const [busy, setBusy] = React.useState(false);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const rows = React.useMemo<CloudProviderRow[]>(() => {
    const restrictToCloud = checkDesktopAppRestriction({ restriction: "allowCustomProviders" });
    const liveRows = cloudOrgProviders.map((provider) => {
      const imported = importedCloudProviders[provider.id] ?? null;
      const outOfSync = imported ? isCloudProviderOutOfSync(provider, imported) : false;
      const allowed = isProviderAllowedByDesktopPolicy({
        providerId: getCloudManagedProviderId(provider),
        restrictToCloud,
        checkRestriction: checkDesktopAppRestriction,
      });
      // Modern server sync owns credential resolution, including local
      // Environment variables. Den's shared-credential summary and errors
      // from the legacy renderer path are not authoritative in this mode.
      const syncError = serverSync === null ? lastSyncError[provider.id] ?? null : null;
      const env = getCloudProviderEnv(provider.providerConfig);
      const status = resolveCloudProviderRowStatus({
        imported: Boolean(imported),
        outOfSync,
        allowed,
        importsUnavailable,
        needsCredential: serverSync === null && !provider.hasApiKey && env.length > 0,
        needsServer: serverSync === null && provider.hasApiKey && env.length > 1 && !openworkServerAvailable,
        syncError,
        skippedByServer: Boolean(serverSync?.skippedProviders[provider.id]),
        reloadPending: serverSync?.reloadPending === true,
      });
      const providerDetail = provider.source === "openwork"
        ? [t("settings_extra.organization_credential"), provider.models.length ? t("model_picker.model_count_other", { count: provider.models.length }) : t("interface.all_models")].join(" · ")
        : [imported?.source === "openwork_gateway" ? "OpenWork Gateway" : t("settings_extra.organization_credential"), provider.credentialMode === "per_member" ? t("settings_extra.each_member_signs_in") : t("settings_extra.shared_org_key")].join(" · ");
      const detail = status === "blocked"
        ? t("den.cloud_provider_blocked")
        : status === "unavailable"
          ? t("den.cloud_provider_imports_unavailable")
          : status === "needs_credential"
            ? syncError?.message ?? t("den.cloud_provider_needs_credential")
            : status === "needs_server"
              ? syncError?.message ?? t("den.cloud_provider_needs_server")
              : syncError?.message ?? providerDetail;

      return {
        key: `live:${provider.id}`,
        cloudProviderId: provider.id,
        provider,
        imported,
        status,
        name: provider.name,
        detail,
        metaId: provider.source === "openwork" ? "openwork" : provider.id,
        access: providerAccessLabel(provider.access),
        credentialReady: provider.source === "openwork" || provider.hasApiKey || provider.hasMyCredential === true || Boolean(imported),
      };
    });
    const importedRows: CloudProviderRow[] = Object.values(importedCloudProviders).filter((provider) => !cloudOrgProviders.some((live) => live.id === provider.cloudProviderId)).map((provider) => ({
      key: `imported:${provider.cloudProviderId}`, cloudProviderId: provider.cloudProviderId, provider: null, imported: provider, name: provider.name,
      status: resolveCloudProviderRowStatus({ imported: true, outOfSync: false, allowed: isProviderAllowedByDesktopPolicy({ providerId: provider.providerId, restrictToCloud, checkRestriction: checkDesktopAppRestriction }), importsUnavailable, needsCredential: false, needsServer: false, syncError: null, reloadPending: serverSync?.reloadPending, skippedByServer: Boolean(serverSync?.skippedProviders[provider.cloudProviderId]) }),
      detail: provider.source === "openwork_gateway" ? t("settings_extra.openwork_gateway_organization_credential") : t("interface.managed_in_den"),
      metaId: provider.cloudProviderId,
      credentialReady: true,
    }));
    const combined = [...liveRows, ...importedRows];
    return combined.filter((row) => !gatewayConnectProviders.some((provider) => provider.cloudProviderId === row.cloudProviderId)).map<CloudProviderRow>((row) => serverSync?.lastRun?.status === "failed" ? { ...row, status: "unavailable", detail: t("settings_extra.could_not_verify_with_den_sync_again_to_check_access") } : row);
  }, [
    checkDesktopAppRestriction,
    cloudOrgProviders,
    gatewayConnectProviders,
    importedCloudProviders,
    importsUnavailable,
    lastSyncError,
    openworkServerAvailable,
    serverSync, locale]);

  React.useEffect(() => {
    if (!isSignedIn || !activeOrganization?.id) return;
    let current = true;
    setBusy(true);
    void refreshCloudOrgProviders().catch(() => {
      if (current) setActionError(t("settings_extra.could_not_verify_organization_providers_sync_again_to_retry"));
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [activeOrganization?.id, isSignedIn, refreshCloudOrgProviders]);

  const syncNow = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await runCloudProviderSync("manual");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("den.sync_provider_failed", { name: t("den.cloud_providers_title") }));
    } finally {
      setBusy(false);
    }
  }, [busy, runCloudProviderSync]);

  const retryProvider = React.useCallback(async (cloudProviderId: string) => {
    if (actionId) return;
    setActionId(cloudProviderId);
    setActionError(null);
    try {
      await connectCloudProvider(cloudProviderId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("den.sync_provider_failed", { name: t("settings_extra.cloud_provider") }));
    } finally {
      setActionId(null);
    }
  }, [actionId, connectCloudProvider]);

  if (!isSignedIn) {
    const notice = (
      <section className="flex flex-col gap-3" aria-labelledby="ai-providers-organization">
        <div className="space-y-1">
          <h2 id="ai-providers-organization" className="text-base font-medium text-dls-text">{t("mcp.org_connections_title")}</h2>
          <p className="text-sm text-muted-foreground">{t("interface.providers_your_team_pays_for_delivered_through_the_openwork_gateway_nothing_to_set_up_on_this_device")}</p>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-dls-border px-5 py-5 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center -space-x-2" aria-hidden>
            {["openai", "openrouter", "google"].map((id) => <span key={id} className="flex size-8 items-center justify-center rounded-full border border-dls-border bg-dls-surface"><ProviderIcon providerId={id} size={16} /></span>)}
            <span className="flex size-8 items-center justify-center rounded-full border border-dls-border bg-dls-hover text-[11px] font-medium text-muted-foreground">+2</span>
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h3 className="text-sm font-medium text-dls-text">{t("interface.no_organization_yet")}</h3>
            <p className="text-sm text-muted-foreground">{t("interface.sign_in_to_see_what_your_organization_already_provides_your_keys_on_this_device_keep_working_either_")}</p>
          </div>
          <Button variant="outline" className="shrink-0 self-start sm:self-center" onClick={onOpenAccount}>{t("interface.sign_in_to_openwork")}</Button>
        </div>
      </section>
    );
    return embedded ? notice : (
      <SettingsStack>
        <Separator />
        {notice}
      </SettingsStack>
    );
  }

  const section = (
    <CloudProvidersSection
      actionError={actionError ?? (serverSync?.lastRun?.status === "failed" ? t("settings_extra.could_not_verify_providers_with_den_sync_again_to_retry") : null)}
      actionId={actionId}
      busy={busy}
      rows={rows}
      onRefresh={syncNow}
      onRetry={retryProvider}
      onOpenDen={onOpenDen}
      onOpenModelConnections={onOpenModelConnections}
      lastVerifiedAt={serverSync?.lastVerifiedAt}
      additionalCount={gatewayConnectProviders.length}
      additionalRows={gatewayConnectProviders.map((provider) => <GatewayConnectRow key={gatewayConnectProviderKey(provider)} provider={provider} busy={connectingGatewayProviderId === gatewayConnectProviderKey(provider)} onConnect={onConnectGatewayProvider} />)}
    />
  );

  return embedded ? section : (
    <SettingsStack>
      <Separator />
      {section}
    </SettingsStack>
  );
}
