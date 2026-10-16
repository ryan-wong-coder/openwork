// OPENWORK_TEST_OPENCODE_BIN=/path/to/pinned/opencode bun apps/server/test/fixtures/gateway-reasoning-native-v1.ts
// Real native engine + real authenticated proxy; synthetic localhost upstream only.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL } from "../../src/gateway-config";
import { forwardGatewayChat } from "../../src/gateway-proxy";
import { GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken } from "../../src/gateway-proxy-auth";
import type { ServerConfig } from "../../src/types";

const binary = process.env.OPENWORK_TEST_OPENCODE_BIN;
assert.ok(binary, "Set OPENWORK_TEST_OPENCODE_BIN to the pinned native v1 executable.");
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const directory = await mkdtemp(join(tmpdir(), "gateway-reasoning-v1-"));
const captures: Record<string, unknown>[] = [];
const modelID = "deepseek/deepseek-v4-flash";
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  assert.equal(request.headers.get("authorization"), "Bearer synthetic-upstream-key");
  const body: unknown = await request.json();
  assert.ok(record(body));
  const title = JSON.stringify(body.messages).includes("Generate a title for");
  if (!title) captures.push(body);
  const chunks = [
    ...(title ? [] : [{ reasoning_content: "Synthetic thought." }]),
    { content: title ? "Synthetic native proof" : "Synthetic answer" },
  ];
  const sse = [...chunks.map(delta => ({ delta, finish_reason: null })), { delta: {}, finish_reason: "stop" }]
    .map(choice => `data: ${JSON.stringify({ id: "synthetic-completion", object: "chat.completion.chunk", created: 1,
      model: modelID, choices: [{ index: 0, ...choice }] })}\n\n`).join("");
  return new Response(sse + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
} });
const config: ServerConfig = {
  host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host",
  configPath: join(directory, "server.json"), clientProfile: "local-gateway", workspaces: [], authorizedRoots: [],
  corsOrigins: [], approval: { mode: "auto", timeoutMs: 1000 }, readOnly: false, startedAt: Date.now(),
  tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
};
const env = { list: async () => [
  { key: "OPENWORK_GATEWAY_API_KEY", value: "synthetic-upstream-key", updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_BASE_URL", value: `http://127.0.0.1:${upstream.port}/v1`, updatedAt: 0 },
] };
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => forwardGatewayChat(config, env, request) });
config.port = proxy.port;
let child: ReturnType<typeof spawn> | undefined;
let output = "";
try {
  for (const name of ["config", "cache", "data", "state"]) await mkdir(join(directory, name));
  // The exact ModelHelm model capability snapshot is routed to our real local
  // proxy; that proxy's synthetic env points solely at the fake upstream.
  const provider = buildGatewayProvider({ baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: modelID, imageModel: "unused",
    imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 10000, imageGenerationEnabled: false },
  [{ id: modelID, name: "Synthetic reasoner", kind: "chat" }], config);
  const runtime = join(directory, "runtime.json");
  await writeFile(runtime, JSON.stringify({ enabled_providers: ["modelhelm"], provider: { modelhelm: provider } }));
  child = spawn(resolve(binary), ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: directory, env: {
    PATH: process.env.PATH, HOME: directory, TMPDIR: tmpdir(), LANG: "en_US.UTF-8",
    XDG_CONFIG_HOME: join(directory, "config"), XDG_DATA_HOME: join(directory, "data"), XDG_CACHE_HOME: join(directory, "cache"), XDG_STATE_HOME: join(directory, "state"),
    OPENWORK_CLIENT_PROFILE: "local-gateway", OPENCODE_CONFIG: runtime, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_SHARE: "1", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1", npm_config_registry: `http://127.0.0.1:${proxy.port}`, npm_config_audit: "false",
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
  assert.ok(Array.isArray(catalog.all));
  const nativeProvider = catalog.all.find((value: unknown) => record(value) && value.id === "modelhelm");
  assert.ok(record(nativeProvider) && record(nativeProvider.models));
  const nativeModel = nativeProvider.models[modelID];
  assert.ok(record(nativeModel) && record(nativeModel.variants) && record(nativeModel.capabilities));
  assert.equal(nativeModel.capabilities.reasoning, true);
  assert.deepEqual(Object.keys(nativeModel.variants).sort(), ["none", "low", "high", "max"].sort());
  const session = await call("/session", {}); assert.equal(typeof session.id, "string");
  for (const text of ["Synthetic reasoning test. Reply briefly.", "Synthetic follow-up. Reply briefly."]) {
    await call(`/session/${session.id}/message`, { model: { providerID: "modelhelm", modelID }, variant: "high", parts: [{ type: "text", text }] });
  }
  assert.equal(captures.length, 2);
  for (const captured of captures) { assert.equal(captured.model, modelID); assert.equal(captured.reasoning_effort, "high"); }
  assert.ok(Array.isArray(captures[1].messages));
  const assistant = captures[1].messages.find((message: unknown) => record(message) && message.role === "assistant");
  assert.ok(record(assistant));
  assert.equal(assistant.reasoning_content, "Synthetic thought.");
  console.log(JSON.stringify({ passed: true, protocol: "OpenAI-compatible Chat Completions", provider: "modelhelm", model: modelID,
    variant: "high", reasoning_effort: "high", reasoningReplay: true, authenticatedProxy: true, externalModelCalls: 0, capturedRequests: captures.length }));
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM"); await Promise.race([once(child, "exit"), Bun.sleep(3000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  proxy.stop(true); upstream.stop(true); await rm(directory, { recursive: true, force: true });
}
