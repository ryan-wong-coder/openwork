import { afterAll, beforeAll, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceAccess } from "../src/opencode-plugins/workspace-access";
import type { ServerConfig } from "../src/types";

const keys = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "OPENCODE_CONFIG_DIR", "OPENWORK_SERVER_CONFIG", "OPENWORK_RUNTIME_DB", "OPENWORK_ENV_STORE", "OPENWORK_ENGINE_V2_PREVIEW", "OPENWORK_CLIENT_PROFILE"];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const legacyCommand = "---\nname: synthetic-legacy\nmodel: null\n---\nSynthetic command body.\n";
const opencodeConfig = '{"permission":{"bash":"ask"}}\n';
let root: string;
let missing: string;
let existing: string;
let outside: string;
let origin: string;
let stop: (() => void | Promise<void>) | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "zeno-workspace-read-only-"));
  missing = join(root, "missing"); existing = join(root, "existing"); outside = join(root, "unregistered-root");
  await mkdir(join(existing, ".opencode", "commands"), { recursive: true });
  await writeFile(join(existing, ".opencode", "commands", "synthetic-legacy.md"), legacyCommand);
  await writeFile(join(existing, "opencode.jsonc"), opencodeConfig);
  Object.assign(process.env, {
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_CONFIG_DIR: join(root, "opencode"), OPENWORK_SERVER_CONFIG: join(root, "state", "server.json"),
    OPENWORK_RUNTIME_DB: join(root, "state", "runtime.sqlite"), OPENWORK_ENV_STORE: join(root, "state", "env.json"),
    OPENWORK_ENGINE_V2_PREVIEW: "0", OPENWORK_CLIENT_PROFILE: "local-gateway",
  });
  const config: ServerConfig = {
    clientProfile: "local-gateway", host: "127.0.0.1", port: 0, token: "synthetic-owner", hostToken: "synthetic-host",
    configPath: join(root, "state", "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    authorizedRoots: [missing, existing],
    workspaces: [missing, existing, outside].map((path, index) => ({ id: `workspace-${index}`, name: "Synthetic", path, preset: "starter", workspaceType: "local" })),
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const { startServer } = await import("../src/server");
  const server = await startServer(config, { deferManagedEngineStartup: true });
  stop = server.stop;
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await stop?.();
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
  if (root) await rm(root, { recursive: true, force: true });
});

const exists = (path: string) => access(path).then(() => true, () => false);
async function get(path: string) {
  const response = await fetch(origin + path, { headers: { Authorization: "Bearer synthetic-owner" } });
  if (!response.ok) throw new Error(`Synthetic backend denied ${response.status}`);
  return response.json();
}

test("workspace.read returns registered metadata without recreating a missing workspace directory", async () => {
  expect(await exists(missing)).toBe(false);
  const result = await readWorkspaceAccess({ workspaceId: "workspace-0" }, get);
  expect(result).toMatchObject({ ok: true, workspace: { id: "workspace-0", path: missing }, authorizedFolders: { workspaceRoot: missing, folders: [], hiddenCount: 0 } });
  expect(await exists(missing)).toBe(false);
});

test("authorized folder reads preserve existing configuration and repairable legacy commands byte for byte", async () => {
  const command = join(existing, ".opencode", "commands", "synthetic-legacy.md");
  expect(await readFile(command, "utf8")).toBe(legacyCommand);
  const result = await readWorkspaceAccess({ workspaceId: "workspace-1" }, get);
  expect(result).toMatchObject({ ok: true, workspace: { id: "workspace-1", path: existing }, authorizedFolders: { workspaceRoot: existing, folders: [], hiddenCount: 0 } });
  expect(await readFile(command, "utf8")).toBe(legacyCommand);
  expect(await readFile(join(existing, "opencode.jsonc"), "utf8")).toBe(opencodeConfig);
});

test("metadata inspection retains backend authentication and registered authorized-root checks", async () => {
  const unauthenticated = await fetch(origin + "/workspace/workspace-1/authorized-folders");
  expect(unauthenticated.status).toBe(401);
  await expect(readWorkspaceAccess({ workspaceId: "workspace-2" }, get)).rejects.toThrow("403");
  expect(await exists(outside)).toBe(false);
});
