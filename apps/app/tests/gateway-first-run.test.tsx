import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement, StrictMode } from "react";
import { createOpenworkServerClient, type GatewayConfig } from "../src/app/lib/openwork-server";

const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });
const { createRoot } = await import("react-dom/client");
const { GatewayFirstRun } = await import("../src/react-app/domains/settings/pages/gateway-first-run");

const fixtureKey = "first-run-private-fixture";
const existingConfig: GatewayConfig = {
  baseURL: "https://custom.example.invalid/v2", chatModel: "configured-chat", imageModel: "configured-image",
  imageSize: "1536x1024", imageQuality: "high", requestTimeoutMs: 123000,
  imageGenerationEnabled: false, configured: false, ready: false, apiKeyLast4: null,
};
const client = createOpenworkServerClient({ baseUrl: "http://localhost:8787", token: "fixture-client", hostToken: "fixture-host" });
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let previousAct: unknown;
let config: GatewayConfig;
let savedConfig: GatewayConfig;
let readStatus: number;
let saveStatus: number;
let saveCode: string;
let writes: unknown[];
let requests: string[];
let completes: string[];
let completeFailures: number;
let skipped: number;
let settingsOpened: number;
let saveResponse: (() => Promise<Response>) | null;
let readResponse: ((url: string) => Promise<Response>) | null;
let restoreFetch: () => void;

beforeEach(() => {
  previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  config = { ...existingConfig };
  savedConfig = { ...existingConfig, configured: true, ready: true, apiKeyLast4: "ture" };
  readStatus = 200; saveStatus = 200; saveCode = "gateway_request_failed"; writes = []; requests = []; completes = [];
  completeFailures = 0; skipped = 0; settingsOpened = 0; saveResponse = null; readResponse = null;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    const path = new URL(url).pathname;
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (path !== "/gateway/config") throw new Error("Unexpected first-run request");
    if (init?.method === "PUT") {
      writes.push(typeof init.body === "string" ? JSON.parse(init.body) : null);
      if (saveResponse) return saveResponse();
      if (saveStatus !== 200) return Response.json({ code: saveCode, message: `Upstream echoed ${fixtureKey}` }, { status: saveStatus });
      return Response.json(savedConfig);
    }
    if (readResponse) return readResponse(url);
    if (readStatus !== 200) return Response.json({ message: `Unsafe service detail ${fixtureKey}` }, { status: readStatus });
    return Response.json(config);
  });
  restoreFetch = () => fetchSpy.mockRestore();
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); restoreFetch();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
});

async function render(strict = false) {
  const element = createElement(GatewayFirstRun, {
    client,
    onComplete: async (modelId: string) => {
      completes.push(modelId);
      if (completeFailures-- > 0) throw new Error(`Refresh failed ${fixtureKey}`);
    },
    onSkip: () => { skipped += 1; },
    onOpenSettings: () => { settingsOpened += 1; },
  });
  await act(async () => root.render(strict ? createElement(StrictMode, {}, element) : element));
}
function button(label: string) {
  const value = [...host.querySelectorAll("button")].find(e => e.textContent?.trim() === label);
  if (!value) throw new Error(`Missing action: ${label}`);
  return value;
}
function keyField() {
  const value = host.querySelector<HTMLInputElement>('[data-testid="gateway-first-run-key"]');
  if (!value) throw new Error("Missing private key field");
  return value;
}
async function enterKey(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(keyField(), value);
    keyField().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) { await act(async () => button(label).click()); }
function expectNoSecret() {
  expect(host.textContent).not.toContain(fixtureKey);
  expect(host.innerHTML).not.toContain(fixtureKey);
  for (let i = 0; i < localStorage.length; i += 1) expect(localStorage.getItem(localStorage.key(i) ?? "")).not.toContain(fixtureKey);
}

test("first run checks host access before accepting a masked, private key and blocks empty submission", async () => {
  await render();
  expect(requests).toEqual(["GET /gateway/config"]);
  expect(host.textContent).toContain("连接 ModelHelm");
  expect(keyField().type).toBe("password");
  expect(keyField().getAttribute("data-private")).toBe("true");
  expect(keyField().autocomplete).toBe("off");
  expect(button("保存并开始").disabled).toBe(true);
  await enterKey("   ");
  await click("保存并开始");
  expect(writes).toEqual([]);
  expect(keyField().value).toBe("");
  expect(completes).toEqual([]);
});

test("an existing ready configuration passes through once, including strict effect replay", async () => {
  config = { ...config, configured: true, ready: true };
  await render(true);
  expect(completes).toEqual([config.chatModel]);
  expect(host.querySelector("input")).toBeNull();
  expect(writes).toEqual([]);
});

test("401 and 403 management responses never collect a key or expose raw service errors", async () => {
  readStatus = 401;
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("网关由部署者管理，请联系部署者完成配置。");
  readStatus = 403;
  await click("重新检查");
  expect(host.querySelector("input")).toBeNull();
  expect(writes).toEqual([]);
  expect(completes).toEqual([]);
  expectNoSecret();
  await click("网关设置"); await click("稍后设置");
  expect(settingsOpened).toBe(1); expect(skipped).toBe(1);
});

test("an existing unready key is retained and directs to settings without asking for another key", async () => {
  config = { ...config, configured: true, ready: false };
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("密钥已保存，等待引擎应用。");
  expect(completes).toEqual([]);
  await click("网关设置");
  expect(settingsOpened).toBe(1); expect(writes).toEqual([]);
});

test("a rejected key is cleared, is never rendered from the upstream error, and can be replaced", async () => {
  await render(); saveStatus = 401;
  await enterKey(fixtureKey); await click("保存并开始");
  expect(keyField().value).toBe("");
  expect(button("保存并开始").disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("连接未完成");
  expect(completes).toEqual([]); expectNoSecret();
  saveStatus = 200;
  await enterKey("replacement-fixture-key"); await click("保存并开始");
  expect(completes).toEqual([savedConfig.chatModel]);
  expect(writes).toEqual([{ apiKey: fixtureKey }, { apiKey: "replacement-fixture-key" }]);
});

test("expired host authorization during save stops collecting keys", async () => {
  await render(); saveStatus = 401; saveCode = "unauthorized";
  await enterKey(fixtureKey); await click("保存并开始");
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("网关由部署者管理");
  expect(completes).toEqual([]); expectNoSecret();
});

test("saving only sends the key and preserves custom address, models and advanced parameters", async () => {
  await render();
  await enterKey(`  ${fixtureKey}  `); await click("保存并开始");
  expect(writes).toEqual([{ apiKey: fixtureKey }]);
  expect(config).toEqual(existingConfig);
  expect(requests).toEqual(["GET /gateway/config", "PUT /gateway/config"]);
  expect(completes).toEqual([savedConfig.chatModel]); expectNoSecret();
});

test("rapid submissions share one in-flight save and disable all navigation actions", async () => {
  await render(); await enterKey(fixtureKey);
  let finish: ((response: Response) => void) | undefined;
  saveResponse = () => new Promise(resolve => { finish = resolve; });
  await act(async () => {
    const action = button("保存并开始"); action.click(); action.click();
    keyField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(writes).toHaveLength(1);
  expect(keyField().value).toBe("");
  expect([...host.querySelectorAll("button")].every(e => e.disabled)).toBe(true);
  expect(completes).toEqual([]);
  await act(async () => finish?.(Response.json(savedConfig)));
  expect(completes).toEqual([savedConfig.chatModel]); expectNoSecret();
});

test("deferred application stays pending until a recheck reports real readiness", async () => {
  await render(); savedConfig = { ...savedConfig, refresh: "deferred", ready: true };
  await enterKey(fixtureKey); await click("保存并开始");
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("密钥已保存，等待引擎应用。");
  expect(completes).toEqual([]);
  config = { ...config, configured: true, ready: false };
  await click("重新检查"); expect(completes).toEqual([]);
  config = { ...config, ready: true };
  await click("重新检查");
  expect(completes).toEqual([config.chatModel]);
  expect(writes).toHaveLength(1); expectNoSecret();
});

test("a parent refresh failure does not claim success or require the saved key again", async () => {
  await render(); completeFailures = 1;
  await enterKey(fixtureKey); await click("保存并开始");
  expect(host.textContent).toContain("连接状态尚未刷新，请重新检查。");
  expect(host.textContent).not.toContain("已就绪");
  expect(host.querySelector("input")).toBeNull(); expectNoSecret();
  config = { ...config, configured: true, ready: true };
  await click("重新检查");
  expect(completes).toEqual([config.chatModel, config.chatModel]);
  expect(writes).toHaveLength(1);
});

test("an accepted but not-ready save retains the saved state without completing", async () => {
  await render(); savedConfig = { ...savedConfig, ready: false };
  await enterKey(fixtureKey); await click("保存并开始");
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("密钥已保存，等待引擎应用。");
  expect(completes).toEqual([]);
  expect(writes).toEqual([{ apiKey: fixtureKey }]); expectNoSecret();
});

test("leaving setup discards the unsaved secret before navigating", async () => {
  await render();
  await enterKey(fixtureKey); await click("网关设置");
  expect(settingsOpened).toBe(1); expect(keyField().value).toBe("");
  await enterKey(fixtureKey); await click("稍后设置");
  expect(skipped).toBe(1); expect(keyField().value).toBe("");
  expect(writes).toEqual([]); expectNoSecret();
});

test("an unreadable service never solicits a key before management access is known", async () => {
  readStatus = 502;
  await render();
  expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).toContain("暂时无法读取网关配置，请检查服务连接后重试。");
  expectNoSecret(); expect(writes).toEqual([]);
});

const replacementClient = createOpenworkServerClient({ baseUrl: "http://localhost:8788", token: "second-fixture-client", hostToken: "second-fixture-host" });
async function switchClient() {
  await act(async () => root.render(createElement(GatewayFirstRun, {
    client: replacementClient,
    onComplete: async (modelId: string) => { completes.push(`replacement:${modelId}`); },
    onSkip: () => {}, onOpenSettings: () => {},
  })));
}

test("a new client checks immediately and a late old read cannot apply to its callback", async () => {
  let finishOld: ((response: Response) => void) | undefined;
  readResponse = async url => new URL(url).port === "8787"
    ? new Promise(resolve => { finishOld = resolve; })
    : Response.json({ ...config, configured: true, ready: true, chatModel: "replacement-chat" });
  await render();
  await switchClient();
  expect(completes).toEqual(["replacement:replacement-chat"]);
  await act(async () => finishOld?.(Response.json({ ...config, configured: true, ready: true })));
  expect(completes).toEqual(["replacement:replacement-chat"]);
  expect(requests).toEqual(["GET /gateway/config", "GET /gateway/config"]);
});

test("switching clients ignores an old in-flight save", async () => {
  await render(); await enterKey(fixtureKey);
  const previousInput = keyField();
  let finishSave: ((response: Response) => void) | undefined;
  saveResponse = () => new Promise(resolve => { finishSave = resolve; });
  await click("保存并开始");
  await switchClient();
  expect(previousInput.value).toBe("");
  expect(keyField().value).toBe("");
  expect(button("保存并开始").disabled).toBe(true);
  await act(async () => finishSave?.(Response.json(savedConfig)));
  expect(completes).toEqual([]);
  expect(host.querySelector("input")).not.toBeNull();
  expect(writes).toHaveLength(1); expectNoSecret();
});

test("switching clients discards an unsaved key before checking the new deployment", async () => {
  await render(); await enterKey(fixtureKey);
  const previousInput = keyField();
  await switchClient();
  expect(previousInput.value).toBe("");
  expect(keyField().value).toBe("");
  expect(button("保存并开始").disabled).toBe(true);
  expect(writes).toEqual([]); expectNoSecret();
});

test("a late readiness response after unmount cannot complete setup", async () => {
  let finishRead: ((response: Response) => void) | undefined;
  readResponse = () => new Promise(resolve => { finishRead = resolve; });
  await render();
  await act(async () => root.render(null));
  await act(async () => finishRead?.(Response.json({ ...config, configured: true, ready: true })));
  expect(completes).toEqual([]);
  expect(host.textContent).toBe("");
  expect(writes).toEqual([]);
});
