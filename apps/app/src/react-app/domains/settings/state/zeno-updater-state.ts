import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { useSessionActivityStore } from "../../session/status/session-activity-store";
import { useComposerStateStore, type ComposerStateStore } from "../../session/surface/composer-state-store";
import { usePendingConversationStore } from "../../session/chat/pending-conversation-store";
import type { SettingsUpdateStatus } from "./electron-updater-state";
import { useUpdateCheckRequestStore } from "./update-check-request";

export const ZENO_UPDATE_START_DELAY_MS = 45_000;
export const ZENO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const IDLE_SETTLE_MS = 2_000;
const IDLE_RETRY_MS = 15_000;

export function zenoComposerUpdateBusy(state: Pick<ComposerStateStore, "sessions" | "queuedDrafts" | "pendingMessages" | "failedDrafts">): boolean {
  return Object.values(state.sessions).some((session) => Boolean(session.draft.trim() || session.attachments.length || session.pasteParts.length))
    || Object.values(state.queuedDrafts).some((queue) => queue.length > 0)
    || Object.values(state.pendingMessages).some((messages) => messages.some((message) => !message.settled))
    || Object.values(state.failedDrafts).some((drafts) => drafts.length > 0);
}

function updaterBridge() { return window.__OPENWORK_ELECTRON__?.updater; }

/** This hook never reads Den policy, upstream inventories, or legacy update preferences. */
export function useZenoUpdaterState({ enabled }: { enabled: boolean }) {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateEnv, setUpdateEnv] = useState<{ supported?: boolean; reason?: string | null }>({ supported: false });
  const [updateStatus, setUpdateStatus] = useState<SettingsUpdateStatus>(null);
  const status = useRef(updateStatus);
  status.current = updateStatus;
  const mounted = useRef(false);
  const busyOperation = useRef(false);
  const installRequested = useRef(false);
  const [idleRetry, setIdleRetry] = useState(0);
  const activityBusy = useSessionActivityStore((state) => Object.values(state.recordsByWorkspaceId).some((workspace) =>
    Object.values(workspace).some((record) => record.runActive || record.retrying || record.compacting
      || ["thinking", "responding", "compacting", "waiting"].includes(record.status)
      || record.waitingPermissionIds.length > 0 || record.waitingQuestionIds.length > 0)));
  const composerBusy = useComposerStateStore(zenoComposerUpdateBusy);
  const creating = usePendingConversationStore((state) => Object.values(state.conversations).some((conversation) => conversation.phase !== "persisted"));
  const busy = activityBusy || composerBusy || creating;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const supported = enabled && updateEnv.supported === true;
  const supportedRef = useRef(supported);
  supportedRef.current = supported;

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    if (enabled) void updaterBridge()?.getChannel?.().then((result) => {
      if (disposed) return;
      setAppVersion(result.currentVersion);
      const valid = result.product === "zeno" && result.supported === true
        && /^https:\/\/www\.zeno\.ryan-wong\.cn\/updates\/(darwin|win32|linux)\/(x64|arm64)\/$/.test(result.feedUrl);
      setUpdateEnv({ supported: valid, reason: valid ? null : t("zeno.updates.manual_install") });
    }).catch(() => {
      if (!disposed) setUpdateEnv({ supported: false, reason: t("zeno.updates.manual_install") });
    });
    return () => { disposed = true; mounted.current = false; installRequested.current = false; };
  }, [enabled]);

  const publish = useCallback((next: SettingsUpdateStatus) => {
    if (!mounted.current) return;
    status.current = next;
    setUpdateStatus(next);
  }, []);

  useEffect(() => {
    if (!supported) return;
    return updaterBridge()?.onInstallError?.(() => {
      installRequested.current = false;
      publish({ ...status.current, state: "error", installing: false,
        failedAction: "install", message: t("zeno.updates.install_failed") });
    });
  }, [publish, supported]);

  const checkForUpdates = useCallback(async () => {
    if (!supportedRef.current || busyOperation.current || status.current?.state === "ready" || status.current?.state === "downloading") return;
    const bridge = updaterBridge();
    if (!bridge?.check) return;
    busyOperation.current = true;
    const previous = status.current;
    publish({ ...previous, state: "checking" });
    try {
      const result = await bridge.check("stable");
      if (!mounted.current || !supportedRef.current) return;
      if (result.reason) throw new Error("check-failed");
      if (result.currentVersion) setAppVersion(result.currentVersion);
      publish({ state: result.available && result.latestVersion ? "available" : "idle",
        version: result.latestVersion ?? undefined, totalBytes: result.totalBytes,
        lastCheckedAt: Date.now() });
    } catch {
      publish({ ...previous, state: "error", failedAction: "check", message: t("zeno.updates.check_failed") });
    } finally { busyOperation.current = false; }
  }, [publish]);

  const installUpdateAndRestart = useCallback(async () => {
    if (!supportedRef.current || busyOperation.current || status.current?.state !== "ready") return;
    installRequested.current = true;
    if (busyRef.current) { publish({ ...status.current, waitingForIdle: true }); return; }
    const bridge = updaterBridge();
    if (!bridge?.installAndRestart) return;
    busyOperation.current = true;
    publish({ ...status.current, installing: true, waitingForIdle: false });
    try {
      const result = await bridge.installAndRestart();
      if (!mounted.current) return;
      if (result.ok) return;
      if (result.reason === "tasks-active") {
        publish({ ...status.current, state: "ready", installing: false, waitingForIdle: true });
        return;
      }
      throw new Error("install-failed");
    } catch {
      installRequested.current = false;
      publish({ ...status.current, state: "error", installing: false, failedAction: "install", message: t("zeno.updates.install_failed") });
    } finally { busyOperation.current = false; }
  }, [publish]);

  const downloadUpdate = useCallback(async () => {
    if (!supportedRef.current || busyOperation.current || status.current?.state === "downloading") return;
    if (status.current?.state === "ready" || status.current?.failedAction === "install") {
      publish({ ...status.current, state: "ready", failedAction: undefined, message: undefined });
      await installUpdateAndRestart();
      return;
    }
    if (status.current?.state !== "available" && status.current?.failedAction !== "download") return;
    const bridge = updaterBridge();
    if (!bridge?.download) return;
    busyOperation.current = true;
    installRequested.current = true;
    const previous = status.current;
    publish({ ...previous, state: "downloading", downloadedBytes: 0, message: undefined, failedAction: undefined });
    const unsubscribe = bridge.onDownloadProgress?.((progress) => {
      if (status.current?.state !== "downloading" || !Number.isFinite(progress.transferred) || !Number.isFinite(progress.total)) return;
      publish({ ...status.current, downloadedBytes: Math.max(0, progress.transferred), totalBytes: Math.max(0, progress.total) });
    });
    try {
      const result = await bridge.download();
      if (!mounted.current) return;
      if (!result.ok) throw new Error("download-failed");
      publish({ ...status.current, state: "ready", waitingForIdle: true });
    } catch {
      installRequested.current = false;
      publish({ ...previous, state: "error", failedAction: "download", message: t("zeno.updates.download_failed") });
    } finally { unsubscribe?.(); busyOperation.current = false; }
  }, [installUpdateAndRestart, publish]);

  useEffect(() => {
    if (!supported) return;
    const first = window.setTimeout(() => { void checkForUpdates(); }, ZENO_UPDATE_START_DELAY_MS);
    const interval = window.setInterval(() => { void checkForUpdates(); }, ZENO_UPDATE_INTERVAL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [checkForUpdates, supported]);

  useEffect(() => {
    if (!supported || updateStatus?.state !== "ready" || updateStatus.installing || !installRequested.current) return;
    const timer = window.setTimeout(() => {
      if (!busyRef.current) void installUpdateAndRestart();
      setIdleRetry((previous) => previous + 1);
    }, busy || idleRetry > 0 ? IDLE_RETRY_MS : IDLE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [busy, idleRetry, installUpdateAndRestart, supported, updateStatus]);

  const requestedAt = useUpdateCheckRequestStore((state) => state.requestedAt);
  useEffect(() => {
    if (!supported || requestedAt === null) return;
    useUpdateCheckRequestStore.getState().clearUpdateCheckRequest();
    void checkForUpdates();
  }, [checkForUpdates, requestedAt, supported]);

  const setReleaseChannel = useCallback(async () => {}, []);
  return { appVersion, updateEnv, updateStatus, checkForUpdates, downloadUpdate, installUpdateAndRestart, setReleaseChannel };
}
