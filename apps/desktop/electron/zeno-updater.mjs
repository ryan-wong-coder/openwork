import { compareStableVersions, stableVersion } from "./recovery.mjs";
import path from "node:path";

export const ZENO_RELEASE_ORIGIN = "https://www.zeno.ryan-wong.cn";

export function zenoUpdaterFeedUrl(platform, arch) {
  if (!["darwin", "win32", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) return null;
  return `${ZENO_RELEASE_ORIGIN}/updates/${platform}/${arch}/`;
}

export function zenoUpdateRequestAllowed(value, feedUrl) {
  try {
    const url = new URL(value);
    return url.origin === ZENO_RELEASE_ORIGIN && url.href.startsWith(feedUrl)
      && !url.username && !url.password && !url.hash && !/%2f|%5c|%2e/i.test(url.pathname);
  } catch { return false; }
}

export function zenoEnginesIdle(activity) {
  const idle = (engine) => engine?.verdict === "idle" && engine.busySessions === 0 && engine.waitingRequests === 0;
  return idle(activity?.v1) && (activity.v2 === null || idle(activity.v2));
}

/** Probe only the trusted embedded runtime; unreadable activity never proves idle. */
export function createZenoInstallGuard({ getLocalRuntime, fetchImpl = fetch }) {
  return async () => {
    try {
      const runtime = await getLocalRuntime();
      const base = new URL(runtime?.baseUrl);
      if (!runtime?.token || base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
        || base.username || base.password) return false;
      const url = `${base.href.replace(/\/$/, "")}/experimental/engine-v2-preview/activity`;
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${runtime.token}` }, redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      return response.ok && zenoEnginesIdle(await response.json());
    } catch { return false; }
  };
}

/** Validate the exact metadata held by electron-updater before it may download. */
export function validateZenoUpdateInfo(info, { platform, arch, extension }) {
  const feed = zenoUpdaterFeedUrl(platform, arch);
  if (!feed || !stableVersion(info?.version) || !Array.isArray(info.files) || info.files.length === 0) {
    throw new Error("invalid-release");
  }
  if (info.packages && Object.keys(info.packages).length > 0) throw new Error("invalid-release");
  const files = info.files.map((file) => {
    if (typeof file?.url !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 ?? "")
      || !Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("invalid-release");
    const url = new URL(file.url, feed);
    if (url.origin !== ZENO_RELEASE_ORIGIN || !url.href.startsWith(feed) || url.username || url.password
      || url.search || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) throw new Error("invalid-release");
    const filename = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    if (!filename.startsWith("zeno-") || (!filename.includes(`-${arch}-`)
      && !(platform === "darwin" && filename.includes("-universal-")))) throw new Error("invalid-architecture");
    return { ...file, filename };
  });
  if (info.path && !files.some((file) => new URL(file.url, feed).href === new URL(info.path, feed).href)) {
    throw new Error("invalid-release");
  }
  const suffix = extension ?? (platform === "darwin" ? ".zip" : platform === "win32" ? ".exe" : ".AppImage");
  const artifact = files.find((file) => file.filename.toLowerCase().endsWith(suffix.toLowerCase()));
  if (!artifact) throw new Error("invalid-release");
  return { version: info.version, totalBytes: artifact.size };
}

/**
 * Independent distribution only. No channel preferences, Den inventory, GitHub
 * recovery, eval feed overrides, or external installer commands are consulted.
 */
export function registerZenoUpdaterIpc({
  app,
  enabled = false,
  releaseSigning = "unsigned",
  ipcMain,
  getMainWindow,
  loadAutoUpdater = () => import("electron-updater"),
  platform = process.platform,
  arch = process.arch,
  canInstall = async () => false,
  protectUpdateRequests = (_feedUrl) => {},
  appImagePath = process.env.APPIMAGE,
  relaunchArgs = process.argv.slice(1),
  nativeStagingTimeoutMs = 120_000,
}) {
  const feedUrl = zenoUpdaterFeedUrl(platform, arch);
  const supported = Boolean(enabled && app.isPackaged && feedUrl);
  let updaterPromise = null;
  let checked = null;
  let stagedVersion = null;
  let installing = false;
  let operation = Promise.resolve();
  const state = () => ({
    product: "zeno", channel: "stable", supportsAlpha: false, supported,
    currentVersion: app.getVersion(), feedUrl: feedUrl ?? "", releaseSigning,
    ...(!supported ? { reason: "unavailable" } : {}),
  });
  const fromMainFrame = (event) => {
    const win = getMainWindow();
    return Boolean(win && !win.isDestroyed() && event?.sender === win.webContents
      && event.senderFrame === win.webContents.mainFrame);
  };
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => {
    if (!fromMainFrame(event)) return { ok: false, available: false, reason: "untrusted-sender" };
    const next = operation.then(() => fn(...args));
    operation = next.then(() => undefined, () => undefined);
    return next;
  });
  const unavailable = () => ({ ok: false, available: false, ...state(), reason: "unavailable" });

  async function ensureAutoUpdater() {
    if (!supported) return null;
    if (!updaterPromise) updaterPromise = (async () => {
      protectUpdateRequests(feedUrl);
      const loaded = await loadAutoUpdater();
      const updater = loaded.autoUpdater ?? loaded.default?.autoUpdater;
      if (!updater) throw new Error("unavailable");
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.autoRunAppAfterInstall = true;
      updater.allowDowngrade = false;
      updater.allowPrerelease = false;
      updater.disableDifferentialDownload = true;
      updater.setFeedURL({ provider: "generic", url: feedUrl });
      updater.on("error", () => {
        // quitAndInstall returns void; late native/spawn failures arrive here.
        if (!installing) return;
        installing = false;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send("openwork:updater:install-error");
      });
      updater.on("download-progress", (progress) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send("openwork:updater:download-progress", {
          transferred: progress.transferred, total: progress.total,
          percent: progress.percent, bytesPerSecond: progress.bytesPerSecond,
        });
      });
      return updater;
    })().catch((error) => { updaterPromise = null; throw error; });
    return updaterPromise;
  }

  function validate(info, updater) {
    const extension = platform === "linux"
      ? ({ DebUpdater: ".deb", RpmUpdater: ".rpm", PacmanUpdater: ".pacman", AppImageUpdater: ".AppImage" })[updater.constructor.name]
      : undefined;
    return validateZenoUpdateInfo(info, { platform, arch, extension });
  }

  handle("openwork:updater:getChannel", state);
  handle("openwork:updater:setChannel", state);
  handle("openwork:updater:check", async () => {
    if (!supported) return unavailable();
    if (stagedVersion) return { ...state(), available: true, latestVersion: stagedVersion, stagedVersion };
    try {
      const updater = await ensureAutoUpdater();
      const result = await updater.checkForUpdates();
      const release = validate(result?.updateInfo, updater);
      const available = result.isUpdateAvailable === true && compareStableVersions(release.version, app.getVersion()) > 0;
      checked = available ? { ...release, info: result.updateInfo } : null;
      return { ...state(), available, latestVersion: release.version, totalBytes: release.totalBytes,
        releaseDate: result.updateInfo.releaseDate ?? null };
    } catch {
      checked = null;
      return { ...state(), available: false, reason: "check-failed" };
    }
  });

  handle("openwork:updater:download", async () => {
    if (!supported) return unavailable();
    if (stagedVersion) return { ok: true, version: stagedVersion };
    if (!checked) return { ok: false, reason: "check-required" };
    try {
      const updater = await ensureAutoUpdater();
      validate(checked.info, updater);
      // Never arm install-on-quit: neither closing the app during a transfer nor
      // a failed readiness check may restart an active task.
      updater.autoInstallOnAppQuit = false;
      await updater.downloadUpdate(); // electron-updater verifies the manifest SHA-512.
      if (platform === "darwin") {
        const native = updater.nativeUpdater;
        const nativeFeed = native?.getFeedURL();
        if (!nativeFeed || !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(nativeFeed)) throw new Error("native-stage-unavailable");
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error("native-stage-timeout")), nativeStagingTimeoutMs);
          function finish(error = null) {
            clearTimeout(timer);
            native.removeListener("update-downloaded", onDownloaded);
            native.removeListener("error", onError);
            if (error) reject(error); else resolve(undefined);
          }
          function onDownloaded(_event, _notes, _name, _date, url) {
            if (typeof url === "string" && url.startsWith(`${nativeFeed.replace(/\/$/, "")}/`)) finish();
          }
          function onError(error) { finish(error); }
          native.on("update-downloaded", onDownloaded);
          native.on("error", onError);
          try { native.checkForUpdates(); } catch (error) { finish(error); }
        });
      }
      stagedVersion = checked.version;
      return { ok: true, version: stagedVersion };
    } catch {
      return { ok: false, reason: "download-failed" };
    }
  });

  handle("openwork:updater:installAndRestart", async () => {
    if (!supported) return unavailable();
    if (!stagedVersion) return { ok: false, reason: "update-not-downloaded" };
    if (installing) return { ok: true };
    try {
      if (await canInstall() !== true) return { ok: false, reason: "tasks-active" };
      const updater = await ensureAutoUpdater();
      const appImage = platform === "linux" && updater.constructor.name === "AppImageUpdater";
      let installedAppImagePath = appImagePath;
      const renamed = (filename) => {
        if (typeof filename !== "string" || !path.isAbsolute(filename)) throw new Error("invalid-appimage-path");
        installedAppImagePath = filename;
      };
      if (appImage) {
        if (!appImagePath || !path.isAbsolute(appImagePath) || typeof app.relaunch !== "function") throw new Error("appimage-relaunch-unavailable");
        // 6.8.3 otherwise spawns the new AppImage before quitting, while this
        // process still owns the single-instance lock and stops its runtime.
        // AppRun honours EXIT_AFTER_INSTALL, so the native replacement can
        // finish without launching Electron. app.relaunch waits for our exit.
        updater.autoRunAppAfterInstall = false;
        updater.on("appimage-filename-updated", renamed);
      }
      installing = true;
      try {
        updater.quitAndInstall(false, true);
        if (!installing || (platform !== "darwin" && updater.quitAndInstallCalled === false)) throw new Error("install-failed");
        if (appImage) app.relaunch({ execPath: installedAppImagePath, args: relaunchArgs });
      } finally {
        if (appImage) updater.removeListener("appimage-filename-updated", renamed);
      }
      return { ok: true };
    } catch {
      installing = false;
      return { ok: false, reason: "install-failed" };
    }
  });

  // Legacy recovery has an upstream release inventory and must remain inert.
  for (const name of ["recordHealthy", "list", "use", "restorePrevious", "evalSnapshot"]) {
    handle(`openwork:recovery:${name}`, () => ({ ok: false, releases: [], reason: "unavailable" }));
  }
  return { ensureAutoUpdater };
}
