import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveServerConfig, parseCliArgs } from "../src/config";
import { managedEngineModelsEnvironment, resolveOpencodeModelsUrl } from "../src/opencode-models-url";
import { buildOpenworkRuntimeConfigObject } from "../src/openwork-runtime-config";
import { readGlobalRuntimeOpencodeConfig, writeGlobalRuntimeOpencodeConfig, readGlobalRuntimeMcpConfig } from "../src/runtime-opencode-config-store";
import { migrateOpenworkCloudMcpRuntimeConfig, readOpenworkCloudMcpHealth, reconcileOpenworkCloudMcp } from "../src/cloud-mcp-health";
import { refreshOpenWorkConnectMcpAppHostCatalog } from "../src/connect-mcp-server-catalog";
import { CloudProviderSync } from "../src/cloud-provider-sync";
import { EnvService } from "../src/env-file";
import type { ServerConfig } from "../src/types";
import { captureServerException } from "../src/telemetry";
import { AnonymousInferenceService } from "../src/free-auto/service";
import { managedDesktopPolicy } from "../src/managed-desktop-policy";
import { readOpenWorkConnectSkillCatalog } from "../src/connect-skill-catalog";
import { readOpenWorkAutomationCatalog } from "../src/connect-automation-catalog";
import { writeConnectCloudMcp } from "../src/connect-state";
import { startWorkerActivityHeartbeat } from "../src/worker-activity-heartbeat";

let directory: string;
let config: ServerConfig;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "zeno-independent-"));
  const workspace = join(directory, "workspace");
  await mkdir(workspace);
  const path = join(directory, "server.json");
  // Even a file field cannot change a trusted process distribution.
  await writeFile(path, JSON.stringify({ clientProfile: "connected" }));
  config = await resolveServerConfig({ configPath: path, workspaces: [workspace], clientProfile: "local-gateway" });
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe("independent server distribution", () => {
  test("CLI profile is explicit and workspace/server JSON cannot select it", async () => {
    expect(parseCliArgs(["web", "--client-profile", "connected"]).clientProfile).toBe("connected");
    expect(() => parseCliArgs(["--client-profile", "invalid"])).toThrow();
    const previous = process.env.OPENWORK_CLIENT_PROFILE;
    const previousManaged = process.env.DEN_RUNTIME_MANAGED;
    const previousProvider = process.env.DEN_RUNTIME_PROVIDER;
    delete process.env.OPENWORK_CLIENT_PROFILE;
    delete process.env.DEN_RUNTIME_MANAGED;
    delete process.env.DEN_RUNTIME_PROVIDER;
    try {
      expect((await resolveServerConfig({ configPath: config.configPath, workspaces: [] })).clientProfile).toBe("local-gateway");
      process.env.OPENWORK_CLIENT_PROFILE = "connected";
      expect((await resolveServerConfig({ configPath: config.configPath, workspaces: [] })).clientProfile).toBe("connected");
      delete process.env.OPENWORK_CLIENT_PROFILE;
      process.env.DEN_RUNTIME_MANAGED = "1";
      expect((await resolveServerConfig({ configPath: config.configPath, workspaces: [] })).clientProfile).toBe("connected");
      const env = new EnvService({ path: join(directory, "env.json") });
      await expect(env.upsertMany([{ key: "OPENWORK_CLIENT_PROFILE", value: "connected" }])).rejects.toThrow("reserved");
    } finally {
      if (previous === undefined) delete process.env.OPENWORK_CLIENT_PROFILE;
      else process.env.OPENWORK_CLIENT_PROFILE = previous;
      if (previousManaged === undefined) delete process.env.DEN_RUNTIME_MANAGED;
      else process.env.DEN_RUNTIME_MANAGED = previousManaged;
      if (previousProvider === undefined) delete process.env.DEN_RUNTIME_PROVIDER;
      else process.env.DEN_RUNTIME_PROVIDER = previousProvider;
    }
    expect(config.token.length).toBeGreaterThan(0);
    expect(config.hostToken.length).toBeGreaterThan(0);
  });

  test("catalog refresh uses the real engine opt-out without a fabricated URL", async () => {
    let probes = 0;
    expect(await resolveOpencodeModelsUrl({ config, env: { OPENWORK_DEV_MODE: "1" }, fetchModels: async () => { probes += 1; throw new Error("network must not be used"); } })).toBeUndefined();
    expect(probes).toBe(0);
    expect(await managedEngineModelsEnvironment(config, {})).toEqual({ OPENCODE_DISABLE_MODELS_FETCH: "1" });
    expect(await managedEngineModelsEnvironment(config, { OPENCODE_MODELS_URL: "https://models.openworklabs.com/" })).toEqual({ OPENCODE_DISABLE_MODELS_FETCH: "1" });
    expect(await managedEngineModelsEnvironment(config, { OPENCODE_MODELS_URL: "https://catalog.example.test/models" })).toEqual({ OPENCODE_MODELS_URL: "https://catalog.example.test/models" });
    expect(await managedEngineModelsEnvironment({ clientProfile: "connected" }, { OPENCODE_MODELS_URL: "https://catalog.example.test/models", OPENCODE_DISABLE_MODELS_FETCH: "1" })).toEqual({ OPENCODE_MODELS_URL: "https://catalog.example.test/models", OPENCODE_DISABLE_MODELS_FETCH: "1" });
    expect(await resolveOpencodeModelsUrl({ config: { clientProfile: "connected" }, env: {} })).toBe("https://models.openworklabs.com/");
  });

  test("retained Connect credentials are not registered, probed, migrated or deleted", async () => {
    const retained = {
      mcp: {
        "openwork-cloud": { type: "remote", url: "https://api.openworklabs.com/mcp/agent", enabled: true, headers: { Authorization: "Bearer synthetic-retained-credential" } },
        "openwork-direct-calendar": { type: "remote", url: "https://api.openworklabs.com/mcp/agent", enabled: true },
        "my-files": { type: "local", command: ["custom-files"], enabled: true },
      },
      provider: {
        lpr_retained: { name: "Managed", options: { baseURL: "https://api.openworklabs.com/v1" } },
        modelhelm: { name: "Gateway", options: { baseURL: "http://127.0.0.1:8787/gateway/openai" } },
        personal: { name: "Personal", options: { baseURL: "https://inference.example.test/v1" } },
      },
    };
    await writeGlobalRuntimeOpencodeConfig(config, () => retained);
    await writeConnectCloudMcp(config, retained.mcp["openwork-cloud"]);
    const rendered = await buildOpenworkRuntimeConfigObject(config);
    expect(rendered.mcp).toMatchObject({ "openwork-cloud": { enabled: false }, "openwork-direct-calendar": { enabled: false }, "my-files": { enabled: true } });
    expect(JSON.stringify(rendered)).not.toContain("synthetic-retained-credential");
    expect(Object.keys(rendered.provider ?? {}).sort()).toEqual(["modelhelm", "personal"]);
    expect(await readGlobalRuntimeMcpConfig(config, "openwork-cloud")).toBeNull();
    expect(await migrateOpenworkCloudMcpRuntimeConfig(config)).toEqual({ config: null, changed: false });
    let probes = 0;
    const input = {
      config,
      workspace: config.workspaces[0],
      directory: config.workspaces[0].path,
      createWorkspaceOpencodeClient: () => { probes += 1; throw new Error("engine probe must not run"); },
    };
    expect((await readOpenworkCloudMcpHealth(input)).desired.present).toBe(false);
    expect((await reconcileOpenworkCloudMcp({ ...input, body: { config: retained.mcp["openwork-cloud"] }, registerRuntimeMcp: async () => { throw new Error("registration must not run"); } })).desired.present).toBe(false);
    expect(await refreshOpenWorkConnectMcpAppHostCatalog(config, config.workspaces[0].id, async () => { probes += 1; throw new Error("catalog must not fetch"); })).toMatchObject({ status: "unavailable" });
    expect(await readOpenWorkConnectSkillCatalog(config, async () => { probes += 1; throw new Error("skills must not fetch"); })).toEqual([]);
    expect(await readOpenWorkAutomationCatalog(config, async () => { probes += 1; throw new Error("automations must not fetch"); })).toBeNull();
    expect(probes).toBe(0);
    expect(await readGlobalRuntimeOpencodeConfig(config)).toEqual(retained);
    const legacy = await buildOpenworkRuntimeConfigObject({ ...config, clientProfile: "connected" });
    expect(legacy.mcp).toMatchObject({ "openwork-cloud": { enabled: true } });
    expect(legacy.provider).toHaveProperty("lpr_retained");
  });

  test("saved Den sessions cannot start provider polling", async () => {
    let requests = 0;
    const sync = new CloudProviderSync({ config, env: new EnvService({ path: join(directory, "sync-env.json") }), reloadEngine: async () => ({ action: "updated_live" }), fetchImpl: async () => { requests += 1; throw new Error("Den must not fetch"); } });
    try {
      await sync.setSession({ baseUrl: "https://app.openworklabs.com/api/den", token: "synthetic-retained-session", orgId: "internal-fixture" });
      expect(await sync.run("test")).toMatchObject({ status: "no_session" });
      expect(requests).toBe(0);
    } finally { sync.stop(); }
  });

  test("local telemetry and free hosted inference stay disabled", async () => {
    const previous = globalThis.__openworkDesktopTelemetry;
    let reports = 0;
    globalThis.__openworkDesktopTelemetry = { captureException: () => { reports += 1; return true; } };
    try {
      expect(captureServerException(new Error("synthetic failure"), {}, config)).toBe(false);
      expect(reports).toBe(0);
      const free = new AnonymousInferenceService(config, { log: () => undefined }, {});
      expect(await free.initialize(8787)).toBe(false);
      expect(await free.status(true)).toMatchObject({ state: "unavailable", code: "free_disabled" });
      expect(startWorkerActivityHeartbeat(config, { log: () => undefined }, { env: { DEN_ACTIVITY_HEARTBEAT_ENABLED: "1", DEN_RUNTIME_MANAGED: "1", DEN_WORKER_ID: "internal-fixture", DEN_ACTIVITY_HEARTBEAT_URL: "https://control.example.test/heartbeat", DEN_ACTIVITY_HEARTBEAT_TOKEN: "synthetic-token" }, fetchImpl: async () => { throw new Error("heartbeat must not fetch"); } })).toBeNull();
      await managedDesktopPolicy(config).setSession({ baseUrl: "https://app.openworklabs.com/api/den", token: "synthetic-policy-session", orgId: "internal-fixture" });
      expect(await managedDesktopPolicy(config).current()).toBeNull();
    } finally { globalThis.__openworkDesktopTelemetry = previous; }
  });
});
