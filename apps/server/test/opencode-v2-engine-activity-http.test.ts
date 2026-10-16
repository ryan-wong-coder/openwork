import { expect, test } from "bun:test";
import { describeEngineActivity } from "../src/server";
import type { ServerConfig } from "../src/types";

test("engine activity uses native authenticated, directory-scoped reads across every local workspace", async () => {
  const requests: Array<{ path: string; directory: string | null; authorization: string | null }> = [];
  let fail = false;
  const engine = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const directory = url.searchParams.get("location[directory]");
      if (url.pathname.startsWith("/api/")) requests.push({ path: url.pathname, directory, authorization: request.headers.get("Authorization") });
      if (url.pathname === "/session/status") return Response.json({});
      if (url.pathname === "/permission" || url.pathname === "/question") return Response.json([]);
      if (url.pathname === "/api/session/active") return Response.json({ data: !fail && directory === "/first workspace" ? { "child-a": { type: "compacting" } } : {} });
      if (url.pathname === "/api/session") {
        const suffix = directory === "/first workspace" ? "a" : "b";
        return Response.json(url.searchParams.has("cursor")
          ? { data: [{ id: `child-${suffix}`, parentID: `parent-${suffix}` }], cursor: { next: null } }
          : { data: [{ id: `parent-${suffix}` }], cursor: { next: "children" } });
      }
      if (url.pathname === "/api/form" && fail) return new Response("unreachable", { status: 503 });
      if (url.pathname === "/api/permission/request" && !fail && directory === "/first workspace") return Response.json({ data: [{ id: "permission", sessionID: "global" }] });
      if (url.pathname === "/api/session/child-b/form" && !fail) return Response.json({ data: [{ id: "form", sessionID: "child-b" }] });
      return Response.json({ data: [] });
    },
  });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture-client", hostToken: "fixture-host",
    opencodeBaseUrl: engine.url.href, approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [],
    workspaces: ["/first workspace", "/second workspace"].map((path, index) => ({ id: `workspace-${index}`, name: "Fixture", path, preset: "starter", workspaceType: "local" })),
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const connection = () => ({ url: engine.url.href, username: "fixture-user", password: "fixture-password" });
  try {
    const activity = await describeEngineActivity(config, { connection });
    expect(activity.v1).toEqual({ verdict: "idle", busySessions: 0, waitingRequests: 0 });
    expect(activity.v2).toEqual({ verdict: "busy", busySessions: 1, waitingRequests: 2 });
    expect(Number.isNaN(Date.parse(activity.checkedAt))).toBe(false);
    expect(new Set(requests.map((request) => request.directory))).toEqual(new Set(["/first workspace", "/second workspace"]));
    expect(requests.every((request) => request.authorization === `Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`)).toBe(true);
    expect(requests.some((request) => request.path === "/api/session/child-b/permission")).toBe(true);
    expect(requests.some((request) => request.path === "/api/session/child-b/form")).toBe(true);

    fail = true;
    expect((await describeEngineActivity(config, { connection })).v2?.verdict).toBe("unknown");
    requests.length = 0;
    expect((await describeEngineActivity(config, { connection: () => undefined })).v2).toBeNull();
    expect(requests).toHaveLength(0);
  } finally { await engine.stop(true); }
});
