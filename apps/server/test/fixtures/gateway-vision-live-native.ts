// Opt-in, bounded native image-recognition smoke. Default is dry-run before
// reading a saved configuration, credential or binary. The root task owns the
// two approved live executions; --synthetic-preflight never reads credentials.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";
import { EnvService } from "../../src/env-file";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, normalizeGatewayBaseURL, readGatewaySettings } from "../../src/gateway-config";
import { forwardGatewayChat, forwardGatewayMessages } from "../../src/gateway-proxy";
import { GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken } from "../../src/gateway-proxy-auth";
import { createManagedOpencodeV2Server } from "../../src/managed-opencode-v2";
import { mapRuntimeProvidersToV2Specs } from "../../src/engine-v2-preview";
import type { ServerConfig } from "../../src/types";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
const lane = process.argv[2] ?? "v1";
assert.ok(lane === "v1" || lane === "v2", "Choose v1 or v2.");
const modelID = lane === "v1" ? "anthropic/claude-sonnet-5" : "openai/gpt-6.1-sol";
const mode = process.argv[3];
const synthetic = mode === "--synthetic-preflight";
if (mode !== "--execute-approved-live" && !synthetic) {
  console.log(JSON.stringify({ dryRun: true, lane, model: modelID, liveCallsRequire: "--execute-approved-live", permittedLiveCalls: 1,
    maxOutputTokens: 512, timeoutMs: 60000, tools: false, retries: 0, continuations: 0, image: { mime: "image/png", width: 128, height: 128 },
    credentialRead: false, binaryStarted: false, externalCalls: 0 }));
  process.exit(0);
}
assert.equal(process.argv.length, 4, "Use exactly one execution mode and one lane.");
assert.equal(process.platform, "darwin", "Native loopback-only isolation requires macOS sandbox-exec.");
const binary = lane === "v1" ? process.env.OPENWORK_TEST_OPENCODE_BIN : process.env.OPENWORK_TEST_OPENCODE2_BIN;
assert.ok(binary, "Set the pinned native binary path; this fixture never downloads a binary.");
let key = "synthetic-vision-preflight-key";
let savedBase = DEFAULT_GATEWAY_BASE_URL;
if (!synthetic) {
  const records = await new EnvService({ path: join(homedir(), ".config/openwork/env.json") }).list();
  // Validate the saved destination before selecting its credential. Missing
  // base uses the factory default; explicitly empty/invalid/custom bases fail.
  const storedBase = records.find(entry => entry.key === "OPENWORK_GATEWAY_BASE_URL");
  savedBase = normalizeGatewayBaseURL(storedBase === undefined ? DEFAULT_GATEWAY_BASE_URL : storedBase.value);
  assert.ok(savedBase === DEFAULT_GATEWAY_BASE_URL, "An existing factory ModelHelm configuration is required.");
  const selected = records.find(entry => entry.key === "OPENWORK_GATEWAY_API_KEY");
  assert.ok(selected && selected.value.trim(), "An existing gateway key is required."); key = selected.value.trim();
}
const env = { list: async () => [
  { key: "OPENWORK_GATEWAY_API_KEY", value: key, updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_BASE_URL", value: savedBase, updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS", value: "60000", updatedAt: 0 },
] };
const { settings } = await readGatewaySettings(env);
const directory = await realpath(await mkdtemp(join(tmpdir(), `zeno-vision-live-${lane}-`)));

// Cryptographically shuffle the four position answers on every execution;
// neither prompt nor filename discloses those answers. The image stays in RAM.
const palette = [{ name: "red", rgb: [255, 0, 0] }, { name: "green", rgb: [0, 255, 0] }, { name: "blue", rgb: [0, 0, 255] }, { name: "yellow", rgb: [255, 255, 0] }];
for (let index = palette.length - 1; index > 0; index--) { const selected = randomInt(index + 1); [palette[index], palette[selected]] = [palette[selected], palette[index]]; }
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]); }
const header = Buffer.alloc(13); header.writeUInt32BE(128, 0); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 2;
const pixels = Buffer.alloc(128 * (128 * 3 + 1));
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
  const offset = y * (128 * 3 + 1) + 1 + x * 3; const color = palette[(y >= 64 ? 2 : 0) + (x >= 64 ? 1 : 0)];
  pixels[offset] = color.rgb[0]; pixels[offset + 1] = color.rgb[1]; pixels[offset + 2] = color.rgb[2];
}
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
const pngURL = `data:image/png;base64,${png.toString("base64")}`;
const pngSHA256 = createHash("sha256").update(png).digest("hex");
const expected = palette.map(color => color.name);
const prompt = "Inspect the attached image. Name the color in each position, in this exact order: top left, top right, bottom left, bottom right. Return only a JSON array of four lowercase English color names. Do not use tools.";
const config: ServerConfig = { host: "127.0.0.1", port: 0, token: randomBytes(24).toString("base64url"), hostToken: randomBytes(24).toString("base64url"),
  configPath: join(directory, "server.json"), clientProfile: "local-gateway", workspaces: [], authorizedRoots: [], corsOrigins: [],
  approval: { mode: "auto", timeoutMs: 1000 }, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
let child: ReturnType<typeof spawn> | undefined;
let managed: Awaited<ReturnType<typeof createManagedOpencodeV2Server>> | undefined;
let nativeOutput = "";
let upstreamCalls = 0;
let proxyRequests = 0;
let httpStatus = 0;
let streamEnded = false;
let responseText = "";
let inputTokens: unknown;
let outputTokens: unknown;
let wire: Record<string, unknown> = {};
let result: Record<string, unknown> | undefined;
const originalFetch = globalThis.fetch;
const expectedURL = lane === "v1" ? "https://api.modelhelm.com/claude/v1/messages" : "https://api.modelhelm.com/v1/chat/completions";
function consumeLine(line: string) {
  if (!line.startsWith("data:")) return;
  const data = line.slice(5).trim(); if (data === "[DONE]") { streamEnded = true; return; }
  let value: unknown; try { value = JSON.parse(data); } catch { return; } if (!record(value)) return;
  if (lane === "v1") {
    if (value.type === "message_start" && record(value.message) && record(value.message.usage)) inputTokens = value.message.usage.input_tokens;
    if (value.type === "message_delta" && record(value.usage)) outputTokens = value.usage.output_tokens;
    if (value.type === "content_block_start" && record(value.content_block)) assert.notEqual(value.content_block.type, "tool_use", "No tools are allowed in the live probe.");
    if (value.type === "content_block_delta" && record(value.delta) && value.delta.type === "text_delta" && typeof value.delta.text === "string") responseText += value.delta.text;
    if (value.type === "message_stop") streamEnded = true;
  } else {
    const choices = Array.isArray(value.choices) ? value.choices.filter(record) : [];
    for (const choice of choices) if (record(choice.delta)) {
      assert.ok(!Array.isArray(choice.delta.tool_calls) || choice.delta.tool_calls.length === 0, "No tools are allowed in the live probe.");
      if (typeof choice.delta.content === "string") responseText += choice.delta.content;
    }
    if (record(value.usage)) { inputTokens = value.usage.prompt_tokens; outputTokens = value.usage.completion_tokens; }
  }
  assert.ok(responseText.length <= 8192, "Bounded visible answer buffer.");
}
const preflightUpstream = synthetic ? Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body: unknown = await request.json(); assert.ok(record(body));
  if (lane === "v1") {
    const events = [{ type: "message_start", message: { id: "msg_synthetic_vision", type: "message", role: "assistant", model: modelID, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: JSON.stringify(expected) } }, { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } }, { type: "message_stop" }];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  }
  const chunks = [{ delta: { role: "assistant", content: JSON.stringify(expected) }, finish_reason: null }, { delta: {}, finish_reason: "stop" }];
  return new Response(chunks.map(choice => `data: ${JSON.stringify({ id: "synthetic_vision", object: "chat.completion.chunk", created: 1, model: modelID, choices: [{ index: 0, ...choice }] })}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
} }) : undefined;
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol === "https:") {
    assert.equal(url.href, expectedURL, "Only the fixed official model endpoint is permitted.");
    assert.equal(upstreamCalls, 0, "One upstream request per execution; no retry or continuation.");
    const headers = new Headers(init?.headers);
    assert.ok((lane === "v1" ? headers.get("x-api-key") : headers.get("authorization")) === (lane === "v1" ? key : `Bearer ${key}`), "Only the host may attach the existing upstream credential.");
    upstreamCalls++;
    const upstream = await originalFetch(preflightUpstream ? `http://127.0.0.1:${preflightUpstream.port}${url.pathname}` : input,
      { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    httpStatus = upstream.status;
    if (!upstream.ok) { await upstream.body?.cancel(); return Response.json({ error: { message: "The bounded live vision request was rejected." } }, { status: upstream.status }); }
    assert.ok(upstream.headers.get("content-type")?.includes("text/event-stream"), "Expected a streamed native response.");
    let pending = ""; const decoder = new TextDecoder();
    const tap = new TransformStream<Uint8Array, Uint8Array>({ transform(bytes, controller) {
      pending += decoder.decode(bytes, { stream: true }); assert.ok(pending.length <= 128 * 1024, "Bounded stream frame buffer.");
      const lines = pending.split("\n"); pending = lines.pop() ?? ""; for (const line of lines) consumeLine(line); controller.enqueue(bytes);
    }, flush() { pending += decoder.decode(); if (pending.trim()) consumeLine(pending); pending = ""; } });
    return new Response(upstream.body?.pipeThrough(tap), { status: upstream.status, headers: upstream.headers });
  }
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Host process blocks all other external destinations.");
  return originalFetch(input, init);
}, originalFetch);
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  const expectedPath = lane === "v1" ? "/gateway/openai/messages" : "/gateway/openai/chat/completions";
  if (path !== expectedPath) return Response.json({ error: "No approved fixture route" }, { status: 404 });
  if (proxyRequests > 0) return Response.json({ error: "The probe forbids retries and continuations." }, { status: 400 }); proxyRequests++;
  assert.ok((lane === "v1" ? request.headers.get("x-api-key") : request.headers.get("authorization")) === (lane === "v1" ? gatewayProxyToken(config) : `Bearer ${gatewayProxyToken(config)}`), "Native request must use only the scoped proxy credential.");
  const body: unknown = await request.clone().json(); assert.ok(record(body)); assert.equal(body.model, modelID); assert.equal(body.stream, true);
  const limits = [body.max_tokens, body.max_completion_tokens].filter((value): value is number => typeof value === "number");
  assert.ok(limits.length > 0 && limits.every(limit => Number.isInteger(limit) && limit > 0 && limit <= 512), "A hard <=512 output-token bound is required before network.");
  assert.ok(!Array.isArray(body.tools) || body.tools.length === 0, "The native probe must expose zero tools.");
  assert.ok(Array.isArray(body.messages)); const messages = body.messages.filter(record); assert.equal(messages.filter(message => message.role === "user").length, 1);
  const blocks = messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(record) : []);
  const images = blocks.filter(block => block.type === "image" || block.type === "image_url"); assert.equal(images.length, 1);
  const image = images[0];
  if (lane === "v1") { assert.ok(record(image.source)); assert.equal(image.source.type, "base64"); assert.equal(image.source.media_type, "image/png"); assert.ok(image.source.data === png.toString("base64"), "Native PNG bytes must match."); }
  else { assert.ok(record(image.image_url)); assert.ok(image.image_url.url === pngURL, "Native PNG bytes must match."); }
  assert.doesNotMatch(JSON.stringify(body.messages), /ERROR:.{0,120}(?:does not support image|cannot read images)/i);
  wire = { model: modelID, maxOutputTokens: Math.max(...limits), imageBlocks: images.length, firstTurn: true, mime: "image/png", bytes: png.length,
    sha256: pngSHA256, encoding: lane === "v1" ? "source/base64" : "image_url/dataURL", scopedAuthentication: true, tools: 0 };
  return lane === "v1" ? forwardGatewayMessages(config, env, request) : forwardGatewayChat(config, env, request);
} });
assert.ok(proxy.port); config.port = proxy.port;
const until = async (test: () => Promise<boolean>) => { const deadline = Date.now() + 60000; while (Date.now() < deadline) { if (await test()) return; await Bun.sleep(100); } throw new Error("Bounded native vision timeout."); };
async function keyAbsentOnDisk(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) { const full = join(path, entry.name); if (entry.isDirectory()) await keyAbsentOnDisk(full);
    if (entry.isFile()) assert.ok(!(await readFile(full)).includes(Buffer.from(key)), "Upstream credential persisted in native profile."); }
}
async function nativeWrapper() {
  const profile = join(directory, "loopback-only.sb"); await writeFile(profile, '(version 1)\n(allow default)\n(deny network*)\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n', { mode: 0o600 });
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`; const wrapper = join(directory, "native-engine");
  await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(profile)} ${quote(resolve(binary ?? ""))} "$@"\n`, { mode: 0o700 }); return wrapper;
}
try {
  for (const name of ["home", "config", "cache", "data", "state", "workspace"]) await mkdir(join(directory, name), { recursive: true });
  const generated = buildGatewayProvider({ ...settings, chatModel: modelID }, [{ id: modelID, name: "Bounded synthetic-image live probe", kind: "chat" }], config);
  const model = generated.models[modelID]; assert.ok(model); assert.ok(record(model.modalities) && Array.isArray(model.modalities.input) && model.modalities.input.includes("image"));
  const provider = { ...generated, models: { [modelID]: { ...model, tool_call: false, limit: { context: 128000, output: 512 } } } };
  assert.ok(!JSON.stringify(provider).includes(key));
  const isolated = { HOME: join(directory, "home"), XDG_CONFIG_HOME: join(directory, "config"), XDG_CACHE_HOME: join(directory, "cache"),
    XDG_DATA_HOME: join(directory, "data"), XDG_STATE_HOME: join(directory, "state"), OPENWORK_CLIENT_PROFILE: "local-gateway" };
  const wrapped = await nativeWrapper(); let version: unknown; let nativeCatalogImage = false;
  if (lane === "v1") {
    const runtime = join(directory, "runtime.json"); await writeFile(runtime, JSON.stringify({ enabled_providers: ["modelhelm"], provider: { modelhelm: provider }, permission: { "*": "deny" } }), { mode: 0o600 });
    child = spawn(wrapped, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: join(directory, "workspace"), env: { PATH: process.env.PATH, TMPDIR: tmpdir(), LANG: "en_US.UTF-8", ...isolated,
      OPENCODE_CONFIG: runtime, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1", OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_SHARE: "1", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
      npm_config_registry: `http://127.0.0.1:${config.port}`, npm_config_audit: "false", [GATEWAY_PROXY_TOKEN_ENV]: gatewayProxyToken(config) }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", bytes => { nativeOutput += String(bytes); }); child.stderr?.on("data", bytes => { nativeOutput += String(bytes); });
    let base = ""; await until(async () => { assert.equal(child?.exitCode, null); base = /opencode server listening on (http:\/\/[^\s]+)/.exec(nativeOutput)?.[1] ?? ""; return Boolean(base); });
    const call = async (path: string, body?: unknown) => { const response = await fetch(base + path, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
      assert.equal(response.status, 200, "Native V1 request must succeed."); const value: unknown = await response.json(); assert.ok(record(value)); return value; };
    version = (await call("/global/health")).version; assert.equal(version, "1.18.30"); const catalog = await call("/provider"); assert.ok(Array.isArray(catalog.all));
    const listed = catalog.all.find((item: unknown) => record(item) && item.id === "modelhelm"); assert.ok(record(listed) && record(listed.models));
    const native: unknown = listed.models[modelID]; assert.ok(record(native) && record(native.capabilities) && record(native.capabilities.input)); assert.equal(native.capabilities.input.image, true); nativeCatalogImage = true;
    const session = await call("/session", { title: "Bounded synthetic image recognition" }); assert.equal(typeof session.id, "string");
    await call(`/session/${String(session.id)}/message`, { model: { providerID: "modelhelm", modelID }, variant: "low", parts: [{ type: "text", text: prompt }, { type: "file", mime: "image/png", filename: "quadrants.png", url: pngURL }] });
  } else {
    managed = await createManagedOpencodeV2Server({ bin: wrapped, rootDir: join(directory, "engine"), bootTimeoutMs: 30000, env: { ...isolated, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_MODELS_URL: `http://127.0.0.1:${config.port}/no-catalog` }, permissions: async () => [{ action: "*", resource: "*", effect: "deny" }] });
    const current = managed; version = (await current.health()).version; assert.equal(version, "2.0.26"); const mapped = mapRuntimeProvidersToV2Specs({ modelhelm: provider }, new Map([[GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken(config)]])); await current.setProviders(mapped.specs);
    await until(async () => { const catalog = await current.fetchJson("/api/model", { timeoutMs: 5000 }); const all = record(catalog.json) ? catalog.json.data : catalog.json;
      const native = Array.isArray(all) ? all.filter(record).find(item => item.providerID === "modelhelm" && item.id === modelID) : undefined;
      if (!native) return false; assert.ok(record(native.capabilities) && Array.isArray(native.capabilities.input) && native.capabilities.input.includes("image")); nativeCatalogImage = true; return true; });
    const created = await current.fetchJson("/api/session", { method: "POST", body: { title: "Bounded synthetic image recognition", location: { directory: join(directory, "workspace") }, model: { providerID: "modelhelm", id: modelID } } });
    assert.equal(created.status, 200); assert.ok(record(created.json)); const session = record(created.json.data) ? created.json.data : created.json; assert.equal(typeof session.id, "string"); const id = String(session.id);
    const bound = await current.fetchJson(`/api/session/${id}/model`, { method: "POST", body: { model: { providerID: "modelhelm", id: modelID, variant: "low" } } }); assert.ok(bound.status >= 200 && bound.status < 300);
    const prompted = await current.fetchJson(`/api/session/${id}/prompt`, { method: "POST", body: { text: prompt, files: [{ uri: pngURL, name: "quadrants.png" }] }, timeoutMs: 60000 }); assert.ok(prompted.status >= 200 && prompted.status < 300);
    await until(async () => streamEnded); await until(async () => { const active = await current.fetchJson("/api/session/active", { timeoutMs: 5000 }); const states = record(active.json) && record(active.json.data) ? active.json.data : active.json; return record(states) && (!record(states[id]) || states[id].type === "idle"); });
  }
  assert.equal(httpStatus, 200); assert.equal(upstreamCalls, 1); assert.equal(proxyRequests, 1); assert.ok(streamEnded); assert.ok(responseText.trim());
  let answer: unknown; try { answer = JSON.parse(responseText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { answer = undefined; }
  const matched = Array.isArray(answer) && answer.length === 4 && answer.every((value: unknown, index: number) => typeof value === "string" && value.trim().toLowerCase() === expected[index]);
  assert.ok(!nativeOutput.includes(key));
  result = { passed: matched, syntheticPreflight: synthetic, lane, version, model: modelID, nativeCatalogImage, wire, image: { mime: "image/png", width: 128, height: 128, bytes: png.length, sha256: pngSHA256 },
    httpStatus, upstreamCalls, externalModelCalls: synthetic ? 0 : upstreamCalls, retryAndContinuationBudget: 0, textPresent: Boolean(responseText.trim()), quadrantColorOrderMatched: matched,
    remoteVisualRecognitionVerified: !synthetic && matched,
    inputTokens, outputTokens, streamEnded, nativeNetwork: "macOS sandbox: loopback-only", upstreamKeyOnlyInHostMemory: true, scopedTokenOnlyInNativeConfiguration: true, rawAnswerAndThinkingRetained: false };
  if (!matched) process.exitCode = 1;
} catch (error) {
  result = { passed: false, syntheticPreflight: synthetic, lane, model: modelID, httpStatus, upstreamCalls, externalModelCalls: synthetic ? 0 : upstreamCalls, proxyRequests, wire,
    failureType: error instanceof Error ? error.name : "Unknown", rawAnswerAndThinkingRetained: false }; process.exitCode = 1;
} finally {
  await managed?.close();
  if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), Bun.sleep(3000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await Promise.race([once(child, "exit"), Bun.sleep(1000)]); } }
  try { await keyAbsentOnDisk(directory); result = { ...result, keyAbsentOnDisk: true }; }
  catch { result = { ...result, passed: false, keyAbsentOnDisk: false }; process.exitCode = 1; }
  finally { proxy.stop(true); preflightUpstream?.stop(true); globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); nativeOutput = ""; responseText = ""; key = ""; }
}
assert.ok(result); console.log(JSON.stringify({ ...result, nativeProfileRemoved: true, nativeLogsDiscarded: true }));
