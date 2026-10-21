import { expect, test } from "bun:test";
import { readWorkspaceAccess } from "../src/opencode-plugins/workspace-access";
import { buildOpenworkProviderContributions } from "../src/opencode-plugins/openwork-provider-adapters";
import { createV2ContextBridge } from "../src/opencode-v2-context-bridge";
import { OpenWorkExtensionsPreview } from "../src/opencode-plugins/openwork-extensions-preview";
import { openworkReadTransport } from "../src/opencode-plugins/openwork-read-transport";

function workspaceBackend(paths: string[]) {
  return async (path: string, init?: RequestInit): Promise<unknown> => {
    paths.push(path);
    expect(init?.method ?? "GET").toBe("GET");
    if (path === "/workspaces") return { items: [{
      id: "fixture-workspace", name: "合成工作区", path: "/fixture/workspace",
      opencode: { username: "fixture", password: "must-never-be-returned" },
    }] };
    if (path === "/workspace/fixture-workspace/authorized-folders") return {
      workspaceRoot: "/fixture/workspace", folders: ["/fixture/research"], hiddenCount: 2,
      privateConfig: "must-never-be-returned",
    };
    throw new Error("Unexpected backend request");
  };
}

test("workspace access reads actual registered paths and effective folder settings without credentials", async () => {
  const paths: string[] = [];
  const result = await readWorkspaceAccess({ workspaceId: "fixture-workspace" }, workspaceBackend(paths));
  expect(result).toMatchObject({ ok: true, workspace: { id: "fixture-workspace", path: "/fixture/workspace" },
    authorizedFolders: { workspaceRoot: "/fixture/workspace", folders: ["/fixture/research"], hiddenCount: 2 } });
  expect(paths).toEqual(["/workspaces", "/workspace/fixture-workspace/authorized-folders"]);
  expect(JSON.stringify(result)).not.toContain("must-never-be-returned");
  expect(result.instruction).toContain("实际工具权限");
});

test("unknown workspaces cannot trigger arbitrary folder reads and queries reject mutation arguments", async () => {
  const paths: string[] = [];
  expect(await readWorkspaceAccess({ workspaceId: "../../outside" }, workspaceBackend(paths))).toMatchObject({ ok: false });
  expect(paths).toEqual(["/workspaces"]);
  await expect(readWorkspaceAccess({ workspaceId: "fixture-workspace", folders: ["/outside"], action: "write" }, workspaceBackend(paths))).rejects.toThrow();
  expect(paths).toEqual(["/workspaces"]);
});

test("standalone discovery distinguishes native personal reads and writes, with real catalogue guidance", async () => {
  const standalone = buildOpenworkProviderContributions([], [], true).flatMap(item => item.affordances);
  const personal = standalone.filter(item => item.executor.kind === "tool" && item.executor.tool === "zeno_personal");
  expect(personal.map(item => item.id)).toEqual(["personal.catalogue", "personal.read", "personal.write", "personal.propose", "personal.undo"]);
  expect(personal.filter(item => item.kind === "query").every(item => item.effects.data === "read" && item.effects.ui === "none")).toBe(true);
  expect(personal.filter(item => item.kind === "command").every(item => item.effects.data === "write")).toBe(true);
  expect(personal.find(item => item.id === "personal.catalogue")?.description).toContain("真实 exerciseId");
  expect(standalone.find(item => item.id === "workspace.read")?.executor).toEqual({ kind: "openwork" });
  expect(buildOpenworkProviderContributions([], [], false).flatMap(item => item.affordances).some(item => item.id.startsWith("personal."))).toBe(false);
  const plugin = await OpenWorkExtensionsPreview(undefined, { clientProfile: "local-gateway" });
  try {
    const context = JSON.parse(await openworkReadTransport.run({
      get: async () => { throw new Error("Unexpected context backend read"); },
      post: async path => {
        expect(path).toBe("/experimental/ui-control/request");
        return { context: { availableAffordances: [] } };
      },
    }, () => plugin.tool.openwork_context.execute()));
    expect(context.instructions.personal).toContain("catalogue");
    expect(context.instructions.personal).toContain("read kind=routine");
    expect(context.context.availableAffordances.some((entry: { id: string }) => entry.id === "personal.catalogue")).toBe(true);
  } finally { await plugin.dispose(); }
});

test("the actual V2 read bridge executes workspace.read against the same backend without UI navigation", async () => {
  const paths: string[] = [];
  const bridge = await createV2ContextBridge(workspaceBackend(paths), { clientProfile: "local-gateway" });
  try {
    const response = await fetch(bridge.url, { method: "POST", headers: { Authorization: "Bearer " + bridge.token, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "openwork_query", input: { id: "workspace.read", args: { workspaceId: "fixture-workspace" } } }) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, id: "workspace.read", result: { workspace: { path: "/fixture/workspace" }, authorizedFolders: { folders: ["/fixture/research"] } }, effects: { data: "read", ui: "none", external: false } });
    expect(JSON.stringify(result)).not.toContain("must-never-be-returned");
    expect(paths).toEqual(["/workspaces", "/workspace/fixture-workspace/authorized-folders"]);
  } finally { await bridge.close(); }
});
