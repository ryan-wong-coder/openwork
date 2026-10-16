import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvService } from "../src/env-file";
import { GATEWAY_API_KEY_ENV, GATEWAY_MODEL_CATALOG_ENV, publicGatewayConfig, restoreGatewayProvider, saveGatewayConfig, syncGatewayModels } from "../src/gateway-config";
import { readGlobalRuntimeOpencodeConfig, writeGlobalRuntimeOpencodeConfig } from "../src/runtime-opencode-config-store";
import { serve } from "../src/serve-node";
import { gatewayProxyBaseURL } from "../src/gateway-proxy-auth";
import type { ServerConfig } from "../src/types";

const fixtureKey = "synthetic-restore-credential";
let directory: string;
let baseURL: string;
let requests = 0;
let stop: () => void | Promise<void>;
let previousRuntimeDb: string | undefined;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openwork-gateway-restore-"));
  previousRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
  delete process.env.OPENWORK_RUNTIME_DB;
  const server = await serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
    requests += 1;
    expect(new URL(request.url).pathname).toBe("/v1/models");
    expect(request.headers.get("authorization")).toBe(`Bearer ${fixtureKey}`);
    return Response.json({ data: [{ id: "anthropic/claude-sonnet-5" }, { id: "openai/gpt-image-2" }] });
  } });
  stop = server.stop;
  baseURL = `http://127.0.0.1:${server.port}/v1`;
});
afterAll(async () => {
  await stop();
  if (previousRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = previousRuntimeDb;
  await rm(directory, { recursive: true, force: true });
});

function config(name: string, readOnly = false): ServerConfig {
  return {
    host: "127.0.0.1", port: 0, token: "fixture-owner", hostToken: "fixture-host",
    configPath: join(directory, name, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [], workspaces: [],
    readOnly, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
}

async function saved(name: string) {
  const path = join(directory, name, "env.json");
  const env = new EnvService({ path });
  const original = config(`${name}-original`);
  await saveGatewayConfig(original, env, { baseURL, apiKey: fixtureKey });
  return { path, env, original };
}

describe("private gateway catalog startup restoration", () => {
  test("restores a new profile offline from the validated private catalog", async () => {
    const { path, env } = await saved("cold");
    const cold = config("cold-new-profile");
    const count = requests;
    expect(await publicGatewayConfig(env, cold)).toMatchObject({ configured: true, ready: false });
    expect(await restoreGatewayProvider(cold, env)).toEqual({ changed: true, ready: true });
    expect(await publicGatewayConfig(env, cold)).toMatchObject({ configured: true, ready: true });
    expect(await restoreGatewayProvider(cold, env)).toEqual({ changed: false, ready: true });
    expect(requests).toBe(count);
    const runtime = await readGlobalRuntimeOpencodeConfig(cold);
    expect(runtime.provider?.modelhelm).toMatchObject({ options: { baseURL: gatewayProxyBaseURL(cold), gatewayBaseURL: baseURL }, models: { "anthropic/claude-sonnet-5": { tool_call: true } } });
    expect(JSON.stringify(runtime)).not.toContain(fixtureKey);
    const catalog = (await env.list()).find((entry) => entry.key === GATEWAY_MODEL_CATALOG_ENV)?.value;
    expect(catalog).toContain("anthropic/claude-sonnet-5");
    expect(catalog).not.toContain(fixtureKey);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const injected = await EnvService.readForInjection(path);
    expect(injected).not.toHaveProperty(GATEWAY_API_KEY_ENV);
    expect(injected).not.toHaveProperty(GATEWAY_MODEL_CATALOG_ENV);
  });

  test("rejects a cache after endpoint or credential changes and preserves unrelated providers", async () => {
    for (const field of ["OPENWORK_GATEWAY_BASE_URL", GATEWAY_API_KEY_ENV]) {
      const { env, original } = await saved(`binding-${field}`);
      await writeGlobalRuntimeOpencodeConfig(original, (runtime) => ({ ...runtime, provider: { ...runtime.provider, unrelated: { name: "Local fixture" } } }));
      await env.upsertMany([{ key: field, value: field === GATEWAY_API_KEY_ENV ? "synthetic-rotated-key" : `${baseURL}/changed` }]);
      const count = requests;
      expect(await restoreGatewayProvider(original, env)).toEqual({ changed: true, ready: false });
      const runtime = await readGlobalRuntimeOpencodeConfig(original);
      expect(runtime.provider).not.toHaveProperty("modelhelm");
      expect(runtime.provider?.unrelated).toEqual({ name: "Local fixture" });
      expect(await publicGatewayConfig(env, original)).toMatchObject({ configured: true, ready: false });
      expect(requests).toBe(count);
    }
  });

  test("key-only, damaged cache, and cleared credentials never imply profile readiness", async () => {
    const env = new EnvService({ path: join(directory, "invalid", "env.json") });
    const profile = config("invalid-profile");
    await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: fixtureKey }, { key: "OPENWORK_GATEWAY_BASE_URL", value: baseURL }]);
    const count = requests;
    expect(await restoreGatewayProvider(profile, env)).toMatchObject({ ready: false });
    expect(await publicGatewayConfig(env, profile)).toMatchObject({ configured: true, ready: false });
    await env.upsertMany([{ key: GATEWAY_MODEL_CATALOG_ENV, value: "{broken-cache" }]);
    expect(await restoreGatewayProvider(profile, env)).toEqual({ changed: false, ready: false });
    await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: "" }]);
    expect(await restoreGatewayProvider(profile, env)).toEqual({ changed: false, ready: false });
    expect(await publicGatewayConfig(env, profile)).toMatchObject({ configured: false, ready: false });
    expect(requests).toBe(count);
  });

  test("explicit sync repairs an existing key-only profile and persists the offline catalog", async () => {
    const env = new EnvService({ path: join(directory, "repair", "env.json") });
    await env.upsertMany([{ key: GATEWAY_API_KEY_ENV, value: fixtureKey }, { key: "OPENWORK_GATEWAY_BASE_URL", value: baseURL }]);
    const profile = config("repair-profile");
    const count = requests;
    expect(await syncGatewayModels(profile, env)).toMatchObject({ changed: true });
    expect(requests).toBe(count + 1);
    expect(await publicGatewayConfig(env, profile)).toMatchObject({ configured: true, ready: true });
    expect(await restoreGatewayProvider(config("repair-second-profile"), env)).toEqual({ changed: true, ready: true });
    expect(requests).toBe(count + 1);
  });

  test("read-only startup does not materialize cached providers", async () => {
    const { env } = await saved("readonly");
    const profile = config("readonly-profile", true);
    const count = requests;
    expect(await restoreGatewayProvider(profile, env)).toEqual({ changed: false, ready: false });
    expect((await readGlobalRuntimeOpencodeConfig(profile)).provider).toBeUndefined();
    expect(requests).toBe(count);
  });

  test("a late directory sync cannot restore an old endpoint after saving new credentials", async () => {
    let enterOld: () => void = () => {};
    let releaseOld: () => void = () => {};
    const oldEntered = new Promise<void>(resolve => { enterOld = resolve; });
    const oldReleased = new Promise<void>(resolve => { releaseOld = resolve; });
    const inFlight: Promise<unknown>[] = [];
    let newRequests = 0;
    const fixture = await serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
      const path = new URL(request.url).pathname;
      if (path === "/old/models") {
        expect(request.headers.get("authorization")).toBe("Bearer synthetic-old-credential");
        enterOld();
        await oldReleased;
      } else {
        expect(path).toBe("/new/models");
        expect(request.headers.get("authorization")).toBe("Bearer synthetic-new-credential");
        newRequests += 1;
      }
      return Response.json({ data: [{ id: "anthropic/claude-sonnet-5" }, { id: "openai/gpt-image-2" }] });
    } });
    try {
      const env = new EnvService({ path: join(directory, "concurrent", "env.json") });
      const oldURL = `http://127.0.0.1:${fixture.port}/old`;
      const newURL = `http://127.0.0.1:${fixture.port}/new`;
      const profile = config("concurrent-profile");
      await env.upsertMany([{ key: "OPENWORK_GATEWAY_BASE_URL", value: oldURL }, { key: GATEWAY_API_KEY_ENV, value: "synthetic-old-credential" }]);
      const oldSync = syncGatewayModels(profile, env);
      inFlight.push(oldSync);
      await oldEntered;
      const replacement = saveGatewayConfig(profile, env, { baseURL: newURL, apiKey: "synthetic-new-credential" });
      inFlight.push(replacement);
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(newRequests).toBe(0);
      releaseOld();
      await Promise.all([oldSync, replacement]);
      expect(newRequests).toBe(1);
      expect(await publicGatewayConfig(env, profile)).toMatchObject({ baseURL: newURL, configured: true, ready: true });
      const runtime = await readGlobalRuntimeOpencodeConfig(profile);
      expect(runtime.provider?.modelhelm).toMatchObject({ options: { baseURL: gatewayProxyBaseURL(profile), gatewayBaseURL: newURL } });
      expect(JSON.stringify(runtime)).not.toContain("synthetic-new-credential");
    } finally {
      releaseOld();
      await Promise.allSettled(inFlight);
      await fixture.stop();
    }
  });
});
