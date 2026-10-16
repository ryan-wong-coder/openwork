import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../src/types";

const environmentKeys = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "OPENCODE_CONFIG_DIR", "OPENWORK_SERVER_CONFIG", "OPENWORK_RUNTIME_DB", "OPENWORK_ENV_STORE", "OPENWORK_ENGINE_V2_PREVIEW"];
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
let directory: string;
let workspaceRoot: string;
let globalRoot: string;
let baseUrl: string;
let stop: () => void | Promise<void>;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openwork-visual-config-"));
  workspaceRoot = join(directory, "workspace"); globalRoot = join(directory, "opencode");
  await Promise.all([mkdir(workspaceRoot), mkdir(globalRoot)]);
  process.env.XDG_CONFIG_HOME = join(directory, "config");
  process.env.XDG_DATA_HOME = join(directory, "data");
  process.env.OPENCODE_CONFIG_DIR = globalRoot;
  process.env.OPENWORK_SERVER_CONFIG = join(directory, "openwork", "server.json");
  process.env.OPENWORK_RUNTIME_DB = join(directory, "openwork", "runtime.sqlite");
  process.env.OPENWORK_ENV_STORE = join(directory, "openwork", "env.json");
  process.env.OPENWORK_ENGINE_V2_PREVIEW = "0";
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture-owner", hostToken: "fixture-host",
    configPath: process.env.OPENWORK_SERVER_CONFIG,
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [workspaceRoot],
    workspaces: [{ id: "workspace", name: "Fixture", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const { startServer } = await import("../src/server");
  const server = await startServer(config, { deferManagedEngineStartup: true });
  stop = server.stop;
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  if (stop) await stop();
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function request(path: string, body?: unknown, method = "POST") {
  return fetch(`${baseUrl}/workspace/workspace${path}`, {
    method: body === undefined ? "GET" : method,
    headers: { Authorization: "Bearer fixture-owner", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("visual configuration API writes", () => {
  test("a missing file uses a null baseline and cannot overwrite a file created meanwhile", async () => {
    const file = join(workspaceRoot, "opencode.jsonc");
    const original = await request("/opencode-config?scope=project");
    expect(await original.json()).toMatchObject({ exists: false, content: null });
    const first = await request("/opencode-config", { scope: "project", expectedContent: null, content: '{"model":"gateway/first"}' });
    expect(first.status).toBe(200);
    const second = await request("/opencode-config", { scope: "project", expectedContent: null, content: '{"model":"gateway/stale"}' });
    expect(second.status).toBe(409);
    expect(await readFile(file, "utf8")).toBe('{"model":"gateway/first"}\n');
  });

  test("concurrent project-file saves with the same baseline admit exactly one writer", async () => {
    const file = join(workspaceRoot, "opencode.jsonc");
    const baseline = '// preserve comments\n{"model":"gateway/original"}\n';
    await writeFile(file, baseline);
    const responses = await Promise.all(["one", "two"].map((suffix) => request("/opencode-config", {
      scope: "project", expectedContent: baseline, content: `// preserve comments\n{"model":"gateway/${suffix}"}\n`,
    })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const written = await readFile(file, "utf8");
    expect(written).toContain("// preserve comments");
    expect(["one", "two"].some((suffix) => written.includes(`gateway/${suffix}`))).toBe(true);
  });

  test("global saves have the same conflict protection and reject malformed documents", async () => {
    const baseline = '{"small_model":"gateway/small"}\n';
    const file = join(globalRoot, "opencode.jsonc");
    await writeFile(file, baseline);
    const responses = await Promise.all(["one", "two"].map((suffix) => request("/opencode-config", {
      scope: "global", expectedContent: baseline, content: `{"small_model":"gateway/${suffix}"}\n`,
    })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const written = await readFile(file, "utf8");
    for (const content of ['{"model":', '[]', 'null']) {
      const invalid = await request("/opencode-config", { scope: "global", expectedContent: written, content });
      expect(invalid.status).toBe(422);
    }
    expect(await readFile(file, "utf8")).toBe(written);
  });

  test("workspace replacement removes options and rejects a stale snapshot", async () => {
    const current = await request("/config");
    const snapshot = await current.json();
    const initialized = await request("/config", { openwork: { version: 1, reload: { auto: true }, custom: { enabled: true } }, openworkReplace: true, expectedOpenwork: snapshot.openwork }, "PATCH");
    expect(initialized.status).toBe(200);
    const before = await (await request("/config")).json();
    const responses = await Promise.all(["one", "two"].map((name) => request("/config", {
      openwork: { version: 1, workspace: { name } }, openworkReplace: true, expectedOpenwork: before.openwork,
    }, "PATCH")));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const after = await (await request("/config")).json();
    expect(after.openwork).not.toHaveProperty("reload");
    expect(after.openwork).not.toHaveProperty("custom");
    expect(after.openwork).toMatchObject({ version: 1, workspace: { name: expect.any(String) } });
  });
});
