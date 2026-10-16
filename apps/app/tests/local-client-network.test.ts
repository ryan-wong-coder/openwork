import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { isLocalGatewayClient, setClientProfileBootstrap } from "../src/app/lib/client-profile";
import { createDenClient, initializeDenBootstrapConfig, readDenSettings, writeDenSettings } from "../src/app/lib/den";
import { loadSessionConnectCapabilities, prefetchCloudInventory, readCloudInventoryScope } from "../src/react-app/domains/connections/cloud-inventory-cache";
import { areOpenWorkModelsPromosDisabled } from "../src/react-app/domains/cloud/openwork-models-promo";

describe("local client control-plane isolation", () => {
  let ownedDom = false;
  let previousBridge: typeof window.__OPENWORK_ELECTRON__;
  let previousGateway: typeof window.__OPENWORK_GATEWAY__;
  let previousDeployment: string | undefined;
  let previousProfile: string | undefined;
  let previousSignin: string | undefined;

  beforeEach(() => {
    ownedDom = typeof window === "undefined";
    if (ownedDom) GlobalRegistrator.register();
    previousBridge = window.__OPENWORK_ELECTRON__;
    previousGateway = window.__OPENWORK_GATEWAY__;
    previousDeployment = process.env.VITE_OPENWORK_DEPLOYMENT;
    previousProfile = process.env.VITE_OPENWORK_CLIENT_PROFILE;
    previousSignin = process.env.VITE_DEN_REQUIRE_SIGNIN;
    delete process.env.VITE_OPENWORK_CLIENT_PROFILE;
    delete process.env.VITE_DEN_REQUIRE_SIGNIN;
    process.env.VITE_OPENWORK_DEPLOYMENT = "desktop";
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
    Reflect.set(window, "__OPENWORK_GATEWAY__", previousGateway);
    for (const [key, value] of Object.entries({ VITE_OPENWORK_DEPLOYMENT: previousDeployment, VITE_OPENWORK_CLIENT_PROFILE: previousProfile, VITE_DEN_REQUIRE_SIGNIN: previousSignin })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
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

  test("self-deployed Web defaults to isolation even with a gateway marker and retained account credentials", async () => {
    Reflect.deleteProperty(window, "__OPENWORK_ELECTRON__");
    Reflect.set(window, "__OPENWORK_GATEWAY__", { version: 1, denBaseUrl: "https://control.example.test" });
    process.env.VITE_OPENWORK_DEPLOYMENT = "web";
    localStorage.setItem("openwork.den.authToken", "retained-test-token");
    localStorage.setItem("openwork.den.activeOrgId", "retained-org");
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network should not be reached"));
    try {
      expect(isLocalGatewayClient()).toBe(true);
      expect((await initializeDenBootstrapConfig()).requireSignin).toBe(false);
      expect(readDenSettings().authToken).toBeNull();
      expect(readCloudInventoryScope()).toBeNull();
      expect(areOpenWorkModelsPromosDisabled()).toBe(true);
      prefetchCloudInventory();
      expect(await loadSessionConnectCapabilities()).toMatchObject({ skills: [], plugins: [], mcpServers: [] });
      await expect(createDenClient({ baseUrl: "https://control.example.test", token: "retained-test-token" }).getSession()).rejects.toMatchObject({ code: "local_client" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(localStorage.getItem("openwork.den.authToken")).toBe("retained-test-token");
    } finally { fetchSpy.mockRestore(); }
  });
});
