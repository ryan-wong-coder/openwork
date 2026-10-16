import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { setClientProfileBootstrap } from "../src/app/lib/client-profile";
import * as zenoIdentity from "../src/app/lib/zeno-identity";
import { currentLocale, setLocale, t } from "../src/i18n";

const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });
const { createRoot } = await import("react-dom/client");
const { PreferencesView } = await import("../src/react-app/domains/settings/pages/preferences-view");

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let previousAct: unknown;
let previousLocale: ReturnType<typeof currentLocale>;
let originalPreferences: string | null;
let toggleCalls: number;
let restoreZeno: (() => void) | undefined;
const savedPreferences = JSON.stringify({ analyticsEnabled: true, showThinking: true });

beforeEach(() => {
  previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  previousLocale = currentLocale();
  setLocale("en");
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  originalPreferences = localStorage.getItem("openwork.preferences");
  localStorage.setItem("openwork.preferences", savedPreferences);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  toggleCalls = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  restoreZeno?.();
  restoreZeno = undefined;
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  setLocale(previousLocale);
  if (originalPreferences === null) localStorage.removeItem("openwork.preferences");
  else localStorage.setItem("openwork.preferences", originalPreferences);
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
});

async function renderPreferences() {
  await act(async () => root.render(createElement(PreferencesView, {
    busy: false,
    showThinking: false,
    onToggleShowThinking: () => {},
    autoCompactContext: true,
    autoCompactContextBusy: false,
    onToggleAutoCompactContext: () => {},
    analyticsEnabled: true,
    onToggleAnalytics: () => { toggleCalls += 1; },
    desktopNotifications: "off",
    onDesktopNotificationsChange: () => {},
    linkOpenDestination: "openwork",
    onLinkOpenDestinationChange: () => {},
  })));
  const control = [...host.querySelectorAll<HTMLElement>("[role=switch]")]
    .find((element) => element.getAttribute("aria-label") === t("settings.analytics_toggle"));
  if (!control) throw new Error("Analytics preference switch is absent");
  return control;
}

test("local analytics stays visibly off and cannot change a saved enabled preference", async () => {
  const control = await renderPreferences();
  expect(control.getAttribute("aria-checked")).toBe("false");
  expect(control.getAttribute("aria-disabled")).toBe("true");
  expect(host.textContent).toContain(t("zeno.settings.analytics_local_disabled"));
  await act(async () => control.click());
  expect(toggleCalls).toBe(0);
  expect(localStorage.getItem("openwork.preferences")).toBe(savedPreferences);

  const help = [...host.querySelectorAll<HTMLButtonElement>(".zeno-settings-help")]
    .find((element) => element.getAttribute("aria-label")?.startsWith(t("settings.analytics_toggle")));
  if (!help) throw new Error("Privacy collection details are absent");
  await act(async () => help.click());
  expect(document.querySelector("[data-slot=popover-content]")?.textContent).toContain(t("settings.analytics_toggle_desc"));
});

test("local analytics stays off when the Zeno interface is disabled", async () => {
  const spy = spyOn(zenoIdentity, "isZenoInterfaceEnabled").mockReturnValue(false);
  restoreZeno = () => spy.mockRestore();
  const control = await renderPreferences();
  expect(control.getAttribute("aria-checked")).toBe("false");
  expect(control.getAttribute("aria-disabled")).toBe("true");
  await act(async () => control.click());
  expect(toggleCalls).toBe(0);
  expect(host.textContent).toContain(t("settings.analytics_toggle_desc"));
  expect(localStorage.getItem("openwork.preferences")).toBe(savedPreferences);
});

test("connected installs retain the saved analytics state and working toggle", async () => {
  setClientProfileBootstrap({ requireSignin: true });
  const control = await renderPreferences();
  expect(control.getAttribute("aria-checked")).toBe("true");
  expect(control.getAttribute("aria-disabled")).not.toBe("true");
  expect(host.textContent).not.toContain(t("zeno.settings.analytics_local_disabled"));
  await act(async () => control.click());
  expect(toggleCalls).toBe(1);
  expect(localStorage.getItem("openwork.preferences")).toBe(savedPreferences);
});
