import { describe, expect, test } from "bun:test";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, parseGatewayModels, type GatewaySettings } from "../src/gateway-config";
import { fillGatewayRuntimeModelMetadata, gatewayReasoningMetadata, isModelHelmClaudeModel, parseGatewayReasoningMetadata } from "../src/gateway-model-capabilities";

const settings: GatewaySettings = {
  baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: "deepseek/deepseek-v4-flash", imageModel: "image-model",
  imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 180000, imageGenerationEnabled: false,
};
const enabled = (variants: ReturnType<typeof gatewayReasoningMetadata>["variants"]) =>
  Object.entries(variants ?? {}).filter(([, value]) => value.disabled !== true).map(([id]) => id);

describe("gateway reasoning capability materialization", () => {
  test("only four exact official Claude routes receive a local native SDK and native effort variants", () => {
    for (const id of ["anthropic/claude-fable-5", "anthropic/claude-opus-5", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5"]) {
      const parsed = parseGatewayModels({ data: [{ id, provider: { npm: "untrusted-package", api: "https://untrusted.invalid" },
        npm: "untrusted-package", options: { baseURL: "https://untrusted.invalid", headers: { authorization: "untrusted" } } }] });
      expect(isModelHelmClaudeModel(DEFAULT_GATEWAY_BASE_URL, id)).toBe(true);
      const provider = buildGatewayProvider({ ...settings, chatModel: id }, parsed, { port: 4321 });
      expect(provider.npm).toBe("@ai-sdk/openai-compatible");
      expect(provider.options.baseURL).toBe("http://127.0.0.1:4321/gateway/openai");
      expect(provider.models[id]).toMatchObject({ reasoning: true, provider: { npm: "@ai-sdk/anthropic" },
        options: { thinking: { type: "adaptive", display: "summarized" } } });
      expect(enabled(provider.models[id].variants)).toEqual(["low", "medium", "high", "xhigh", "max"]);
      for (const level of ["low", "medium", "high", "xhigh", "max"]) {
        expect(provider.models[id].variants?.[level]).toEqual({ effort: level, thinking: { type: "adaptive", display: "summarized" } });
      }
      expect(provider.models[id].variants?.none).toEqual({ disabled: true });
      expect(provider.models[id].variants?.minimal).toEqual({ disabled: true });
      expect(JSON.stringify(provider)).not.toContain("untrusted");
      expect(isModelHelmClaudeModel("https://custom-gateway.invalid/v1", id)).toBe(false);
      const custom = buildGatewayProvider({ ...settings, baseURL: "https://custom-gateway.invalid/v1" }, parsed, { port: 4321 });
      expect(custom.models[id]).not.toHaveProperty("provider");
      expect(custom.models[id]).not.toHaveProperty("options");
      expect(custom.models[id]).not.toHaveProperty("variants");
    }
    for (const id of ["claude-sonnet-5", "another-route/claude-sonnet-5", "anthropic/claude-sonnet-5-new", "anthropic/claude-sonnet-5.5", "toString"]) {
      expect(isModelHelmClaudeModel(DEFAULT_GATEWAY_BASE_URL, id)).toBe(false);
    }
    expect(isModelHelmClaudeModel("https://api.modelhelm.com/v1?route=claude", "anthropic/claude-sonnet-5")).toBe(false);
  });

  test("Claude sanitized declarations retain disabled controls and use native options without accepting executable metadata", () => {
    const id = "anthropic/claude-sonnet-5";
    for (const declaration of [{ reasoning: false }, { reasoning: true, variants: {} }, { reasoning_efforts: [] }]) {
      expect(enabled(gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, id, parseGatewayReasoningMetadata(declaration)).variants)).toEqual([]);
    }
    const parsed = parseGatewayReasoningMetadata({ variants: {
      careful: { effort: "high", thinking: { type: "enabled", budgetTokens: 10000 }, provider: { npm: "untrusted" } },
      medium: { disabled: true }, unavailable: { effort: "none" },
    } });
    const metadata = gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, id, parsed);
    expect(enabled(metadata.variants)).toEqual(["careful"]);
    expect(metadata.variants?.careful).toEqual({ effort: "high", thinking: { type: "adaptive", display: "summarized" } });
    expect(metadata.variants?.medium).toEqual({ disabled: true });
    expect(JSON.stringify(metadata)).not.toContain("budgetTokens");
    expect(JSON.stringify(metadata)).not.toContain("untrusted");
  });

  test("Claude startup fills partial local SDK/options without rewriting explicit variant payloads", () => {
    const id = "anthropic/claude-sonnet-5";
    const local = { name: "User label", provider: { api: "https://explicit.invalid" }, options: { custom: "retained" },
      variants: { careful: { effort: "high", temperature: 0.2, thinking: { type: "adaptive", display: "omitted" } } } };
    const filled = fillGatewayRuntimeModelMetadata(DEFAULT_GATEWAY_BASE_URL, id, local);
    expect(filled.provider).toEqual({ npm: "@ai-sdk/anthropic", api: "https://explicit.invalid" });
    expect(filled.options).toEqual({ custom: "retained", thinking: { type: "adaptive", display: "summarized" } });
    expect(filled.variants).toEqual(local.variants);
    expect(fillGatewayRuntimeModelMetadata(DEFAULT_GATEWAY_BASE_URL, id, filled)).toEqual(filled);
  });

  test("an explicit conflicting Claude SDK never receives native thinking or inferred effort", () => {
    const id = "anthropic/claude-sonnet-5";
    for (const npm of ["@ai-sdk/openai-compatible", "@fixture/custom-sdk"]) {
      const local = { provider: { npm }, options: { custom: "preserved" } };
      const filled = fillGatewayRuntimeModelMetadata(DEFAULT_GATEWAY_BASE_URL, id, local);
      expect(filled.provider).toEqual(local.provider);
      expect(filled.options).toEqual(local.options);
      expect(enabled(filled.variants)).toEqual([]);
      expect(filled.variants?.high).toEqual({ disabled: true });
      const explicit = { ...local, variants: { custom: { reasoningEffort: "high", temperature: 0.2 } } };
      expect(fillGatewayRuntimeModelMetadata(DEFAULT_GATEWAY_BASE_URL, id, explicit)).toEqual(explicit);
    }
  });

  test("remote native-style effort normalizes to compatible effort for custom and non-Claude models", () => {
    for (const baseURL of [DEFAULT_GATEWAY_BASE_URL, "https://custom-gateway.invalid/v1"]) {
      const id = "synthetic/reasoner";
      const parsed = parseGatewayModels({ data: [{ id, variants: { high: { effort: "high", thinking: { type: "adaptive" } } } }] });
      expect(parsed[0].variants?.high).toEqual({ reasoningEffort: "high" });
      const provider = buildGatewayProvider({ ...settings, baseURL, chatModel: id }, parsed, { port: 4321 });
      expect(provider.models[id].variants?.high).toEqual({ reasoningEffort: "high" });
      expect(provider.models[id]).not.toHaveProperty("provider");
      expect(provider.models[id]).not.toHaveProperty("options");
    }
  });

  test("known ModelHelm models get exact documented efforts, preserving the complete routing ID", () => {
    const provider = buildGatewayProvider(settings, parseGatewayModels({ data: [{ id: settings.chatModel }] }), { port: 4321 });
    const model = provider.models[settings.chatModel];
    expect(model.reasoning).toBe(true);
    expect(enabled(model.variants)).toEqual(["none", "low", "high", "max"]);
    expect(model.variants?.medium).toEqual({ disabled: true });
    expect(model.variants?.high).toEqual({ reasoningEffort: "high" });
    expect(model.interleaved).toEqual({ field: "reasoning_content" });
    expect(Object.keys(provider.models)).toEqual([settings.chatModel]);
  });

  test("does not infer support for unknown IDs, substrings, alternate routing namespaces or custom gateways", () => {
    for (const id of ["unknown/reasoning-model", "deepseek/deepseek-v4-pro-new", "another-route/deepseek-v4-pro", "toString"]) {
      expect(gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, id, {})).toEqual({});
    }
    expect(gatewayReasoningMetadata("http://127.0.0.1:1234/v1", settings.chatModel, {})).toEqual({});
  });

  test("GPT-6.1 Sol receives exactly its five efforts without none or minimal", () => {
    const id = "openai/gpt-6.1-sol";
    const provider = buildGatewayProvider({ ...settings, chatModel: id }, parseGatewayModels({ data: [{ id }] }), { port: 4321 });
    const model = provider.models[id];
    expect(model.reasoning).toBe(true);
    expect(enabled(model.variants)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(model.variants?.none).toEqual({ disabled: true });
    expect(model.variants?.minimal).toEqual({ disabled: true });
    expect(model.variants?.max).toEqual({ reasoningEffort: "max" });
    expect(Object.keys(provider.models)).toEqual([id]);
    expect(gatewayReasoningMetadata("https://custom-gateway.invalid/v1", id, {})).toEqual({});
    for (const alias of ["gpt-6.1-sol", "another-route/gpt-6.1-sol", "openai/gpt-6.1-sol-new"]) {
      expect(gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, alias, {})).toEqual({});
    }
    for (const declaration of [{ reasoning: false }, { reasoning: true, variants: {} }, { reasoning_efforts: [] }]) {
      expect(enabled(gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, id, parseGatewayReasoningMetadata(declaration)).variants)).toEqual([]);
    }
    const explicit = { precise: { reasoningEffort: "high" }, max: { disabled: true } };
    expect(gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, id, { variants: explicit }).variants).toEqual(explicit);
  });

  test("built-in reasoning without an effort dial does not acquire inferred engine defaults", () => {
    const metadata = gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, "minimax/minimax-m2.1", {});
    expect(metadata.reasoning).toBe(true);
    expect(enabled(metadata.variants)).toEqual([]);
    expect(metadata.variants?.high).toEqual({ disabled: true });
  });

  test("preserves explicit custom-gateway effort names and disabled variants, without accepting remote executable/options config", () => {
    const [parsed] = parseGatewayModels({ data: [{ id: "tenant/opaque-model", variants: {
      precise: { reasoningEffort: "high", headers: { authorization: "not-a-model-option" } },
      ultra: { reasoning_effort: "ultra" }, low: { disabled: true },
    } }] });
    expect(parsed.reasoning).toBe(true);
    expect(parsed.variants?.precise).toEqual({ reasoningEffort: "high" });
    expect(parsed.variants?.ultra).toEqual({ reasoningEffort: "ultra" });
    expect(parsed.variants?.low).toEqual({ disabled: true });
    const metadata = gatewayReasoningMetadata("https://gateway.invalid/v1", parsed.id, parsed);
    expect(metadata.variants).toEqual(parsed.variants);
    expect(metadata).not.toHaveProperty("id");
  });

  test("explicit vendor metadata wins over the offline known-model fallback", () => {
    const declared = parseGatewayReasoningMetadata({ reasoning: { supported_efforts: ["high"] } });
    const materialized = gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, settings.chatModel, declared);
    expect(enabled(materialized.variants)).toEqual(["high"]);
    expect(materialized.variants?.low).toEqual({ disabled: true });
    expect(gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, settings.chatModel,
      parseGatewayReasoningMetadata({ reasoning: false, variants: { high: { reasoningEffort: "high" } } }))).toMatchObject({ reasoning: false });
    for (const explicit of [{ reasoning: false }, { reasoning: true, variants: {} },
      { variants: { high: { disabled: true } } }, { reasoning_efforts: [] }]) {
      const retained = gatewayReasoningMetadata(DEFAULT_GATEWAY_BASE_URL, settings.chatModel, parseGatewayReasoningMetadata(explicit));
      expect(enabled(retained.variants)).toEqual([]);
    }
  });

  test("accepts documented effort metadata forms and survives a private-catalog round trip", () => {
    for (const metadata of [
      { reasoning_efforts: ["low", "high"] },
      { reasoning: { supported_levels: ["low", "high"] } },
      { effort: { supported_levels: ["low", "high"] } },
      { reasoning_options: [{ type: "effort", values: ["low", "high"] }] },
    ]) {
      const models = parseGatewayModels({ data: [{ id: "synthetic/reasoner", ...metadata }] });
      expect(enabled(models[0].variants)).toEqual(["low", "high"]);
      expect(parseGatewayModels({ data: JSON.parse(JSON.stringify(models)) })).toEqual(models);
    }
  });

  test("empty or malformed capability data never invents adjustable reasoning", () => {
    for (const metadata of [{}, { reasoning: "true" }, { variants: { bogus: { reasoningEffort: {} } } },
      { reasoning: { supported_efforts: null } }, { reasoning_efforts: [null, {}, ""] }]) {
      expect(enabled(parseGatewayReasoningMetadata(metadata).variants)).toEqual([]);
    }
  });

  test("explicit interleaved fields survive custom/unknown models and known-model fallback", () => {
    for (const baseURL of [DEFAULT_GATEWAY_BASE_URL, "https://gateway.invalid/v1"]) {
      for (const id of [settings.chatModel, "synthetic/unknown"]) {
        const metadata = gatewayReasoningMetadata(baseURL, id, { interleaved: { field: "reasoning_details" } });
        expect(metadata.interleaved).toEqual({ field: "reasoning_details" });
      }
    }
  });
});
