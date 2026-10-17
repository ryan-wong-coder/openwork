// Run with Bun and the pinned OPENWORK_TEST_OPENCODE_BIN (1.18.30) and
// OPENWORK_TEST_OPENCODE2_BIN (2.0.26). Both native engines use isolated
// profiles, synthetic scoped authentication and a real localhost-only proxy.
// macOS sandbox-exec blocks native WAN traffic; no desktop app is launched.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buildGatewayProvider, DEFAULT_GATEWAY_BASE_URL, parseGatewayModels } from "../../src/gateway-config";
import { GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken } from "../../src/gateway-proxy-auth";
import { createManagedOpencodeV2Server } from "../../src/managed-opencode-v2";
import { mapRuntimeProvidersToV2Specs } from "../../src/engine-v2-preview";
import { syntheticVisionGateway, record, png, pngURL, pngHash, visionModels, textModel, imageParts, verifyImage } from "./gateway-vision-native-upstream";

assert.equal(process.platform, "darwin", "This manual fixture requires macOS sandbox-exec to enforce native loopback-only network access.");
const v1Binary = process.env.OPENWORK_TEST_OPENCODE_BIN;
const v2Binary = process.env.OPENWORK_TEST_OPENCODE2_BIN;
assert.ok(v1Binary && v2Binary, "Set both pinned native binary paths. The fixture never downloads a binary.");
const directory = await realpath(await mkdtemp(join(tmpdir(), "zeno-vision-native-")));
const gateway = await syntheticVisionGateway(directory);
let child: ReturnType<typeof spawn> | undefined;
let managed: Awaited<ReturnType<typeof createManagedOpencodeV2Server>> | undefined;
let output = "";

async function until(read: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await read()) return; await Bun.sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
function modelProvider() {
  const generated = buildGatewayProvider({ baseURL: DEFAULT_GATEWAY_BASE_URL, chatModel: visionModels[0], imageModel: "unused",
    imageSize: "1024x1024", imageQuality: "auto", requestTimeoutMs: 10000, imageGenerationEnabled: false },
  parseGatewayModels({ data: visionModels.map(id => ({ id })) }), gateway.config);
  return { ...generated, models: { ...generated.models, [textModel]: { name: "Synthetic text-only control", image: false,
    modalities: { input: ["text"], output: ["text"] }, limit: { context: 64000, output: 1024 } } } };
}
async function nativeWrapper(binary: string, name: string) {
  const profile = join(directory, `${name}.sb`);
  await writeFile(profile, '(version 1)\n(allow default)\n(deny network*)\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n', { mode: 0o600 });
  const wrapper = join(directory, name);
  // A shell wrapper is required because the managed v2 server takes a binary
  // path. Quote paths with POSIX single quotes; never interpolate environment.
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(profile)} ${quote(resolve(binary))} "$@"\n`, { mode: 0o700 });
  return wrapper;
}
async function stopV1() {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM"); await Promise.race([once(child, "exit"), Bun.sleep(3000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await Promise.race([once(child, "exit"), Bun.sleep(1000)]); }
  }
}
function capturedSummary(model: string, before: number) {
  const calls = gateway.captures.slice(before).filter(capture => capture.body.model === model);
  assert.equal(calls.length, 1, "A first-turn image proof must use one upstream call, without a read-tool continuation.");
  const capture = calls[0];
  assert.equal(capture.body.model, model); assert.equal(capture.body.stream, true);
  assert.doesNotMatch(JSON.stringify(capture.body.messages), /ERROR:.{0,120}(?:does not support image|cannot read images)/i,
    "Supported native image input must not be replaced with the old rejection text.");
  return { model, firstTurn: true, modelCalls: calls.length, ...verifyImage(capture.body, capture.protocol) };
}
const unsupportedPattern = /(?:does not|doesn't|not|unsupported|cannot|can't).{0,60}image|image.{0,80}(?:not support|unsupported|not supported)/i;
function controlSummary(before: number, response: unknown, stored: unknown) {
  const calls = gateway.captures.slice(before).filter(capture => capture.body.model === textModel);
  assert.ok(calls.every(capture => imageParts(capture.body).length === 0), "Text-only model must never receive an image block.");
  const explanation = JSON.stringify([response, stored, calls.map(capture => capture.body.messages)]);
  assert.match(explanation, unsupportedPattern, "Native text-only control must explicitly reject image input, rather than silently dropping it.");
  return { model: textModel, imageSupported: false, nativeRejectionObserved: true, transmittedImages: 0, modelCalls: calls.length };
}

try {
  const v1 = join(directory, "v1");
  const workspace = join(v1, "workspace");
  for (const name of ["config", "cache", "data", "state", "workspace"]) await mkdir(join(v1, name), { recursive: true });
  const runtime = join(v1, "runtime.json");
  await writeFile(runtime, JSON.stringify({ enabled_providers: ["modelhelm"], provider: { modelhelm: modelProvider() }, permission: { "*": "deny" } }), { mode: 0o600 });
  const v1Wrapper = await nativeWrapper(v1Binary, "native-v1");
  child = spawn(v1Wrapper, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: workspace, env: {
    PATH: process.env.PATH, HOME: v1, TMPDIR: tmpdir(), LANG: "en_US.UTF-8", XDG_CONFIG_HOME: join(v1, "config"),
    XDG_DATA_HOME: join(v1, "data"), XDG_CACHE_HOME: join(v1, "cache"), XDG_STATE_HOME: join(v1, "state"),
    OPENWORK_CLIENT_PROFILE: "local-gateway", OPENCODE_CONFIG: runtime, OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_SHARE: "1", OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
    npm_config_registry: `http://127.0.0.1:${gateway.config.port}`, npm_config_audit: "false", [GATEWAY_PROXY_TOKEN_ENV]: gatewayProxyToken(gateway.config),
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", chunk => { output += String(chunk); }); child.stderr?.on("data", chunk => { output += String(chunk); });
  let base = "";
  await until(async () => { assert.equal(child?.exitCode, null, "Pinned V1 must remain running");
    base = /opencode server listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? ""; return Boolean(base); }, "V1 starts");
  const callV1 = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, { ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const value: unknown = await response.json(); return { status: response.status, json: value };
  };
  const healthV1 = await callV1("/global/health"); assert.ok(record(healthV1.json)); assert.equal(healthV1.json.version, "1.18.30");
  const catalogV1 = await callV1("/provider"); assert.ok(record(catalogV1.json) && Array.isArray(catalogV1.json.all));
  const providerV1 = catalogV1.json.all.find((value: unknown) => record(value) && value.id === "modelhelm"); assert.ok(record(providerV1) && record(providerV1.models));
  const v1Proofs = [];
  for (const model of visionModels) {
    const listed: unknown = providerV1.models[model]; assert.ok(record(listed) && record(listed.capabilities) && record(listed.capabilities.input));
    assert.equal(listed.capabilities.input.image, true, `V1 ${model} must advertise image input`);
    const session = await callV1("/session", { title: "Synthetic image first-turn proof" }); assert.ok(record(session.json) && typeof session.json.id === "string");
    const before = gateway.captures.length;
    const response = await callV1(`/session/${session.json.id}/message`, { model: { providerID: "modelhelm", modelID: model }, variant: "low",
      parts: [{ type: "text", text: "Inspect the attached synthetic PNG. Reply briefly. Do not use any tool." }, { type: "file", mime: "image/png", filename: "synthetic.png", url: pngURL }] });
    assert.equal(response.status, 200); v1Proofs.push(capturedSummary(model, before));
  }
  const controlV1 = await callV1("/session", { title: "Synthetic text-only image rejection" }); assert.ok(record(controlV1.json) && typeof controlV1.json.id === "string");
  const beforeV1 = gateway.captures.length;
  const rejectedV1 = await callV1(`/session/${controlV1.json.id}/message`, { model: { providerID: "modelhelm", modelID: textModel },
    parts: [{ type: "text", text: "Inspect this synthetic image." }, { type: "file", mime: "image/png", filename: "synthetic.png", url: pngURL }] });
  const messagesV1 = await callV1(`/session/${controlV1.json.id}/message`);
  const textControlV1 = controlSummary(beforeV1, rejectedV1.json, messagesV1.json);
  await stopV1(); child = undefined; output = "";

  const v2 = join(directory, "v2");
  for (const name of ["home", "config", "cache", "data", "state", "workspace"]) await mkdir(join(v2, name), { recursive: true });
  managed = await createManagedOpencodeV2Server({ bin: await nativeWrapper(v2Binary, "native-v2"), rootDir: join(v2, "engine"), bootTimeoutMs: 30000,
    permissions: async () => [{ action: "*", resource: "*", effect: "deny" }],
    env: { HOME: join(v2, "home"), XDG_CONFIG_HOME: join(v2, "config"), XDG_CACHE_HOME: join(v2, "cache"), XDG_DATA_HOME: join(v2, "data"), XDG_STATE_HOME: join(v2, "state"),
      OPENWORK_CLIENT_PROFILE: "local-gateway", OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_MODELS_URL: `http://127.0.0.1:${gateway.config.port}/catalog` } });
  const current = managed; assert.equal((await current.health()).version, "2.0.26");
  const mapped = mapRuntimeProvidersToV2Specs({ modelhelm: modelProvider() }, new Map([[GATEWAY_PROXY_TOKEN_ENV, gatewayProxyToken(gateway.config)]]));
  await current.setProviders(mapped.specs);
  let catalogV2: Record<string, unknown>[] = [];
  await until(async () => { const response = await current.fetchJson("/api/model", { timeoutMs: 5000 });
    assert.equal(response.status, 200); const items = record(response.json) ? response.json.data : response.json; assert.ok(Array.isArray(items));
    catalogV2 = items.filter(record).filter(model => model.providerID === "modelhelm"); return [...visionModels, textModel].every(id => catalogV2.some(model => model.id === id)); }, "V2 catalog updates");
  const createV2 = async (model: string) => {
    const created = await current.fetchJson("/api/session", { method: "POST", body: { title: "Synthetic image first-turn proof", location: { directory: join(v2, "workspace") }, model: { providerID: "modelhelm", id: model } }, timeoutMs: 10000 });
    assert.equal(created.status, 200); assert.ok(record(created.json)); const session = record(created.json.data) ? created.json.data : created.json; assert.equal(typeof session.id, "string");
    const id = String(session.id);
    const selected = await current.fetchJson(`/api/session/${id}/model`, { method: "POST", body: { model: { providerID: "modelhelm", id: model, ...(model === textModel ? {} : { variant: "low" }) } }, timeoutMs: 10000 });
    assert.ok(selected.status >= 200 && selected.status < 300); return id;
  };
  const idleV2 = async (id: string) => until(async () => { const active = await current.fetchJson("/api/session/active", { timeoutMs: 5000 });
    assert.ok(record(active.json)); const states = record(active.json.data) ? active.json.data : active.json; return !record(states[id]) || states[id].type === "idle"; }, "V2 image turn completes");
  const v2Proofs = [];
  for (const model of visionModels) {
    const listed = catalogV2.find(item => item.id === model); assert.ok(listed && record(listed.capabilities) && Array.isArray(listed.capabilities.input));
    assert.ok(listed.capabilities.input.includes("image"), `V2 ${model} must advertise image input`);
    const id = await createV2(model); const before = gateway.captures.length;
    const response = await current.fetchJson(`/api/session/${id}/prompt`, { method: "POST", body: { text: "Inspect the attached synthetic PNG. Reply briefly. Do not use any tool.", files: [{ uri: pngURL, name: "synthetic.png" }] }, timeoutMs: 10000 });
    assert.ok(response.status >= 200 && response.status < 300);
    await until(async () => gateway.captures.length > before, "V2 first turn reaches upstream with image"); await idleV2(id); v2Proofs.push(capturedSummary(model, before));
  }
  const controlID = await createV2(textModel); const beforeV2 = gateway.captures.length;
  const rejectedV2 = await current.fetchJson(`/api/session/${controlID}/prompt`, { method: "POST", body: { text: "Inspect this synthetic image.", files: [{ uri: pngURL, name: "synthetic.png" }] }, timeoutMs: 10000 });
  await until(async () => {
    const stored = await current.fetchJson(`/api/session/${controlID}/message`, { timeoutMs: 5000 });
    return unsupportedPattern.test(JSON.stringify([rejectedV2.json, stored.json, gateway.captures.slice(beforeV2).map(capture => capture.body.messages)]));
  }, "V2 text-only native rejection becomes visible");
  await idleV2(controlID);
  const messagesV2 = await current.fetchJson(`/api/session/${controlID}/message`, { timeoutMs: 10000 });
  const textControlV2 = controlSummary(beforeV2, rejectedV2.json, messagesV2.json);
  assert.deepEqual(gateway.failures, []); assert.ok(gateway.proxyRequests.every(request => request.scoped));
  console.log(JSON.stringify({ passed: true, engines: [{ version: "1.18.30", nativeInput: "message parts:file/dataURL", proofs: v1Proofs, textOnlyControl: textControlV1 },
    { version: "2.0.26", nativeInput: "prompt files:uri/dataURL", proofs: v2Proofs, textOnlyControl: textControlV2 }],
    image: { mime: "image/png", width: 2, height: 2, bytes: png.length, sha256: pngHash }, firstTurnImageTransport: true, noReadToolContinuation: true,
    realScopedProxy: true, syntheticUpstream: true, nativeNetwork: "macOS sandbox: loopback-only", externalModelCalls: 0, realCredentialsRead: false, profilesRemovedOnExit: true }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, phase: "native-vision", capturedModels: gateway.captures.map(capture => ({ model: capture.body.model, protocol: capture.protocol, images: imageParts(capture.body).length })),
    syntheticUpstreamFailures: gateway.failures, error: error instanceof Error ? error.message : "Unknown fixture failure" }));
  throw error;
} finally {
  await stopV1(); await managed?.close(); gateway.stop(); await rm(directory, { recursive: true, force: true });
}
