import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createZenoInstallGuard, registerZenoUpdaterIpc, validateZenoUpdateInfo,
  zenoEnginesIdle, zenoUpdateRequestAllowed, zenoUpdaterFeedUrl,
} from "../electron/zeno-updater.mjs";

const sha512 = Buffer.alloc(64, 1).toString("base64");
const release = (platform = "win32", arch = "x64") => ({
  version: "1.0.1", files: [{ url: `zeno-${platform}-${arch}-1.0.1.${platform === "darwin" ? "zip" : platform === "linux" ? "AppImage" : "exe"}`, sha512, size: 1024 }],
});
const idle = { verdict: "idle", busySessions: 0, waitingRequests: 0 };

function harness(options = {}) {
  const handlers = new Map();
  const feeds = [];
  let loads = 0;
  let downloads = 0;
  let installs = 0;
  const relaunches = [];
  let canInstall = false;
  const platform = options.platform ?? "win32";
  const native = new EventEmitter();
  native.getFeedURL = () => "http://127.0.0.1:43111";
  native.checkForUpdates = () => {};
  const updater = options.appImage ? new (class AppImageUpdater extends EventEmitter {})() : new EventEmitter();
  updater.nativeUpdater = native;
  updater.setFeedURL = (feed) => feeds.push(feed);
  updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: release(platform) });
  updater.downloadUpdate = async () => { downloads++; };
  updater.quitAndInstall = () => { installs++; };
  const webContents = { mainFrame: {}, send() {} };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const registration = registerZenoUpdaterIpc({
    app: { isPackaged: options.packaged ?? true, getVersion: () => "1.0.0", relaunch: (value) => relaunches.push(value) },
    enabled: options.enabled ?? true,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    getMainWindow: () => ({ webContents, isDestroyed: () => false }),
    platform, arch: "x64", loadAutoUpdater: async () => { loads++; return { autoUpdater: updater }; },
    canInstall: async () => canInstall,
    nativeStagingTimeoutMs: options.timeout ?? 100,
    appImagePath: options.appImagePath,
  });
  return {
    ...registration, updater, native, feeds, relaunches,
    invoke: (name, ...args) => handlers.get(`openwork:updater:${name}`)(event, ...args),
    recovery: (name) => handlers.get(`openwork:recovery:${name}`)(event),
    untrusted: () => handlers.get("openwork:updater:check")({ sender: {}, senderFrame: {} }),
    counts: () => ({ loads, downloads, installs }), setIdle: (value) => { canInstall = value; },
  };
}

test("feeds isolate every platform/architecture and disallow unknown targets", () => {
  for (const platform of ["darwin", "win32", "linux"]) for (const arch of ["x64", "arm64"]) {
    assert.equal(zenoUpdaterFeedUrl(platform, arch), `https://www.zeno.ryan-wong.cn/updates/${platform}/${arch}/`);
    assert.equal(validateZenoUpdateInfo(release(platform, arch), { platform, arch }).version, "1.0.1");
  }
  assert.equal(zenoUpdaterFeedUrl("aix", "x64"), null);
  assert.equal(zenoUpdaterFeedUrl("darwin", "ia32"), null);
});

test("metadata rejects external, HTTP, escaped paths, wrong architecture and missing integrity", () => {
  for (const file of [
    { url: "https://github.com/different-ai/openwork/update.exe" },
    { url: "http://www.zeno.ryan-wong.cn/updates/win32/x64/zeno-win32-x64-1.0.1.exe" },
    { url: "../arm64/zeno-win32-arm64-1.0.1.exe" },
    { url: "zeno-win32-arm64-1.0.1.exe" },
    { url: "zeno-win32-x64-1.0.1.exe?redirect=1" },
    { url: "%2e%2e/zeno-win32-x64-1.0.1.exe" },
    { sha512: "wrong" }, { size: 0 },
  ]) {
    const info = release(); info.files[0] = { ...info.files[0], ...file };
    assert.throws(() => validateZenoUpdateInfo(info, { platform: "win32", arch: "x64" }));
  }
  assert.throws(() => validateZenoUpdateInfo({ ...release(), packages: { x64: { path: "external" } } }, { platform: "win32", arch: "x64" }));
});

test("request guard applies HTTPS feed boundary to redirects and assets", () => {
  const feed = zenoUpdaterFeedUrl("linux", "arm64");
  assert.equal(zenoUpdateRequestAllowed(`${feed}latest-linux-arm64.yml?noCache=123`, feed), true);
  assert.equal(zenoUpdateRequestAllowed(`${feed}zeno-linux-arm64-1.0.1.AppImage`, feed), true);
  for (const url of ["https://github.com/different-ai/openwork/releases/latest", `${feed}../x64/latest-linux.yml`, "http://localhost/update", `${feed}%2fescape`]) {
    assert.equal(zenoUpdateRequestAllowed(url, feed), false);
  }
});

test("disabled/unpackaged and legacy recovery stay inert; subframes cannot check", async () => {
  for (const options of [{ enabled: false }, { packaged: false }]) {
    const h = harness(options);
    assert.equal(await h.ensureAutoUpdater(), null);
    for (const action of ["getChannel", "check", "download", "installAndRestart"]) assert.equal((await h.invoke(action)).supported, false);
    assert.equal(h.counts().loads, 0);
  }
  const h = harness();
  assert.equal((await h.untrusted()).reason, "untrusted-sender");
  for (const action of ["recordHealthy", "list", "use", "restorePrevious"]) assert.equal((await h.recovery(action)).ok, false);
  assert.equal(h.counts().loads, 0);
});

test("checking only offers newer stable versions and never downloads automatically", async () => {
  const h = harness();
  const result = await h.invoke("check", "alpha", "99.0.0");
  assert.equal(result.available, true);
  assert.equal(result.latestVersion, "1.0.1");
  assert.deepEqual(h.feeds, [{ provider: "generic", url: zenoUpdaterFeedUrl("win32", "x64") }]);
  assert.equal(h.updater.autoDownload, false);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.equal(h.updater.allowDowngrade, false);
  assert.equal(h.counts().downloads, 0);
  h.updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { ...release(), version: "0.9.0" } });
  assert.equal((await h.invoke("check")).available, false);
  assert.equal((await h.invoke("download")).reason, "check-required");
});

test("manual download, busy/unknown safety and explicit idle installation", async () => {
  const h = harness();
  assert.equal((await h.invoke("download")).reason, "check-required");
  await h.invoke("check");
  assert.equal((await h.invoke("download")).ok, true);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.equal((await h.invoke("installAndRestart")).reason, "tasks-active");
  assert.equal(h.counts().installs, 0);
  h.setIdle(true);
  assert.equal((await h.invoke("installAndRestart")).ok, true);
  assert.equal((await h.invoke("installAndRestart")).ok, true);
  assert.deepEqual(h.counts(), { loads: 1, downloads: 1, installs: 1 });
});

test("native platform eligibility is required even when the feed has a newer version", async () => {
  const h = harness();
  h.updater.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: release() });
  assert.equal((await h.invoke("check")).available, false);
  assert.equal((await h.invoke("download")).reason, "check-required");
});

test("native installer error events cannot claim a successful restart", async () => {
  const h = harness();
  await h.invoke("check"); await h.invoke("download"); h.setIdle(true);
  h.updater.quitAndInstall = () => h.updater.emit("error", new Error("installer unavailable"));
  assert.equal((await h.invoke("installAndRestart")).reason, "install-failed");
});

test("a failed AppImage install never schedules a relaunch or retains its rename listener", async () => {
  const h = harness({ platform: "linux", appImage: true, appImagePath: "/fixture/Zeno.AppImage" });
  await h.invoke("check"); await h.invoke("download"); h.setIdle(true);
  h.updater.quitAndInstall = () => {
    h.updater.emit("appimage-filename-updated", "/fixture/zeno-linux-x64-1.0.1.AppImage");
    h.updater.emit("error", new Error("install failed"));
    h.updater.quitAndInstallCalled = false;
  };
  assert.equal((await h.invoke("installAndRestart")).reason, "install-failed");
  assert.equal(h.relaunches.length, 0);
  assert.equal(h.updater.listenerCount("appimage-filename-updated"), 0);
});

test("failed check/integrity download can retry without a fallback feed", async () => {
  const h = harness();
  h.updater.checkForUpdates = async () => { throw new Error("offline"); };
  assert.equal((await h.invoke("check")).reason, "check-failed");
  h.updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: release() });
  await h.invoke("check");
  h.updater.downloadUpdate = async () => { throw new Error("sha512 mismatch"); };
  assert.equal((await h.invoke("download")).reason, "download-failed");
  assert.equal((await h.invoke("installAndRestart")).reason, "update-not-downloaded");
  h.updater.downloadUpdate = async () => {};
  assert.equal((await h.invoke("download")).ok, true);
  assert.equal(h.feeds.length, 1);
});

test("macOS ZIP transfer is not readiness; current native signed stage is required", async () => {
  const h = harness({ platform: "darwin", timeout: 1000 });
  await h.invoke("check");
  let done = false;
  const download = h.invoke("download").then((result) => { done = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  h.native.emit("update-downloaded", null, null, null, null, "http://127.0.0.1:9999/old.zip");
  assert.equal(done, false);
  h.native.emit("update-downloaded", null, null, null, null, "http://127.0.0.1:43111/current.zip");
  assert.equal((await download).ok, true);
  assert.equal(h.updater.autoInstallOnAppQuit, false);
});

test("macOS signature/native stage failure cannot install or claim success", async () => {
  const h = harness({ platform: "darwin", timeout: 5 });
  await h.invoke("check");
  assert.equal((await h.invoke("download")).ok, false);
  h.setIdle(true);
  assert.equal((await h.invoke("installAndRestart")).reason, "update-not-downloaded");
});

test("both engines must explicitly report idle with no waits", () => {
  assert.equal(zenoEnginesIdle({ v1: idle, v2: null }), true);
  assert.equal(zenoEnginesIdle({ v1: idle, v2: idle }), true);
  for (const activity of [null, {}, { v1: idle }, { v1: { ...idle, verdict: "unknown" }, v2: null },
    { v1: idle, v2: { ...idle, waitingRequests: 1 } }, { v1: { ...idle, busySessions: 1 }, v2: null }]) {
    assert.equal(zenoEnginesIdle(activity), false);
  }
});

test("native install probe uses trusted loopback/client auth and rejects redirects/offline/unknown", async () => {
  const requests = [];
  const getLocalRuntime = async () => ({ baseUrl: "http://127.0.0.1:8778", token: "fixture-client-token" });
  const guard = createZenoInstallGuard({ getLocalRuntime, fetchImpl: async (url, init) => {
    requests.push({ url, init }); return { ok: true, json: async () => ({ v1: idle, v2: null }) };
  } });
  assert.equal(await guard(), true);
  assert.equal(requests[0].url, "http://127.0.0.1:8778/experimental/engine-v2-preview/activity");
  assert.equal(requests[0].init.headers.Authorization, "Bearer fixture-client-token");
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(await createZenoInstallGuard({ getLocalRuntime, fetchImpl: async () => { throw new Error("offline"); } })(), false);
  assert.equal(await createZenoInstallGuard({ getLocalRuntime: async () => ({ baseUrl: "https://external.example", token: "fixture" }),
    fetchImpl: async () => { throw new Error("must not fetch external runtime"); } })(), false);
});
