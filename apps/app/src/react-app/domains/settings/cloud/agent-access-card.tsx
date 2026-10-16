/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";

import { mintCloudControlMcpToken, readDenSettings } from "@/app/lib/den";
import { openDesktopUrl } from "@/app/lib/desktop";
import type {
  OpenworkCloudMcpEngineRefresh,
  OpenworkCloudMcpHealth,
  OpenworkCloudMcpProviderModelContext,
  OpenworkConnectState,
  OpenworkServerClient,
} from "@/app/lib/openwork-server";
import { Button } from "@/components/ui/button";
import {
  SettingsInset,
  SettingsNotice,
  SettingsStatusBadge,
} from "@/react-app/domains/settings/settings-section";
import { useCloudSession } from "@/react-app/domains/settings/cloud/cloud-session-provider";
import {
  OPENWORK_CLOUD_EXPECTED_TOOLS,
  clearCloudMcpDisabledIntent,
  cloudMcpDisplaySummary,
  runOpenworkCloudMcpEngineRefresh,
  runOpenworkCloudMcpReconciler,
  type CloudMcpOperationContext,
} from "@/react-app/domains/connections/cloud-mcp-reconciler";
import {
  buildCloudMcpSupportBundle,
  cloudMcpAdvancedRows,
  cloudMcpEngineRefreshLines,
  cloudMcpProbeTraceLines,
} from "@/react-app/domains/connections/cloud-mcp-diagnostics";
import { readCloudMcpUserState } from "@/react-app/domains/connections/cloud-mcp-user-state";
import { resolveOpenWorkConnectStateSummary } from "@/react-app/domains/connections/openwork-connect-status";
import { t } from "@/i18n";

const CLOUD_MCP_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

function denManageConnectionsUrl() {
  return new URL("/dashboard/mcp-connections", readDenSettings().baseUrl).toString();
}

function ManageInDenButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-fit"
      onClick={() => void openDesktopUrl(denManageConnectionsUrl())}
    >
      {t("connect.manage_in_den_web")}
      <ArrowUpRight size={13} />
    </Button>
  );
}

function buildCloudMcpContext(input: {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  currentModel: OpenworkCloudMcpProviderModelContext | null;
}): CloudMcpOperationContext | null {
  const workspaceId = input.workspaceId?.trim() ?? "";
  const serverBaseUrl = input.client?.baseUrl.trim() ?? "";
  const settings = readDenSettings();
  const orgId = settings.activeOrgId?.trim() ?? "";
  if (!workspaceId || !serverBaseUrl || !orgId) return null;
  return {
    denBaseUrl: settings.baseUrl,
    serverBaseUrl,
    orgId,
    workspaceId,
    denAuthToken: settings.authToken ?? null,
    orgSlug: settings.activeOrgSlug,
    orgName: settings.activeOrgName,
    providerModel: input.currentModel ?? undefined,
  };
}

function missingCloudMcpContextMessage(input: {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
}): string {
  if (!input.workspaceId?.trim()) return t("settings_extra.select_a_workspace_before_running_agent_access_diagnostics");
  if (!input.client?.baseUrl.trim()) return t("settings_extra.connect_to_the_workspace_server_before_running_agent_access_diagnostics");
  if (!readDenSettings().activeOrgId?.trim()) return t("settings_extra.select_an_organization_before_running_agent_access_diagnostics");
  return t("settings_extra.agent_access_diagnostics_are_unavailable_for_the_current_workspace");
}

export function readyCloudMcpToolIds(health: OpenworkCloudMcpHealth | null): string[] {
  if (!health?.usable) return [];
  return health.tools.present.filter((tool) => OPENWORK_CLOUD_EXPECTED_TOOLS.some((expected) => expected === tool));
}

export function AgentAccessCard(props: {
  client: OpenworkServerClient | null;
  workspaceId: string | null;
  currentModel: OpenworkCloudMcpProviderModelContext | null;
  onHealthChange?: (health: OpenworkCloudMcpHealth | null) => void;
}) {
  const cloudSession = useCloudSession();
  const [health, setHealth] = useState<OpenworkCloudMcpHealth | null>(null);
  const [connectState, setConnectState] = useState<OpenworkConnectState | null>(null);
  const [busy, setBusy] = useState<"test" | "repair" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [lastEngineRefresh, setLastEngineRefresh] = useState<OpenworkCloudMcpEngineRefresh | null>(null);
  const context = buildCloudMcpContext(props);
  const userState = context ? readCloudMcpUserState(context) : null;
  const signedIn = cloudSession.isSignedIn && Boolean(cloudSession.authToken.trim());
  const orgSelected = Boolean(readDenSettings().activeOrgId?.trim());
  const missingContextSummary = signedIn && busy === null && !context
    ? !props.workspaceId?.trim()
      ? {
          status: "not_checked" as const,
          statusLabel: t("updates.not_checked"),
          tone: "neutral" as const,
          stageLabel: t("settings_extra.select_a_workspace"),
          recommendedAction: t("settings_extra.choose_the_workspace_agents_should_use"),
        }
      : !props.client?.baseUrl.trim()
        ? {
            status: "not_checked" as const,
            statusLabel: t("updates.not_checked"),
            tone: "neutral" as const,
            stageLabel: t("settings_extra.connect_the_workspace_server"),
            recommendedAction: t("settings_extra.restore_the_workspace_server_connection"),
          }
        : !orgSelected
          ? {
              status: "degraded" as const,
              statusLabel: t("settings_extra.degraded"),
              tone: "error" as const,
              stageLabel: t("interface.select_an_organization"),
              recommendedAction: t("settings_extra.choose_the_organization_agents_should_use"),
            }
          : null
    : null;
  const connectStateSummary = connectState && (connectState.status !== "available" || !connectState.connectEnabled)
    ? resolveOpenWorkConnectStateSummary(connectState.status, connectState.connectEnabled)
    : null;
  const summary = missingContextSummary ?? connectStateSummary ?? cloudMcpDisplaySummary({
      signedIn,
      orgSelected,
      connecting: busy !== null,
      userState,
      health,
    });

  const updateHealth = (next: OpenworkCloudMcpHealth | null) => {
    setHealth(next);
    props.onHealthChange?.(next);
  };

  const testNow = async () => {
    if (!props.client || !context) {
      setError(missingCloudMcpContextMessage(props));
      return;
    }
    setBusy("test");
    setError(null);
    try {
      // probe: verify the Cloud endpoint directly from the OpenWork server as
      // well, so a failure can be attributed to the endpoint, the network
      // path, or the engine — not just reported as the engine's cached state.
      const result = await runOpenworkCloudMcpReconciler({
        mode: "health",
        client: props.client,
        context: { ...context, trigger: "desktop-connect-test" },
        mintToken: mintCloudControlMcpToken,
        refreshMarginMs: CLOUD_MCP_REFRESH_MARGIN_MS,
        probe: true,
      });
      updateHealth(result.health);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings_extra.could_not_test_agent_access"));
    } finally {
      setBusy(null);
    }
  };

  const refreshEngineConnection = async () => {
    if (!props.client || !context) {
      setError(missingCloudMcpContextMessage(props));
      return;
    }
    setBusy("refresh");
    setError(null);
    try {
      const result = await runOpenworkCloudMcpEngineRefresh({
        client: props.client,
        context: { ...context, trigger: "desktop-connect-engine-refresh" },
      });
      setLastEngineRefresh(result.refresh);
      if (result.health) updateHealth(result.health);
      if (result.status === "skipped") {
        setError(
          result.skippedReason === "unsupported"
            ? t("settings_extra.this_openwork_server_does_not_support_engine_refresh_yet_update_openwork_then_retry")
            : t("settings_extra.select_a_workspace_before_refreshing_the_engine_connection"),
        );
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings_extra.could_not_refresh_the_engine_connection"));
    } finally {
      setBusy(null);
    }
  };

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(buildCloudMcpSupportBundle({
        health,
        refresh: lastEngineRefresh,
        context: context
          ? {
              workspaceId: context.workspaceId,
              orgId: context.orgId,
              denBaseUrl: context.denBaseUrl,
              serverBaseUrl: context.serverBaseUrl,
            }
          : undefined,
      }));
      setCopyStatus(t("settings_extra.copied_sanitized_diagnostic_to_the_clipboard"));
    } catch {
      setCopyStatus(t("settings_extra.could_not_copy_the_diagnostic"));
    }
  };

  const repairAndTest = async () => {
    if (!props.client || !context) {
      setError(missingCloudMcpContextMessage(props));
      return;
    }
    setBusy("repair");
    setError(null);
    try {
      clearCloudMcpDisabledIntent(context);
      const result = await runOpenworkCloudMcpReconciler({
        mode: "repair",
        client: props.client,
        context: { ...context, trigger: "desktop-connect-repair" },
        mintToken: mintCloudControlMcpToken,
        force: true,
        refreshMarginMs: CLOUD_MCP_REFRESH_MARGIN_MS,
      });
      updateHealth(result.health);
      if (!result.health && result.skippedReason === "mint_failed") {
        setError(t("settings_extra.could_not_refresh_cloud_authentication_sign_in_again_then_retry"));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings_extra.could_not_repair_agent_access"));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!props.client) {
      setConnectState(null);
      return;
    }
    let cancelled = false;
    void props.client.getConnectState(props.workspaceId)
      .then((state) => {
        if (!cancelled) setConnectState(state);
      })
      .catch(() => {
        if (!cancelled) setConnectState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [health, props.client, props.workspaceId, signedIn]);

  useEffect(() => {
    if (!props.client || !context || !signedIn) {
      updateHealth(null);
      return;
    }
    let cancelled = false;
    setBusy("test");
    setError(null);
    void runOpenworkCloudMcpReconciler({
      mode: "health",
      client: props.client,
      context: { ...context, trigger: "desktop-connect-autocheck" },
      mintToken: mintCloudControlMcpToken,
      refreshMarginMs: CLOUD_MCP_REFRESH_MARGIN_MS,
    })
      .then((result) => {
        if (!cancelled) updateHealth(result.health);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("settings_extra.could_not_test_agent_access"));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.currentModel, props.workspaceId, signedIn]);

  useEffect(() => {
    if (!props.client || !context || !signedIn || typeof window === "undefined") return;
    const client = props.client;
    let cancelled = false;
    const retryAfterReconnect = () => {
      if (window.navigator.onLine === false) return;
      void runOpenworkCloudMcpReconciler({
        mode: "repair",
        client,
        context: { ...context, trigger: "desktop-connect-online-retry" },
        mintToken: mintCloudControlMcpToken,
        refreshMarginMs: CLOUD_MCP_REFRESH_MARGIN_MS,
      })
        .then((result) => {
          if (cancelled || !result.health) return;
          updateHealth(result.health);
          if (result.health.usable) setError(null);
        })
        .catch((nextError) => {
          if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("settings_extra.could_not_restore_agent_access"));
        });
    };

    window.addEventListener("online", retryAfterReconnect);
    return () => {
      cancelled = true;
      window.removeEventListener("online", retryAfterReconnect);
    };
  }, [
    context?.denAuthToken,
    context?.denBaseUrl,
    context?.orgId,
    context?.serverBaseUrl,
    props.client,
    props.currentModel,
    props.workspaceId,
    signedIn,
  ]);

  const canRun = Boolean(props.client && context && signedIn);
  const readyTools = readyCloudMcpToolIds(health);

  if (health?.usable && !connectStateSummary) {
    return (
      <SettingsInset className="flex flex-col gap-3 bg-dls-surface sm:flex-row sm:items-center sm:justify-between" data-testid="agent-access-card">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-base font-semibold text-dls-text">{t("interface.agent_access_ready")}</div>
            <SettingsStatusBadge label={summary.statusLabel} tone={summary.tone} />
          </div>
          <div className="text-sm text-dls-secondary">{t("interface.this_workspace_can_search_and_run_your_organization_apos_s_shared_capabilities")} </div>
          <div className="flex flex-wrap gap-2 font-mono text-xs text-green-11">
            {readyTools.map((tool) => <span key={tool} className="rounded-md bg-green-3 px-2 py-1">{tool}</span>)}
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={!canRun || busy !== null} onClick={() => void testNow()}>
          {busy === "test" ? t("interface.testing") : t("interface.test_again")}
        </Button>
      </SettingsInset>
    );
  }

  return (
    <SettingsInset className="space-y-4 bg-dls-surface" data-testid="agent-access-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="text-base font-semibold text-dls-text">{t("interface.agent_access_to_connected_services")}</div>
          <div className="max-w-[62ch] text-sm text-dls-secondary">{t("interface.lets_agents_use_the_exact_openwork_cloud_tools_for_this_active_workspace_and_organization")} </div>
        </div>
        <SettingsStatusBadge label={summary.statusLabel} tone={summary.tone} />
      </div>

      <div className="grid gap-2 text-sm text-dls-secondary sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-dls-secondary">{t("interface.first_issue")}</div>
          <div className="mt-1 text-dls-text">{summary.stageLabel}</div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-dls-secondary">{t("connect.diagnostics_action_label")}</div>
          <div className="mt-1 text-dls-text">{summary.recommendedAction}</div>
        </div>
      </div>

      {health?.usable && !connectStateSummary ? (
        <div className="space-y-2 rounded-xl border border-green-6/30 bg-green-2 p-3 text-sm text-green-11">
          <div className="font-medium">{t("interface.cloud_tools_verified_for_this_workspace")}</div>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            {readyTools.map((tool) => <span key={tool} className="rounded-md bg-green-3 px-2 py-1">{tool}</span>)}
          </div>
          <div className="text-xs">
            {health.usableByCurrentModel === null
              ? t("interface.current_model_access_was_not_checked")
              : health.usableByCurrentModel
                ? t("interface.current_model_can_use_these_cloud_tools")
                : t("interface.current_model_cannot_use_these_cloud_tools")}
          </div>
        </div>
      ) : null}

      {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={!canRun || busy !== null} onClick={() => void testNow()}>
          {busy === "test" ? t("interface.testing") : t("interface.test_now")}
        </Button>
        <Button size="sm" disabled={!canRun || busy !== null} onClick={() => void repairAndTest()}>
          {busy === "repair" ? t("interface.repairing") : t("interface.repair_and_test")}
        </Button>
      </div>

      <AgentAccessAdvanced
        health={health}
        engineRefresh={lastEngineRefresh}
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((current) => !current)}
        busyLabel={busy}
        canRun={canRun}
        copyStatus={copyStatus}
        onRefreshEngine={() => void refreshEngineConnection()}
        onCopy={() => void copyDiagnostics()}
      />
    </SettingsInset>
  );
}

function AgentAccessAdvanced(props: {
  health: OpenworkCloudMcpHealth | null;
  engineRefresh: OpenworkCloudMcpEngineRefresh | null;
  open: boolean;
  onToggle: () => void;
  busyLabel: "test" | "repair" | "refresh" | null;
  canRun: boolean;
  copyStatus: string | null;
  onRefreshEngine: () => void;
  onCopy: () => void;
}) {
  const rows = cloudMcpAdvancedRows(props.health);
  const traceLines = cloudMcpProbeTraceLines(props.health?.tools.direct.trace);
  const refreshLines = cloudMcpEngineRefreshLines(props.engineRefresh);
  return (
    <div className="border-t border-dls-border pt-3" data-testid="agent-access-advanced">
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-dls-secondary transition-colors hover:text-dls-text"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        {props.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{t("interface.advanced_diagnostics")} </button>
      {props.open ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!props.canRun || props.busyLabel !== null}
              onClick={props.onRefreshEngine}
            >
              {props.busyLabel === "refresh" ? t("interface.refreshing_engine") : t("interface.refresh_engine_connection")}
            </Button>
            <Button variant="outline" size="sm" disabled={!props.health} onClick={props.onCopy}>{t("interface.copy_sanitized_diagnostic")} </Button>
          </div>
          <div className="text-xs text-dls-secondary">{t("interface.refresh_makes_the_agent_engine_drop_its_cloud_connection_and_reconnect_from_scratch_the_engine_never")} </div>
          {props.copyStatus ? <div className="text-xs text-dls-secondary">{props.copyStatus}</div> : null}
          {rows.length ? (
            <div className="grid gap-1.5" data-testid="agent-access-advanced-rows">
              {rows.map((row) => (
                <div key={row.label} className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">{row.label}</div>
                  <div
                    className={`break-words font-mono text-xs ${
                      row.tone === "error" ? "text-red-11" : row.tone === "muted" ? "text-dls-secondary" : "text-dls-text"
                    }`}
                  >
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-dls-secondary">{t("interface.run_test_now_to_load_diagnostics_for_this_workspace")}</div>
          )}
          {traceLines.length ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">{t("interface.direct_probe_steps")}</div>
              <div className="mt-1 space-y-0.5 font-mono text-xs text-dls-text">
                {traceLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
              </div>
            </div>
          ) : null}
          {refreshLines.length ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-dls-secondary">{t("interface.last_engine_refresh")}</div>
              <div className="mt-1 space-y-0.5 font-mono text-xs text-dls-text">
                {refreshLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
