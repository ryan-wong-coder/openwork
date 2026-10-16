import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  useZenoUpdaterState, ZENO_UPDATE_INTERVAL_MS, ZENO_UPDATE_START_DELAY_MS, zenoComposerUpdateBusy,
} from "../src/react-app/domains/settings/state/zeno-updater-state";
import { useComposerStateStore } from "../src/react-app/domains/session/surface/composer-state-store";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { usePendingConversationStore } from "../src/react-app/domains/session/chat/pending-conversation-store";
import type { ComposerDraft } from "../src/app/types";
import { isZenoReleaseUpdatesEnabled } from "../src/app/lib/zeno-release-updates";
import { setClientProfileBootstrap } from "../src/app/lib/client-profile";
import * as localFeatures from "../src/app/lib/local-client-features";

type Timer = { callback: () => void; delay: number; interval: boolean };
type Updater = ReturnType<typeof useZenoUpdaterState>;
type Bridge = NonNullable<NonNullable<Window["__OPENWORK_ELECTRON__"]>["updater"]>;

describe("independent Zeno release updates", () => {
  let root: ReturnType<typeof createRoot>;
  let updater: Updater;
  let bridge: Bridge;
  let checks: number;
  let downloads: number;
  let installs: number;
  let channelReads: number;
  let timers: Map<number, Timer>;
  let nextTimer: number;
  let progress: ((value: { transferred: number; total: number; percent: number; bytesPerSecond: number }) => void) | undefined;
  let installError: (() => void) | undefined;
  const channel = { product: "zeno", supported: true, channel: "stable", currentVersion: "1.0.0",
    feedUrl: "https://www.zeno.ryan-wong.cn/updates/darwin/arm64/" };

  function Harness({ enabled = true }: { enabled?: boolean }) {
    updater = useZenoUpdaterState({ enabled });
    return null;
  }
  const render = async (enabled = true) => { await act(async () => root.render(createElement(Harness, { enabled }))); };
  const runTimer = async (delay: number) => {
    const entry = [...timers.entries()].find(([, value]) => value.delay === delay);
    expect(entry).toBeDefined();
    if (!entry) return;
    if (!entry[1].interval) timers.delete(entry[0]);
    await act(async () => entry[1].callback());
  };

  beforeEach(() => {
    GlobalRegistrator.register({ url: "http://localhost/" });
    setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    useSessionActivityStore.setState({ recordsByWorkspaceId: {}, statusesByWorkspaceId: {}, waitingByWorkspaceId: {} });
    useComposerStateStore.setState({ sessions: {}, queuedDrafts: {}, pendingMessages: {}, failedDrafts: {} });
    usePendingConversationStore.setState({ conversations: {} });
    checks = 0; downloads = 0; installs = 0; channelReads = 0; nextTimer = 0; timers = new Map(); progress = undefined; installError = undefined;
    Reflect.set(window, "setTimeout", (callback: () => void, delay: number) => {
      const id = ++nextTimer; timers.set(id, { callback, delay, interval: false }); return id;
    });
    Reflect.set(window, "setInterval", (callback: () => void, delay: number) => {
      const id = ++nextTimer; timers.set(id, { callback, delay, interval: true }); return id;
    });
    Reflect.set(window, "clearTimeout", (id: number) => timers.delete(id));
    Reflect.set(window, "clearInterval", (id: number) => timers.delete(id));
    bridge = {
      getChannel: async () => { channelReads++; return { ...channel, product: "zeno", channel: "stable" }; },
      check: async () => { checks++; return { available: true, latestVersion: "1.0.1", currentVersion: "1.0.0", totalBytes: 100 }; },
      download: async () => { downloads++; return { ok: true }; },
      installAndRestart: async () => { installs++; return { ok: true }; },
      onDownloadProgress: (callback) => { progress = callback; return () => { progress = undefined; }; },
      onInstallError: (callback) => { installError = callback; return () => { installError = undefined; }; },
    };
    Reflect.set(window, "__OPENWORK_ELECTRON__", { updater: bridge });
    root = createRoot(document.createElement("div"));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    expect(timers.size).toBe(0);
    await GlobalRegistrator.unregister();
  });

  test("waits 45 seconds, rechecks every six hours and only offers a download", async () => {
    await render();
    expect(channelReads).toBe(1);
    expect(checks).toBe(0);
    expect([...timers.values()].map((timer) => timer.delay)).toEqual([ZENO_UPDATE_START_DELAY_MS, ZENO_UPDATE_INTERVAL_MS]);
    await runTimer(ZENO_UPDATE_START_DELAY_MS);
    expect(updater.updateStatus).toMatchObject({ state: "available", version: "1.0.1" });
    expect(downloads).toBe(0);
    expect(installs).toBe(0);
    await runTimer(ZENO_UPDATE_INTERVAL_MS);
    expect(checks).toBe(2);
    expect(downloads).toBe(0);
  });

  test("disabled and unsupported legacy/dev bridges schedule no release requests", async () => {
    await render(false);
    expect(channelReads).toBe(0);
    expect(timers.size).toBe(0);
    bridge.getChannel = async () => ({ channel: "stable", currentVersion: "1.0.0", feedUrl: "https://github.com/different-ai/openwork" });
    await render();
    expect(updater.updateEnv.supported).toBe(false);
    expect(timers.size).toBe(0);
    await act(async () => { await updater.checkForUpdates(); await updater.downloadUpdate(); await updater.installUpdateAndRestart(); });
    expect(checks + downloads + installs).toBe(0);
  });

  test("Web, connected installations and a disabled feature cannot activate native updates", async () => {
    expect(isZenoReleaseUpdatesEnabled()).toBe(true);
    setClientProfileBootstrap({ requireSignin: true });
    expect(isZenoReleaseUpdatesEnabled()).toBe(false);
    setClientProfileBootstrap({ requireSignin: false });
    const flag = spyOn(localFeatures, "localClientFeatureEnabled").mockReturnValue(false);
    try {
      expect(isZenoReleaseUpdatesEnabled()).toBe(false);
      await render(isZenoReleaseUpdatesEnabled());
      expect(channelReads).toBe(0);
    } finally { flag.mockRestore(); }
    Reflect.deleteProperty(window, "__OPENWORK_ELECTRON__");
    expect(isZenoReleaseUpdatesEnabled()).toBe(false);
  });

  test("a manual download reports progress and restarts only after a stable idle interval", async () => {
    let finish: ((result: { ok: boolean }) => void) | undefined;
    bridge.download = () => { downloads++; return new Promise((resolve) => { finish = resolve; }); };
    await render();
    await act(async () => updater.checkForUpdates());
    let downloading: Promise<void> | undefined;
    await act(async () => { downloading = updater.downloadUpdate(); });
    expect(updater.updateStatus?.state).toBe("downloading");
    expect(installs).toBe(0);
    await act(async () => progress?.({ transferred: 50, total: 100, percent: 50, bytesPerSecond: 10 }));
    expect(updater.updateStatus).toMatchObject({ downloadedBytes: 50, totalBytes: 100 });
    await act(async () => { finish?.({ ok: true }); await downloading; });
    expect(updater.updateStatus?.state).toBe("ready");
    expect(installs).toBe(0);
    await runTimer(2_000);
    expect(installs).toBe(1);
  });

  test("drafts, attachments, queued sends and running/waiting sessions postpone restart", async () => {
    await render();
    await act(async () => {
      useComposerStateStore.getState().setDraft("draft", "unsent work");
      await updater.checkForUpdates(); await updater.downloadUpdate();
    });
    await runTimer(15_000);
    expect(installs).toBe(0);
    await act(async () => {
      useComposerStateStore.getState().clearSession("draft");
      useSessionActivityStore.getState().setRunStatus("workspace", "session", { type: "busy" });
    });
    await runTimer(15_000);
    expect(installs).toBe(0);
    await act(async () => {
      useSessionActivityStore.getState().setRunStatus("workspace", "session", { type: "idle" });
      useSessionActivityStore.getState().setWaitingRequest("workspace", "session", "permission", "request", true);
    });
    await runTimer(15_000);
    expect(installs).toBe(0);
    await act(async () => useSessionActivityStore.getState().setWaitingRequest("workspace", "session", "permission", "request", false));
    await runTimer(15_000);
    expect(installs).toBe(1);
  });

  test("unknown native activity waits and polls; failed installs require a person to retry", async () => {
    bridge.installAndRestart = async () => { installs++; return { ok: false, reason: "tasks-active" }; };
    await render();
    await act(async () => { await updater.checkForUpdates(); await updater.downloadUpdate(); });
    await runTimer(2_000);
    expect(updater.updateStatus).toMatchObject({ state: "ready", waitingForIdle: true, installing: false });
    bridge.installAndRestart = async () => { installs++; return { ok: false, reason: "install-failed" }; };
    await runTimer(15_000);
    expect(updater.updateStatus).toMatchObject({ state: "error", failedAction: "install" });
    expect([...timers.values()].some((timer) => timer.delay === 15_000)).toBe(false);
    bridge.installAndRestart = async () => { installs++; return { ok: true }; };
    await act(async () => updater.downloadUpdate());
    expect(installs).toBe(3);
  });

  test("offline checks/downloads can retry and no-update stays idle", async () => {
    await render();
    bridge.check = async () => { checks++; return { available: false, reason: "check-failed" }; };
    await act(async () => updater.checkForUpdates());
    expect(updater.updateStatus).toMatchObject({ state: "error", failedAction: "check" });
    bridge.check = async () => ({ available: false, latestVersion: "1.0.0" });
    await act(async () => updater.checkForUpdates());
    expect(updater.updateStatus?.state).toBe("idle");
    bridge.check = async () => ({ available: true, latestVersion: "1.0.1" });
    bridge.download = async () => ({ ok: false, reason: "download-failed" });
    await act(async () => { await updater.checkForUpdates(); await updater.downloadUpdate(); });
    expect(updater.updateStatus).toMatchObject({ state: "error", failedAction: "download" });
    expect(installs).toBe(0);
    bridge.download = async () => ({ ok: true });
    await act(async () => updater.downloadUpdate());
    expect(updater.updateStatus?.state).toBe("ready");
  });

  test("a late native installer error restores a retry action after restart was requested", async () => {
    await render();
    await act(async () => { await updater.checkForUpdates(); await updater.downloadUpdate(); });
    await runTimer(2_000);
    expect(updater.updateStatus?.installing).toBe(true);
    await act(async () => installError?.());
    expect(updater.updateStatus).toMatchObject({ state: "error", failedAction: "install", installing: false });
    await act(async () => updater.downloadUpdate());
    expect(installs).toBe(2);
  });

  test("composer safety includes attachment-only drafts and pending queues without blocking settled sends", () => {
    const empty = { sessions: {}, queuedDrafts: {}, pendingMessages: {}, failedDrafts: {} };
    expect(zenoComposerUpdateBusy(empty)).toBe(false);
    useComposerStateStore.getState().setDraft("draft", "create state");
    const session = useComposerStateStore.getState().sessions.draft;
    expect(session).toBeDefined();
    if (!session) return;
    expect(zenoComposerUpdateBusy({ ...empty, sessions: { draft: { ...session, draft: "", pasteParts: [{ id: "paste", label: "paste", text: "long draft", lines: 1 }] } } })).toBe(true);
    expect(zenoComposerUpdateBusy({ ...empty, sessions: { draft: { ...session, draft: "", attachments: [{
      id: "attachment", name: "draft.txt", mimeType: "text/plain", size: 1, kind: "file", file: new File(["x"], "draft.txt"),
    }] } } })).toBe(true);
    const draft: ComposerDraft & { messageId: string } = { mode: "prompt", parts: [], text: "next turn", attachments: [], messageId: "message" };
    expect(zenoComposerUpdateBusy({ ...empty, queuedDrafts: { draft: [{ id: "queued", draft }] } })).toBe(true);
    const pending = { draft, composer: session, previousMessageIds: [], submissionMessageIds: [], settled: false };
    expect(zenoComposerUpdateBusy({ ...empty, pendingMessages: { draft: [pending] } })).toBe(true);
    expect(zenoComposerUpdateBusy({ ...empty, pendingMessages: { draft: [{ ...pending, settled: true }] } })).toBe(false);
    expect(zenoComposerUpdateBusy({ ...empty, failedDrafts: { draft: [session] } })).toBe(true);
  });
});
