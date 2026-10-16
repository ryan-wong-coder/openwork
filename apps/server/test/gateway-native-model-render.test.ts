import { expect, test } from "bun:test";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL } from "../src/gateway-config";
import { mapRuntimeProvidersToV2Specs } from "../src/engine-v2-preview";
import { renderOpencodeV2Config } from "../src/managed-opencode-v2";

test("mixed ModelHelm models retain identity while Claude selects only its built-in native adapter", () => {
  const claude = "anthropic/claude-sonnet-5";
  const gpt = "openai/gpt-6.1-sol";
  const provider = buildGatewayProvider({ baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: claude,
    imageModel: "unused", imageSize: "auto", imageQuality: "auto", imageGenerationEnabled: false, requestTimeoutMs: 10000 },
  [claude, gpt].map(id => ({ id, name: id, kind: "chat" })), { port: 4321 });
  const mapped = mapRuntimeProvidersToV2Specs({ modelhelm: provider }, new Map(), new Map([["modelhelm", "synthetic-scoped-key"]]));
  expect(mapped.skippedProviderIds).toEqual([]);
  expect(mapped.specs).toHaveLength(1);
  expect(renderOpencodeV2Config({ providers: mapped.specs, skills: [] })).toMatchObject({
    providers: { modelhelm: { package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "http://127.0.0.1:4321/gateway/openai", apiKey: "synthetic-scoped-key" },
      models: { [claude]: { package: "@opencode/ai/providers/anthropic",
        settings: { thinking: { type: "adaptive", display: "summarized" } },
        capabilities: { output: ["text", "reasoning"] },
        variants: ["low", "medium", "high", "xhigh", "max"].map(effort => ({
          id: effort, settings: { effort, thinking: { type: "adaptive", display: "summarized" } },
        })),
      }, [gpt]: { variants: ["low", "medium", "high", "xhigh", "max"].map(reasoningEffort => ({
        id: reasoningEffort, settings: { reasoningEffort },
      })) } },
    } },
  });
});

test("unknown per-model SDK strings never become native package imports", () => {
  const rendered = renderOpencodeV2Config({ skills: [], providers: [{
    id: "synthetic", name: "Synthetic", apiKey: "synthetic", package: "@opencode/ai/providers/openai-compatible",
    models: [{ id: "model", name: "Model", config: { provider: { npm: "untrusted-remote-package" } } }],
  }] });
  expect(JSON.stringify(rendered)).not.toContain("untrusted-remote-package");
  expect(rendered).toMatchObject({ providers: { synthetic: { package: "@opencode/ai/providers/openai-compatible", models: { model: { name: "Model" } } } } });
});

test("a conflicting local Claude SDK does not regain native options when rebuilding and rendering", () => {
  const id = "anthropic/claude-sonnet-5";
  const settings = { baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: id, imageModel: "unused", imageSize: "auto",
    imageQuality: "auto", imageGenerationEnabled: false, requestTimeoutMs: 10000 };
  const models: Parameters<typeof buildGatewayProvider>[1] = [{ id, name: id, kind: "chat" }];
  const original = buildGatewayProvider(settings, models, { port: 4321 });
  for (const npm of ["@ai-sdk/openai-compatible", "@fixture/custom-sdk"]) {
    const local = { provider: { npm }, options: { custom: "retained" } };
    const rebuilt = buildGatewayProvider(settings, models, { port: 4321 }, { ...original, models: { [id]: local } });
    expect(rebuilt.models[id].provider).toEqual(local.provider);
    expect(rebuilt.models[id].options).toEqual(local.options);
    expect(Object.values(rebuilt.models[id].variants ?? {}).every(value => value.disabled === true)).toBe(true);
    const mapped = mapRuntimeProvidersToV2Specs({ modelhelm: rebuilt }, new Map(), new Map([["modelhelm", "synthetic"]]));
    const rendered = renderOpencodeV2Config({ providers: mapped.specs, skills: [] });
    expect(rendered).toMatchObject({ providers: { modelhelm: { models: { [id]: { settings: local.options, variants: [] } } } } });
    expect(JSON.stringify(rendered)).not.toContain("adaptive");
    expect(JSON.stringify(rendered)).not.toContain("@opencode/ai/providers/anthropic");
  }
});

