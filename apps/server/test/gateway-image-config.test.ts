import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvService } from "../src/env-file";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, GATEWAY_API_KEY_ENV, GATEWAY_MODEL_CATALOG_ENV, parseGatewayModels, readGatewaySettings, restoreGatewayProvider, type GatewaySettings } from "../src/gateway-config";
import { mapRuntimeProvidersToV2Specs } from "../src/engine-v2-preview";
import { renderOpencodeV2Config } from "../src/managed-opencode-v2";
import { readGlobalRuntimeOpencodeConfig, writeGlobalRuntimeOpencodeConfig } from "../src/runtime-opencode-config-store";
import type { ServerConfig } from "../src/types";

const id = "openai/gpt-6.1-sol";
const textOnly = { input: ["text"], output: ["text"] };
const images = { input: ["text", "image"], output: ["text"] };
const settings: GatewaySettings = { baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: id, imageModel: "openai/gpt-image-2", imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 60000, imageGenerationEnabled: false };

test("discovered image metadata survives private cache JSON and reaches the real V2 config renderer", () => {
  const catalog = parseGatewayModels({ data: [
    { id, capabilities: { input: { image: true } }, provider: { npm: "untrusted" }, options: { headers: "untrusted" } },
    { id: "synthetic/text-only", modalities: { input: ["text"] } },
  ] });
  expect(parseGatewayModels({ data: JSON.parse(JSON.stringify(catalog)) })).toEqual(catalog);
  const provider = buildGatewayProvider(settings, catalog, { port: 4321 });
  expect(provider.models[id]).toMatchObject({ attachment: true, modalities: images });
  expect(provider.models["synthetic/text-only"]).toMatchObject({ attachment: false, modalities: textOnly });
  const mapped = mapRuntimeProvidersToV2Specs({ modelhelm: provider }, new Map(), new Map([["modelhelm", "synthetic-scoped-token"]]));
  expect(renderOpencodeV2Config({ providers: mapped.specs, skills: [] })).toMatchObject({ providers: { modelhelm: { models: {
    [id]: { capabilities: { input: ["text", "image"] } },
    "synthetic/text-only": { capabilities: { input: ["text"] } },
  } } } });
  expect(JSON.stringify(provider)).not.toContain("untrusted");
});

test("remote explicit image false overrides known fallback and managed defaults follow later declarations", () => {
  const enabled = buildGatewayProvider(settings, parseGatewayModels({ data: [{ id }] }), { port: 4321 });
  const disabled = buildGatewayProvider(settings, parseGatewayModels({ data: [{ id, image: false }] }), { port: 4321 }, enabled);
  expect(disabled.models[id]).toMatchObject({ attachment: false, modalities: textOnly });
  const restored = buildGatewayProvider(settings, parseGatewayModels({ data: [{ id, image: true }] }), { port: 4321 }, disabled);
  expect(restored.models[id]).toMatchObject({ attachment: true, modalities: images });
});

test("an explicit local text-only edit remains authoritative across repeated directory rebuilds", () => {
  const catalog = parseGatewayModels({ data: [{ id }] });
  const generated = buildGatewayProvider(settings, catalog, { port: 4321 });
  let provider = { ...generated, models: { ...generated.models,
    [id]: { ...generated.models[id], attachment: false, modalities: textOnly },
  } };
  for (let rebuild = 0; rebuild < 3; rebuild++) {
    provider = buildGatewayProvider(settings, catalog, { port: 4321 }, provider);
    expect(provider.models[id]).toMatchObject({ attachment: false, modalities: textOnly });
    expect(provider.options.gatewayImageCapabilities.explicit).toEqual([id]);
    expect(provider.options.gatewayImageCapabilities.models).toEqual({});
  }
});

test("changing the model SDK/settings preserves its explicitly retained text-only capability", () => {
  const base = { ...settings, baseURL: "https://custom-gateway.invalid/v1" };
  const disabled = buildGatewayProvider(base, parseGatewayModels({ data: [{ id, image: false }] }), { port: 4321 });
  let provider = { ...disabled, models: { ...disabled.models, [id]: { ...disabled.models[id],
    provider: { npm: "@fixture/custom-sdk" }, options: { custom: "retained" },
  } } };
  for (let rebuild = 0; rebuild < 3; rebuild++) {
    provider = buildGatewayProvider(base, parseGatewayModels({ data: [{ id, image: true }] }), { port: 4321 }, provider);
    expect(provider.models[id]).toMatchObject({ attachment: false, modalities: textOnly,
      provider: { npm: "@fixture/custom-sdk" }, options: { custom: "retained" } });
    expect(provider.options.gatewayImageCapabilities.explicit).toEqual([id]);
  }
});

test("unknown gateways and routes keep conservative defaults while an explicit remote image declaration works", () => {
  const custom = { ...settings, baseURL: "https://custom-gateway.invalid/v1" };
  const unknown = buildGatewayProvider(custom, parseGatewayModels({ data: [{ id }] }), { port: 4321 });
  expect(unknown.models[id]).toMatchObject({ attachment: false, modalities: textOnly });
  const declared = buildGatewayProvider(custom, parseGatewayModels({ data: [{ id, modalities: { input: ["text", "image"] } }] }), { port: 4321 }, unknown);
  expect(declared.models[id]).toMatchObject({ attachment: true, modalities: images });
  const omitted = buildGatewayProvider(custom, parseGatewayModels({ data: [{ id }] }), { port: 4321 }, declared);
  expect(omitted.models[id]).toMatchObject({ attachment: true, modalities: images });
});

let directory: string;
let inheritedRuntimeDb: string | undefined;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "gateway-image-migration-"));
  inheritedRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
  delete process.env.OPENWORK_RUNTIME_DB;
});
afterAll(async () => {
  if (inheritedRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = inheritedRuntimeDb;
  await rm(directory, { recursive: true, force: true });
});
function config(name: string): ServerConfig {
  return { host: "127.0.0.1", port: 4321, token: "synthetic-client", hostToken: "synthetic-host", configPath: join(directory, name, "server.json"), clientProfile: "local-gateway",
    workspaces: [], authorizedRoots: [], corsOrigins: [], approval: { mode: "auto", timeoutMs: 1000 }, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
}
async function profile(name: string, modelId: string, cached: boolean, baseURL = DEFAULT_GATEWAY_BASE_URL, image?: boolean) {
  const server = config(name);
  const env = new EnvService({ path: join(directory, `${name}-env.json`) });
  const key = "synthetic-image-migration-key";
  await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: key },
    { key: "OPENWORK_GATEWAY_BASE_URL", value: baseURL }, { key: "OPENWORK_GATEWAY_CHAT_MODEL", value: modelId },
    ...(cached ? [{ key: GATEWAY_MODEL_CATALOG_ENV, value: JSON.stringify({ version: 1,
      fingerprint: createHash("sha256").update(baseURL).update("\0").update(key).digest("hex"),
      models: [{ id: modelId, name: "Cached image fixture", ...(image === undefined ? {} : { image }) }], syncedAt: 1,
    }) }] : []),
  ]);
  return { server, env, settings: (await readGatewaySettings(env)).settings };
}

for (const cached of [false, true]) for (const modelId of [id, "anthropic/claude-sonnet-5"]) {
  test(`startup repairs shipped text-only configuration exactly once (${modelId}, cache ${cached})`, async () => {
    const local = await profile(`legacy-${modelId.replaceAll("/", "-")}-${cached}`, modelId, cached);
    const provider = buildGatewayProvider(local.settings, parseGatewayModels({ data: [{ id: modelId }] }), local.server);
    const oldOptions: Record<string, unknown> = { ...provider.options };
    delete oldOptions.gatewayImageCapabilities;
    await writeGlobalRuntimeOpencodeConfig(local.server, () => ({ provider: { modelhelm: { ...provider, options: oldOptions, models: {
      [modelId]: { ...provider.models[modelId], attachment: false, modalities: textOnly },
    } }, unrelated: { name: "Preserved fixture" } } }));
    expect(await restoreGatewayProvider(local.server, local.env)).toEqual({ ready: true, changed: true });
    expect((await readGlobalRuntimeOpencodeConfig(local.server)).provider).toMatchObject({ modelhelm: { models: {
      [modelId]: { attachment: true, modalities: images },
    } }, unrelated: { name: "Preserved fixture" } });
    expect(await restoreGatewayProvider(local.server, local.env)).toEqual({ ready: true, changed: false });
  });
}

for (const cached of [false, true]) {
  test(`startup preserves custom input/settings overrides twice (cache ${cached})`, async () => {
    const local = await profile(`explicit-${cached}`, id, cached);
    const generated = buildGatewayProvider(local.settings, parseGatewayModels({ data: [{ id }] }), local.server);
    const oldOptions: Record<string, unknown> = { ...generated.options }; delete oldOptions.gatewayImageCapabilities;
    const explicit = { ...generated.models[id], attachment: false, modalities: textOnly, options: { custom: "retained" }, limit: { context: 8192, output: 512 } };
    await writeGlobalRuntimeOpencodeConfig(local.server, () => ({ provider: { modelhelm: { ...generated, options: oldOptions, models: { [id]: explicit } } } }));
    for (let start = 0; start < 2; start++) {
      const restored = await restoreGatewayProvider(local.server, local.env);
      expect(restored.ready).toBe(true);
      if (start > 0) expect(restored.changed).toBe(false);
      expect((await readGlobalRuntimeOpencodeConfig(local.server)).provider).toMatchObject({ modelhelm: { models: { [id]: explicit } } });
    }
  });
}

test("legacy startup without a catalog retains the last managed remote declaration", async () => {
  for (const image of [true, false]) {
    const local = await profile(`missing-cache-declaration-${image}`, id, false, DEFAULT_GATEWAY_BASE_URL);
    const generated = buildGatewayProvider(local.settings, parseGatewayModels({ data: [{ id, image }] }), local.server);
    await writeGlobalRuntimeOpencodeConfig(local.server, () => ({ provider: { modelhelm: generated } }));
    for (let start = 0; start < 2; start++) {
      const restored = await restoreGatewayProvider(local.server, local.env);
      expect(restored.ready).toBe(true);
      if (start > 0) expect(restored.changed).toBe(false);
      expect((await readGlobalRuntimeOpencodeConfig(local.server)).provider).toMatchObject({ modelhelm: { models: {
        [id]: { attachment: image, modalities: image ? images : textOnly },
      } } });
    }
  }
});

test("a missing catalog cannot carry generated image capabilities across an external key rotation", async () => {
  const local = await profile("rotated-key-missing-cache", id, false);
  const oldBinding = createHash("sha256").update(DEFAULT_GATEWAY_BASE_URL).update("\0").update("synthetic-image-migration-key").digest("hex");
  const generated = buildGatewayProvider(local.settings, parseGatewayModels({ data: [{ id, image: false }] }), local.server, undefined, oldBinding);
  await writeGlobalRuntimeOpencodeConfig(local.server, () => ({ provider: { modelhelm: generated, unrelated: { name: "Preserved" } } }));
  await local.env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: "synthetic-new-key" }]);
  expect(await restoreGatewayProvider(local.server, local.env)).toEqual({ ready: false, changed: true });
  expect((await readGlobalRuntimeOpencodeConfig(local.server)).provider).toEqual({ unrelated: { name: "Preserved" } });
  expect(await restoreGatewayProvider(local.server, local.env)).toEqual({ ready: false, changed: false });
});
