import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
// Manual shipping-engine regression: OPENWORK_TEST_OPENCODE_BIN=/path/to/opencode
// bun apps/server/test/fixtures/title-model-routing-native.ts
// The child receives an isolated profile and synthetic localhost credentials only.
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const binary = process.env.OPENWORK_TEST_OPENCODE_BIN;
if (!binary) throw new Error("Set OPENWORK_TEST_OPENCODE_BIN to the pinned v1 sidecar to run this native regression.");
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const dir = await mkdtemp(join(tmpdir(), "zeno-title-native-"));
const calls: Array<{ path: string; model: unknown; title: boolean }> = [];
const gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (!path.endsWith("/chat/completions")) return Response.json({});
  const body: unknown = await request.json();
  if (!record(body)) return Response.json({ error: "Invalid fixture request" }, { status: 400 });
  const title = JSON.stringify(body.messages).includes("Generate a title for");
  calls.push({ path, model: body.model, title });
  if (path.startsWith("/legacy/")) return Response.json({ error: { message: "Synthetic retired credential", code: "invalid_api_key" } }, { status: 401 });
  const text = title ? "Synthetic title verified" : "READY";
  const chunks = [{ id: "fixture-completion", object: "chat.completion.chunk", created: 1, model: body.model,
    choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
  { id: "fixture-completion", object: "chat.completion.chunk", created: 1, model: body.model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }];
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
} });
let child: ReturnType<typeof spawn> | undefined;
let output = "";
try {
  const pluginPath = join(dir, "title-plugin.mjs");
  // Match the production plugin bundler. Only this one output is installed in
  // the fixture directory, proving no sibling source module is needed at run time.
  const build = await Bun.build({ entrypoints: [join(root, "apps/server/src/opencode-plugins/openwork-title-recovery.ts")], target: "node", format: "esm" });
  if (!build.success) throw new Error("Plugin fixture build failed");
  await Bun.write(pluginPath, build.outputs[0]);
  const globalFolder = join(dir, "config/opencode");
  await mkdir(globalFolder, { recursive: true });
  await writeFile(join(globalFolder, "opencode.json"), JSON.stringify({
    small_model: "legacy-provider/retired-model", model: "legacy-provider/retired-model",
    provider: { "legacy-provider": { npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${gateway.port}/legacy/v1`, apiKey: "synthetic-retired-key" }, models: { "retired-model": { name: "Retired fixture", limit: { context: 128000, output: 8192 } } } } },
  }));
  const runtimePath = join(dir, "runtime.json");
  await writeFile(runtimePath, JSON.stringify({
    plugin: [pathToFileURL(pluginPath).href],
    enabled_providers: ["legacy-provider", "modelhelm"],
    provider: { modelhelm: { npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${gateway.port}/gateway/v1`, apiKey: "synthetic-active-key" }, models: { "vendor/chat-model": { name: "Current fixture", limit: { context: 128000, output: 8192 }, tool_call: true } } } },
  }));
  child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: dir, env: {
    PATH: process.env.PATH, HOME: dir, TMPDIR: tmpdir(), LANG: "en_US.UTF-8",
    XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data"), XDG_CACHE_HOME: join(dir, "cache"), XDG_STATE_HOME: join(dir, "state"),
    OPENWORK_CLIENT_PROFILE: "local-gateway", OPENCODE_CONFIG: runtimePath, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_SHARE: "1", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1", npm_config_registry: `http://127.0.0.1:${gateway.port}`, npm_config_audit: "false",
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", chunk => { output += chunk.toString(); });
  child.stderr?.on("data", chunk => { output += chunk.toString(); });
  const deadline = Date.now() + 45000;
  let base: string | undefined;
  while (Date.now() < deadline) {
    base = /opencode server listening on (http:\/\/[^\s]+)/.exec(output)?.[1];
    if (base) break;
    if (child.exitCode !== null) throw new Error(`Engine exited: ${output.slice(-1500)}`);
    await Bun.sleep(100);
  }
  if (!base) throw new Error(`Engine startup timeout: ${output.slice(-1500)}`);
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Native ${path}: ${response.status} ${await response.text()}`);
    const value: unknown = await response.json();
    if (!record(value)) throw new Error(`Native ${path} returned no object`);
    return value;
  };
  const session = await call("/session", {});
  if (typeof session.id !== "string") throw new Error("Native session has no ID");
  await call(`/session/${session.id}/message`, { model: { providerID: "modelhelm", modelID: "vendor/chat-model" }, parts: [{ type: "text", text: "Synthetic native title regression. Reply READY." }] });
  let title = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    const read = await call(`/session/${session.id}`);
    title = typeof read.title === "string" ? read.title : "";
    if (title === "Synthetic title verified") break;
    await Bun.sleep(100);
  }
  console.log(JSON.stringify({ title, calls }, null, 2));
  if (title !== "Synthetic title verified" || !calls.some(c => c.title && c.model === "vendor/chat-model") || calls.some(c => c.path.startsWith("/legacy/"))) throw new Error("Native title routing regression failed");
} finally {
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), Bun.sleep(3000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
  gateway.stop(true);
  await rm(dir, { recursive: true, force: true });
}
