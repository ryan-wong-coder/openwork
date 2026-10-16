/** @jsxImportSource react */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Download, LoaderCircle, RotateCw } from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../../../../components/ui/alert-dialog";
import { t } from "../../../../i18n";
import { useLocal } from "../../../kernel/local-provider";
import { useDesktopConfig } from "../../cloud/desktop-config-provider";
import { useEnterpriseActivationRequired } from "../../cloud/enterprise-activation-gate";
import { useBrandAppName } from "../../cloud/brand-theme";
import { notifyAlert } from "../../../shell/notifications";
import { useElectronUpdaterState } from "./electron-updater-state";
import { isLocalGatewayClient } from "@/app/lib/client-profile";
import { isZenoReleaseUpdatesEnabled } from "@/app/lib/zeno-release-updates";
import { useZenoUpdaterState } from "./zeno-updater-state";

function useUpdatePreference(key: string) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (isLocalGatewayClient()) return;
    try { localStorage.setItem(key, enabled ? "1" : "0"); } catch { /* Keep the session preference. */ }
  }, [enabled, key]);
  return [enabled, setEnabled] as const;
}

function useUpdater() {
  const local = useLocal();
  const desktopConfig = useDesktopConfig();
  // This provider mounts above the enterprise activation gate. Before activation
  // no Den is known, and until the desktop config has resolved once (or failed
  // and fallen back to the last known one) the organization's allowed desktop
  // versions cannot be honoured, so no update check (and therefore no
  // download) may run yet.
  const allowedVersionsKnown = !useEnterpriseActivationRequired() && !desktopConfig.loading && !isLocalGatewayClient();
  const [updateAutoCheck, setUpdateAutoCheck] = useUpdatePreference("openwork.react.settings.update-auto-check");
  // Older Settings wrote "0" even when the user never touched the old opt-in.
  // Start the automatic-download default once, then retain future opt-outs.
  const [updateAutoDownload, setUpdateAutoDownload] = useUpdatePreference("openwork.react.settings.update-auto-download.v2");
  const onReleaseChannelChange = useCallback((next: "stable" | "alpha") => {
    local.setPrefs((previous) => ({ ...previous, releaseChannel: next }));
  }, [local.setPrefs]);
  const setError = useCallback((message: string | null) => {
    if (message) notifyAlert({
      kind: "update", title: t("notifications.updater_error"), body: message, dedupeKey: "updater-error",
    });
  }, []);
  const updater = useElectronUpdaterState({
    releaseChannel: local.prefs.releaseChannel ?? "stable",
    onReleaseChannelChange,
    updateAutoCheck,
    updateAutoDownload,
    allowedVersionsKnown,
    desktopConfig: desktopConfig.config,
    refreshDesktopConfig: desktopConfig.refreshFresh,
    setError,
  });
  const zenoEnabled = isZenoReleaseUpdatesEnabled();
  const zenoUpdater = useZenoUpdaterState({ enabled: zenoEnabled });
  return { ...(zenoEnabled ? zenoUpdater : updater), updateAutoCheck, setUpdateAutoCheck, updateAutoDownload, setUpdateAutoDownload };
}

const DesktopUpdaterContext = createContext<ReturnType<typeof useUpdater> | null>(null);

export function useDesktopUpdater() {
  const updater = useContext(DesktopUpdaterContext);
  if (!updater) throw new Error("DesktopUpdaterProvider is missing.");
  return updater;
}

export function DesktopUpdaterProvider({ children }: { children: ReactNode }) {
  const updater = useUpdater();
  return <DesktopUpdaterContext.Provider value={updater}>{children}</DesktopUpdaterContext.Provider>;
}

/** DESIGN P1/P5/V1: one action reflects the real native update state. */
export function ZenoUpdateControl({ compact = false }: { compact?: boolean }) {
  const updater = useContext(DesktopUpdaterContext);
  if (!isZenoReleaseUpdatesEnabled() || !updater) return null;
  if (!updater.updateEnv?.supported) return compact ? null : (
    <p className="text-xs text-muted-foreground">{updater.updateEnv?.reason ?? t("zeno.updates.manual_install")}</p>
  );
  const status = updater.updateStatus;
  const state = status?.state ?? "idle";
  if (compact && state !== "available" && state !== "downloading" && state !== "ready") return null;
  const progress = status?.totalBytes && status.totalBytes > 0
    ? Math.min(100, Math.round(((status.downloadedBytes ?? 0) / status.totalBytes) * 100)) : null;
  const working = state === "checking" || state === "downloading" || state === "ready";
  const label = state === "checking" ? t("settings.update_checking")
    : state === "downloading" ? `${t("settings.update_downloading")}${progress === null ? "" : ` ${progress}%`}`
      : state === "ready" ? status?.installing ? t("zeno.updates.restarting") : t("zeno.updates.waiting")
        : state === "available" ? t("zeno.updates.update_and_restart")
          : state === "error" ? t("updates.retry") : t("settings.update_check_button");
  const action = () => {
    if (state === "available" || (state === "error" && status?.failedAction !== "check")) void updater.downloadUpdate();
    else void updater.checkForUpdates();
  };
  return (
    <div className={compact ? "mac:titlebar-no-drag" : "flex flex-col items-start gap-2"} data-zeno-update>
      <Tooltip>
        <TooltipTrigger render={
          <Button variant={state === "available" ? "default" : "outline"} size="sm" disabled={working} onClick={action}
            className={compact ? "h-7 gap-1.5 rounded-lg px-2.5 text-xs" : "gap-2"}>
            {working ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
              : state === "available" ? <Download className="size-3.5" aria-hidden="true" /> : <RotateCw className="size-3.5" aria-hidden="true" />}
            {label}
          </Button>
        } />
        <TooltipContent>{state === "ready" ? t("zeno.updates.safe_restart")
          : state === "available" && status?.version ? t("zeno.updates.version", undefined, { version: status.version }) : t("zeno.updates.source")}</TooltipContent>
      </Tooltip>
      {!compact && <div role="status" aria-live="polite" className="max-w-sm text-xs text-muted-foreground">
        {state === "error" ? status?.message
          : state === "idle" && status?.lastCheckedAt ? t("settings.update_uptodate")
            : state === "available" && status?.version ? t("zeno.updates.version", undefined, { version: status.version })
              : state === "ready" ? t("zeno.updates.safe_restart") : null}
      </div>}
      {!compact && state === "downloading" && <progress className="h-1.5 w-48 accent-primary" value={progress ?? undefined} max={100} aria-label={t("settings.update_downloading")} />}
    </div>
  );
}

export function DesktopUpdateButton() {
  const updater = useContext(DesktopUpdaterContext);
  const appName = useBrandAppName();
  const [confirmRestart, setConfirmRestart] = useState(false);
  if (isZenoReleaseUpdatesEnabled()) return <ZenoUpdateControl compact />;
  if (isLocalGatewayClient()) return null;
  if (updater?.updateStatus?.state !== "ready") return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger render={
          <Button
            variant="ghost"
            size="sm"
            data-update-button
            onClick={() => setConfirmRestart(true)}
            className="mac:titlebar-no-drag h-7 gap-1.5 rounded-lg border border-foreground/[0.06] bg-foreground/[0.04] px-2.5 text-xs font-medium text-foreground/80 shadow-none transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
          >
            <RotateCw className="size-3.5 opacity-70" strokeWidth={1.75} aria-hidden="true" />
            {t("settings.update_restart_button")}
          </Button>
        } />
        <TooltipContent side="bottom" align="end">{t("settings.update_on_quit_hint")}</TooltipContent>
      </Tooltip>
      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent className="max-w-[340px] gap-0 rounded-[15px] border border-border p-6 ring-0 sm:max-w-[340px]">
          <RotateCw className="mb-3 size-6 text-muted-foreground" aria-hidden="true" />
          <AlertDialogTitle className="mb-2 text-[19px] leading-tight tracking-tight">{t("settings.update_restart_now_title", undefined, { appName })}</AlertDialogTitle>
          <AlertDialogDescription className="text-xs leading-[1.75]">{t("settings.update_restart_now_message", undefined, { appName })}</AlertDialogDescription>
          <AlertDialogFooter className="mt-5">
            <AlertDialogCancel variant="ghost" size="sm" className="rounded-[7px] text-[11px] text-muted-foreground">{t("settings.update_keep_working")}</AlertDialogCancel>
            <AlertDialogAction size="sm" className="rounded-[7px] text-[11px]" onClick={() => {
              setConfirmRestart(false);
              void updater.installUpdateAndRestart();
            }}>{t("settings.update_restart_confirm_action")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
