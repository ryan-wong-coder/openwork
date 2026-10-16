/** @jsxImportSource react */
import { useEffect, useReducer, useRef, useState } from "react";

import { useLocation } from "react-router";
import { ChevronRight } from "lucide-react";
import { ADVANCED_SETTINGS_SECTIONS } from "../advanced-sections";

import { Separator } from "@/components/ui/separator";

import type { OpencodeConnectStatus } from "@/app/types";
import type { OpenworkServerClient, OpenworkCloudMcpHealth, OpenworkRuntimeConfigStatus, OpenworkServerStatus } from "@/app/lib/openwork-server";
import { t } from "@/i18n";
import { isLocalGatewayClient } from "@/app/lib/client-profile";
import { LayoutStack } from "../settings-layout";
import type { useDenSession } from "../cloud/use-den-session";

import { advancedLocalReducer, initialAdvancedLocalState } from "./advanced-view-state";
import {
  AdvancedDeveloperSection,
  AdvancedEngineV2PreviewSection,
  AdvancedCloudMcpDiagnosticsSection,
  AdvancedOrganizationServerSection,
  AdvancedRuntimeConfigSourcesSection,
  AdvancedRuntimeSection,
  AdvancedWorkspaceRunModeSection,
} from "./advanced-view-sections";

type AdvancedOrganizationServerSession = Pick<
  ReturnType<typeof useDenSession>,
  | "authBusy"
  | "baseUrl"
  | "baseUrlBusy"
  | "baseUrlDraft"
  | "baseUrlError"
  | "onApplyBaseUrl"
  | "onBaseUrlDraftChange"
  | "onClearServerConfiguration"
  | "onResetBaseUrlToDefault"
  | "sessionBusy"
>;

export type AdvancedViewProps = {
  sectionId?: string;
  busy: boolean;
  clientConnected: boolean;
  opencodeConnectStatus: OpencodeConnectStatus | null;
  openworkServerStatus: OpenworkServerStatus;
  developerMode: boolean;
  toggleDeveloperMode: () => void;
  opencodeDevModeEnabled: boolean;
  openDebugDeepLink: (rawUrl: string) => Promise<{ ok: boolean; message: string }>;
  canInspectRuntimeConfig: boolean;
  getRuntimeConfigStatus: () => Promise<OpenworkRuntimeConfigStatus>;
  organizationServer: AdvancedOrganizationServerSession;
  cloudMcpUrl: string | null;
  cloudMcpHealth: OpenworkCloudMcpHealth | null;
  refreshCloudMcpHealth: () => Promise<OpenworkCloudMcpHealth | null>;
  engineClient: OpenworkServerClient | null;
};

type AdvancedStatusTone = "ready" | "warning" | "error" | "neutral";

export function AdvancedView(props: AdvancedViewProps) {
  const localOnly = isLocalGatewayClient();
  const location = useLocation();
  const viewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sectionId = props.sectionId;
    if (!ADVANCED_SETTINGS_SECTIONS.some((section) => section.id === sectionId)) return;
    const frame = requestAnimationFrame(() => {
      const section = viewRef.current?.querySelector<HTMLElement>(`#advanced-${sectionId}`);
      section?.scrollIntoView({ block: "start" });
      section?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.key, props.sectionId]);
  const [localState, dispatchLocal] = useReducer(
    advancedLocalReducer,
    initialAdvancedLocalState,
  );
  const [configStatus, setConfigStatus] = useState<OpenworkRuntimeConfigStatus | null>(null);
  const [configStatusBusy, setConfigStatusBusy] = useState(false);
  const [configStatusError, setConfigStatusError] = useState<string | null>(null);
  const {
    deepLinkOpen: debugDeepLinkOpen,
    deepLinkInput: debugDeepLinkInput,
    deepLinkBusy: debugDeepLinkBusy,
    deepLinkStatus: debugDeepLinkStatus,
  } = localState;

  const clientStatusLabel = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return t("status.connecting");
    if (status === "error") return t("settings.connection_failed");
    return props.clientConnected ? t("status.connected") : t("config.status_not_connected");
  })();

  const clientTone: AdvancedStatusTone = (() => {
    const status = props.opencodeConnectStatus?.status;
    if (status === "connecting") return "warning";
    if (status === "error") return "error";
    return props.clientConnected ? "ready" : "neutral";
  })();

  const openworkStatusLabel = (() => {
    switch (props.openworkServerStatus) {
      case "connected":
        return t("config.status_connected");
      case "limited":
        return t("config.status_limited");
      default:
        return t("config.status_not_connected");
    }
  })();

  const openworkTone: AdvancedStatusTone = (() => {
    switch (props.openworkServerStatus) {
      case "connected":
        return "ready";
      case "limited":
        return "warning";
      default:
        return "neutral";
    }
  })();

  const clientDetailLines = props.clientConnected
    ? [t("settings_extra.chat_and_task_creation_can_use_the_opencode_engine_for_this_workspace")]
    : [
        t("settings_extra.chat_and_task_creation_may_fail_until_opencode_restarts"),
        t("settings_extra.openwork_server_config_sources_below_can_still_be_inspected"),
      ];

  const openworkDetailLines = props.openworkServerStatus === "connected"
    ? [t("settings_extra.runtime_db_workspace_config_and_migration_diagnostics_are_available")]
    : [t("settings_extra.runtime_config_diagnostics_need_the_openwork_server_connection")];

  const submitDebugDeepLink = async () => {
    const rawUrl = debugDeepLinkInput.trim();
    if (!rawUrl || props.busy || debugDeepLinkBusy) return;
    dispatchLocal({ type: "deepLinkStart" });
    try {
      const result = await props.openDebugDeepLink(rawUrl);
      if (result.ok) {
        dispatchLocal({ type: "deepLinkSuccess", status: result.message });
      } else {
        dispatchLocal({ type: "deepLinkStatus", status: result.message });
      }
    } catch (error) {
      dispatchLocal({
        type: "deepLinkStatus",
        status: error instanceof Error ? error.message : t("settings.open_deeplink_failed"),
      });
    } finally {
      dispatchLocal({ type: "deepLinkDone" });
    }
  };

  const refreshRuntimeConfigStatus = async () => {
    if (!props.canInspectRuntimeConfig) {
      setConfigStatus(null);
      return;
    }
    setConfigStatusBusy(true);
    setConfigStatusError(null);
    try {
      setConfigStatus(await props.getRuntimeConfigStatus());
    } catch (error) {
      setConfigStatusError(error instanceof Error ? error.message : t("settings_extra.failed_to_load_runtime_config_status"));
    } finally {
      setConfigStatusBusy(false);
    }
  };

  useEffect(() => {
    void refreshRuntimeConfigStatus();
  }, [props.canInspectRuntimeConfig]);

  const runtimeInspection = <>
    <AdvancedRuntimeSection
      clientStatusLabel={clientStatusLabel}
      clientTone={clientTone}
      clientDetailLines={clientDetailLines}
      openworkStatusLabel={openworkStatusLabel}
      openworkTone={openworkTone}
      openworkDetailLines={openworkDetailLines}
    />
    <AdvancedRuntimeConfigSourcesSection
      busy={props.busy}
      canInspect={props.canInspectRuntimeConfig}
      configStatus={configStatus}
      configStatusBusy={configStatusBusy}
      configStatusError={configStatusError}
      onRefresh={refreshRuntimeConfigStatus}
    />
  </>;

  return (
    <div ref={viewRef}>
      <LayoutStack>
        {!localOnly ? <AdvancedOrganizationServerSection
          authBusy={props.organizationServer.authBusy}
          baseUrl={props.organizationServer.baseUrl}
          baseUrlBusy={props.organizationServer.baseUrlBusy}
          baseUrlDraft={props.organizationServer.baseUrlDraft}
          baseUrlError={props.organizationServer.baseUrlError}
          onApplyBaseUrl={props.organizationServer.onApplyBaseUrl}
          onBaseUrlDraftChange={props.organizationServer.onBaseUrlDraftChange}
          onClearServerConfiguration={props.organizationServer.onClearServerConfiguration}
          onResetBaseUrlToDefault={props.organizationServer.onResetBaseUrlToDefault}
          sessionBusy={props.organizationServer.sessionBusy}
          cloudMcpUrl={props.cloudMcpUrl}
        /> : null}

        {!localOnly ? <AdvancedCloudMcpDiagnosticsSection
          cloudMcpHealth={props.cloudMcpHealth}
          onRefresh={props.refreshCloudMcpHealth}
        /> : null}

        {localOnly ? <details className="group/runtime-diagnostics">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium"><ChevronRight className="size-4 transition-transform group-open/runtime-diagnostics:rotate-90" />运行时诊断</summary>
          <div className="pt-4"><LayoutStack>{runtimeInspection}</LayoutStack></div>
        </details> : runtimeInspection}

        <AdvancedEngineV2PreviewSection client={props.engineClient} />

        <AdvancedWorkspaceRunModeSection />

        <AdvancedDeveloperSection
          busy={props.busy}
          developerMode={props.developerMode}
          opencodeDevModeEnabled={props.opencodeDevModeEnabled}
          deepLinkOpen={debugDeepLinkOpen}
          deepLinkInput={debugDeepLinkInput}
          deepLinkBusy={debugDeepLinkBusy}
          deepLinkStatus={debugDeepLinkStatus}
          onToggleDeveloperMode={props.toggleDeveloperMode}
          onToggleDeepLink={() => dispatchLocal({ type: "toggleDeepLink" })}
          onDeepLinkInput={(input) => dispatchLocal({ type: "deepLinkInput", input })}
          onSubmitDeepLink={submitDebugDeepLink}
        />
      </LayoutStack>
    </div>
  );
}
