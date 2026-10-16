import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { registerZenoUpdaterIpc } from "../electron/zeno-updater.mjs";

const require = createRequire(import.meta.url);
const { AppImageUpdater } = require("electron-updater/out/AppImageUpdater.js");
const builderRequire = createRequire(require.resolve("electron-builder"));
const { generateAppRunScript } = builderRequire("app-builder-lib/out/targets/appimage/appImageUtil.js");

// Exercise the installed 6.8.3 installer and builder 26.15.3 AppRun. Only the
// Electron host is substituted: no GUI, downloaded binary, sudo, or real app is run.
for (const renamed of [true, false]) test(`AppImage waits for old-process exit before relaunch (${renamed ? "versioned" : "custom"} filename)`, { skip: process.platform === "win32" }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "zeno-appimage-update-"));
  const oldPath = path.join(directory, renamed ? "zeno-linux-x64-1.0.0.AppImage" : "Zeno.AppImage");
  const cache = path.join(directory, "cache"); mkdirSync(cache);
  const installerPath = path.join(cache, "zeno-linux-x64-1.0.1.AppImage");
  const destination = renamed ? path.join(directory, path.basename(installerPath)) : oldPath;
  const ranElectron = path.join(directory, "electron-started");
  const savedEnvironment = { APPIMAGE: process.env.APPIMAGE, APPDIR: process.env.APPDIR };
  process.env.APPIMAGE = oldPath; process.env.APPDIR = directory;
  const electronId = require.resolve("electron");
  const savedElectron = require("electron");
  const native = new EventEmitter();
  require.cache[electronId].exports = { autoUpdater: native };
  const order = [];
  try {
    writeFileSync(oldPath, "old AppImage", { mode: 0o755 });
    writeFileSync(path.join(directory, "fixture-executable"), `#!/usr/bin/env bash\nprintf launched > '${ranElectron}'\n`, { mode: 0o755 });
    writeFileSync(installerPath, generateAppRunScript({ ExecutableName: "fixture-executable", DesktopFileName: "fixture.desktop",
      ProductFilename: "Zeno", ProductName: "Zeno", ResourceName: "zeno" }), { mode: 0o755 });
    const updater = new AppImageUpdater(undefined, {
      version: "1.0.0", name: "Zeno", isPackaged: true, whenReady: async () => {},
      quit: () => order.push("quit-requested"), relaunch: () => { throw new Error("Do not use the adapter's old executable"); },
      userDataPath: directory, baseCachePath: directory, appUpdateConfigPath: path.join(directory, "app-update.yml"),
    });
    updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
    const info = { version: "1.0.1", files: [{ url: "zeno-linux-x64-1.0.1.AppImage", sha512: Buffer.alloc(64, 1).toString("base64"), size: 1024 }] };
    updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: info });
    updater.downloadUpdate = async () => {
      updater.downloadedUpdateHelper = { file: installerPath, downloadedFileInfo: { isAdminRightsRequired: false } };
      return [installerPath];
    };
    updater.spawnLog = async () => { assert.fail("A new Electron process must not start before the old one exits"); };
    const handlers = new Map();
    const webContents = { mainFrame: {}, send() {} };
    let relaunchOptions;
    registerZenoUpdaterIpc({
      app: { isPackaged: true, getVersion: () => "1.0.0", relaunch: (options) => { relaunchOptions = options; order.push("relaunch-scheduled"); } },
      enabled: true, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      getMainWindow: () => ({ webContents, isDestroyed: () => false }), loadAutoUpdater: async () => ({ autoUpdater: updater }),
      platform: "linux", arch: "x64", appImagePath: oldPath, relaunchArgs: ["--no-sandbox"], canInstall: async () => true,
    });
    const invoke = (action) => handlers.get(`openwork:updater:${action}`)({ sender: webContents, senderFrame: webContents.mainFrame });
    assert.equal((await invoke("check")).available, true);
    assert.equal((await invoke("download")).ok, true);
    assert.equal((await invoke("installAndRestart")).ok, true);
    assert.equal(updater.autoRunAppAfterInstall, false);
    assert.equal(updater.quitAndInstallCalled, true);
    assert.equal(existsSync(ranElectron), false, "AppRun must honour APPIMAGE_EXIT_AFTER_INSTALL");
    assert.ok(readFileSync(destination, "utf8").includes("APPIMAGE_EXIT_AFTER_INSTALL"));
    assert.deepEqual(relaunchOptions, { execPath: destination, args: ["--no-sandbox"] });
    assert.deepEqual(order, ["relaunch-scheduled"]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["relaunch-scheduled", "quit-requested"]);
    assert.equal(updater.listenerCount("appimage-filename-updated"), 0);
  } finally {
    require.cache[electronId].exports = savedElectron;
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
