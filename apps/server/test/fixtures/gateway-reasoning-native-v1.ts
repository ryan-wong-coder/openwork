// OPENWORK_TEST_OPENCODE_BIN=/path/to/pinned/opencode bun apps/server/test/fixtures/gateway-reasoning-native-v1.ts
// Real native engine + real authenticated proxy; synthetic localhost upstream only.
// Set OPENWORK_TEST_REASONING_MODEL=openai/gpt-6.1-sol for its exact catalog and high/max transport regression.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, type GatewayModel } from "../../src/gateway-config";
import { GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken } from "../../src/gateway-proxy-auth";
import { syntheticNativeGateway, assertSyntheticClaudeRequests, CLAUDE_EFFORTS, CLAUDE_MODEL, CLAUDE_MODELS } from "./gateway-reasoning-native-upstream";

const binary = process.env.OPENWORK_TEST_OPENCODE_BIN;
assert.ok(binary, "Set OPENWORK_TEST_OPENCODE_BIN to the pinned native v1 executable.");
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const directory = await realpath(await mkdtemp(join(tmpdir(), "gateway-reasoning-v1-")));
const modelID = process.env.OPENWORK_TEST_REASONING_MODEL ?? "deepseek/deepseek-v4-flash";
assert.ok(["deepseek/deepseek-v4-flash", "openai/gpt-6.1-sol"].includes(modelID), "Choose a fixture model with a verified exact effort set.");
const expectedEfforts = modelID === "openai/gpt-6.1-sol" ? ["low", "medium", "high", "xhigh", "max"] : ["none", "low", "high", "max"];
const selectedEfforts = modelID === "openai/gpt-6.1-sol" ? ["high", "max"] : ["high", "high"];
const gateway = await syntheticNativeGateway(directory);
const { config, cc: captures } = gateway;
let child: ReturnType<typeof spawn> | undefined;
let output = "";
try {
  for (const name of ["config", "cache", "data", "state"]) await mkdir(join(directory, name));
  // The exact ModelHelm model capability snapshot is routed to our real local
  // proxy; the fixture rewrites its fixed official destination to loopback.
  const provider = buildGatewayProvider({ baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: modelID, imageModel: "unused",
    imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 10000, imageGenerationEnabled: false },
  [{ id: modelID, name: "Synthetic reasoner", kind: "chat" }, ...CLAUDE_MODELS.map((id): GatewayModel => ({ id, name: id, kind: "chat" }))], config);
  const runtime = join(directory, "runtime.json");
  await writeFile(runtime, JSON.stringify({ enabled_providers: ["modelhelm"], provider: { modelhelm: provider },
    permission: { "*": "deny", read: { "*": "deny", [join(directory, "workspace/native-proof.txt")]: "allow",
      [join(directory, "workspace/native-proof.txt").slice(1)]: "allow", "workspace/native-proof.txt": "allow" },
      external_directory: { [join(directory, "workspace")]: "allow", [join(directory, "workspace/*")]: "allow" } } }));
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) });
  const nativePort = reservation.port;
  reservation.stop(true);
  child = spawn(resolve(binary), ["serve", "--hostname", "127.0.0.1", "--port", String(nativePort)], { cwd: directory, env: {
    PATH: process.env.PATH, HOME: directory, TMPDIR: tmpdir(), LANG: "en_US.UTF-8",
    XDG_CONFIG_HOME: join(directory, "config"), XDG_DATA_HOME: join(directory, "data"), XDG_CACHE_HOME: join(directory, "cache"), XDG_STATE_HOME: join(directory, "state"),
    OPENWORK_CLIENT_PROFILE: "local-gateway", OPENCODE_CONFIG: runtime, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_SHARE: "1", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1", npm_config_registry: `http://127.0.0.1:${config.port}`, npm_config_audit: "false",
    [GATEWAY_PROXY_TOKEN_ENV]: gatewayProxyToken(config),
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", chunk => { output += chunk.toString(); });
  child.stderr?.on("data", chunk => { output += chunk.toString(); });
  let base = "";
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    base = /opencode server listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? "";
    if (base) break;
    assert.equal(child.exitCode, null, "Native engine must remain running");
    await Bun.sleep(100);
  }
  assert.ok(base, "Native engine must announce its local listener");
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, { ...(body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, `Native ${path}`);
    const value: unknown = await response.json(); assert.ok(record(value)); return value;
  };
  const catalog = await call("/provider");
  const health = await call("/global/health");
  assert.equal(typeof health.version, "string");
  assert.ok(Array.isArray(catalog.all));
  const nativeProvider = catalog.all.find((value: unknown) => record(value) && value.id === "modelhelm");
  assert.ok(record(nativeProvider) && record(nativeProvider.models));
  const nativeModel = nativeProvider.models[modelID];
  assert.ok(record(nativeModel) && record(nativeModel.variants) && record(nativeModel.capabilities));
  assert.equal(nativeModel.capabilities.reasoning, true);
  assert.deepEqual(Object.keys(nativeModel.variants).sort(), expectedEfforts.slice().sort());
  for (const id of CLAUDE_MODELS) {
    const model: unknown = nativeProvider.models[id];
    assert.ok(record(model) && record(model.variants) && record(model.api));
    assert.equal(model.api.npm, "@ai-sdk/anthropic");
    assert.deepEqual(Object.keys(model.variants).sort(), CLAUDE_EFFORTS.slice().sort());
  }
  const session = await call("/session", { title: "Synthetic CC proof" }); assert.equal(typeof session.id, "string");
  for (const [index, text] of ["Synthetic reasoning test. Reply briefly.", "Synthetic follow-up. Reply briefly."].entries()) {
    await call(`/session/${session.id}/message`, { model: { providerID: "modelhelm", modelID }, variant: selectedEfforts[index], parts: [{ type: "text", text }] });
  }
  assert.equal(captures.length, 2);
  for (const [index, captured] of captures.entries()) { assert.equal(captured.model, modelID); assert.equal(captured.reasoning_effort, selectedEfforts[index]); }
  assert.ok(Array.isArray(captures[1].messages));
  const assistant = captures[1].messages.find((message: unknown) => record(message) && message.role === "assistant");
  assert.ok(record(assistant));
  assert.equal(assistant.reasoning_content, "Synthetic thought.");
  for (const effort of ["high", "xhigh", "max"]) {
    const claudeSession = await call("/session", { title: `Synthetic Claude ${effort}` });
    assert.equal(typeof claudeSession.id, "string");
    await call(`/session/${claudeSession.id}/message`, { model: { providerID: "modelhelm", modelID: CLAUDE_MODEL }, variant: effort,
      parts: [{ type: "text", text: `Synthetic Claude ${effort}. Read the fixture proof when requested and answer briefly.` }] });
  }
  const nativeClaude = assertSyntheticClaudeRequests(gateway.anthropic);
  console.log(JSON.stringify({ passed: true, engineVersion: health.version, protocols: ["OpenAI-compatible Chat Completions", "Anthropic Messages"], provider: "modelhelm", model: modelID,
    nativeCatalogEfforts: expectedEfforts, selectedEfforts, reasoningReplay: true, authenticatedProxy: true,
    ccToolCallingVerified: false, nativeClaude, externalModelCalls: 0, capturedRequests: captures.length, nativeClaudeRequests: gateway.anthropic.length }));
} catch (error) {
  console.error(JSON.stringify({ phase: "native-v1-failure", capturedCC: captures.length,
    capturedClaude: gateway.anthropic.length, nativeLogTail: output.slice(-5000) }));
  throw error;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM"); await Promise.race([once(child, "exit"), Bun.sleep(3000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await gateway.stop(); await rm(directory, { recursive: true, force: true });
}
