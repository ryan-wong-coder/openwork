import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { setClientProfileBootstrap } from "../src/app/lib/client-profile";
import * as localFeatures from "../src/app/lib/local-client-features";
import { isZenoAboutEnabled } from "../src/app/lib/zeno-about";
import { isSettingsTabAllowed } from "../src/app/cloud/desktop-app-restrictions";
import { SETTINGS_TAB_VALUES } from "../src/app/types";
import { currentLocale, setLocale, t } from "../src/i18n";
import { parseSettingsPath } from "../src/react-app/shell/settings-path";

const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });
const { createRoot } = await import("react-dom/client");
const { AboutView } = await import("../src/react-app/domains/settings/pages/about-view");
const { GeneralSettingsView } = await import("../src/react-app/domains/settings/pages/general-view");
const { getGlobalSettingsTabs, getSettingsTabLabel } = await import("../src/react-app/domains/settings/shell/settings-page");
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let previousAct: unknown;
let previousLocale: ReturnType<typeof currentLocale>;
let restoreFeature: (() => void) | undefined;

beforeEach(() => {
  previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  previousLocale = currentLocale(); setLocale("zh");
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  restoreFeature?.(); restoreFeature = undefined;
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  setLocale(previousLocale); Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
});

const tabs = () => getGlobalSettingsTabs(false, { autoUpdate: true });
const allowed = () => isSettingsTabAllowed({ tab: "about", checkRestriction: () => false });
async function renderAbout() { await act(async () => root.render(createElement(AboutView, { appVersion: "1.2.3" }))); }

function disableAbout() {
  const featureSpy = spyOn(localFeatures, "localClientFeatureEnabled").mockImplementation(key => key !== "zenoAbout");
  restoreFeature = () => featureSpy.mockRestore();
}

test("the local about page includes the birthday note, authorized signature and complete upstream MIT notice", async () => {
  await renderAbout();
  expect(host.querySelector('[data-testid="zeno-about"]')).not.toBeNull();
  expect(host.textContent).toContain("生日快乐。愿你始终保有好奇与热爱");
  expect(host.textContent).toContain("愿泽诺陪你把灵感变成现实");
  expect(host.querySelector("[data-about-signature]")?.textContent).toBe("王思源");
  expect(host.textContent).toContain("基于 OpenWork 改造");
  expect(host.textContent).toContain("1.2.3");
  expect(host.textContent).toContain("Copyright (c) 2026-present Different AI, Inc.");
  expect(host.textContent).toContain("Copyright (c) 2026 Different AI");
  expect(host.textContent).toContain("MIT License");
  expect(host.textContent).toContain("Permission is hereby granted, free of charge");
  expect(host.textContent).toContain("THE SOFTWARE IS PROVIDED");
  expect(host.textContent).toContain("/ee 目录适用其独立许可证");
  expect(host.querySelector("details")?.open).toBe(false);
  expect(host.querySelectorAll("img").length).toBeGreaterThan(0);
});

test("navigation and direct workspace/global routes reach the local about page", () => {
  expect(isZenoAboutEnabled()).toBe(true);
  expect(SETTINGS_TAB_VALUES).toContain("about");
  expect(tabs()).toContain("about");
  expect(getSettingsTabLabel("about")).toBe("关于泽诺");
  expect(parseSettingsPath("/settings/about")).toEqual({ tab: "about", redirectPath: null });
  expect(parseSettingsPath("/workspace/fixture-workspace/settings/about")).toEqual({ tab: "about", redirectPath: null });
  expect(allowed()).toBe(true);
  expect(isSettingsTabAllowed({ tab: "about", checkRestriction: () => true })).toBe(true);
  expect(parseSettingsPath("/settings/ai")).toEqual({ tab: "ai", redirectPath: null });
});

test("turning the feature off removes the entry and safely redirects direct routes", async () => {
  disableAbout();
  expect(isZenoAboutEnabled()).toBe(false);
  expect(tabs()).not.toContain("about");
  expect(allowed()).toBe(false);
  expect(parseSettingsPath("/settings/about")).toEqual({ tab: "general", redirectPath: "general" });
  await renderAbout();
  expect(host.textContent).toBe("");
  await act(async () => root.render(createElement(GeneralSettingsView, {
    appVersion: "1.2.3", developerMode: false, onNavigateTab: () => {},
    onSendFeedback: () => {}, onJoinDiscord: () => {}, onReportIssue: () => {},
  })));
  expect(host.querySelector('[data-testid="self-managed-about"]')?.textContent).toContain(t("updates.current_version"));
  expect(host.textContent).toContain("1.2.3");
  expect([...host.querySelectorAll("button")].some(e => e.textContent?.includes("关于泽诺"))).toBe(false);
});

test("connected installations never expose the personal page even if the feature helper returns true", async () => {
  setClientProfileBootstrap({ requireSignin: true });
  const featureSpy = spyOn(localFeatures, "localClientFeatureEnabled").mockReturnValue(true);
  restoreFeature = () => featureSpy.mockRestore();
  expect(isZenoAboutEnabled()).toBe(false);
  expect(tabs()).not.toContain("about");
  expect(allowed()).toBe(false);
  expect(parseSettingsPath("/workspace/fixture-workspace/settings/about")).toEqual({ tab: "general", redirectPath: "general" });
  await renderAbout();
  expect(host.textContent).toBe("");
});

test("the settings overview opens the real about route without official support actions", async () => {
  const navigated: string[] = [];
  const supportCalls: string[] = [];
  await act(async () => root.render(createElement(GeneralSettingsView, {
    appVersion: "1.2.3", developerMode: false, onNavigateTab: tab => { navigated.push(tab); },
    onSendFeedback: () => { supportCalls.push("feedback"); }, onJoinDiscord: () => { supportCalls.push("discord"); }, onReportIssue: () => { supportCalls.push("issue"); },
  })));
  const about = [...host.querySelectorAll("button")].find(e => e.textContent?.includes("关于泽诺"));
  expect(about).toBeDefined();
  await act(async () => about?.click());
  expect(navigated).toEqual(["about"]);
  expect(supportCalls).toEqual([]);
  expect(host.textContent).not.toContain("生日快乐");
});

test("about content is static and contains no official links, embeds or automatic connections", async () => {
  let requests = 0;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => { requests += 1; throw new Error("Unexpected about-page network request"); });
  try {
    await renderAbout();
    expect(requests).toBe(0);
    expect(host.querySelectorAll("a[href], iframe, script, form").length).toBe(0);
    expect([...host.querySelectorAll("img")].some(img => /^https?:\/\//.test(img.getAttribute("src") ?? ""))).toBe(false);
  } finally { fetchSpy.mockRestore(); }
});

test("the English locale preserves the signature and attribution without missing translations", async () => {
  setLocale("en"); await renderAbout();
  expect(host.textContent).toContain("Happy birthday.");
  expect(host.textContent).toContain("Adapted from OpenWork");
  expect(host.querySelector("[data-about-signature]")?.textContent).toBe("王思源");
  expect(host.textContent).not.toContain("zeno.about.");
});
