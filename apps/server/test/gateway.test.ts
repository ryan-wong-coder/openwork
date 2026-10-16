import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvService } from "../src/env-file";
import { buildGatewayProvider, gatewayRequest, normalizeGatewayBaseURL, parseGatewayInput, parseGatewayModels, publicGatewayConfig, readGatewaySettings, testGatewayConnection } from "../src/gateway-config";
import { generateGatewayImage } from "../src/gateway-images";
import { createGatewayImageTools } from "../src/opencode-plugins/gateway-image-tools";
import { openAiImageGenerationStatus } from "../src/extensions/openai-image-generation";
import { serve } from "../src/serve-node";

const fixtureKey = "synthetic-gateway-credential";
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVl0AAAAASUVORK5CYII=", "base64");
let directory: string;
let baseURL: string;
let stop: () => void | Promise<void>;
let calls: { path: string; json?: unknown; multipart?: FormData }[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openwork-gateway-"));
  const server = await serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    expect(request.headers.get("authorization")).toBe(`Bearer ${fixtureKey}`);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/error")) return Response.json({ error: { message: `Failed: ${fixtureKey}` } }, { status: 429 });
    if (path.endsWith("/slow")) { await new Promise((resolve) => setTimeout(resolve, 80)); return Response.json({}); }
    if (path.endsWith("/slow-body")) {
      let timer: ReturnType<typeof setTimeout>;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          timer = setTimeout(() => { controller.enqueue(new TextEncoder().encode("[]}")); controller.close(); }, 80);
        },
        cancel() { clearTimeout(timer); },
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (path.endsWith("/models")) return Response.json({ data: [{ id: "anthropic/claude-sonnet-5" }, { id: "openai/gpt-image-2" }] });
    if (path.endsWith("/chat/completions")) return Response.json({ choices: [{ message: { content: "GATEWAY_OK" } }] });
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) calls.push({ path, multipart: await request.formData() });
    else calls.push({ path, json: await request.json() });
    return Response.json({ data: [{ b64_json: image.toString("base64") }] });
  } });
  stop = server.stop;
  baseURL = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
const environment = (extra: Record<string, string> = {}) => ({ list: async () => Object.entries({ OPENWORK_GATEWAY_BASE_URL: baseURL, OPENWORK_GATEWAY_API_KEY: fixtureKey, ...extra }).map(([key, value]) => ({ key, value, updatedAt: 0 })) });

describe("gateway configuration", () => {
  test("preserves model routing namespaces and builds a credential-free provider", async () => {
    const { settings } = await readGatewaySettings(environment());
    const models = parseGatewayModels({ data: [{ id: "openai/gpt-image-2" }, { id: "anthropic/claude-sonnet-5" }, { id: " anthropic/claude-sonnet-5 " }, { id: "google/text-embedding" }] });
    expect(models.map((model) => model.id)).toEqual(["openai/gpt-image-2", "anthropic/claude-sonnet-5", "google/text-embedding"]);
    const provider = buildGatewayProvider(settings, models, { port: 8787 });
    expect(provider.models).toHaveProperty("anthropic/claude-sonnet-5");
    expect(provider.models).not.toHaveProperty("openai/gpt-image-2");
    expect(JSON.stringify(provider)).not.toContain(fixtureKey);
    expect(provider.options).toMatchObject({ baseURL: "http://127.0.0.1:8787/gateway/openai", gatewayBaseURL: settings.baseURL });
    expect(provider.env).toEqual(["OPENWORK_GATEWAY_PROXY_TOKEN"]);
    const result = await publicGatewayConfig(environment());
    expect(result).toMatchObject({ configured: true, apiKeyLast4: fixtureKey.slice(-4) });
    expect(JSON.stringify(result)).not.toContain(fixtureKey);
  });
  test("validates URLs, timeouts, booleans, and model output", async () => {
    expect(normalizeGatewayBaseURL("https://api.modelhelm.com/v1/")).toBe("https://api.modelhelm.com/v1");
    for (const value of ["http://example.test/v1", "https://user:secret@example.test/v1", "https://example.test/v1?key=value", "file:///tmp"]) expect(() => normalizeGatewayBaseURL(value)).toThrow();
    const { settings } = await readGatewaySettings(environment());
    for (const input of [{ requestTimeoutMs: 2 }, { imageGenerationEnabled: "false" }, { apiKey: "bad\nvalue" }, { imageSize: "5x5" }]) expect(() => parseGatewayInput(input, settings)).toThrow();
    expect(() => parseGatewayModels({ object: "list" })).toThrow();
    expect(await testGatewayConnection(environment())).toMatchObject({ ok: true, message: "GATEWAY_OK", model: "anthropic/claude-sonnet-5" });
  });
  test("persists gateway options privately and explicit clearing shadows inherited secrets", async () => {
    const path = join(directory, "env.json");
    const env = new EnvService({ path });
    await env.upsertMany([{ key: "OPENWORK_GATEWAY_API_KEY", value: fixtureKey }, { key: "OPENWORK_GATEWAY_IMAGE_GENERATION_ENABLED", value: "false" }]);
    expect(await publicGatewayConfig(env)).toMatchObject({ configured: true, imageGenerationEnabled: false });
    expect(await EnvService.readForInjection(path)).not.toHaveProperty("OPENWORK_GATEWAY_API_KEY");
    const previous = process.env.OPENWORK_GATEWAY_API_KEY;
    try {
      process.env.OPENWORK_GATEWAY_API_KEY = fixtureKey;
      await env.upsertMany([{ key: "OPENWORK_GATEWAY_API_KEY", value: "" }]);
      expect(await publicGatewayConfig(env)).toMatchObject({ configured: false, apiKeyLast4: null });
    } finally { if (previous === undefined) delete process.env.OPENWORK_GATEWAY_API_KEY; else process.env.OPENWORK_GATEWAY_API_KEY = previous; }
  });
  test("legacy image actions cannot fall back to a direct OpenAI credential", async () => {
    const env = new EnvService({ path: join(directory, "legacy-env.json") });
    await env.upsertMany([{ key: "OPENAI_API_KEY", value: fixtureKey }, { key: "OPENWORK_GATEWAY_API_KEY", value: "" }]);
    expect(await openAiImageGenerationStatus(env)).toMatchObject({ configured: false, connected: false, provider: "modelhelm" });
  });
  test("redacts upstream secrets and honors cancellation", async () => {
    const { settings } = await readGatewaySettings(environment());
    try { await gatewayRequest(settings, fixtureKey, "error"); throw new Error("expected rejection"); }
    catch (error) { expect(String(error)).not.toContain(fixtureKey); expect(String(error)).toContain("已隐藏密钥"); }
    await expect(gatewayRequest(settings, fixtureKey, "slow", {}, AbortSignal.timeout(2))).rejects.toThrow("已取消");
    await expect(gatewayRequest(settings, fixtureKey, "slow-body", {}, AbortSignal.timeout(10))).rejects.toThrow("已取消");
  });
});

describe("gateway image artifacts", () => {
  test("generates unique files and sends exact configured model, quality, and size", async () => {
    calls = [];
    const workspace = { id: "fixture", path: directory, name: "Fixture" };
    const input = { prompt: "绘制蓝色方块", filename: "页面配图", quality: "low", size: "1024x1024" };
    const first = await generateGatewayImage(environment(), workspace, input);
    const second = await generateGatewayImage(environment(), workspace, input);
    expect(first.path).not.toBe(second.path);
    expect(first.path).toStartWith("artifacts/页面配图-");
    expect(await readFile(first.absolutePath)).toEqual(image);
    expect(first).toMatchObject({ width: 1, height: 1, requestedSize: "1024x1024", pathBase: "workspace-root", workspaceRoot: await realpath(directory) });
    expect(calls[0]).toMatchObject({ path: "/v1/images/generations", json: { model: "openai/gpt-image-2", quality: "low", size: "1024x1024", response_format: "b64_json" } });
    expect(JSON.stringify(first)).not.toContain(fixtureKey);
    const edited = await generateGatewayImage(environment(), workspace, { prompt: "改成绿色", referenceImages: [first.path] });
    expect(await readFile(edited.absolutePath)).toEqual(image);
    expect(calls[2].path).toBe("/v1/images/edits");
    const uploaded = calls[2].multipart?.get("image[]");
    expect(uploaded).toBeInstanceOf(File);
    if (uploaded instanceof File) expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(image);
  });
  test("disabled generation and unsafe references never reach the gateway", async () => {
    calls = [];
    const workspace = { id: "fixture", path: directory, name: "Fixture" };
    await expect(generateGatewayImage(environment({ OPENWORK_GATEWAY_IMAGE_GENERATION_ENABLED: "false" }), workspace, { prompt: "image" })).rejects.toThrow("尚未启用");
    const outside = `${directory}-outside.png`;
    await writeFile(outside, image);
    try {
      await symlink(outside, join(directory, "escape.png"));
      await expect(generateGatewayImage(environment(), workspace, { prompt: "edit", referenceImages: ["escape.png"] })).rejects.toThrow("工作区内");
    } finally { await rm(outside, { force: true }); }
    expect(calls).toHaveLength(0);
  });
  test("chat tool forwards validated arguments and preserves execution context", async () => {
    let captured: unknown;
    const context = { sessionID: "fixture-session" };
    const tools = createGatewayImageTools(async (input, actualContext) => { captured = { input, actualContext }; return { path: "artifacts/result.png" }; });
    expect(await tools.openwork_image_generate.execute({ prompt: "页面配图", referenceImages: ["assets/logo.png"] }, context)).toContain("artifacts/result.png");
    expect(captured).toEqual({ input: { prompt: "页面配图", referenceImages: ["assets/logo.png"] }, actualContext: context });
    await expect(tools.openwork_image_generate.execute({ prompt: "" }, context)).rejects.toThrow();
  });
});
