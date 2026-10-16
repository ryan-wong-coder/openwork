import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setClientProfileBootstrap } from "../src/app/lib/client-profile";
import { currentLocale, setLocale, t } from "../src/i18n";
import { useElectronUpdaterState } from "../src/react-app/domains/settings/state/electron-updater-state";

const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });
const { createRoot } = await import("react-dom/client");
const { GeneralSettingsView } = await import("../src/react-app/domains/settings/pages/general-view");
const { LocalLibraryActions } = await import("../src/react-app/domains/settings/pages/local-library-actions");
const { getGlobalSettingsTabs } = await import("../src/react-app/domains/settings/shell/settings-page");
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let previousAct: unknown;
let previousLocale: ReturnType<typeof currentLocale>;

beforeEach(() => {
  previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  previousLocale = currentLocale();
  setLocale("en");
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  Reflect.deleteProperty(window, "__OPENWORK_ELECTRON__");
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  setLocale(previousLocale);
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
});

test("self-managed settings replace official account, support and update entries with local version information", () => {
  const html = renderToStaticMarkup(createElement(GeneralSettingsView, {
    appVersion: "1.0.0", developerMode: false, onNavigateTab: () => {},
    onSendFeedback: () => {}, onJoinDiscord: () => {}, onReportIssue: () => {},
  }));
  expect(html).toContain('data-testid="self-managed-about"');
  expect(html).toContain("1.0.0");
  expect(html).not.toContain(t("settings.send_feedback"));
  expect(html).not.toContain(t("settings.join_discord"));
  expect(html).not.toContain(t("settings.report_issue"));
  expect(html).not.toContain(t("settings.tab_updates"));
  expect(getGlobalSettingsTabs(true, { autoUpdate: true })).not.toContain("updates");
  expect(getGlobalSettingsTabs(true, { autoUpdate: true })).not.toContain("cloud-account");
});

test("self-managed updater never contacts a feed or changes its channel, including direct requests", async () => {
  const calls: string[] = [];
  Reflect.set(window, "__OPENWORK_ELECTRON__", { updater: {
    getChannel: async () => { calls.push("channel"); return { channel: "stable", currentVersion: "1.0.0" }; },
    setChannel: async () => { calls.push("set-channel"); return { channel: "stable", currentVersion: "1.0.0" }; },
    check: async () => { calls.push("check"); return { available: false, currentVersion: "1.0.0" }; },
    download: async () => { calls.push("download"); return { ok: true }; },
    installAndRestart: async () => { calls.push("install"); return { ok: true }; },
  } });
  let updater: ReturnType<typeof useElectronUpdaterState> | null = null;
  const releaseChange = () => { calls.push("preference"); };
  const refreshConfig = async () => { calls.push("policy"); return {}; };
  const setError = () => { calls.push("error"); };
  function Harness() {
    updater = useElectronUpdaterState({ releaseChannel: "stable", onReleaseChannelChange: releaseChange,
      updateAutoCheck: true, updateAutoDownload: true, allowedVersionsKnown: true,
      desktopConfig: {}, refreshDesktopConfig: refreshConfig, setError });
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
  expect(updater).not.toBeNull();
  await act(async () => {
    await updater?.checkForUpdates(); await updater?.downloadUpdate();
    await updater?.installUpdateAndRestart(); await updater?.setReleaseChannel("alpha");
  });
  expect(calls).toEqual([]);
});

test("the local add menu offers workspace connections and own imports without cloud account actions", async () => {
  const input = createRef<HTMLInputElement>(); const selections: string[] = [];
  await act(async () => root.render(createElement(LocalLibraryActions, {
    disabled: false, skillFileInput: input,
    onAddMcp: () => { selections.push("mcp"); },
    onInstallPlugin: () => { selections.push("plugin"); },
    onImportSkillText: async () => {}, onImportError: () => {},
  })));
  const trigger = host.querySelector("button");
  if (!trigger) throw new Error("Local add menu is absent");
  await act(async () => { trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
  const items = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];
  expect(items.map((item) => item.textContent)).toEqual([
    t("extensions.add_workspace_mcp"), t("zeno.library.import_skill"), t("zeno.library.install_plugin"),
  ]);
  await act(async () => items[2]?.click());
  expect(selections).toEqual(["plugin"]);
});

test("a local Markdown import sends only the selected file to the existing workspace handler", async () => {
  const input = createRef<HTMLInputElement>();
  const imports: Array<{ content: string; name: string }> = [];
  const errors: Array<string | null> = [];
  await act(async () => root.render(createElement(LocalLibraryActions, {
    disabled: false, skillFileInput: input, onAddMcp: () => {}, onInstallPlugin: () => {},
    onImportError: (message) => { errors.push(message); },
    onImportSkillText: async (content, name) => { imports.push({ content, name }); },
  })));
  if (!input.current) throw new Error("Local Markdown import is absent");
  const content = "---\nname: fixture-skill\ndescription: Fixture instruction\n---\nKeep output concise.\n";
  Object.defineProperty(input.current, "files", { configurable: true, value: [new File([content], "SKILL.md", { type: "text/markdown" })] });
  await act(async () => { input.current?.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(imports).toEqual([{ content, name: "SKILL.md" }]);
  expect(errors).toEqual([null]);
});

test("invalid or policy-disabled local skill imports do not reach the workspace writer", async () => {
  const input = createRef<HTMLInputElement>(); let writes = 0; const errors: Array<string | null> = [];
  const props = { disabled: false, skillFileInput: input, onAddMcp: () => {},
    onImportError: (message: string | null) => { errors.push(message); },
    onImportSkillText: async () => { writes += 1; } };
  await act(async () => root.render(createElement(LocalLibraryActions, props)));
  if (!input.current) throw new Error("Local Markdown import is absent");
  Object.defineProperty(input.current, "files", { configurable: true, value: [new File(["fixture"], "file.json")] });
  await act(async () => { input.current?.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(writes).toBe(0); expect(errors).toEqual([t("zeno.library.invalid_skill_file")]);
  await act(async () => root.render(createElement(LocalLibraryActions, { ...props, disabled: true })));
  Object.defineProperty(input.current, "files", { configurable: true, value: [new File(["fixture"], "SKILL.md")] });
  await act(async () => { input.current?.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(writes).toBe(0);
});
