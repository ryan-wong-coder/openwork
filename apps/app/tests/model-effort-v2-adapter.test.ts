import { expect, test } from "bun:test";
import { createClientV2 } from "../src/app/lib/opencode-v2-adapter";
import { getModelEffortState } from "../src/app/lib/model-behavior";
import { runtimeModelOptions } from "../src/react-app/domains/models/catalog";
import { setLocale } from "../src/i18n";

test("public V2 provider list preserves advertised reasoning and native variant IDs", async () => {
  setLocale("zh");
  const requests: string[] = [];
  const nativeModel = (id: string, reasoning: boolean, variants: Array<{ id: string; settings: { reasoningEffort: string } }>) => ({
    id, providerID: "modelhelm", name: id,
    api: { id, url: "https://fixture.example.invalid", package: "@ai-sdk/openai-compatible" },
    capabilities: { input: ["text"], output: reasoning ? ["text", "reasoning"] : ["text"], tools: true },
    variants, limit: { context: 10000, output: 1000 },
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (request.method !== "GET") return Response.json({ message: "Read-only fixture" }, { status: 405 });
    if (path === "/api/model") return Response.json({ data: [
      nativeModel("qa-manual", true, [{ id: "high", settings: { reasoningEffort: "high" } }]),
      nativeModel("qa-builtin", true, []),
      nativeModel("qa-unverified", false, []),
    ] });
    if (path === "/api/provider") return Response.json({ data: [{ id: "modelhelm", name: "Synthetic provider" }] });
    if (path === "/api/model/default") return Response.json({ data: { modelhelm: "qa-manual" } });
    return Response.json({ message: "Unexpected fixture read" }, { status: 404 });
  } });
  try {
    const client = createClientV2(`http://127.0.0.1:${server.port}`, undefined, {});
    const result = await client.provider.list();
    const data = result.data;
    if (!data) throw new Error("Provider list did not return its normalized catalog");
    const provider = data.all.find(entry => entry.id === "modelhelm");
    expect(provider?.models["qa-manual"].capabilities.reasoning).toBe(true);
    expect(provider?.models["qa-manual"].variants).toEqual({ high: { reasoningEffort: "high" } });
    expect(provider?.models["qa-builtin"].capabilities.reasoning).toBe(true);
    expect(provider?.models["qa-builtin"].variants).toEqual({});
    const options = runtimeModelOptions(data);
    const manual = options.find(entry => entry.modelID === "qa-manual");
    expect(manual?.reasoning).toBe(true);
    expect(manual?.behaviorOptions?.map(entry => entry.value)).toEqual([null, "high"]);
    expect(manual?.behaviorOptions?.[1].label).toBe("深入");
    const builtin = options.find(entry => entry.modelID === "qa-builtin");
    expect(builtin?.reasoning).toBe(true);
    expect(builtin?.behaviorOptions?.map(entry => entry.value)).toEqual([null]);
    expect(getModelEffortState(builtin?.behaviorOptions ?? [], builtin?.reasoning)).toMatchObject({ adjustable: false, label: "模型自动控制" });
    const unverified = options.find(entry => entry.modelID === "qa-unverified");
    expect(getModelEffortState(unverified?.behaviorOptions ?? [], unverified?.reasoning)).toMatchObject({ adjustable: false, label: "未提供可调深度" });
    expect(requests.sort()).toEqual(["GET /api/model", "GET /api/model/default", "GET /api/provider"]);
  } finally { await server.stop(true); }
});
