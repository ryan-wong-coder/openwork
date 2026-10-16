// Manual, opt-in one-call-per-engine live smoke. Default invocation is dry-run.
// Run with Bun, a pinned OPENWORK_TEST_OPENCODE_BIN / OPENCODE2_BIN, and
// <v1|v2> --execute-approved-live only after explicit authorization. No transcript,
// key, native log, or temporary profile is retained after execution.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { EnvService } from "../../src/env-file";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, normalizeGatewayBaseURL, readGatewaySettings } from "../../src/gateway-config";
import { forwardGatewayMessages } from "../../src/gateway-proxy";
import { GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken } from "../../src/gateway-proxy-auth";
import { createManagedOpencodeV2Server } from "../../src/managed-opencode-v2";
import { mapRuntimeProvidersToV2Specs } from "../../src/engine-v2-preview";
import type { ServerConfig } from "../../src/types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const lane = process.argv[2] ?? "v1";
assert.ok(lane === "v1" || lane === "v2", "Choose v1 or v2.");
if (process.argv[3] !== "--execute-approved-live") {
  console.log(JSON.stringify({ dryRun: true, lane, externalCalls: 1, maxOutputTokens: 1024, tools: false }));
  process.exit(0);
}
const binary = lane === "v1" ? process.env.OPENWORK_TEST_OPENCODE_BIN : process.env.OPENWORK_TEST_OPENCODE2_BIN;
assert.ok(binary);
const modelID = "anthropic/claude-sonnet-5";
const prompt = "Calculate 17 * 19. Respond with only the integer. Do not use tools.";
const records = await new EnvService({ path: join(homedir(), ".config/openwork/env.json") }).list();
// Never send a custom gateway's saved credential to the factory endpoint.
// Only an absent base URL uses the default; an explicit empty/invalid value
// fails before a key is selected or any native process/network starts.
const storedBase = records.find(entry => entry.key === "OPENWORK_GATEWAY_BASE_URL");
const savedBase = normalizeGatewayBaseURL(storedBase === undefined ? DEFAULT_GATEWAY_BASE_URL : storedBase.value);
assert.ok(savedBase === DEFAULT_GATEWAY_BASE_URL, "The live ModelHelm probe requires an existing factory ModelHelm configuration.");
const keyRecord = records.find(entry => entry.key === "OPENWORK_GATEWAY_API_KEY");
assert.ok(keyRecord && keyRecord.value.trim(), "An existing gateway key is required.");
const key = keyRecord.value.trim();
const env = { list: async () => [
  { key: "OPENWORK_GATEWAY_API_KEY", value: key, updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_BASE_URL", value: savedBase, updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS", value: "60000", updatedAt: 0 },
] };
const { settings } = await readGatewaySettings(env);
const directory = await realpath(await mkdtemp(join(tmpdir(), `zeno-native-live-${lane}-`)));
const config: ServerConfig = {
  host: "127.0.0.1", port: 0, token: randomBytes(24).toString("base64url"), hostToken: randomBytes(24).toString("base64url"),
  configPath: join(directory, "server.json"), clientProfile: "local-gateway", workspaces: [], authorizedRoots: [], corsOrigins: [],
  approval: { mode: "auto", timeoutMs: 1000 }, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
};
let child: ReturnType<typeof spawn> | undefined;
let managed: Awaited<ReturnType<typeof createManagedOpencodeV2Server>> | undefined;
let output = "";
let externalCalls = 0;
let proxyRequests = 0;
let httpStatus = 0;
let inputTokens: unknown;
let outputTokens: unknown;
let responseText = "";
let wire: Record<string, unknown> = {};
let streamEnded = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol === "https:") {
    assert.equal(url.href, "https://api.modelhelm.com/claude/v1/messages");
    assert.equal(externalCalls, 0, "The live budget permits exactly one upstream request; retries are blocked.");
    externalCalls++;
    assert.ok(new Headers(init?.headers).get("x-api-key") === key, "Only the existing upstream credential is used in the trusted host process.");
    const upstream = await originalFetch(input, init);
    httpStatus = upstream.status;
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return Response.json({ type: "error", error: { type: "live_probe_rejected", message: "The approved live request was rejected." } }, { status: upstream.status });
    }
    let buffer = "";
    const decoder = new TextDecoder();
    const tap = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        assert.ok(buffer.length < 256 * 1024, "Bounded live response buffer.");
        controller.enqueue(chunk);
      },
      flush() {
        buffer += decoder.decode();
        assert.ok(!buffer.includes(key));
        for (const line of buffer.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let event: unknown;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          if (!record(event)) continue;
          if (event.type === "message_start" && record(event.message) && record(event.message.usage)) inputTokens = event.message.usage.input_tokens;
          if (event.type === "message_delta" && record(event.usage)) outputTokens = event.usage.output_tokens;
          if (event.type === "content_block_delta" && record(event.delta) && event.delta.type === "text_delta" && typeof event.delta.text === "string") responseText += event.delta.text;
          if (event.type === "message_stop") streamEnded = true;
        }
        buffer = "";
      },
    });
    return new Response(upstream.body?.pipeThrough(tap), { status: upstream.status, headers: upstream.headers });
  }
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  return originalFetch(input, init);
}, originalFetch);
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (new URL(request.url).pathname !== "/gateway/openai/messages") return Response.json({ error: "No live probe route" }, { status: 404 });
  if (proxyRequests > 0) return Response.json({ type: "error", error: { type: "call_budget_exceeded", message: "No retries or tool continuations in the approved live probe." } }, { status: 400 });
  proxyRequests++;
  assert.ok(request.headers.get("x-api-key") === gatewayProxyToken(config), "The native engine must authenticate only with the scoped proxy credential.");
  const body: unknown = await request.clone().json();
  assert.ok(record(body));
  assert.equal(body.model, modelID);
  assert.ok(typeof body.max_tokens === "number" && body.max_tokens > 0 && body.max_tokens <= 1024, "Native max_tokens must satisfy the hard live output budget before network.");
  assert.ok(!Array.isArray(body.tools) || body.tools.length === 0, "The live probe does not expose tools.");
  assert.ok(record(body.thinking) && body.thinking.type === "adaptive" && body.thinking.display === "summarized");
  const updates = Array.isArray(body.messages) ? body.messages.filter(record).filter(message => message.role === "system" && record(message.output_config)) : [];
  const lastUpdate = updates.at(-1)?.output_config;
  const effort = record(lastUpdate) ? lastUpdate.effort : record(body.output_config) ? body.output_config.effort : undefined;
  assert.equal(effort, "high");
  wire = { model: body.model, maxTokens: body.max_tokens, effort, effortTransport: updates.length ? "message-update" : "top-level", thinking: "adaptive/summarized",
    betaHeader: request.headers.get("anthropic-beta"), blockBinding: body.thinking.block_binding ?? null, scopedAuthentication: true, tools: 0 };
  return forwardGatewayMessages(config, env, request);
} });
assert.ok(proxy.port !== undefined);
config.port = proxy.port;
const until = async (test: () => Promise<boolean>) => {
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) { if (await test()) return; await Bun.sleep(100); }
  throw new Error("Bounded live native probe timeout.");
};
async function keyAbsentOnDisk(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) await keyAbsentOnDisk(full);
    if (entry.isFile()) assert.ok(!(await readFile(full)).includes(Buffer.from(key)), "Upstream key must never be persisted in the isolated native profile.");
  }
}
let result: Record<string, unknown> | undefined;
try {
  for (const name of ["home", "config", "cache", "data", "state", "workspace"]) await mkdir(join(directory, name), { recursive: true });
  const generated = buildGatewayProvider({ ...settings, chatModel: modelID }, [{ id: modelID, name: "Synthetic arithmetic probe", kind: "chat" }], config);
  const model = generated.models[modelID];
  assert.ok(model);
  const provider = { ...generated, models: { ...generated.models, [modelID]: { ...model, tool_call: false, limit: { context: 128000, output: 1024 } } } };
  assert.ok(!JSON.stringify(provider).includes(key));
  const isolated = { HOME: join(directory, "home"), XDG_CONFIG_HOME: join(directory, "config"), XDG_CACHE_HOME: join(directory, "cache"), XDG_DATA_HOME: join(directory, "data"), XDG_STATE_HOME: join(directory, "state"), OPENWORK_CLIENT_PROFILE: "local-gateway" };
  let version: unknown;
  let nativeCatalog = false;
  if (lane === "v1") {
    const runtime = join(directory, "runtime.json");
    await writeFile(runtime, JSON.stringify({ enabled_providers: ["modelhelm"], provider: { modelhelm: provider }, permission: { "*": "deny" } }), { mode: 0o600 });
    const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) });
    const port = reservation.port; reservation.stop(true);
    child = spawn(resolve(binary), ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: join(directory, "workspace"), env: {
      PATH: process.env.PATH, TMPDIR: tmpdir(), LANG: "en_US.UTF-8", ...isolated,
      OPENCODE_CONFIG: runtime, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_SHARE: "1", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
      npm_config_registry: `http://127.0.0.1:${config.port}`, npm_config_audit: "false", [GATEWAY_PROXY_TOKEN_ENV]: gatewayProxyToken(config),
    }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", chunk => { output += chunk.toString(); });
    child.stderr?.on("data", chunk => { output += chunk.toString(); });
    let base = "";
    await until(async () => { base = /opencode server listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? ""; return Boolean(base); });
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(base + path, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(70_000) });
      assert.equal(response.status, 200, "Native live API request must succeed.");
      const value: unknown = await response.json(); assert.ok(record(value)); return value;
    };
    version = (await call("/global/health")).version;
    const catalog = await call("/provider");
    assert.ok(Array.isArray(catalog.all));
    const nativeProvider = catalog.all.find((value: unknown) => record(value) && value.id === "modelhelm");
    assert.ok(record(nativeProvider) && record(nativeProvider.models));
    const native = nativeProvider.models[modelID];
    assert.ok(record(native) && record(native.api) && record(native.variants));
    assert.equal(native.api.npm, "@ai-sdk/anthropic");
    assert.deepEqual(Object.keys(native.variants).sort(), ["low", "medium", "high", "xhigh", "max"].sort()); nativeCatalog = true;
    const session = await call("/session", { title: "Synthetic arithmetic probe" });
    await call(`/session/${session.id}/message`, { model: { providerID: "modelhelm", modelID }, variant: "high", parts: [{ type: "text", text: prompt }] });
  } else {
    managed = await createManagedOpencodeV2Server({ bin: resolve(binary), rootDir: join(directory, "engine"), bootTimeoutMs: 30000,
      env: { ...isolated, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_MODELS_URL: `http://127.0.0.1:${config.port}/no-catalog` },
      permissions: async () => [{ action: "*", resource: "*", effect: "deny" }],
    });
    const current = managed; version = (await managed.health()).version;
    const mapped = mapRuntimeProvidersToV2Specs({ modelhelm: provider }, new Map([[GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken(config)]]));
    await managed.setProviders(mapped.specs);
    await until(async () => {
      const catalog = await current.fetchJson("/api/model", { timeoutMs: 5000 });
      const all = record(catalog.json) ? catalog.json.data : catalog.json;
      const native = Array.isArray(all) ? all.filter(record).find(model => model.providerID === "modelhelm" && model.id === modelID) : undefined;
      if (!native) return false;
      assert.equal(native.package, "@opencode/ai/providers/anthropic"); assert.ok(Array.isArray(native.variants));
      assert.deepEqual(native.variants.filter(record).map(variant => variant.id).sort(), ["low", "medium", "high", "xhigh", "max"].sort()); nativeCatalog = true; return true;
    });
    const created = await managed.fetchJson("/api/session", { method: "POST", body: { title: "Synthetic arithmetic probe", location: { directory: join(directory, "workspace") }, model: { providerID: "modelhelm", id: modelID } } });
    assert.equal(created.status, 200); assert.ok(record(created.json)); const session = record(created.json.data) ? created.json.data : created.json; const id = String(session.id);
    const bound = await managed.fetchJson(`/api/session/${id}/model`, { method: "POST", body: { model: { providerID: "modelhelm", id: modelID, variant: "high" } } });
    assert.ok(bound.status >= 200 && bound.status < 300);
    const prompted = await managed.fetchJson(`/api/session/${id}/prompt`, { method: "POST", body: { text: prompt }, timeoutMs: 70000 });
    assert.ok(prompted.status >= 200 && prompted.status < 300);
    await until(async () => streamEnded);
    await until(async () => { const active = await current.fetchJson("/api/session/active"); const states = record(active.json) && record(active.json.data) ? active.json.data : active.json;
      return record(states) && (!record(states[id]) || states[id].type === "idle"); });
  }
  assert.equal(httpStatus, 200); assert.equal(externalCalls, 1); assert.equal(proxyRequests, 1); assert.ok(streamEnded); assert.ok(responseText.trim());
  assert.ok(!output.includes(key));
  result = { passed: true, lane, version, nativeCatalog, sdk: lane === "v1" ? "@ai-sdk/anthropic" : "@opencode/ai/providers/anthropic", wire,
    httpStatus, upstreamCalls: externalCalls, retryAndContinuationBudget: 0, textPresent: Boolean(responseText.trim()), normalizedArithmeticAnswerMatched: responseText.trim() === "323", inputTokens, outputTokens, streamEnded,
    upstreamKeyOnlyInMemory: true, scopedTokenOnlyInNativeConfiguration: true };
} catch (error) {
  result = { passed: false, lane, httpStatus, upstreamCalls: externalCalls, proxyRequests, wire, failureType: error instanceof Error ? error.name : "Unknown", failureMessage: error instanceof Error ? error.message.replaceAll(key, "[redacted]").slice(0, 500) : "Unknown" };
  process.exitCode = 1;
} finally {
  await managed?.close();
  if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), Bun.sleep(3000)]); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  try { await keyAbsentOnDisk(directory); }
  finally {
    proxy.stop(true); globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
    output = ""; responseText = "";
  }
}
assert.ok(result); console.log(JSON.stringify({ ...result, nativeProfileRemoved: true, nativeLogsDiscarded: true }));
