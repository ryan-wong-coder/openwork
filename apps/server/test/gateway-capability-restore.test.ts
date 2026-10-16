import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EnvService } from "../src/env-file";
import { DEFAULT_GATEWAY_BASE_URL, GATEWAY_API_KEY_ENV, GATEWAY_MODEL_CATALOG_ENV, buildGatewayProvider, readGatewaySettings, restoreGatewayProvider, saveGatewayConfig, syncGatewayModels } from "../src/gateway-config";
import { readGlobalRuntimeOpencodeConfig, writeGlobalRuntimeOpencodeConfig } from "../src/runtime-opencode-config-store";
import type { ServerConfig } from "../src/types";

let directory: string;
let inheritedRuntimeDb: string | undefined;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "gateway-capability-migration-"));
  inheritedRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
  delete process.env.OPENWORK_RUNTIME_DB;
});
afterAll(async () => {
  if (inheritedRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = inheritedRuntimeDb;
  await rm(directory, { recursive: true, force: true });
});
const modelId = "deepseek/deepseek-v4-flash";
const key = "synthetic-offline-key";
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function config(name: string): ServerConfig {
  return { host: "127.0.0.1", port: 4321, token: "synthetic-client", hostToken: "synthetic-host",
    configPath: join(directory, name, "server.json"), clientProfile: "local-gateway",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [], workspaces: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
}

for (const migration of [{ id: modelId, disabled: "medium" }, { id: "openai/gpt-6.1-sol", disabled: "none" },
  { id: "anthropic/claude-sonnet-5", disabled: "none" }]) for (const cached of [true, false]) {
  test(`startup migrates existing ready gateway capabilities offline (${migration.id}, ${cached ? "validated private cache" : "legacy profile without cache"})`, async () => {
    const modelId = migration.id;
    const suffix = `${cached ? "cached" : "legacy"}-${modelId.replaceAll("/", "-")}`;
    const profile = config(suffix);
    const env = new EnvService({ path: join(directory, `${suffix}-env.json`) });
    await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: key },
      { key: "OPENWORK_GATEWAY_BASE_URL", value: DEFAULT_GATEWAY_BASE_URL },
      { key: "OPENWORK_GATEWAY_CHAT_MODEL", value: modelId },
      ...(cached ? [{ key: GATEWAY_MODEL_CATALOG_ENV, value: JSON.stringify({ version: 1,
        fingerprint: createHash("sha256").update(DEFAULT_GATEWAY_BASE_URL).update("\0").update(key).digest("hex"),
        models: [{ id: modelId, name: "Synthetic cached model", kind: "chat" }], syncedAt: 1,
      }) }] : []),
    ]);
    const { settings } = await readGatewaySettings(env);
    const provider = buildGatewayProvider(settings, [{ id: modelId, name: "Legacy model", kind: "chat" }], profile);
    // Reproduce the shipped pre-fix provider, which had no reasoning metadata.
    await writeGlobalRuntimeOpencodeConfig(profile, () => ({ provider: { modelhelm: { ...provider, models: {
      [modelId]: { name: "Legacy model", tool_call: true, attachment: false, modalities: { input: ["text"], output: ["text"] } },
    } }, unrelated: { name: "Preserved" } } }));
    expect(await restoreGatewayProvider(profile, env)).toEqual({ ready: true, changed: true });
    const runtime = await readGlobalRuntimeOpencodeConfig(profile);
    const nativeClaude = modelId === "anthropic/claude-sonnet-5";
    expect(runtime.provider?.modelhelm).toMatchObject({ models: { [modelId]: {
      reasoning: true, variants: { high: nativeClaude ? { effort: "high", thinking: { type: "adaptive", display: "summarized" } }
        : { reasoningEffort: "high" }, [migration.disabled]: { disabled: true } },
      ...(nativeClaude ? { provider: { npm: "@ai-sdk/anthropic" }, options: { thinking: { type: "adaptive", display: "summarized" } } } : {}),
    } } });
    expect(runtime.provider?.unrelated).toEqual({ name: "Preserved" });
    expect(JSON.stringify(runtime)).not.toContain(key);
    expect(await restoreGatewayProvider(profile, env)).toEqual({ ready: true, changed: false });
  });
}

test("an unconfigured or cleared gateway never gains a provider or implied capabilities", async () => {
  const profile = config("not-configured");
  const env = new EnvService({ path: join(directory, "no-key-env.json") });
  await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: "" }, { key: "OPENWORK_GATEWAY_BASE_URL", value: DEFAULT_GATEWAY_BASE_URL }]);
  expect(await restoreGatewayProvider(profile, env)).toMatchObject({ ready: false });
  expect((await readGlobalRuntimeOpencodeConfig(profile)).provider).toBeUndefined();
  expect(await restoreGatewayProvider(profile, env)).toEqual({ ready: false, changed: false });
});

for (const modelId of ["deepseek/deepseek-v4-flash", "openai/gpt-6.1-sol", "anthropic/claude-sonnet-5"]) for (const cached of [true, false]) for (const baseURL of [DEFAULT_GATEWAY_BASE_URL, "https://custom-gateway.invalid/v1"]) {
  test(`startup preserves complete explicit model config twice (${modelId}, ${cached ? "cache" : "legacy"}, ${baseURL === DEFAULT_GATEWAY_BASE_URL ? "ModelHelm" : "custom"})`, async () => {
    const suffix = `${modelId.replaceAll("/", "-")}-${cached}-${baseURL === DEFAULT_GATEWAY_BASE_URL}`;
    const profile = config(`explicit-${suffix}`);
    const env = new EnvService({ path: join(directory, `explicit-env-${suffix}.json`) });
    await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: key }, { key: "OPENWORK_GATEWAY_BASE_URL", value: baseURL },
      { key: "OPENWORK_GATEWAY_CHAT_MODEL", value: modelId },
      ...(cached ? [{ key: GATEWAY_MODEL_CATALOG_ENV, value: JSON.stringify({ version: 1,
        fingerprint: createHash("sha256").update(baseURL).update("\0").update(key).digest("hex"),
        models: [{ id: modelId, name: "Catalog label", kind: "chat" }], syncedAt: 1,
      }) }] : []),
    ]);
    const { settings } = await readGatewaySettings(env);
    const provider = buildGatewayProvider(settings, [{ id: modelId, name: "Legacy", kind: "chat" }], profile);
    const explicit = { name: "User label", reasoning: true, interleaved: { field: "reasoning_details" },
      variants: { careful: { reasoningEffort: "high", temperature: 0.2 },
        budget: { thinking: { type: "enabled", budgetTokens: 8192 } }, high: { disabled: true } },
      tool_call: true, attachment: false, modalities: { input: ["text"], output: ["text"] },
      options: { custom: "preserved", ...(modelId === "anthropic/claude-sonnet-5" ? { thinking: { type: "adaptive", display: "omitted" } } : {}) },
      ...(modelId === "anthropic/claude-sonnet-5" ? { provider: { npm: "@ai-sdk/anthropic", api: "https://explicit.invalid" } } : {}),
      limit: { context: 32000, output: 8192 },
    };
    await writeGlobalRuntimeOpencodeConfig(profile, () => ({ provider: { modelhelm: { ...provider, models: { [modelId]: explicit } } } }));
    for (let start = 0; start < 2; start++) {
      const restored = await restoreGatewayProvider(profile, env);
      expect(restored.ready).toBe(true);
      if (start > 0) expect(restored.changed).toBe(false);
      expect((await readGlobalRuntimeOpencodeConfig(profile)).provider?.modelhelm).toMatchObject({ models: { [modelId]: explicit } });
      const runtime = await readGlobalRuntimeOpencodeConfig(profile);
      const gateway = runtime.provider?.modelhelm;
      if (!record(gateway) || !record(gateway.models)) throw new Error("Missing runtime models");
      expect(gateway.models[modelId]).toEqual(explicit);
    }
  });
}


for (const cached of [true, false]) for (const npm of ["@ai-sdk/openai-compatible", "@fixture/custom-sdk"]) {
  test(`startup respects conflicting local Claude SDK and explicit variants (${cached ? "cache" : "legacy"}, ${npm})`, async () => {
    const id = "anthropic/claude-sonnet-5";
    const suffix = `${cached}-${npm.replaceAll("/", "-")}`;
    const profile = config(`conflicting-${suffix}`);
    const env = new EnvService({ path: join(directory, `conflicting-env-${suffix}.json`) });
    await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: key },
      { key: "OPENWORK_GATEWAY_BASE_URL", value: DEFAULT_GATEWAY_BASE_URL }, { key: "OPENWORK_GATEWAY_CHAT_MODEL", value: id },
      ...(cached ? [{ key: GATEWAY_MODEL_CATALOG_ENV, value: JSON.stringify({ version: 1,
        fingerprint: createHash("sha256").update(DEFAULT_GATEWAY_BASE_URL).update("\0").update(key).digest("hex"),
        models: [{ id, name: "Catalog Claude", kind: "chat" }], syncedAt: 1,
      }) }] : []),
    ]);
    const { settings } = await readGatewaySettings(env);
    const provider = buildGatewayProvider(settings, [{ id, name: "Claude", kind: "chat" }], profile);
    const local = { name: "User Claude", provider: { npm }, options: { custom: "retained" } };
    await writeGlobalRuntimeOpencodeConfig(profile, () => ({ provider: { modelhelm: { ...provider, models: { [id]: local } } } }));
    for (let start = 0; start < 2; start++) {
      const restored = await restoreGatewayProvider(profile, env);
      expect(restored.ready).toBe(true);
      if (start > 0) expect(restored.changed).toBe(false);
      const gateway = (await readGlobalRuntimeOpencodeConfig(profile)).provider?.modelhelm;
      if (!record(gateway) || !record(gateway.models) || !record(gateway.models[id])) throw new Error("Missing local model");
      const model = gateway.models[id];
      expect(model.provider).toEqual(local.provider);
      expect(model.options).toEqual(local.options);
      expect(model.reasoning).toBeUndefined();
      expect(record(model.variants) && Object.values(model.variants).every(value => record(value) && value.disabled === true)).toBe(true);
    }
    const explicit = { ...local, variants: { custom: { reasoningEffort: "high", temperature: 0.2 } } };
    await writeGlobalRuntimeOpencodeConfig(profile, runtime => ({ ...runtime, provider: { modelhelm: { ...provider, models: { [id]: explicit } } } }));
    await restoreGatewayProvider(profile, env);
    const gateway = (await readGlobalRuntimeOpencodeConfig(profile)).provider?.modelhelm;
    if (!record(gateway) || !record(gateway.models)) throw new Error("Missing explicit model");
    const restored = gateway.models[id];
    if (!record(restored)) throw new Error("Missing explicit model config");
    expect(restored.provider).toEqual(explicit.provider);
    expect(restored.options).toEqual(explicit.options);
    expect(restored.variants).toEqual(explicit.variants);
    expect(restored.reasoning).toBeUndefined();
  });
}


test("explicit model overrides do not cross a changed endpoint or key, including a repaired stale catalog", async () => {
  const syntheticModel = "synthetic/reasoner";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ data: [{ id: syntheticModel }] }) });
  const profile = config("changed-binding");
  const env = new EnvService({ path: join(directory, "changed-binding-env.json") });
  const baseURL = `http://127.0.0.1:${server.port}/first`;
  const addOverride = () => writeGlobalRuntimeOpencodeConfig(profile, runtime => {
    const gateway = runtime.provider?.modelhelm;
    if (typeof gateway !== "object" || gateway === null) throw new Error("Missing gateway");
    return { ...runtime, provider: { ...runtime.provider, modelhelm: { ...gateway, models: {
      [syntheticModel]: { name: "User override", reasoning: true, variants: { careful: { reasoningEffort: "high", temperature: 0.2 } } },
    } } } };
  });
  const expectNoOverride = async () => {
    const gateway = (await readGlobalRuntimeOpencodeConfig(profile)).provider?.modelhelm;
    expect(gateway).toMatchObject({ models: { [syntheticModel]: { name: syntheticModel } } });
    expect(JSON.stringify(gateway)).not.toContain("careful");
  };
  try {
    await saveGatewayConfig(profile, env, { baseURL, apiKey: "synthetic-first-key", chatModel: syntheticModel, imageGenerationEnabled: false });
    await addOverride();
    await saveGatewayConfig(profile, env, { apiKey: "synthetic-replacement-key" });
    await expectNoOverride();
    await addOverride();
    await saveGatewayConfig(profile, env, { baseURL: `http://127.0.0.1:${server.port}/second` });
    await expectNoOverride();
    await addOverride();
    await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: "synthetic-external-rotation" }]);
    await syncGatewayModels(profile, env);
    await expectNoOverride();
  } finally { server.stop(true); }
});
