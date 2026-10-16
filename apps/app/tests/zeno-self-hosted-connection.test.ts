import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { isLocalGatewayClient, setClientProfileBootstrap } from "../src/app/lib/client-profile";
import { createOpenworkServerClient, hydrateOpenworkServerSettingsFromEnv, readOpenworkServerSettings, writeOpenworkServerSettings } from "../src/app/lib/openwork-server";
import { resolveOpenworkConnection } from "../src/react-app/shell/openwork-connection";
import { buildOpenworkHealthHeaders, localClientServerAllowed } from "../src/react-app/kernel/server-provider";
import { resolveDefaultServerUrl } from "../src/react-app/shell/providers";

const NativeResponse = Response;
const keys = ["VITE_OPENWORK_DEPLOYMENT", "VITE_OPENWORK_CLIENT_PROFILE", "VITE_DEN_REQUIRE_SIGNIN", "VITE_OPENWORK_URL", "VITE_OPENCODE_URL", "VITE_OPENWORK_TOKEN", "VITE_OPENWORK_HOST_TOKEN", "VITE_OPENWORK_FORCE_ENV_SETTINGS"];
let previous: Record<string, string | undefined>;
GlobalRegistrator.register({ url: "https://zeno.example.test/session" });
beforeEach(() => {
  previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.VITE_OPENWORK_DEPLOYMENT = "web";
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  localStorage.clear();
});
afterEach(() => {
  for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  Reflect.deleteProperty(window, "__OPENWORK_GATEWAY__");
  Reflect.deleteProperty(window, "__OPENWORK_BOOTSTRAP__");
  localStorage.clear();
});
afterAll(async () => { await GlobalRegistrator.unregister(); });

test("a default Web client uses its own server token and origin instead of a retained vendor session", async () => {
  Reflect.set(window, "__OPENWORK_GATEWAY__", { version: 1 });
  Reflect.set(window, "__OPENWORK_BOOTSTRAP__", { token: "own-client-token" });
  localStorage.setItem("openwork.den.authToken", "retained-vendor-token");
  hydrateOpenworkServerSettingsFromEnv();
  const connection = await resolveOpenworkConnection();
  expect(isLocalGatewayClient()).toBe(true);
  expect(connection).toMatchObject({ source: "same-origin", normalizedBaseUrl: "https://zeno.example.test", resolvedToken: "own-client-token", resolvedHostToken: "" });
  expect(localClientServerAllowed("https://zeno.example.test/opencode")).toBe(true);
  expect(buildOpenworkHealthHeaders("https://zeno.example.test/opencode")).toEqual({ Authorization: "Bearer own-client-token" });
});

test("an explicit operator backend and path remain usable outside the frontend origin", async () => {
  process.env.VITE_OPENWORK_URL = "https://agent.example.test/service";
  process.env.VITE_OPENWORK_TOKEN = "own-client-token";
  process.env.VITE_OPENWORK_FORCE_ENV_SETTINGS = "1";
  Reflect.set(window, "__OPENWORK_GATEWAY__", { version: 1 });
  hydrateOpenworkServerSettingsFromEnv();
  expect(await resolveOpenworkConnection()).toMatchObject({ source: "stored-settings", normalizedBaseUrl: "https://agent.example.test/service", resolvedToken: "own-client-token" });
  expect(localClientServerAllowed("https://agent.example.test/service/opencode")).toBe(true);
  expect(localClientServerAllowed("https://agent.example.test/service-other/opencode")).toBe(false);
});

test("relative operator API paths resolve consistently for the engine and the workspace API", async () => {
  Reflect.set(window, "__OPENWORK_BOOTSTRAP__", { token: "own-client-token" });
  for (const [configured, expected] of [
    ["/service/openwork", "https://zeno.example.test/service/openwork"],
    ["./api/openwork", "https://zeno.example.test/api/openwork"],
    ["../api/openwork", "https://zeno.example.test/api/openwork"],
  ]) {
    localStorage.clear();
    process.env.VITE_OPENWORK_URL = configured;
    hydrateOpenworkServerSettingsFromEnv();
    expect(readOpenworkServerSettings().urlOverride).toBe(expected);
    expect(resolveDefaultServerUrl()).toBe(`${expected}/opencode`);
    expect(await resolveOpenworkConnection()).toMatchObject({ source: "stored-settings", normalizedBaseUrl: expected, resolvedToken: "own-client-token" });
  }
});

test("a fresh standalone bootstrap recovers its own origin from an old rejected target without dropping local credentials", async () => {
  for (const previousUrl of ["https://api.openworklabs.com", "https://old-server.example.test"]) {
    writeOpenworkServerSettings({ urlOverride: previousUrl, token: "stale-client-token", hostToken: "retained-host-token" });
    Reflect.set(window, "__OPENWORK_GATEWAY__", { version: 1 });
    Reflect.set(window, "__OPENWORK_BOOTSTRAP__", { token: "new-own-client-token" });
    localStorage.setItem("openwork.den.authToken", "retained-vendor-token");
    hydrateOpenworkServerSettingsFromEnv();
    expect(readOpenworkServerSettings()).toMatchObject({ urlOverride: "https://zeno.example.test", token: "new-own-client-token", hostToken: "retained-host-token" });
    expect(await resolveOpenworkConnection()).toMatchObject({ source: "stored-settings", normalizedBaseUrl: "https://zeno.example.test", resolvedToken: "new-own-client-token" });
    expect(localStorage.getItem("openwork.den.authToken")).toBe("retained-vendor-token");
  }
});

test("a retained official endpoint cannot become a standalone fallback or receive its stored tokens", async () => {
  writeOpenworkServerSettings({ urlOverride: "https://api.openworklabs.com", token: "retained-client-token", hostToken: "retained-host-token" });
  expect(await resolveOpenworkConnection()).toMatchObject({ source: "empty", normalizedBaseUrl: "", resolvedToken: "", resolvedHostToken: "" });
  expect(localClientServerAllowed("https://api.openworklabs.com/opencode")).toBe(false);
  expect(readOpenworkServerSettings().token).toBe("retained-client-token");
});

test("chat readiness uses only the client-authenticated status route", async () => {
  const calls: { url: string; authorization: string | null; host: string | null }[] = [];
  const fetched = spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("authorization"), host: headers.get("x-openwork-host-token") });
    return Promise.resolve(NativeResponse.json({ configured: true, ready: true, chatModel: "provider/model" }));
  });
  try {
    const client = createOpenworkServerClient({ baseUrl: "https://zeno.example.test", token: "own-client-token", hostToken: "host-must-not-be-used" });
    expect(await client.getGatewayStatus()).toMatchObject({ configured: true, ready: true, chatModel: "provider/model" });
    expect(calls).toEqual([{ url: "https://zeno.example.test/gateway/status", authorization: "Bearer own-client-token", host: null }]);
  } finally { fetched.mockRestore(); }
});
