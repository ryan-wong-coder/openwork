// Run with Bun and OPENWORK_TEST_OPENCODE2_BIN pointing at the pinned native
// sidecar. Uses a synthetic key and localhost only; creates no desktop window.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createManagedOpencodeV2Server } from "../../src/managed-opencode-v2.ts";
import { mapRuntimeProvidersToV2Specs } from "../../src/engine-v2-preview.ts";
import artifacts from "../../src/opencode-v2-artifacts.json" with { type: "json" };

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
assert.ok(binary?.trim(), "Set OPENWORK_TEST_OPENCODE2_BIN to the pinned OpenCode v2 executable.");
const root = await mkdtemp(join(tmpdir(), "zeno-v2-reasoning-proof-"));
const captures: Record<string, unknown>[] = [];
const fake = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    assert.ok(Buffer.isBuffer(chunk));
    chunks.push(chunk);
  }
  if (request.url?.endsWith("/chat/completions")) {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    assert.ok(isRecord(body));
    captures.push(body);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish_reason] of [
      [{ role: "assistant", reasoning_content: "Synthetic thought." }, null],
      [{ content: "Synthetic result" }, null],
      [{}, "stop"],
    ]) {
      response.write(`data: ${JSON.stringify({ id: "chatcmpl-synthetic", object: "chat.completion.chunk", created: 1, model: "vendor/reasoner", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ data: [] }));
});
await new Promise<void>(resolveListen => fake.listen(0, "127.0.0.1", resolveListen));
const address = fake.address();
assert.ok(address && typeof address !== "string");
const fakeURL = `http://127.0.0.1:${address.port}/v1`;
let managed: Awaited<ReturnType<typeof createManagedOpencodeV2Server>> | undefined;
try {
  for (const dir of ["home", "config", "cache", "data", "state", "workspace"]) await mkdir(join(root, dir));
  managed = await createManagedOpencodeV2Server({
    bin: resolve(binary), rootDir: join(root, "engine"), bootTimeoutMs: 30_000,
    env: {
      HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
      OPENWORK_CLIENT_PROFILE: "local-gateway", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_MODELS_URL: `${fakeURL}/catalog`,
    },
  });
  assert.equal((await managed.health()).version, artifacts.version);
  const mapped = mapRuntimeProvidersToV2Specs({
    modelhelm: {
      npm: "@ai-sdk/openai-compatible", name: "Synthetic provider", options: { baseURL: fakeURL, apiKey: "synthetic" },
      models: {
        "vendor/reasoner": { name: "Synthetic", reasoning: true, variants: { low: { reasoningEffort: "low" }, high: { reasoningEffort: "high" } } },
        "vendor/builtin-only": { name: "Synthetic built-in reasoning", reasoning: true, variants: {} },
      },
    },
  });
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
    return catalog.some(model => model.id === "vendor/reasoner") && catalog.some(model => model.id === "vendor/builtin-only");
  }, "native V2 catalog includes both injected models");
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
  console.log(JSON.stringify({ passed: true, engineVersion: artifacts.version, protocol: "OpenAI-compatible Chat Completions", provider: "modelhelm", model: "vendor/reasoner", nativeCatalogReasoning: true, nativeCatalogHighEffort: "high", nativeBuiltinReasoningWithoutDial: true, variant: "high", reasoning_effort: "high", reasoningReplay: true, externalModelCalls: 0, keyType: "synthetic", capturedRequests: captures.length }));
} finally {
  await managed?.close();
  await new Promise<void>(resolveClose => fake.close(() => resolveClose()));
  await rm(root, { recursive: true, force: true });
}
