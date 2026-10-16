import { expect, test } from "bun:test";
import { createClientV2 } from "../src/app/lib/opencode-v2-adapter";
import { getModelEffortState } from "../src/app/lib/model-behavior";
import { runtimeModelOptions } from "../src/react-app/domains/models/catalog";
import { setLocale } from "../src/i18n";
import { gatewayReasoningMetadata } from "../../server/src/gateway-model-capabilities";
import { nativeModelVariants } from "@openwork/types/cloud-model-fast";

test("public V2 provider list preserves advertised reasoning and native variant IDs", async () => {
  setLocale("zh");
  const requests: string[] = [];
  const nativeModel = (id: string, reasoning: boolean, variants: ReturnType<typeof nativeModelVariants>, nativePackage = "@opencode/ai/providers/openai-compatible") => ({
    id, providerID: "modelhelm", name: id,
    api: { id, url: "https://fixture.example.invalid", package: nativePackage },
    capabilities: { input: ["text"], output: reasoning ? ["text", "reasoning"] : ["text"], tools: true },
    variants, limit: { context: 10000, output: 1000 },
  });
  const gpt61Id = "openai/gpt-6.1-sol";
  const gpt61 = gatewayReasoningMetadata("https://api.modelhelm.com/v1", gpt61Id, {});
  const claudeId = "anthropic/claude-sonnet-5";
  const claude = gatewayReasoningMetadata("https://api.modelhelm.com/v1", claudeId, {});
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    requests.push(`${request.method} ${path}`);
    if (request.method !== "GET") return Response.json({ message: "Read-only fixture" }, { status: 405 });
    if (path === "/api/model") return Response.json({ data: [
      nativeModel("qa-manual", true, [{ id: "high", settings: { reasoningEffort: "high" } }]),
      nativeModel("qa-builtin", true, []),
      nativeModel("qa-unverified", false, []),
      nativeModel(gpt61Id, gpt61.reasoning === true, nativeModelVariants(gpt61.variants, "@opencode/ai/providers/openai-compatible")),
      nativeModel(claudeId, claude.reasoning === true, nativeModelVariants(claude.variants, "@opencode/ai/providers/anthropic"), "@opencode/ai/providers/anthropic"),
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
    const gpt61Option = options.find(entry => entry.modelID === gpt61Id);
    expect(gpt61Option?.reasoning).toBe(true);
    expect(gpt61Option?.behaviorOptions?.map(entry => entry.value)).toEqual([null, "low", "medium", "high", "xhigh", "max"]);
    expect(getModelEffortState(gpt61Option?.behaviorOptions ?? [], gpt61Option?.reasoning).adjustable).toBe(true);
    expect(provider?.models[gpt61Id].variants).toEqual({
      low: { reasoningEffort: "low" }, medium: { reasoningEffort: "medium" }, high: { reasoningEffort: "high" },
      xhigh: { reasoningEffort: "xhigh" }, max: { reasoningEffort: "max" },
    });
    const claudeOption = options.find(entry => entry.modelID === claudeId);
    expect(claudeOption?.providerID).toBe("modelhelm");
    expect(claudeOption?.reasoning).toBe(true);
    expect(claudeOption?.behaviorOptions?.map(entry => entry.value)).toEqual([null, "low", "medium", "high", "xhigh", "max"]);
    expect(getModelEffortState(claudeOption?.behaviorOptions ?? [], claudeOption?.reasoning).adjustable).toBe(true);
    expect(provider?.models[claudeId].variants.high).toEqual({ effort: "high", thinking: { type: "adaptive", display: "summarized" } });
    expect(requests.sort()).toEqual(["GET /api/model", "GET /api/model/default", "GET /api/provider"]);
  } finally { await server.stop(true); }
});
