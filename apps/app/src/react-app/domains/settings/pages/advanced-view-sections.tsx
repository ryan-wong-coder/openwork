/** @jsxImportSource react */
import { useState, type ComponentProps, type ReactNode } from "react";
import { Cpu, RefreshCcw, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OpenworkServerClient, OpenworkCloudMcpHealth, OpenworkRuntimeConfigStatus } from "@/app/lib/openwork-server";
import { sanitizeCloudMcpHealthDiagnostic, sanitizeDiagnosticRecord } from "@/app/lib/diagnostic-sanitizer";
import {
  DEFAULT_DEN_API_BASE_URL,
  DEFAULT_DEN_BASE_URL,
  readDenBootstrapConfig,
  readDenSettings,
} from "@/app/lib/den";
import {
  describeCloudMcpTarget,
  describeDenEndpointSource,
  type DenEndpointSource,
} from "@/app/lib/den-endpoint-sources";
import { useOpencodeEngineControls } from "@/react-app/shell/opencode-engine-controls";
import { showEngineMigrationProgress } from "@/react-app/shell/engine-migration";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { ControlPlaneUrlEditor } from "../cloud/control-plane-url-editor";
import { usePlatform } from "../../../kernel/platform";
import { useFeatureFlagsPreferences } from "../state/feature-flags-preferences";
import { useDesktopRestriction } from "../../cloud/desktop-config-provider";
import {
  displayCustomControlPlaneUrl,
  isValidControlPlaneUrl,
} from "../cloud/control-plane-url";
import {
  SettingsInset,
  SettingsNotice,
  SettingsStatusBadge,
} from "../settings-section";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemFootnote,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "../settings-layout";

type SettingsTone = ComponentProps<typeof SettingsStatusBadge>["tone"];

const DESKTOP_BOOTSTRAP_PATH_HINT = "~/.config/openwork/desktop-bootstrap.json";

function sourceBadgeLabel(source: DenEndpointSource): string {
  switch (source) {
    case "custom":
      return t("settings.server_endpoints_source_custom");
    case "bootstrap":
      return t("settings.server_endpoints_source_bootstrap");
    case "default":
      return t("settings.server_endpoints_source_default");
  }
}

function sourceBadgeClass(source: DenEndpointSource): string {
  switch (source) {
    case "custom":
      return "border-blue-7/40 bg-blue-3 text-blue-11";
    case "bootstrap":
      return "border-amber-7/40 bg-amber-3 text-amber-11";
    case "default":
      return "border-gray-7/50 bg-gray-3 text-gray-11";
  }
}

function EndpointSourceBadge(props: { source: DenEndpointSource }) {
  return (
    <Badge variant="outline" className={sourceBadgeClass(props.source)}>
      {sourceBadgeLabel(props.source)}
    </Badge>
  );
}

function EndpointWarningBadge(props: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="border-amber-7/40 bg-amber-3 text-amber-11">
      {props.children}
    </Badge>
  );
}

function EndpointRow(props: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-xl border border-gray-6/50 bg-gray-1/60 p-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-9">
        {props.label}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="truncate font-mono text-xs text-gray-12" title={props.value}>
          {props.value}
        </div>
        {props.children ? <div className="flex flex-wrap gap-1.5">{props.children}</div> : null}
      </div>
    </div>
  );
}

function bootstrapValueWhenNotDefault(value: string, buildDefault: string): string | null {
  const fallback = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: null,
    buildDefault,
  });
  return value === fallback.effective ? null : value;
}

function ServerEndpointsCard(props: { cloudMcpUrl: string | null }) {
  const settings = readDenSettings();
  const effectiveApiBaseUrl = settings.apiBaseUrl ?? DEFAULT_DEN_API_BASE_URL;
  const bootstrap = readDenBootstrapConfig();
  const organizationServer = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: bootstrapValueWhenNotDefault(bootstrap.baseUrl, DEFAULT_DEN_BASE_URL),
    buildDefault: DEFAULT_DEN_BASE_URL,
  });
  const apiEndpoint = describeDenEndpointSource({
    storedValue: null,
    bootstrapValue: bootstrapValueWhenNotDefault(bootstrap.apiBaseUrl, DEFAULT_DEN_API_BASE_URL),
    buildDefault: DEFAULT_DEN_API_BASE_URL,
  });
  const cloudMcp = describeCloudMcpTarget({
    mcpUrl: props.cloudMcpUrl,
    effectiveApiBaseUrl,
  });
  const hasBootstrapSource = organizationServer.source === "bootstrap" || apiEndpoint.source === "bootstrap";

  return (
    <SettingsInset className="space-y-3 bg-gray-1/40">
      <div className="space-y-1">
        <div className="text-sm font-medium text-gray-12">{t("settings.server_endpoints_title")}</div>
        <div className="text-xs text-gray-9">{t("settings.server_endpoints_desc")}</div>
      </div>

      <div className="space-y-2">
        <EndpointRow label={t("settings.server_endpoints_org")} value={settings.baseUrl}>
          <EndpointSourceBadge source={organizationServer.source} />
        </EndpointRow>
        <EndpointRow label={t("settings.server_endpoints_api")} value={effectiveApiBaseUrl}>
          <EndpointSourceBadge source={apiEndpoint.source} />
        </EndpointRow>
        <EndpointRow
          label={t("settings.server_endpoints_cloud_mcp")}
          value={cloudMcp.url ?? t("settings.server_endpoints_not_configured")}
        >
          {cloudMcp.url && cloudMcp.isLocalhost ? (
            <EndpointWarningBadge>{t("settings.server_endpoints_local_dev")}</EndpointWarningBadge>
          ) : null}
          {cloudMcp.url && !cloudMcp.matchesApi ? (
            <EndpointWarningBadge>{t("settings.server_endpoints_mismatch")}</EndpointWarningBadge>
          ) : null}
        </EndpointRow>
      </div>

      {hasBootstrapSource ? (
        <div className="text-[11px] text-amber-11">
          {t("settings.server_endpoints_bootstrap_hint", { path: DESKTOP_BOOTSTRAP_PATH_HINT })}
        </div>
      ) : null}
    </SettingsInset>
  );
}

interface AdvancedOrganizationServerSectionProps {
  authBusy: boolean;
  baseUrl: string;
  baseUrlBusy: boolean;
  baseUrlDraft: string;
  baseUrlError: string | null;
  onApplyBaseUrl: () => void | Promise<void>;
  onBaseUrlDraftChange: (value: string) => void;
  onClearServerConfiguration: () => void | Promise<void>;
  onResetBaseUrlToDefault: () => void | Promise<void>;
  sessionBusy: boolean;
  cloudMcpUrl: string | null;
}

export function AdvancedOrganizationServerSection(props: AdvancedOrganizationServerSectionProps) {
  const platform = usePlatform();
  const [clearConfirming, setClearConfirming] = useState(false);
  const controlsDisabled = [props.authBusy, props.baseUrlBusy, props.sessionBusy].some(Boolean);
  const customUrl = displayCustomControlPlaneUrl(props.baseUrlDraft);
  const currentUrl = displayCustomControlPlaneUrl(props.baseUrl);
  const clearServerConfiguration = () => {
    if (!clearConfirming) {
      setClearConfirming(true);
      return;
    }
    setClearConfirming(false);
    void props.onClearServerConfiguration();
  };

  return (
    <LayoutSection id="advanced-organization-server">
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.organization_server_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.organization_server_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <ControlPlaneUrlEditor
          disabled={controlsDisabled}
          hint={t("settings.organization_server_url_hint")}
          label={t("settings.organization_server_url_label")}
          onReset={props.onResetBaseUrlToDefault}
          onSave={props.onApplyBaseUrl}
          onValueChange={props.onBaseUrlDraftChange}
          placeholder={DEFAULT_DEN_BASE_URL}
          resetLabel={t("common.reset")}
          saveDisabled={!isValidControlPlaneUrl(customUrl)}
          saveLabel={t("common.save")}
          value={customUrl}
        />
        <LayoutSectionItemFootnote>
          {currentUrl
            ? t("settings.organization_server_current", { url: currentUrl })
            : t("settings.organization_server_default")}
        </LayoutSectionItemFootnote>
        {isDesktopRuntime() ? <ServerEndpointsCard cloudMcpUrl={props.cloudMcpUrl} /> : null}
        {platform.capabilities.desktopBootstrap ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-9">
            <Button
              variant={clearConfirming ? "destructive" : "outline"}
              size="sm"
              onClick={clearServerConfiguration}
              disabled={controlsDisabled}
            >
              {clearConfirming
                ? t("den.cloud_control_plane_clear_confirm")
                : t("den.cloud_control_plane_clear")}
            </Button>
            <span>
              {clearConfirming
                ? t("den.cloud_control_plane_clear_confirm_hint")
                : t("den.cloud_control_plane_clear_hint")}
            </span>
          </div>
        ) : null}
        {props.baseUrlError ? <SettingsNotice tone="error">{props.baseUrlError}</SettingsNotice> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface RuntimeStatusCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  statusLabel: string;
  tone: SettingsTone;
  detailLines?: string[];
}

function RuntimeStatusCard(props: RuntimeStatusCardProps) {
  return (
    <SettingsInset className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-gray-6/60 bg-gray-1/70 text-gray-12">
          {props.icon}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-12">{props.title}</div>
          <div className="text-xs text-gray-9">{props.description}</div>
        </div>
      </div>
      <SettingsStatusBadge className="inline-flex min-h-0 justify-start px-0 py-0" tone={props.tone} label={props.statusLabel} />
      {props.detailLines?.length ? (
        <div className="space-y-1 border-t border-gray-6/50 pt-2 text-[11px] text-gray-9">
          {props.detailLines.map((line) => (
            <div key={line} className="truncate" title={line}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </SettingsInset>
  );
}

interface AdvancedRuntimeSectionProps {
  clientStatusLabel: string;
  clientTone: SettingsTone;
  clientDetailLines: string[];
  openworkStatusLabel: string;
  openworkTone: SettingsTone;
  openworkDetailLines: string[];
}

export function AdvancedRuntimeSection(props: AdvancedRuntimeSectionProps) {
  return (
    <LayoutSection id="advanced-runtime">
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.runtime_title")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("settings.runtime_desc")}</LayoutSectionDescription>
      </LayoutSectionHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <RuntimeStatusCard
          icon={<Cpu size={18} />}
          title={t("settings.opencode_engine_label")}
          description={t("settings.opencode_engine_desc")}
          statusLabel={props.clientStatusLabel}
          tone={props.clientTone}
          detailLines={props.clientDetailLines}
        />
        <RuntimeStatusCard
          icon={<Server size={18} />}
          title={t("settings.openwork_server_label")}
          description={t("settings.openwork_server_desc")}
          statusLabel={props.openworkStatusLabel}
          tone={props.openworkTone}
          detailLines={props.openworkDetailLines}
        />
      </div>
    </LayoutSection>
  );
}

function DiagnosticRow(props: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-gray-6 bg-gray-2/50 p-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-8">{props.label}</div>
      <div className="min-w-0 break-all font-mono text-[11px] text-gray-12">{props.value}</div>
    </div>
  );
}

function joinList(values: string[]): string {
  return values.length ? values.join(", ") : t("connect.diagnostics_none");
}

function formatMaybe(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return t("common.unknown");
  if (typeof value === "boolean") return t(value ? "connect.diagnostics_yes" : "connect.diagnostics_no");
  return String(value);
}

function formatMetadataRecord(value: Record<string, string | number | boolean | null> | null | undefined): string {
  if (!value || Object.keys(value).length === 0) return t("connect.diagnostics_none");
  return Object.entries(value).map(([key, nested]) => `${key}=${formatMaybe(nested)}`).join(", ");
}

function formatSupportedFeatures(features: OpenworkCloudMcpHealth["compatibility"]["supportedFeatures"]): string {
  return Object.entries(features).map(([key, enabled]) => `${key}:${t(enabled ? "connect.diagnostics_yes" : "connect.diagnostics_no")}`).join(", ");
}

function formatPluginHashes(hashes: OpenworkCloudMcpHealth["compatibility"]["pluginFileHashes"]): string {
  if (hashes.length === 0) return t("connect.diagnostics_none");
  return hashes.map((hash) => `${hash.name}=${hash.sha256 ? hash.sha256.slice(0, 12) : `${t("config.unavailable")}${hash.error ? ` (${hash.error})` : ""}`}`).join(", ");
}

function formatMcpToolExposure(input: { checked: boolean; includesMcpTools: boolean | null; present: string[]; missing: string[]; limitation?: string }): string {
  if (!input.checked) return t("updates.not_checked");
  const includes = input.includesMcpTools === null ? t("common.unknown") : t(input.includesMcpTools ? "connect.diagnostics_yes" : "connect.diagnostics_no");
  return `包含工具：${includes}；已提供：${joinList(input.present)}；缺少：${joinList(input.missing)}${input.limitation ? `；限制：${input.limitation}` : ""}`;
}

interface AdvancedCloudMcpDiagnosticsSectionProps {
  cloudMcpHealth: OpenworkCloudMcpHealth | null;
  onRefresh: () => Promise<OpenworkCloudMcpHealth | null>;
}

export function AdvancedCloudMcpDiagnosticsSection(props: AdvancedCloudMcpDiagnosticsSectionProps) {
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const safeHealth = sanitizeCloudMcpHealthDiagnostic(props.cloudMcpHealth);
  const projection = props.cloudMcpHealth?.tools.providerProjection;
  const compatibility = props.cloudMcpHealth?.compatibility;

  const refresh = async () => {
    setBusy(true);
    setCopyStatus(null);
    setRefreshError(null);
    try {
      await props.onRefresh();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : t("settings_extra.could_not_refresh_cloud_mcp_diagnostics"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const payload = JSON.stringify({ cloudMcpHealth: safeHealth }, null, 2);
    await navigator.clipboard.writeText(payload);
    setCopyStatus(t("settings_extra.copied_sanitized_cloud_diagnostic"));
  };

  return (
    <LayoutSection id="advanced-agent-access">
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("interface.agent_access_diagnostics")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("interface.technical_details_for_openwork_cloud_mcp_delivery_tokens_and_authorization_headers_are_redacted_befo")} </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("interface.openwork_cloud_mcp_health")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("interface.use_this_when_support_needs_exact_runtime_state_the_main_connect_card_stays_user_facing")} </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
              <RefreshCcw size={14} className={busy ? "animate-spin" : ""} />{t("skills.refresh")} </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()} disabled={!props.cloudMcpHealth}>{t("interface.copy_sanitized_diagnostic")} </Button>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>

        {copyStatus ? <SettingsNotice>{copyStatus}</SettingsNotice> : null}
        {refreshError ? <SettingsNotice tone="error">{refreshError}</SettingsNotice> : null}
        {props.cloudMcpHealth ? (
          <div className="space-y-2 rounded-xl border border-gray-6 bg-gray-1/60 p-3">
            <div className="grid gap-2">
              <DiagnosticRow label={t("interface.active_workspace")} value={`${props.cloudMcpHealth.workspace.id} (${props.cloudMcpHealth.workspace.directory ?? "未设置目录"})`} />
              <DiagnosticRow label={t("interface.desired_revision")} value={props.cloudMcpHealth.desired.revision ?? t("connect.diagnostics_none")} />
              <DiagnosticRow label={t("interface.applied_revision")} value={props.cloudMcpHealth.delivery.appliedRevision ?? t("connect.diagnostics_none")} />
              <DiagnosticRow label={t("interface.delivery")} value={`${props.cloudMcpHealth.delivery.state}${props.cloudMcpHealth.delivery.trigger ? ` / ${props.cloudMcpHealth.delivery.trigger}` : ""}`} />
              <DiagnosticRow label={t("interface.engine_status")} value={props.cloudMcpHealth.engine.status} />
              {props.cloudMcpHealth.engineInspection?.checked ? (
                <DiagnosticRow
                  label={t("interface.engine_mcp_servers")}
                  value={(props.cloudMcpHealth.engineInspection.servers ?? []).length
                    ? (props.cloudMcpHealth.engineInspection.servers ?? []).map((server) => `${server.name} ${server.status}${server.error ? ` (${server.error})` : ""}`).join("; ")
                    : t("connect.diagnostics_none")}
                />
              ) : null}
              <DiagnosticRow label={t("interface.provider_model")} value={projection?.checked ? `${projection.provider ?? "unknown"}/${projection.model ?? "unknown"}; source ${projection.source ?? "unknown"}; tool calling ${formatMaybe(projection.toolCalling)}; present ${joinList(projection.present)}; missing ${joinList(projection.missing)}${projection.limitation ? `; limitation: ${projection.limitation}` : ""}` : "not checked"} />
              <DiagnosticRow label={t("interface.cloud_tools")} value={`derived present ${joinList(props.cloudMcpHealth.tools.present)}; missing ${joinList(props.cloudMcpHealth.tools.missing)}`} />
              <DiagnosticRow label={t("interface.direct_tools_list")} value={`checked ${props.cloudMcpHealth.tools.direct.checked ? "yes" : "no"}; present ${joinList(props.cloudMcpHealth.tools.direct.present)}; missing ${joinList(props.cloudMcpHealth.tools.direct.missing)}`} />
              {props.cloudMcpHealth.tools.direct.trace ? (
                <DiagnosticRow
                  label={t("interface.direct_probe")}
                  value={`${props.cloudMcpHealth.tools.direct.trace.endpoint ?? "unknown endpoint"} · ${props.cloudMcpHealth.tools.direct.trace.latencyMs} ms · ${props.cloudMcpHealth.tools.direct.trace.steps.map((step) => `${step.step} ${step.ok ? "ok" : "failed"}${step.httpStatus !== undefined ? ` (HTTP ${step.httpStatus})` : ""} ${Math.max(0, Math.round(step.latencyMs))}ms`).join(" → ") || "no steps"}`}
                />
              ) : null}
              {props.cloudMcpHealth.firstFailure ? (
                <DiagnosticRow
                  label={t("interface.first_failure")}
                  value={`${props.cloudMcpHealth.firstFailure.code} (stage ${props.cloudMcpHealth.firstFailure.stage}; ${props.cloudMcpHealth.firstFailure.retryable ? "retryable" : "not retryable"}): ${props.cloudMcpHealth.firstFailure.message}`}
                />
              ) : null}
              <DiagnosticRow label={t("interface.plugin_canaries")} value={`present ${joinList(props.cloudMcpHealth.pluginCanaries.present)}; missing ${joinList(props.cloudMcpHealth.pluginCanaries.missing)}`} />
              <DiagnosticRow label={t("interface.safe_capabilities")} value={`schema v${props.cloudMcpHealth.schemaVersion}; connect catalog ${props.cloudMcpHealth.connectCatalogEnabled ? "enabled" : "disabled"}`} />
              {compatibility ? (
                <>
                  <DiagnosticRow label={t("interface.openwork_versions")} value={`server ${formatMaybe(compatibility.openwork.serverVersion)}; app ${formatMetadataRecord(compatibility.openwork.app)}`} />
                  <DiagnosticRow label={t("interface.opencode_compatibility")} value={`expected ${formatMaybe(compatibility.opencode.expectedVersion)}; actual ${formatMaybe(compatibility.opencode.actualVersion)}; probe ${compatibility.opencode.probe}`} />
                  <DiagnosticRow label={t("interface.feature_probes")} value={formatSupportedFeatures(compatibility.supportedFeatures)} />
                  <DiagnosticRow label={t("interface.experimental_tool_ids")} value={formatMcpToolExposure(compatibility.experimentalToolIds)} />
                  <DiagnosticRow label={t("interface.experimental_provider_tools")} value={formatMcpToolExposure(compatibility.experimentalProviderTools)} />
                  <DiagnosticRow label={t("interface.plugin_hashes")} value={formatPluginHashes(compatibility.pluginFileHashes)} />
                </>
              ) : null}
              <DiagnosticRow label={t("interface.live_verification")} value={props.cloudMcpHealth.checkedAt} />
            </div>
            <details className="rounded-lg bg-gray-3 p-2">
              <summary className="cursor-pointer text-[11px] font-medium text-gray-11">{t("interface.show_sanitized_health_json")}</summary>
              <pre className="mt-2 max-h-72 overflow-auto font-mono text-[11px] text-gray-11">
                {JSON.stringify(safeHealth, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <SettingsNotice>{t("interface.no_cloud_mcp_health_has_been_loaded_for_this_workspace_yet")}</SettingsNotice>
        )}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

interface AdvancedRuntimeConfigSourcesSectionProps {
  busy: boolean;
  canInspect: boolean;
  configStatus: OpenworkRuntimeConfigStatus | null;
  configStatusBusy: boolean;
  configStatusError: string | null;
  onRefresh: () => Promise<void>;
}

function formatKeys(keys: string[]) {
  return keys.length ? keys.join(", ") : t("connect.diagnostics_none");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizedConfig(config: Record<string, unknown>): Record<string, unknown> {
  return sanitizeDiagnosticRecord(config);
}

function countRecord(value: unknown) {
  return isRecord(value) ? Object.keys(value).length : 0;
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function providerModelCount(config: Record<string, unknown>) {
  const providers = isRecord(config.provider) ? config.provider : {};
  return Object.values(providers).reduce<number>((total, provider) => {
    if (!isRecord(provider)) return total;
    return total + countRecord(provider.models);
  }, 0);
}

function RuntimeConfigSummary(props: { config: Record<string, unknown> }) {
  const config = props.config;
  const providers = countRecord(config.provider);
  const models = providerModelCount(config);
  const agents = countRecord(config.agent);
  const plugins = countArray(config.plugin);
  const mcps = countRecord(config.mcp);
  const permissions = countRecord(config.permission);
  const disabledProviders = countArray(config.disabled_providers);
  const defaultAgent = typeof config.default_agent === "string" ? config.default_agent : t("config.not_set");

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-8">{t("session.default_agent")}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-gray-12" title={defaultAgent}>{defaultAgent}</div>
      </div>
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-8">{t("interface.providers_models")}</div>
        <div className="mt-1 font-mono text-[11px] text-gray-12">{providers}{t("interface.providers")} {models}{t("interface.models")}</div>
      </div>
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-8">{t("interface.agents_plugins")}</div>
        <div className="mt-1 font-mono text-[11px] text-gray-12">{agents}{t("interface.agents")} {plugins}{t("interface.plugins")}</div>
      </div>
      <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2">
        <div className="text-[10px] uppercase tracking-wide text-gray-8">{t("interface.mcp_permissions")}</div>
        <div className="mt-1 font-mono text-[11px] text-gray-12">{mcps}{t("interface.mcps")} {permissions}{t("interface.permission_keys")}</div>
      </div>
      {disabledProviders ? (
        <div className="rounded-lg border border-gray-6 bg-gray-2/60 p-2 sm:col-span-2 lg:col-span-4">
          <div className="text-[10px] uppercase tracking-wide text-gray-8">{t("interface.disabled_providers")}</div>
          <div className="mt-1 font-mono text-[11px] text-gray-12">{disabledProviders}</div>
        </div>
      ) : null}
    </div>
  );
}

function RuntimeConfigSourceBlock(props: {
  title: string;
  description: string;
  path?: string;
  exists?: boolean;
  keys: string[];
  config: Record<string, unknown>;
}) {
  const safeConfig = sanitizedConfig(props.config);
  return (
    <div className="space-y-2 rounded-xl border border-gray-6 bg-gray-1/70 p-3">
      <div>
        <div className="font-medium text-gray-12">{props.title}</div>
        <div className="text-[11px] text-gray-9">{props.description}</div>
        {props.path ? <div className="mt-1 break-all font-mono text-[11px] text-gray-8">{props.path}</div> : null}
        {props.exists !== undefined ? <div className="text-[11px] text-gray-9">{props.exists ? t("interface.found") : t("interface.not_found")}</div> : null}
        <div className="text-[11px] text-gray-9">{t("interface.keys")} {formatKeys(props.keys)}</div>
      </div>
      <RuntimeConfigSummary config={safeConfig} />
      <details className="rounded-lg bg-gray-3 p-2">
        <summary className="cursor-pointer text-[11px] font-medium text-gray-11">{t("interface.show_raw_json")}</summary>
        <pre className="mt-2 max-h-56 overflow-auto font-mono text-[11px] text-gray-11">
          {JSON.stringify(safeConfig, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function AdvancedRuntimeConfigSourcesSection(props: AdvancedRuntimeConfigSourcesSectionProps) {
  const effectiveRuntimeConfig = props.configStatus
    ? sanitizedConfig(props.configStatus.effectiveRuntime ?? props.configStatus.runtime)
    : null;
  const runtimeConfig = props.configStatus ? sanitizedConfig(props.configStatus.runtime) : null;
  return (
    <LayoutSection id="advanced-config-sources">
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("interface.opencode_config_sources")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("interface.inspect_what_openwork_controls_at_runtime_versus_what_belongs_to_your_workspace_config_this_works_th")} </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("interface.config_source_snapshot")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("interface.shows_the_openwork_runtime_database_the_injected_runtime_config_and_the_workspace_owned_opencode_con")} </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void props.onRefresh()}
              disabled={props.busy || props.configStatusBusy || !props.canInspect}
            >
              <RefreshCcw size={14} className={props.configStatusBusy ? "animate-spin" : ""} />{t("skills.refresh")} </Button>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        {props.configStatusError ? <SettingsNotice>{props.configStatusError}</SettingsNotice> : null}
        {props.configStatus ? (
          <div className="space-y-3 rounded-xl border border-gray-6 bg-gray-1/60 p-3 text-xs text-gray-10">
            <div className="space-y-2 rounded-xl border border-blue-6/50 bg-blue-2/40 p-3">
              <div className="font-medium text-gray-12">{t("interface.desired_openwork_runtime_config")}</div>
              <div className="text-[11px] text-gray-9">{t("interface.this_is_the_openwork_built_config_object_requested_for_the_runtime_database_and_injected_safely_by_t")} </div>
              <RuntimeConfigSummary config={effectiveRuntimeConfig ?? {}} />
              <details className="rounded-lg bg-gray-3 p-2">
                <summary className="cursor-pointer text-[11px] font-medium text-gray-11">{t("interface.show_desired_json")}</summary>
                <pre className="mt-2 max-h-72 overflow-auto font-mono text-[11px] text-gray-11">
                  {JSON.stringify(effectiveRuntimeConfig, null, 2)}
                </pre>
              </details>
            </div>
            {props.configStatus.sources ? (
              <div className="space-y-3">
                <div>
                  <div className="font-medium text-gray-12">{t("interface.opencode_source_breakdown")}</div>
                  <div className="text-[11px] text-gray-9">{t("interface.opencode_also_reads_its_own_project_and_global_config_files_openwork_injects_the_runtime_config_sepa")} </div>
                </div>
                <RuntimeConfigSourceBlock
                  title={t("interface.project_opencode_config")}
                  description={t("interface.workspace_level_opencode_config_owned_by_the_user_project")}
                  path={props.configStatus.sources.projectOpencode.path}
                  exists={props.configStatus.sources.projectOpencode.exists}
                  keys={props.configStatus.sources.projectOpencode.keys}
                  config={props.configStatus.sources.projectOpencode.config}
                />
                <RuntimeConfigSourceBlock
                  title={t("interface.global_opencode_config")}
                  description={t("interface.user_level_opencode_config_under_config_opencode")}
                  path={props.configStatus.sources.globalOpencode.path}
                  exists={props.configStatus.sources.globalOpencode.exists}
                  keys={props.configStatus.sources.globalOpencode.keys}
                  config={props.configStatus.sources.globalOpencode.config}
                />
                <RuntimeConfigSourceBlock
                  title={t("interface.openwork_runtime_db")}
                  description={t("interface.openwork_managed_runtime_values_stored_outside_workspace_files")}
                  keys={props.configStatus.sources.runtimeDatabase.keys}
                  config={props.configStatus.sources.runtimeDatabase.config}
                />
                <RuntimeConfigSourceBlock
                  title={t("interface.openwork_injected_config")}
                  description={t("interface.the_object_openwork_injects_into_opencode_at_runtime")}
                  keys={props.configStatus.sources.injected.keys}
                  config={props.configStatus.sources.injected.config}
                />
              </div>
            ) : null}
            <div>
              <div className="font-medium text-gray-12">{t("interface.runtime_database")}</div>
              <div>{t("interface.stored_keys")} {formatKeys(props.configStatus.runtimeKeys)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-12">{t("interface.user_opencode_jsonc")}</div>
              <div className="break-all">{props.configStatus.userOpencode.path}</div>
              <div>{props.configStatus.userOpencode.exists ? t("interface.found") : t("interface.not_found")}</div>
              <div>{t("interface.user_owned_keys")} {formatKeys(props.configStatus.userOpencode.keys)}</div>
            </div>
            <div>
              <div className="font-medium text-gray-12">{t("interface.runtime_db_json")}</div>
              <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-gray-3 p-2 font-mono text-[11px] text-gray-11">
                {JSON.stringify(runtimeConfig, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}

export function AdvancedWorkspaceRunModeSection() {
  const { workspaceRunModeEnabled, toggleWorkspaceRunMode } = useFeatureFlagsPreferences();
  const restricted = useDesktopRestriction("allowControlSettings");
  return (
    <LayoutSection id="advanced-workspace-run-mode">
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("interface.workspace_run_mode")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("interface.experimental_approval_controls_in_the_composer")}</LayoutSectionDescription>
      </LayoutSectionHeader>
      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("interface.show_workspace_run_mode")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("interface.choose_when_openwork_asks_before_acting_using_the_icon_beside_attachments_off_by_default_available_w")} </LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              data-testid="workspace-run-mode-flag"
              aria-label={t("interface.show_workspace_run_mode")}
              checked={workspaceRunModeEnabled}
              disabled={restricted || !isDesktopRuntime()}
              onCheckedChange={toggleWorkspaceRunMode}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <LayoutSectionItemFootnote>{t("interface.this_switch_only_shows_or_hides_the_control_hiding_it_does_not_reset_workspace_permissions_choose_wo")} </LayoutSectionItemFootnote>
      </LayoutSectionItem>
    </LayoutSection>
  );
}

export function AdvancedEngineV2PreviewSection(props: { client: OpenworkServerClient | null }) {
  const engine = useOpencodeEngineControls(props.client);
  const runtimeError = engine.status?.enabled ? engine.status.lastError : undefined;
  const engineNote = engine.blockedReason ?? (engine.migrating ? t("settings_extra.wait_for_chat_migration_to_finish") : undefined);
  return (
    <LayoutSection id="advanced-experimental-engine">
      <LayoutSectionHeader><LayoutSectionTitle>{t("settings.opencode_engine_sidecar")}</LayoutSectionTitle></LayoutSectionHeader>
      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("interface.chat_engine")}</LayoutSectionItemTitle>
          <LayoutSectionItemHeaderActions>
            <ToggleGroup aria-label={t("interface.chat_engine")} value={[engine.selected]} variant="outline" disabled={engine.disabled}
              onValueChange={(value) => { if (value[0] === "v1" || value[0] === "v2") engine.select(value[0]); }}>
              <ToggleGroupItem value="v1" data-engine="v1">{t("interface.opencode_v1")}</ToggleGroupItem>
              <ToggleGroupItem value="v2" data-engine="v2">{t("interface.opencode_v2_preview")}</ToggleGroupItem>
            </ToggleGroup>
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        {engineNote ? <p className="text-xs text-muted-foreground">{engineNote}</p> : null}
        {engine.status?.enabled && !engine.status.running && !engine.status.lastError ? <p role="status" className="text-xs text-muted-foreground">{t("interface.opencode_v2_is_starting")}</p> : null}
        {engine.error || runtimeError ? <p role="alert" className="text-xs text-destructive">{engine.error ?? runtimeError}</p> : null}
      </LayoutSectionItem>
      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("interface.v1_chat_history")}</LayoutSectionItemTitle>
          <LayoutSectionItemHeaderActions>
            {engine.migrating
              ? <Button variant="outline" size="sm" onClick={showEngineMigrationProgress}>{t("engine_migration.show_progress")}</Button>
              : <Button variant="outline" size="sm" disabled={engine.disabled || !engine.status?.migration} onClick={engine.openMigration}>{t("interface.migrate_chats_to_opencode_v2")}</Button>}
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        {engine.message ? <p role="status" className="text-xs text-muted-foreground">{engine.message}</p> : null}
      </LayoutSectionItem>
      <details className="text-xs text-muted-foreground"><summary>{t("interface.engine_details")}</summary>
        <p className="py-2">{t("interface.each_engine_has_its_own_chat_history_switching_engines_does_not_migrate_chats")}</p>
        {engine.status?.running ? <p>OpenCode {engine.status.version} · {engine.status.mirroredProviderIds.length}{t("interface.providers_e1fe12cb")} {engine.status.catalogModelIds.length}{t("interface.models")}</p> : null}
      </details>
    </LayoutSection>
  );
}

interface AdvancedDeveloperSectionProps {
  busy: boolean;
  developerMode: boolean;
  opencodeDevModeEnabled: boolean;
  deepLinkOpen: boolean;
  deepLinkInput: string;
  deepLinkBusy: boolean;
  deepLinkStatus: string | null;
  onToggleDeveloperMode: () => void;
  onToggleDeepLink: () => void;
  onDeepLinkInput: (input: string) => void;
  onSubmitDeepLink: () => Promise<void>;
}

export function AdvancedDeveloperSection(props: AdvancedDeveloperSectionProps) {
  return (
    <LayoutSection id="advanced-developer">
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.developer")}</LayoutSectionTitle>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{t("settings.developer_mode_title")}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{t("settings.developer_mode_desc")}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            <Switch
              aria-label={t("settings.developer_mode_title")}
              checked={props.developerMode}
              onCheckedChange={props.onToggleDeveloperMode}
            />
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
      </LayoutSectionItem>

      {isDesktopRuntime() && props.opencodeDevModeEnabled && props.developerMode ? (
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.open_deeplink_title")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.open_deeplink_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onToggleDeepLink}
                disabled={props.busy || props.deepLinkBusy}
              >
                {props.deepLinkOpen ? t("common.hide") : t("settings.open_deeplink_button")}
              </Button>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>

          {props.deepLinkOpen ? (
            <div className="space-y-3">
              <Field>
                <FieldLabel htmlFor="advanced-debug-deep-link">{t("settings.open_deeplink_title")}</FieldLabel>
                <Textarea
                  id="advanced-debug-deep-link"
                  value={props.deepLinkInput}
                  onChange={(event) => props.onDeepLinkInput(event.currentTarget.value)}
                  rows={3}
                  placeholder="openwork://..."
                  className="font-mono text-xs"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void props.onSubmitDeepLink()}
                  disabled={props.busy || props.deepLinkBusy || !props.deepLinkInput.trim()}
                >
                  {props.deepLinkBusy ? t("settings.opening") : t("settings.open_deeplink_action")}
                </Button>
                <div className="text-xs text-gray-8">{t("settings.deeplink_hint")}</div>
              </div>
            </div>
          ) : null}

          {props.deepLinkStatus ? <SettingsNotice>{props.deepLinkStatus}</SettingsNotice> : null}
        </LayoutSectionItem>
      ) : null}
    </LayoutSection>
  );
}
