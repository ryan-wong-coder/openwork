// Run with Bun and OPENWORK_TEST_OPENCODE2_BIN pointing at the pinned native
// sidecar. Uses a synthetic key and localhost only; creates no desktop window.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createManagedOpencodeV2Server } from "../../src/managed-opencode-v2.ts";
import { mapRuntimeProvidersToV2Specs } from "../../src/engine-v2-preview.ts";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, parseGatewayModels, type GatewaySettings } from "../../src/gateway-config.ts";
import { GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken } from "../../src/gateway-proxy-auth.ts";
import artifacts from "../../src/opencode-v2-artifacts.json" with { type: "json" };
import { syntheticNativeGateway, assertSyntheticClaudeRequests, CLAUDE_EFFORTS, CLAUDE_MODEL, CLAUDE_MODELS } from "./gateway-reasoning-native-upstream";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function until(read: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

const binary = process.env.OPENWORK_TEST_OPENCODE2_BIN;
assert.ok(binary && binary.trim(), "Set OPENWORK_TEST_OPENCODE2_BIN to the pinned OpenCode v2 executable.");
const root = await mkdtemp(join(tmpdir(), "zeno-v2-reasoning-proof-"));
const gateway = await syntheticNativeGateway(root);
const { config, cc: captures } = gateway;
const fakeURL = `http://127.0.0.1:${config.port}/catalog`;
let managed: Awaited<ReturnType<typeof createManagedOpencodeV2Server>> | undefined;
try {
  for (const dir of ["home", "config", "cache", "data", "state", "workspace"]) await mkdir(join(root, dir), { recursive: true });
  managed = await createManagedOpencodeV2Server({
    bin: resolve(binary), rootDir: join(root, "engine"), bootTimeoutMs: 30_000,
    env: {
      HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
      OPENWORK_CLIENT_PROFILE: "local-gateway", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_MODELS_URL: `${fakeURL}/catalog`,
    },
  });
  assert.equal((await managed.health()).version, artifacts.version);
  // Use the real ModelHelm materializer for the exact routing ID and effort
  // metadata. Its process-local proxy points only at our synthetic listener.
  const sixModel = "openai/gpt-6.1-sol";
  const settings: GatewaySettings = { baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: sixModel, imageModel: "synthetic-image",
    imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 30_000, imageGenerationEnabled: false };
  const generated = buildGatewayProvider(settings, parseGatewayModels({ data: [sixModel, ...CLAUDE_MODELS].map(id => ({ id })) }), config);
  assert.equal(new URL(generated.options.baseURL).hostname, "127.0.0.1");
  assert.equal(new URL(generated.options.baseURL).port, String(config.port));
  const mapped = mapRuntimeProvidersToV2Specs({
    modelhelm: {
      ...generated,
      models: {
        ...generated.models,
        "vendor/reasoner": { name: "Synthetic", reasoning: true, variants: { low: { reasoningEffort: "low" }, high: { reasoningEffort: "high" } } },
        "vendor/builtin-only": { name: "Synthetic built-in reasoning", reasoning: true, variants: {} },
      },
    },
  }, new Map([[GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken(config)]]));
  assert.equal(mapped.specs.length, 1);
  await managed.setProviders(mapped.specs);
  // Wait for the real watched catalog, rather than assuming a fixed reload
  // delay. These are the exact raw fields consumed by the frontend adapter.
  const current = managed;
  let catalog: Record<string, unknown>[] = [];
  await until(async () => {
    const response = await current.fetchJson("/api/model", { timeoutMs: 5_000 });
    assert.equal(response.status, 200);
    const items = isRecord(response.json) ? response.json.data : response.json;
    assert.ok(Array.isArray(items));
    catalog = items.filter(isRecord).filter(model => model.providerID === "modelhelm");
    return ["vendor/reasoner", "vendor/builtin-only", sixModel, ...CLAUDE_MODELS].every(id => catalog.some(model => model.id === id));
  }, "native V2 catalog includes all injected models");
  const adjustable = catalog.find(model => model.id === "vendor/reasoner");
  assert.ok(adjustable && isRecord(adjustable.capabilities));
  assert.ok(Array.isArray(adjustable.capabilities.output) && adjustable.capabilities.output.includes("reasoning"));
  assert.ok(Array.isArray(adjustable.variants));
  const high = adjustable.variants.find((variant: unknown) => isRecord(variant) && variant.id === "high");
  assert.ok(isRecord(high) && isRecord(high.settings));
  assert.equal(high.settings.reasoningEffort, "high");
  const builtin = catalog.find(model => model.id === "vendor/builtin-only");
  assert.ok(builtin && isRecord(builtin.capabilities));
  assert.ok(Array.isArray(builtin.capabilities.output) && builtin.capabilities.output.includes("reasoning"));
  assert.deepEqual(builtin.variants, [], "Built-in reasoning must not acquire inferred effort controls.");
  const six = catalog.find(model => model.id === sixModel);
  assert.ok(six && isRecord(six.capabilities));
  assert.ok(Array.isArray(six.capabilities.output) && six.capabilities.output.includes("reasoning"));
  assert.ok(Array.isArray(six.variants));
  const sixVariants = six.variants.filter(isRecord);
  assert.deepEqual(sixVariants.map(variant => variant.id).sort(), ["low", "medium", "high", "xhigh", "max"].sort());
  for (const variant of sixVariants) {
    assert.ok(isRecord(variant.settings));
    assert.equal(variant.settings.reasoningEffort, variant.id);
  }
  for (const id of CLAUDE_MODELS) {
    const claude = catalog.find(model => model.id === id);
    assert.ok(claude && isRecord(claude.capabilities));
    assert.equal(claude.package, "@opencode/ai/providers/anthropic");
    assert.ok(Array.isArray(claude.capabilities.output) && claude.capabilities.output.includes("reasoning"));
    assert.ok(Array.isArray(claude.variants));
    const variants = claude.variants.filter(isRecord);
    assert.deepEqual(variants.map(variant => variant.id).sort(), CLAUDE_EFFORTS.slice().sort());
    for (const variant of variants) {
      assert.ok(isRecord(variant.settings));
      assert.equal(variant.settings.effort, variant.id);
      assert.deepEqual(variant.settings.thinking, { type: "adaptive", display: "summarized" });
      assert.equal(variant.settings.reasoningEffort, undefined);
    }
  }
  const created = await managed.fetchJson("/api/session", { method: "POST", body: {
    title: "Synthetic reasoning proof", location: { directory: join(root, "workspace") }, model: { providerID: "modelhelm", id: "vendor/reasoner" },
  }, timeoutMs: 30_000 });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.ok(isRecord(created.json));
  const session = isRecord(created.json.data) ? created.json.data : created.json;
  assert.equal(typeof session.id, "string");
  const sessionId = String(session.id);
  const bound = await managed.fetchJson(`/api/session/${sessionId}/model`, { method: "POST", body: {
    model: { providerID: "modelhelm", id: "vendor/reasoner", variant: "high" },
  }, timeoutMs: 30_000 });
  assert.ok(bound.status >= 200 && bound.status < 300, JSON.stringify(bound.json));
  for (const [index, text] of ["Reply with a short synthetic result.", "Reply to this synthetic follow-up."].entries()) {
    const prompt = await managed.fetchJson(`/api/session/${sessionId}/prompt`, { method: "POST", body: { text }, timeoutMs: 30_000 });
    assert.ok(prompt.status >= 200 && prompt.status < 300, JSON.stringify(prompt.json));
    await until(async () => captures.length > index, "native V2 reaches the local synthetic endpoint");
    await until(async () => {
      const active = await current.fetchJson("/api/session/active", { timeoutMs: 5_000 });
      assert.equal(active.status, 200);
      assert.ok(isRecord(active.json));
      const states = isRecord(active.json.data) ? active.json.data : active.json;
      return !isRecord(states[sessionId]) || states[sessionId].type === "idle";
    }, "native V2 finishes the synthetic turn");
  }
  for (const captured of captures) {
    assert.equal(captured.model, "vendor/reasoner", "The complete upstream model ID must be preserved.");
    assert.equal(captured.reasoning_effort, "high");
    assert.equal(captured.stream, true);
  }
  assert.equal(captures.length, 2);
  assert.ok(Array.isArray(captures[1].messages));
  const replay = captures[1].messages.find((message: unknown) => isRecord(message) && message.role === "assistant");
  assert.ok(isRecord(replay));
  assert.equal(replay.reasoning_content, "Synthetic thought.", "Native compatible history must replay reasoning without an interleaved override.");
  for (const effort of ["high", "max"]) {
    const before: number = captures.length;
    const createdSix: { status: number; json: unknown } = await managed.fetchJson("/api/session", { method: "POST", body: {
      title: `Synthetic 6.1 ${effort}`, location: { directory: join(root, "workspace") }, model: { providerID: "modelhelm", id: sixModel },
    }, timeoutMs: 30_000 });
    assert.equal(createdSix.status, 200, JSON.stringify(createdSix.json));
    assert.ok(isRecord(createdSix.json));
    const sixSession = isRecord(createdSix.json.data) ? createdSix.json.data : createdSix.json;
    assert.equal(typeof sixSession.id, "string");
    const sixSessionId = String(sixSession.id);
    const selected = await managed.fetchJson(`/api/session/${sixSessionId}/model`, { method: "POST", body: {
      model: { providerID: "modelhelm", id: sixModel, variant: effort },
    }, timeoutMs: 30_000 });
    assert.ok(selected.status >= 200 && selected.status < 300, JSON.stringify(selected.json));
    const prompted = await managed.fetchJson(`/api/session/${sixSessionId}/prompt`, { method: "POST", body: { text: "Reply with a short synthetic result." }, timeoutMs: 30_000 });
    assert.ok(prompted.status >= 200 && prompted.status < 300, JSON.stringify(prompted.json));
    await until(async () => captures.length > before, `6.1 ${effort} reaches the synthetic endpoint`);
    assert.equal(captures[before].model, sixModel, "Preserve the complete 6.1 upstream routing ID.");
    assert.equal(captures[before].reasoning_effort, effort);
    assert.equal(captures[before].stream, true);
    await until(async () => {
      const active = await current.fetchJson("/api/session/active", { timeoutMs: 5_000 });
      assert.equal(active.status, 200);
      assert.ok(isRecord(active.json));
      const states = isRecord(active.json.data) ? active.json.data : active.json;
      return !isRecord(states[sixSessionId]) || states[sixSessionId].type === "idle";
    }, `6.1 ${effort} finishes`);
  }
  assert.equal(captures.length, 4);
  for (const effort of ["high", "xhigh", "max"]) {
    const before = gateway.anthropic.length;
    const createdClaude = await managed.fetchJson("/api/session", { method: "POST", body: {
      title: `Synthetic Claude ${effort}`, location: { directory: join(root, "workspace") }, model: { providerID: "modelhelm", id: CLAUDE_MODEL },
    }, timeoutMs: 30_000 });
    assert.equal(createdClaude.status, 200);
    assert.ok(isRecord(createdClaude.json));
    const claudeSession = isRecord(createdClaude.json.data) ? createdClaude.json.data : createdClaude.json;
    assert.equal(typeof claudeSession.id, "string");
    const claudeId = String(claudeSession.id);
    const selected = await managed.fetchJson(`/api/session/${claudeId}/model`, { method: "POST", body: { model: { providerID: "modelhelm", id: CLAUDE_MODEL, variant: effort } }, timeoutMs: 30_000 });
    assert.ok(selected.status >= 200 && selected.status < 300);
    const prompted = await managed.fetchJson(`/api/session/${claudeId}/prompt`, { method: "POST", body: {
      text: `Synthetic Claude ${effort}. Read the fixture proof when requested and answer briefly.`,
    }, timeoutMs: 30_000 });
    assert.ok(prompted.status >= 200 && prompted.status < 300);
    await until(async () => gateway.anthropic.length > before, `Claude ${effort} reaches the authenticated proxy`);
    await until(async () => {
      const active = await current.fetchJson("/api/session/active", { timeoutMs: 5_000 });
      assert.equal(active.status, 200);
      assert.ok(isRecord(active.json));
      const states = isRecord(active.json.data) ? active.json.data : active.json;
      return !isRecord(states[claudeId]) || states[claudeId].type === "idle";
    }, `Claude ${effort} finishes its native turn`);
  }
  const nativeClaude = assertSyntheticClaudeRequests(gateway.anthropic);
  console.log(JSON.stringify({ passed: true, engineVersion: artifacts.version, protocols: ["OpenAI-compatible Chat Completions", "Anthropic Messages"], provider: "modelhelm", model: "vendor/reasoner", nativeCatalogReasoning: true, nativeCatalogHighEffort: "high", nativeBuiltinReasoningWithoutDial: true, variant: "high", reasoning_effort: "high", reasoningReplay: true, sixModel, sixEfforts: ["low", "medium", "high", "xhigh", "max"], sixCapturedEfforts: ["high", "max"], nativeClaude, externalModelCalls: 0, keyType: "synthetic", capturedRequests: captures.length, nativeClaudeRequests: gateway.anthropic.length }));
} finally {
  await managed?.close();
  await gateway.stop();
  await rm(root, { recursive: true, force: true });
}
