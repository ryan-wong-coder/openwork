import { describe, expect, test } from "bun:test";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, parseGatewayModels, type GatewaySettings } from "../src/gateway-config";
import { gatewayReasoningMetadata, parseGatewayReasoningMetadata } from "../src/gateway-model-capabilities";

const settings: GatewaySettings = {
  baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: "deepseek/deepseek-v4-flash", imageModel: "image-model",
  imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 180000, imageGenerationEnabled: false,
};
const enabled = (variants: ReturnType<typeof gatewayReasoningMetadata>["variants"]) =>
  Object.entries(variants ?? {}).filter(([, value]) => value.disabled !== true).map(([id]) => id);

describe("gateway reasoning capability materialization", () => {
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
