import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createOpenworkServerClient, type GatewayConfig } from "../src/app/lib/openwork-server";

GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => { await GlobalRegistrator.unregister(); });
const { createRoot } = await import("react-dom/client");
const { GatewayView } = await import("../src/react-app/domains/settings/pages/gateway-view");

describe("gateway configuration save and engine application", () => {
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let saveRefresh: "reloaded" | "deferred";
  let catalogRefresh: "reloaded" | "deferred" | undefined;
  let catalogFails: boolean;
  let saveFails: boolean;
  let writes: number;
  let restoreFetch: () => void;
  const client = createOpenworkServerClient({ baseUrl: "http://localhost:8787", token: "fixture-token" });
  const config: GatewayConfig = {
    baseURL: "https://gateway.example.invalid/v1", chatModel: "fixture-chat", imageModel: "fixture-image",
    imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 180000,
    imageGenerationEnabled: true, configured: true, ready: true, apiKeyLast4: "1234",
  };

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    saveRefresh = "reloaded"; catalogRefresh = undefined; catalogFails = false; saveFails = false; writes = 0;
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/gateway/config")) {
        if (init?.method === "PUT") {
          writes += 1;
          if (saveFails) return Response.json({ message: "网关地址无法连接。" }, { status: 502 });
          return Response.json({ ...config, refresh: saveRefresh });
        }
        return Response.json(config);
      }
      if (url.endsWith("/gateway/models")) {
        if (catalogFails) return Response.json({ message: "目录暂时不可用。" }, { status: 502 });
        return Response.json({ models: [
          { id: config.chatModel, name: "示例对话模型", kind: "chat" },
          { id: config.imageModel, name: "示例图片模型", kind: "image" },
        ], syncedAt: 123, ...(catalogRefresh ? { refresh: catalogRefresh } : {}) });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    restoreFetch = () => fetchSpy.mockRestore();
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); restoreFetch(); });

  const button = (label: string) => {
    const found = [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  const render = async (onGatewayReady?: (modelId: string) => void | Promise<void>) => {
    await act(async () => { root.render(createElement(GatewayView, { client, onGatewayReady })); });
  };
  const save = async () => { await act(async () => button("保存并同步模型").click()); };
  const expectCatalog = () => {
    expect(host.textContent).toContain("1 个对话模型 · 1 个图片模型");
    expect(host.textContent).toContain("示例对话模型");
    expect(host.textContent).toContain("示例图片模型");
  };

  test("a deferred save confirms stored credentials and preserves the synchronized catalog", async () => {
    await render(); saveRefresh = "deferred";
    await save();
    expect(writes).toBe(1);
    expect(host.textContent).toContain("密钥已保存 · 末四位 1234 · 等待引擎应用");
    expect(host.textContent).toContain("配置已保存，等待引擎应用。已同步 2 个模型。");
    expect(host.textContent).not.toContain("尚未配置密钥");
    expectCatalog();
  });

  test("a deferred catalog refresh keeps a successful save pending", async () => {
    await render(); catalogRefresh = "deferred";
    await save();
    expect(host.textContent).toContain("配置已保存，等待引擎应用。");
    expectCatalog();
  });

  test("a client engine refresh failure is pending application rather than a failed save", async () => {
    await render(async () => { throw new Error("Engine restart pending"); });
    await save();
    expect(host.textContent).toContain("配置已保存，等待引擎应用。");
    expect(host.textContent).not.toContain("Engine restart pending");
    expectCatalog();
    expect(button("保存并同步模型").disabled).toBe(false);
  });

  test("a catalog failure after persistence retains the previous models and saved status", async () => {
    await render(); catalogFails = true;
    await save();
    expect(host.textContent).toContain("网关配置已保存。");
    expect(host.textContent).toContain("模型目录同步未完成：目录暂时不可用。");
    expect(host.textContent).toContain("密钥已保存");
    expectCatalog();
  });

  test("a rejected persistence request does not claim the configuration was saved", async () => {
    await render(); saveFails = true;
    await save();
    expect(host.textContent).toContain("网关地址无法连接。");
    expect(host.textContent).not.toContain("网关配置已保存。");
    expect(host.textContent).not.toContain("配置已保存，等待引擎应用。");
    expectCatalog();
  });

  test("loading a deferred catalog displays the saved configuration and model choices", async () => {
    catalogRefresh = "deferred";
    await render();
    expect(host.textContent).toContain("配置已保存，等待引擎应用。");
    expect(host.textContent).toContain("密钥已保存 · 末四位 1234 · 等待引擎应用");
    expectCatalog();
  });

  test("syncing a deferred response retains models and a later successful save clears pending state", async () => {
    await render(); catalogRefresh = "deferred";
    await act(async () => button("同步模型目录").click());
    expect(host.textContent).toContain("已同步 2 个模型。等待引擎应用。");
    expectCatalog();
    catalogRefresh = "reloaded";
    await save();
    expect(host.textContent).toContain("网关配置已保存。已同步 2 个模型。");
    expect(host.textContent).not.toContain("等待引擎应用");
  });
});
