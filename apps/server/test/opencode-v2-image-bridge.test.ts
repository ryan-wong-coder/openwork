import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createV2ContextBridge } from "../src/opencode-v2-context-bridge";
import { createV2ImageSessionResolver } from "../src/opencode-v2-image-bridge";
import { createV2SessionHomes } from "../src/opencode-v2-session-home";
import contextPlugin from "../src/opencode-plugins/openwork-context-v2";
import type { ServerConfig } from "../src/types";

let directory: string;
const originalRuntimeDb = process.env.OPENWORK_RUNTIME_DB;
let bridge: Awaited<ReturnType<typeof createV2ContextBridge>>;
const imageCalls: Array<{ path: string; body: unknown }> = [];
const resolvedSessions: string[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "openwork-v2-images-"));
  process.env.OPENWORK_RUNTIME_DB = join(directory, "state", "runtime.sqlite");
  bridge = await createV2ContextBridge(async (path, init) => {
    if (path === "/experimental/connect/skills") return { skills: [] };
    const body: unknown = JSON.parse(String(init?.body));
    imageCalls.push({ path, body });
    return { ok: true, path: "artifacts/generated.png", absolutePath: join(directory, "artifacts/generated.png"), mimeType: "image/png" };
  }, {
    resolveImageSession: async (sessionId) => {
      resolvedSessions.push(sessionId);
      if (sessionId !== "ses_current") throw new Error("Conversation is not available");
      return { workspaceId: "current-workspace", directory };
    },
  });
});
afterAll(async () => {
  await bridge?.close();
  if (originalRuntimeDb === undefined) delete process.env.OPENWORK_RUNTIME_DB;
  else process.env.OPENWORK_RUNTIME_DB = originalRuntimeDb;
  await rm(directory, { recursive: true, force: true });
});

function post(url: string, token: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("independent v2 image capability", () => {
  test("read, browser and image credentials are mutually isolated", async () => {
    const image = bridge.image;
    if (!image) throw new Error("Missing image bridge");
    expect(image.token).not.toBe(bridge.token);
    expect(image.token).not.toBe(bridge.browser.token);
    const call = { name: "openwork_image_generate", input: { prompt: "生成网页插图" }, sessionId: "ses_current" };
    expect((await post(image.url, bridge.token, call)).status).toBe(401);
    expect((await post(image.url, bridge.browser.token, call)).status).toBe(401);
    expect((await post(bridge.url, bridge.token, call)).status).toBe(400);
    expect((await post(bridge.url, image.token, { name: "openwork_query", input: {} })).status).toBe(401);
    expect((await post(bridge.browser.url, image.token, call)).status).toBe(401);
  });

  test("the image token cannot choose a host path, a workspace, or an app action", async () => {
    const image = bridge.image;
    if (!image) throw new Error("Missing image bridge");
    const baseline = { name: "openwork_image_generate", input: { prompt: "生成网页插图" }, sessionId: "ses_current" };
    for (const body of [
      { ...baseline, name: "openwork_query" },
      { ...baseline, path: "/gateway/config" },
      { ...baseline, input: { ...baseline.input, context: { workspaceId: "another-workspace" } } },
      { ...baseline, input: { ...baseline.input, directory: "/another-workspace" } },
      { ...baseline, input: { ...baseline.input, sessionId: "ses_another" } },
    ]) expect((await post(image.url, image.token, body)).status).toBe(400);
    expect((await post(new URL("/gateway/config", image.url).href, image.token, baseline)).status).toBe(404);
    expect((await fetch(image.url, { headers: { Authorization: `Bearer ${image.token}` } })).status).toBe(404);
    expect(imageCalls).toHaveLength(0);
  });

  test("verified session context is injected and usable artifact paths are returned", async () => {
    const image = bridge.image;
    if (!image) throw new Error("Missing image bridge");
    const failed = await post(image.url, image.token, { name: "openwork_image_generate", input: { prompt: "test" }, sessionId: "ses_missing" });
    expect(failed.status).toBe(400);
    expect(imageCalls).toHaveLength(0);
    const response = await post(image.url, image.token, { name: "openwork_image_generate", input: { prompt: "生成网页插图", referenceImages: ["artifacts/reference.png"] }, sessionId: "ses_current" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, path: "artifacts/generated.png", absolutePath: join(directory, "artifacts/generated.png") });
    expect(imageCalls).toEqual([{ path: "/gateway/images", body: { prompt: "生成网页插图", referenceImages: ["artifacts/reference.png"], context: { workspaceId: "current-workspace", directory, sessionID: "ses_current" } } }]);
  });

  test("native tool uses the engine session and carries the coding workflow instruction", async () => {
    type PluginContext = Parameters<typeof contextPlugin.setup>[0];
    type Editor = Parameters<Parameters<PluginContext["tool"]["transform"]>[0]>[0];
    type Tool = Parameters<Editor["add"]>[0];
    const tools = new Map<string, Tool>();
    const dispose = await contextPlugin.setup({
      options: bridge,
      tool: { async transform(register) { register({ add: (tool) => { tools.set(tool.name, tool); } }); return { async dispose() {} }; } },
      skill: { async transform() { return { async dispose() {} }; }, async reload() {} },
    });
    try {
      const image = tools.get("openwork_image_generate");
      if (!image) throw new Error("Missing native image tool");
      expect(image.description).toContain("Use those files directly in code");
      expect(image.input).toMatchObject({ additionalProperties: false });
      const result = await image.execute({ prompt: "生成代码项目的配图", sessionId: "ses_another", context: { workspaceId: "another-workspace" } }, { signal: new AbortController().signal, sessionID: "ses_current" });
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, path: "artifacts/generated.png", absolutePath: join(directory, "artifacts/generated.png"), mimeType: "image/png" }, null, 2) }]);
      expect(resolvedSessions.at(-1)).toBe("ses_current");
      expect(imageCalls.at(-1)?.body).toMatchObject({ context: { workspaceId: "current-workspace", sessionID: "ses_current" } });
    } finally { await dispose(); }
  });
});

test("native session homes bind image work to the owning workspace across worktree moves", async () => {
  const first = join(directory, "first");
  const second = join(directory, "second");
  const worktree = join(directory, "worktree");
  const outside = join(directory, "unregistered");
  await Promise.all([first, second, worktree, outside].map((path) => mkdir(path)));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture-client", hostToken: "fixture-host", configPath: join(directory, "state", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [first, second],
    workspaces: [first, second].map((path, index) => ({ id: `workspace-${index}`, name: "Fixture", path, preset: "starter", workspaceType: "local" })),
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const readNative = async (path: string) => {
    if (path.includes("/message?")) return { data: [], cursor: { next: null } };
    if (path.endsWith("ses_moved")) return { id: "ses_moved", location: { directory: worktree } };
    if (path.endsWith("ses_labeled")) return { id: "ses_labeled", location: { directory: second }, openworkHomeDirectory: first };
    if (path.endsWith("ses_outside")) return { id: "ses_outside", location: { directory: outside } };
    return { id: "ses_wrong", location: { directory: first } };
  };
  const homes = createV2SessionHomes(config, readNative);
  await homes.created("ses_moved", first);
  const resolver = createV2ImageSessionResolver(config, readNative);
  const signal = new AbortController().signal;
  expect(await resolver("ses_moved", signal)).toEqual({ workspaceId: "workspace-0", directory: worktree });
  expect(await resolver("ses_labeled", signal)).toEqual({ workspaceId: "workspace-1", directory: second });
  await expect(resolver("ses_outside", signal)).rejects.toThrow("已授权");
  await expect(resolver("ses_missing", signal)).rejects.toThrow("所属的对话");
});
