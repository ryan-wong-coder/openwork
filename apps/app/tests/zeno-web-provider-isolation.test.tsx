import { afterAll, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { setClientProfileBootstrap } from "../src/app/lib/client-profile";
import { initAnalytics, isAnalyticsEnabled } from "../src/app/lib/analytics";
import { deepLinkBridgeEvent } from "../src/app/lib/deep-link-bridge";
import { denSessionUpdatedEvent, denSettingsChangedEvent } from "../src/app/lib/den-session-events";
import { DenAuthProvider, useDenAuth } from "../src/react-app/domains/cloud/den-auth-provider";
import { DesktopConfigProvider, useDesktopConfig } from "../src/react-app/domains/cloud/desktop-config-provider";
import { OpenWorkWebAccessGate } from "../src/react-app/domains/cloud/openwork-web-access-gate";
import { CloudWorkspaceStatusProvider } from "../src/react-app/shell/cloud-workspace-overlay";

GlobalRegistrator.register({ url: "https://zeno.example.test/" });
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(async () => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct); await GlobalRegistrator.unregister(); });

test("default self-deployed Web mounts chat without official account restore, access checks, or retries", async () => {
  const previous = { deployment: process.env.VITE_OPENWORK_DEPLOYMENT, profile: process.env.VITE_OPENWORK_CLIENT_PROFILE, signin: process.env.VITE_DEN_REQUIRE_SIGNIN };
  process.env.VITE_OPENWORK_DEPLOYMENT = "web";
  delete process.env.VITE_OPENWORK_CLIENT_PROFILE;
  delete process.env.VITE_DEN_REQUIRE_SIGNIN;
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  Reflect.set(window, "__OPENWORK_GATEWAY__", { version: 1 });
  localStorage.setItem("openwork.den.authToken", "retained-test-token");
  localStorage.setItem("openwork.den.activeOrgId", "retained-org");
  const fetched = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
  const intervals = spyOn(window, "setInterval");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let refresh: (() => Promise<void>) | undefined;
  function Observe() {
    const auth = useDenAuth();
    const config = useDesktopConfig();
    refresh = auth.refresh;
    return <div data-auth={auth.status} data-policy={config.freshConfigStatus}>Standalone chat</div>;
  }
  try {
    await act(async () => root.render(<DenAuthProvider><DesktopConfigProvider><OpenWorkWebAccessGate>
      <CloudWorkspaceStatusProvider><Observe /></CloudWorkspaceStatusProvider>
    </OpenWorkWebAccessGate></DesktopConfigProvider></DenAuthProvider>));
    await act(async () => {
      initAnalytics();
      await refresh?.();
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new CustomEvent(denSessionUpdatedEvent, { detail: { status: "success" } }));
      window.dispatchEvent(new CustomEvent(denSettingsChangedEvent, { detail: {} }));
      window.dispatchEvent(new CustomEvent(deepLinkBridgeEvent, { detail: { urls: ["openwork://den-auth?grant=fixture&denBaseUrl=https%3A%2F%2Fcontrol.example.test"] } }));
    });
    expect(host.textContent).toBe("Standalone chat");
    expect(host.querySelector("[data-auth]")?.getAttribute("data-auth")).toBe("signed_out");
    expect(host.querySelector("[data-policy]")?.getAttribute("data-policy")).toBe("ready");
    expect(fetched).not.toHaveBeenCalled();
    expect(isAnalyticsEnabled()).toBe(false);
    expect(intervals).not.toHaveBeenCalled();
    expect(localStorage.getItem("openwork.den.authToken")).toBe("retained-test-token");
  } finally {
    await act(async () => root.unmount()); host.remove();
    fetched.mockRestore(); intervals.mockRestore(); localStorage.clear();
    Reflect.deleteProperty(window, "__OPENWORK_GATEWAY__");
    for (const [key, value] of Object.entries({ VITE_OPENWORK_DEPLOYMENT: previous.deployment, VITE_OPENWORK_CLIENT_PROFILE: previous.profile, VITE_DEN_REQUIRE_SIGNIN: previous.signin })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
