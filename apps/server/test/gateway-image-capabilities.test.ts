import { describe, expect, test } from "bun:test";
import { gatewayImageMetadata, parseGatewayImageMetadata } from "../src/gateway-image-capabilities";

const official = "https://api.modelhelm.com/v1";
const verifiedModels = [
  "anthropic/claude-fable-5", "anthropic/claude-opus-5", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5",
  "openai/gpt-5.4", "openai/gpt-5.4-mini", "openai/gpt-5.5", "openai/gpt-5.6-luna", "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra", "openai/gpt-6-astra", "openai/gpt-6-luna", "openai/gpt-6-sol", "openai/gpt-6.1-sol",
  "google/gemini-3.7-flash", "google/gemini-3.8-flash",
  "qwen/qwen3.6-27b", "qwen/qwen3.6-35b-a3b", "qwen/qwen3.6-flash", "qwen/qwen3.6-plus",
  "qwen/qwen3.7-plus", "qwen/qwen3.8-flash", "qwen/qwen3.8-max",
  "moonshotai/kimi-k2.7-code", "moonshotai/kimi-k3",
  "z-ai/glm-4.5v", "z-ai/glm-4.6v", "z-ai/glm-5v-turbo", "x-ai/grok-4.5", "x-ai/grok-4.6", "minimax/minimax-m3",
];

describe("gateway image-input declarations", () => {
  test("accepted metadata shapes normalize to a single boolean and survive a private-cache roundtrip", () => {
    for (const entry of [
      { image: true }, { vision: true }, { capabilities: { vision: true } },
      { modalities: { input: ["text", "image"], output: ["text"] } },
      { capabilities: { input: ["text", "image"] } },
      { capabilities: { input: { text: true, image: true, pdf: false } } },
      { input_modalities: ["text", "image"] },
      { architecture: { input_modalities: ["text", "image", "file"] } },
    ]) {
      const parsed = parseGatewayImageMetadata(entry);
      expect(parsed).toEqual({ image: true });
      expect(parseGatewayImageMetadata(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    }
  });

  test("explicit negative declarations are retained instead of receiving a known-model fallback", () => {
    for (const entry of [
      { image: false }, { vision: false }, { capabilities: { vision: false } },
      { modalities: { input: ["text"] } }, { modalities: { input: [] } },
      { capabilities: { input: ["text", "audio"] } },
      { capabilities: { input: { image: false } } },
      { input_modalities: ["text", "pdf"] }, { architecture: { input_modalities: ["text", "file"] } },
    ]) {
      const parsed = parseGatewayImageMetadata(entry);
      expect(parsed).toEqual({ image: false });
      expect(gatewayImageMetadata(official, "openai/gpt-6.1-sol", parsed)).toEqual(parsed);
      expect(parseGatewayImageMetadata(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    }
  });

  test("conflicting explicit declarations conservatively preserve the negative value", () => {
    for (const entry of [
      { image: false, vision: true }, { image: true, vision: false },
      { image: false, modalities: { input: ["text", "image"] } },
      { vision: true, capabilities: { input: { image: false } } },
      { modalities: { input: ["text"] }, capabilities: { input: ["text", "image"] } },
    ]) expect(parseGatewayImageMetadata(entry)).toEqual({ image: false });
  });

  test("absent, malformed or unrelated declarations stay unknown", () => {
    for (const entry of [
      {}, { image: "true" }, { vision: 1 }, { vision: { supported: true } },
      { attachment: true }, { attachment: false }, { supportsVision: true },
      { capabilities: { attachment: true } }, { capabilities: { input: { text: true } } },
      { capabilities: { input: { image: "true" } } },
      { modalities: { output: ["image"], input: "text,image" } },
      { modalities: { input: ["text", "image", null] } },
      { modalities: { input: ["text", "IMAGE"] } },
      { modalities: { input: ["unknown"] } },
      { modalities: { input: Array(17).fill("image") } },
      { input_modalities: { supported: ["image"] } },
      { architecture: { modality: "text+image->text" } },
      { name: "A multimodal vision model" },
    ]) expect(parseGatewayImageMetadata(entry)).toEqual({});
  });

  test("only input-image metadata is accepted and the remote object is not modified", () => {
    const entry = { id: "synthetic/opaque", modalities: { input: ["text", "image"], output: ["image"] },
      provider: { npm: "untrusted-package", api: "https://untrusted.invalid" },
      options: { apiKey: "synthetic-credential", baseURL: "https://untrusted.invalid" },
      capabilities: { tools: true, reasoning: true, input: { image: true } } };
    const before = JSON.stringify(entry);
    expect(parseGatewayImageMetadata(entry)).toEqual({ image: true });
    expect(JSON.stringify(entry)).toBe(before);
    expect(parseGatewayImageMetadata({ modalities: { output: ["image"] } })).toEqual({});
  });

  test("prototype properties do not become declared metadata", () => {
    expect(parseGatewayImageMetadata(Object.setPrototypeOf({}, { image: true, vision: true }))).toEqual({});
    expect(parseGatewayImageMetadata({ capabilities: { input: Object.setPrototypeOf({}, { image: true }) } })).toEqual({});
  });
});

describe("exact ModelHelm image fallback", () => {
  test("only documented full routing IDs receive the offline image capability", () => {
    for (const id of verifiedModels) {
      expect(gatewayImageMetadata(official, id, {})).toEqual({ image: true });
      expect(gatewayImageMetadata(`${official}/`, id, {})).toEqual({ image: true });
      expect(gatewayImageMetadata(official, id, { image: false })).toEqual({ image: false });
    }
  });

  test("the same model names never imply capabilities for another endpoint", () => {
    for (const baseURL of [
      "https://custom-gateway.invalid/v1", "http://127.0.0.1:1234/v1", "https://api.modelhelm.com.evil.invalid/v1",
      "https://api.modelhelm.com/v1/custom", "https://api.modelhelm.com/v1?vision=true", "https://api.modelhelm.com/v1#vision",
      "http://api.modelhelm.com/v1", "https://user:pass@api.modelhelm.com/v1", "https://api.modelhelm.com:443/v1",
    ]) for (const id of verifiedModels) expect(gatewayImageMetadata(baseURL, id, {})).toEqual({});
  });

  test("unknown aliases, suffixes, case changes and text-only siblings are not guessed", () => {
    for (const id of [
      "gpt-6.1-sol", "another/openai/gpt-6.1-sol", "openai/gpt-6.1-sol-new", "openai/GPT-6.1-sol",
      "anthropic/claude-sonnet-5-new", "anthropic/claude-sonnet-5.5", "google/gemini-new-vision",
      "qwen/qwen3.7-max", "qwen/qwen3.7-max-2026-06-08", "z-ai/glm-5", "z-ai/glm-5.2", "z-ai/glm-5.3",
      "z-ai/glm-5.3-flash", "minimax/minimax-m2", "minimax/minimax-m2.1", "minimax/minimax-m2.5", "minimax/minimax-m2.7",
      "deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash-0731", "synthetic/vision", "toString", "__proto__",
    ]) expect(gatewayImageMetadata(official, id, {})).toEqual({});
  });

  test("explicit image declarations apply to custom and unknown routes without copying extra fields", () => {
    const declared = { image: true, options: { apiKey: "synthetic-credential" }, provider: { npm: "untrusted-package" } };
    for (const baseURL of [official, "https://custom-gateway.invalid/v1"]) {
      expect(gatewayImageMetadata(baseURL, "synthetic/opaque", declared)).toEqual({ image: true });
      expect(gatewayImageMetadata(baseURL, "synthetic/opaque", { image: false })).toEqual({ image: false });
    }
    expect(declared.options.apiKey).toBe("synthetic-credential");
  });
});
