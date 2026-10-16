import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { isLocalGatewayClient, setClientProfileBootstrap } from "../src/app/lib/client-profile";
import { createDenClient, initializeDenBootstrapConfig, readDenSettings, writeDenSettings } from "../src/app/lib/den";

describe("local client control-plane isolation", () => {
  let ownedDom = false;
  let previousBridge: typeof window.__OPENWORK_ELECTRON__;

  beforeEach(() => {
    ownedDom = typeof window === "undefined";
    if (ownedDom) GlobalRegistrator.register();
    previousBridge = window.__OPENWORK_ELECTRON__;
    localStorage.clear();
    setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
    Reflect.set(window, "__OPENWORK_ELECTRON__", {
      meta: {
        distribution: { flavor: "public", requireSignin: false, requireActivation: false },
        desktopBootstrap: { baseUrl: "https://control.example.test", requireSignin: false },
      },
    });
  });

  afterEach(async () => {
    Reflect.set(window, "__OPENWORK_ELECTRON__", previousBridge);
    localStorage.clear();
    setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
    if (ownedDom) await GlobalRegistrator.unregister();
  });

  test("stored OpenWork credentials stay on disk and are unavailable to callers", () => {
    localStorage.setItem("openwork.den.authToken", "retained-test-token");
    localStorage.setItem("openwork.den.activeOrgId", "retained-org");
    const settings = readDenSettings();
    expect(isLocalGatewayClient()).toBe(true);
    expect(settings.authToken).toBeNull();
    expect(settings.activeOrgId).toBeNull();
    writeDenSettings({ ...settings, authToken: null, activeOrgId: null });
    expect(localStorage.getItem("openwork.den.authToken")).toBe("retained-test-token");
    expect(localStorage.getItem("openwork.den.activeOrgId")).toBe("retained-org");
  });

  test("bootstrap and attempted account calls never issue a network request", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network should not be reached"));
    try {
      await initializeDenBootstrapConfig();
      await expect(createDenClient({ baseUrl: "https://control.example.test", token: "test-token" }).getSession()).rejects.toMatchObject({ code: "local_client" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
