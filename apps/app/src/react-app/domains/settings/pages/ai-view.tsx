import type { ReactNode } from "react";
import { Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DesktopFreePreferences } from "@/app/lib/openwork-server";
import { t } from "@/i18n";
import { gatewayConnectProviderKey, type GatewayConnectProvider, isCloudManagedProviderKey } from "../../connections/provider-auth/cloud-provider-config";
import { isKeylessZenProvider } from "../../connections/provider-auth/provider-policy";
import type { ProviderLoadState } from "../../connections/provider-auth/store";
import { AUTO_PROVIDER_ID, autoProviderSubtitle } from "@/react-app/domains/models/model-catalog";
import { SettingsNotice } from "../settings-section";
import { LayoutStack } from "../settings-layout";
import { SettingsPanel, SettingsPanelDescription, SettingsPanelHeading, SettingsPanelTitle } from "../shell/panel";
import { getSettingsTabLabel } from "../shell/settings-page";
import { ProviderList, ProviderMeta, ProviderRow, ProviderStatus, ProviderTile } from "./provider-rows";

export type ConnectedProvider = {
  id: string;
  name: string;
  source?: "env" | "api" | "config" | "custom";
};

export type AiSettingsViewProps = {
  busy: boolean;
  providerAuthBusy: boolean;
  providerStatusLabel: string;
  providerStatusStyle: string;
  providerSummary: string;
  providerLoadState: ProviderLoadState;
  onRetryProviders: () => void | Promise<void>;
  connectedProviders: ConnectedProvider[];
  disconnectingProviderId: string | null;
  providerConnectError: string | null;
  providerDisconnectStatus: string | null;
  providerDisconnectError: string | null;
  onOpenProviderAuth: () => void | Promise<void>;
  onDisconnectProvider: (providerId: string) => void | Promise<void>;
  canDisconnectProvider: (provider: ConnectedProvider) => boolean;
  /** Providers hidden by Disconnect (disabled_providers); each can be enabled again. */
  disabledProviders?: { id: string; name: string }[];
  enablingProviderId?: string | null;
  onEnableProvider?: (providerId: string) => void | Promise<void>;
  /** The Gateway reports free Auto switched off: no OpenWork Models row for it. */
  autoSwitchedOff?: boolean;
  canAddProviders: boolean;
  signedIn?: boolean;
  organizationName?: string;
  cloudProviderIds?: Set<string>;
  gatewayProviderIds?: ReadonlySet<string>;
  gatewayConnectProviders?: GatewayConnectProvider[];
  connectingGatewayProviderId?: string | null;
  onConnectGatewayProvider?: (provider: GatewayConnectProvider) => void | Promise<void>;
  onCancelGatewayConnect?: () => void;
  showOpenWorkModelsConnect?: boolean;
  showOpenWorkModelsSyncing?: boolean;
  onDismissOpenWorkModels?: () => void | Promise<void>;
  cloudProvidersView?: ReactNode;
  autoPreferences?: DesktopFreePreferences | null;
  autoBusy?: boolean;
  autoError?: string | null;
  onSetAutoEnabled?: (enabled: boolean) => void | Promise<void>;
  organizationProviderIds?: ReadonlySet<string>;
  onOpenDen?: () => void;
};

function deviceSourceLabel(source: ConnectedProvider["source"]) {
  if (source === "api") return t("extensions.add_mcp_api_key_label");
  if (source === "env") return t("settings_extra.environment_credential");
  return t("settings_extra.configured_on_this_device");
}

export function GatewayConnectRow({ provider, busy, onConnect, onCancel }: {
  provider: GatewayConnectProvider;
  busy: boolean;
  onConnect?: (provider: GatewayConnectProvider) => void | Promise<void>;
  onCancel?: () => void;
}) {
  return (
    <ProviderRow
      scope="organization"
      tile={<ProviderTile providerId={provider.providerId} name={provider.name} />}
      name={provider.name}
      status={<ProviderStatus tone="attention">{t("extensions.state_needs_signin")}</ProviderStatus>}
      meta={<ProviderMeta id={provider.cloudProviderId} parts={["OpenWork Gateway", t("settings_extra.each_member_signs_in")]} />}
      actions={<>
        <Button disabled={busy || !onConnect} onClick={() => void onConnect?.(provider)}>{busy ? t("interface.waiting_for_sign_in") : t("settings_extra.sign_in_to_name", { name: provider.name })}</Button>
        {busy && onCancel ? <Button variant="ghost" onClick={onCancel}>{t("interface.stop_waiting")}</Button> : null}
      </>}
    />
  );
}

export function aiProvidersDescription(input: { signedIn: boolean; organizationName?: string }) {
  return input.signedIn
    ? t("settings_extra.models_your_agents_can_use_in_this_workspace_keys_you_add_here_stay_on_this_device_pr", { organization: input.organizationName || t("interface.your_organization_bb0bdf0a") })
    : t("settings_extra.models_your_agents_can_use_in_this_workspace_keys_you_add_here_stay_on_this_device_si");
}

export function AiSettingsView(props: AiSettingsViewProps) {
  const ready = props.providerLoadState.status === "ready";
  const loading = props.providerLoadState.status === "loading" || props.providerLoadState.status === "idle";
  const error = props.providerLoadState.error;
  const signedIn = props.signedIn ?? Boolean(props.organizationName);
  const managed = (provider: ConnectedProvider) => provider.id !== AUTO_PROVIDER_ID && (isCloudManagedProviderKey(provider.id) || props.cloudProviderIds?.has(provider.id) || props.gatewayProviderIds?.has(provider.id));
  // Keyless built-in Zen is offered under "Available to add" in Connect a provider, not listed as connected.
  const local = props.connectedProviders.filter((provider) => !managed(provider) && provider.id !== AUTO_PROVIDER_ID && !isKeylessZenProvider(provider));
  const organization = props.connectedProviders.filter(managed);
  const disabled = props.onEnableProvider ? props.disabledProviders ?? [] : [];
  const showAuto = !props.autoSwitchedOff && Boolean(props.autoPreferences || props.connectedProviders.some((provider) => provider.id === AUTO_PROVIDER_ID));
  const autoOff = props.autoPreferences?.enabled === false;
  const autoAvailable = props.autoPreferences?.available ?? ready;
  const locked = !props.canAddProviders;
  const deviceCount = local.length + Number(showAuto);
  const rowsBusy = props.busy || props.providerAuthBusy || props.disconnectingProviderId !== null;

  return <LayoutStack>
    <SettingsPanel>
      <SettingsPanelHeading className="max-w-xl">
        <SettingsPanelTitle>{getSettingsTabLabel("ai")}</SettingsPanelTitle>
        <SettingsPanelDescription>{aiProvidersDescription({ signedIn, organizationName: props.organizationName })}</SettingsPanelDescription>
      </SettingsPanelHeading>
      <Button className="shrink-0 self-start" disabled={locked || props.busy || props.providerAuthBusy || !ready} onClick={() => void props.onOpenProviderAuth()}>
        {locked ? <Lock className="size-4" /> : <Plus className="size-4" />}{t("models.connect_provider")} </Button>
    </SettingsPanel>

    {locked ? <p className="-mt-3 text-xs text-muted-foreground">{t("interface.provider_connections_are_managed_by_your_organization_administrator")}</p> : null}
    {error ? <SettingsNotice tone="error" className="flex flex-wrap items-center justify-between gap-3"><div role="alert"><p>{error}</p>{props.connectedProviders.length ? <p>{t("settings.providers_not_refreshed")}</p> : null}</div><Button variant="outline" disabled={props.busy || loading} aria-busy={loading} onClick={() => void props.onRetryProviders()}>{t("settings.providers_retry")}</Button></SettingsNotice> : null}

    <section className="flex flex-col gap-3" aria-labelledby="ai-providers-device">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="ai-providers-device" className="text-base font-medium text-dls-text">{t("interface.on_this_device")}</h2>
          {ready ? <span className="text-xs text-muted-foreground">{deviceCount === 1 ? t("interface.1_provider") : t("settings_extra.count_providers", { count: deviceCount })}</span> : null}
        </div>
        <p className="text-sm text-muted-foreground">{signedIn ? t("interface.signed_in_or_pasted_by_you_keys_never_leave_this_device_and_only_you_can_disconnect_them") : t("interface.works_without_an_account_keys_you_paste_never_leave_this_device_and_only_you_can_disconnect_them")}</p>
      </div>

      {loading && !props.connectedProviders.length ? <div role="status" aria-label={t("settings.loading_providers")} className="grid gap-2">{[0, 1].map((key) => <div key={key} className="h-16 animate-pulse rounded-2xl bg-muted" />)}</div> : null}

      {showAuto || local.length || disabled.length ? <ProviderList>
        {showAuto ? <ProviderRow
          testId="settings-auto-provider"
          scope="device"
          tile={<ProviderTile providerId="openwork" />}
          name="OpenWork Models"
          status={autoOff ? <ProviderStatus tone="neutral">{t("interface.turned_off")}</ProviderStatus>
            : props.autoError ? <ProviderStatus tone="error">{t("interface.could_not_verify")}</ProviderStatus>
            : autoAvailable ? <ProviderStatus tone="ready">{t("connect.group_ready")}</ProviderStatus>
            : <ProviderStatus tone="neutral">{t("config.unavailable")}</ProviderStatus>}
          meta={<ProviderMeta id="openwork" parts={[autoProviderSubtitle()]} />}
          actions={props.onSetAutoEnabled ? <Button variant="ghost" disabled={props.autoBusy || (autoOff && !props.autoPreferences?.canEnable)} onClick={() => void props.onSetAutoEnabled?.(autoOff)}>{autoOff ? t("interface.turn_on") : t("interface.turn_off")}</Button> : null}
        /> : null}
        {local.map((provider) => <ProviderRow
          key={provider.id}
          scope="device"
          tile={<ProviderTile providerId={provider.id} name={provider.name} />}
          name={provider.name}
          status={<ProviderStatus tone="ready">{t("connect.group_ready")}</ProviderStatus>}
          meta={<ProviderMeta id={provider.id} parts={[deviceSourceLabel(provider.source), props.organizationProviderIds?.has(provider.id) ? t("settings_extra.also_available_from_organization", { organization: props.organizationName || t("interface.your_organization_bb0bdf0a") }) : null]} />}
          actions={<Button variant="ghost" disabled={rowsBusy || !ready || !props.canDisconnectProvider(provider)} onClick={() => void props.onDisconnectProvider(provider.id)}>{props.disconnectingProviderId === provider.id ? t("settings.disconnecting") : props.canDisconnectProvider(provider) ? t("settings.disconnect") : t("settings.managed_by_env")}</Button>}
        />)}
        {disabled.map((provider) => <ProviderRow
          key={`disabled:${provider.id}`}
          testId="disabled-provider"
          scope="device"
          tile={<ProviderTile providerId={provider.id} name={provider.name} />}
          name={provider.name}
          status={<ProviderStatus tone="neutral">{t("settings.provider_disabled_badge")}</ProviderStatus>}
          meta={<ProviderMeta id={provider.id} parts={[t("settings.provider_disabled_hint")]} />}
          actions={<Button variant="ghost" disabled={rowsBusy || (props.enablingProviderId ?? null) !== null} onClick={() => void props.onEnableProvider?.(provider.id)}>{props.enablingProviderId === provider.id ? t("settings.enabling_provider") : t("settings.enable_provider")}</Button>}
        />)}
      </ProviderList> : ready ? <p className="text-sm text-muted-foreground">{t("settings.no_providers_connected")}</p> : null}

      {props.autoError ? <SettingsNotice tone="error">{props.autoError}</SettingsNotice> : null}
      {props.autoPreferences && !props.autoPreferences.canEnable ? <p className="text-xs text-muted-foreground">{t("interface.auto_is_unavailable_on_this_device_or_blocked_by_your_organization_administrator")}</p> : null}
      {props.providerConnectError ? <SettingsNotice tone="error">{props.providerConnectError}</SettingsNotice> : null}
      {props.providerDisconnectStatus ? <SettingsNotice>{props.providerDisconnectStatus}</SettingsNotice> : null}
      {props.providerDisconnectError ? <SettingsNotice tone="error">{props.providerDisconnectError}</SettingsNotice> : null}
    </section>

    {props.cloudProvidersView ?? (organization.length || props.gatewayConnectProviders?.length ? <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium text-dls-text">{t("interface.from")} {props.organizationName || t("interface.your_organization_bb0bdf0a")}</h2>
        {props.onOpenDen ? <Button variant="ghost" onClick={props.onOpenDen}>{t("extensions.open_in_den")}</Button> : null}
      </div>
      <ProviderList>
        {organization.map((provider) => <ProviderRow key={provider.id} scope="organization" tile={<ProviderTile providerId={provider.id} name={provider.name} />} name={provider.name} status={<ProviderStatus tone="ready">{t("connect.group_ready")}</ProviderStatus>} meta={<ProviderMeta id={provider.id} parts={[t("interface.managed_in_den")]} />} />)}
        {props.gatewayConnectProviders?.map((provider) => <GatewayConnectRow key={gatewayConnectProviderKey(provider)} provider={provider} busy={props.connectingGatewayProviderId === gatewayConnectProviderKey(provider)} onConnect={props.onConnectGatewayProvider} onCancel={props.onCancelGatewayConnect} />)}
      </ProviderList>
    </section> : null)}
  </LayoutStack>;
}
