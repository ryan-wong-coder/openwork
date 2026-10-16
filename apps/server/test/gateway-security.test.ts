import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvService } from "../src/env-file";
import { callExperimentalExtensionAction } from "../src/extensions";
import { publicGatewayConfig, saveGatewayConfig } from "../src/gateway-config";
import { generateGatewayImage } from "../src/gateway-images";
import { serve } from "../src/serve-node";
import type { ServerConfig } from "../src/types";

const fixtureKey = "synthetic-security-credential";
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVl0AAAAASUVORK5CYII=", "base64");
let directory: string;
let previousRuntimeDb: string | undefined;
let number = 0;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openwork-gateway-security-"));
  previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
  delete process.env.OPENWORK_RUNTIME_DB;
});
afterAll(async () => {
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  await rm(directory, { recursive: true, force: true });
});

async function fixture(handler: (request: Request, root: string) => Response | Promise<Response>) {
  const profile = join(directory, String(++number));
  const root = join(profile, "workspace");
  await mkdir(root, { recursive: true });
  let requests = 0;
  const server = await serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    requests += 1;
    expect(request.headers.get("authorization")).toBe(`Bearer ${fixtureKey}`);
    return handler(request, root);
  } });
  const env = new EnvService({ path: join(profile, "env.json") });
  const baseURL = `http://127.0.0.1:${server.port}/v1`;
  await env.upsertMany([{ key: "OPENWORK_GATEWAY_BASE_URL", value: baseURL }, { key: "OPENWORK_GATEWAY_API_KEY", value: fixtureKey }]);
  const workspace = { id: "fixture", name: "Fixture", path: root };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture-owner", hostToken: "fixture-host", configPath: join(profile, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [root], workspaces: [workspace],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  return { root, env, baseURL, workspace, config, stop: server.stop, requests: () => requests };
}

const legacyCall = { extensionId: "openai-image-generation", action: "image_generate", args: { prompt: "图片" }, context: { workspaceId: "fixture" } };
const imageResponse = () => Response.json({ data: [{ b64_json: image.toString("base64") }] });

test("legacy image actions obey read-only mode and never fall back to OPENAI_API_KEY", async () => {
  const local = await fixture(imageResponse);
  try {
    await expect(callExperimentalExtensionAction({ ...local.config, readOnly: true }, local.env, legacyCall)).rejects.toMatchObject({ status: 403, code: "read_only" });
    expect(await callExperimentalExtensionAction({ ...local.config, readOnly: true }, local.env, { ...legacyCall, action: "status", args: {} })).toMatchObject({ result: { configured: true, connected: true } });
    await local.env.upsertMany([{ key: "OPENWORK_GATEWAY_API_KEY", value: "" }, { key: "OPENAI_API_KEY", value: fixtureKey }]);
    await expect(callExperimentalExtensionAction(local.config, local.env, legacyCall)).rejects.toMatchObject({ code: "gateway_images_disabled" });
    expect(local.requests()).toBe(0);
    expect(await readdir(local.root)).toEqual([]);
  } finally { await local.stop(); }
});

test("legacy action cancellation reaches the gateway and never saves an artifact", async () => {
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const local = await fixture(async () => { entered(); await released; return imageResponse(); });
  const controller = new AbortController();
  const generation = callExperimentalExtensionAction(local.config, local.env, legacyCall, undefined, controller.signal);
  try {
    await started;
    controller.abort();
    await expect(generation).rejects.toMatchObject({ code: "gateway_request_cancelled" });
    expect(await readdir(join(local.root, "artifacts"))).toEqual([]);
  } finally {
    release();
    await Promise.allSettled([generation]);
    await local.stop();
  }
});

for (const replacement of ["symlink", "output-directory", "workspace-directory"]) {
  test(`a ${replacement} replacement while the gateway runs cannot redirect output`, async () => {
    let outside = "";
    const local = await fixture(async (_request, root) => {
      if (replacement === "workspace-directory") {
        await rename(root, `${root}-original`);
        await mkdir(join(root, "artifacts"), { recursive: true });
      } else {
        await rename(join(root, "artifacts"), join(root, "original-artifacts"));
        if (replacement === "symlink") {
          outside = `${root}-outside`;
          await mkdir(outside);
          await symlink(outside, join(root, "artifacts"), "dir");
        } else await mkdir(join(root, "artifacts"));
      }
      return imageResponse();
    });
    try {
      await expect(generateGatewayImage(local.env, local.workspace, { prompt: "图片" })).rejects.toMatchObject({ code: "gateway_image_path_changed" });
      expect(await readdir(join(local.root, "artifacts"))).toEqual([]);
      if (outside) expect(await readdir(outside)).toEqual([]);
    } finally { await local.stop(); }
  });
}

test("chat-only gateways save with image generation disabled and reject enabling unavailable images", async () => {
  const local = await fixture(() => Response.json({ data: [{ id: "anthropic/claude-sonnet-5" }] }));
  const config = { ...local.config, workspaces: [] };
  try {
    await saveGatewayConfig(config, local.env, { baseURL: local.baseURL, imageGenerationEnabled: false });
    expect(await publicGatewayConfig(local.env, config)).toMatchObject({ configured: true, ready: true, imageGenerationEnabled: false });
    await expect(saveGatewayConfig(config, local.env, { imageGenerationEnabled: true })).rejects.toMatchObject({ code: "gateway_image_model_missing" });
    expect(await publicGatewayConfig(local.env, config)).toMatchObject({ imageGenerationEnabled: false });
  } finally { await local.stop(); }
});
