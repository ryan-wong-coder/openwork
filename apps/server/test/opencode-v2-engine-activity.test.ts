import { describe, expect, test } from "bun:test";
import { readV2EngineActivity } from "../src/opencode-v2-engine-activity";

type NativeRead = Parameters<typeof readV2EngineActivity>[0];

const idle = { verdict: "idle", busySessions: 0, waitingRequests: 0 };
function fixture(overrides: NativeRead): NativeRead {
  return async (directory, path) => {
    const supplied = await overrides(directory, path);
    if (supplied !== undefined) return supplied;
    if (path === "/api/session/active") return { data: {} };
    if (path.startsWith("/api/session?")) return { data: [], cursor: { next: null } };
    if (path === "/api/form" || path === "/api/permission/request" || /\/(permission|form)$/.test(path)) return { data: [] };
    throw new Error(`Unexpected native activity path ${path}`);
  };
}

describe("native v2 engine restart activity", () => {
  test("an inactive session waiting on permission or a form is busy", async () => {
    const calls: string[] = [];
    const result = await readV2EngineActivity(fixture(async (_directory, path) => {
      calls.push(path);
      if (path.startsWith("/api/session?")) return { data: [{ id: "ses_permission" }, { id: "ses_form" }], cursor: { next: null } };
      if (path === "/api/session/ses_permission/permission") return { data: [{ id: "permission" }] };
      if (path === "/api/session/ses_form/form") return [{ id: "form" }];
    }), ["/workspace"]);
    expect(result).toEqual({ verdict: "busy", busySessions: 0, waitingRequests: 2 });
    expect(calls).toContain("/api/session/ses_permission/form");
    expect(calls).toContain("/api/session/ses_form/permission");
  });

  test("pagination includes inactive child sessions in every workspace", async () => {
    const directories = new Set<string>();
    const result = await readV2EngineActivity(fixture(async (directory, path) => {
      directories.add(directory);
      if (path.startsWith("/api/session?")) {
        const cursor = new URL(path, "http://engine").searchParams.get("cursor");
        return cursor === "children" ? { data: [{ id: `child-${directory}`, parentID: "parent" }], cursor: { next: null } }
          : { data: [{ id: "parent" }], cursor: { next: "children" } };
      }
      if (path.includes("child-") && path.endsWith("/permission")) return { data: [{ id: "waiting" }] };
    }), ["/first", "/second"]);
    expect(directories).toEqual(new Set(["/first", "/second"]));
    expect(result).toEqual({ verdict: "busy", busySessions: 0, waitingRequests: 2 });
  });

  test("global requests and per-session requests deduplicate by session, kind and id", async () => {
    const result = await readV2EngineActivity(fixture(async (_directory, path) => {
      if (path.startsWith("/api/session?")) return { data: [{ id: "session" }] };
      if (path === "/api/permission/request") return { data: [{ id: "p", sessionID: "session" }, { id: "global", sessionID: "global" }] };
      if (path === "/api/form") return { data: [{ id: "p", sessionID: "session" }] };
      if (path === "/api/session/session/permission" || path === "/api/session/session/form") return { data: [{ id: "p", sessionID: "session" }] };
    }), ["/first", "/second", "/first"]);
    expect(result).toEqual({ verdict: "busy", busySessions: 0, waitingRequests: 3 });
  });

  test("active sessions not yet listed and all interruption-prone states are included", async () => {
    const states = ["running", "busy", "retry", "compacting", "thinking", "responding", "waiting"];
    const calls: string[] = [];
    const result = await readV2EngineActivity(fixture(async (_directory, path) => {
      calls.push(path);
      if (path === "/api/session/active") return { data: Object.fromEntries(states.map((type) => [type, { type }])) };
      if (path === "/api/session/waiting/form") return { data: [{ id: "form" }] };
    }), ["/workspace"]);
    expect(result).toEqual({ verdict: "busy", busySessions: states.length, waitingRequests: 1 });
    for (const state of states) expect(calls).toContain(`/api/session/${state}/permission`);
  });

  test("only complete, readable empty probes prove idle", async () => {
    expect(await readV2EngineActivity(fixture(async () => undefined), ["/workspace"])).toEqual(idle);
    expect(await readV2EngineActivity(fixture(async () => undefined), [])).toEqual(idle);
    expect(await readV2EngineActivity(fixture(async () => undefined), [""])).toEqual({ ...idle, verdict: "unknown" });
  });

  test("each failed native endpoint is unknown, including the inactive session form and permission reads", async () => {
    const paths = ["/api/session/active", "/api/session?limit=200", "/api/form", "/api/permission/request", "/api/session/session/permission", "/api/session/session/form"];
    for (const failed of paths) {
      const result = await readV2EngineActivity(fixture(async (_directory, path) => {
        if (path === failed) throw new Error("native engine unavailable");
        if (path.startsWith("/api/session?")) return { data: [{ id: "session" }] };
      }), ["/workspace"]);
      expect(result).toEqual({ ...idle, verdict: "unknown" });
    }
  });

  test("partial failures cannot conceal a definite pending request or running session", async () => {
    for (const kind of ["running", "pending"]) {
      const result = await readV2EngineActivity(fixture(async (directory, path) => {
        if (directory === "/unreachable") throw new Error("offline");
        if (path === "/api/session/active" && kind === "running") return { data: { active: { type: "running" } } };
        if (path === "/api/session/active") throw new Error("active probe failed");
        if (path.startsWith("/api/session?")) return { data: [{ id: "session" }] };
        if (path === "/api/session/session/permission" && kind === "pending") return { data: [{ id: "permission" }] };
        if (path === "/api/session/session/form") throw new Error("form probe failed");
      }), ["/unreachable", "/healthy"]);
      expect(result.verdict).toBe("busy");
      expect(result.busySessions + result.waitingRequests).toBeGreaterThan(0);
    }
  });

  test("malformed records, future statuses, and broken pagination never become idle", async () => {
    const cases: Array<{ path: string; payload: unknown }> = [
      { path: "/api/session/active", payload: { data: [] } },
      { path: "/api/session/active", payload: { data: { session: null } } },
      { path: "/api/session/active", payload: { data: { session: { type: "future-state" } } } },
      { path: "/api/session?limit=200", payload: { data: [{ invalid: true }] } },
      { path: "/api/session?limit=200", payload: { data: [], cursor: { next: 123 } } },
      { path: "/api/permission/request", payload: { data: {} } },
      { path: "/api/form", payload: { data: [null] } },
    ];
    for (const entry of cases) {
      const result = await readV2EngineActivity(fixture(async (_directory, path) => path === entry.path ? entry.payload : undefined), ["/workspace"]);
      expect(result.verdict).toBe("unknown");
    }
    let pages = 0;
    const result = await readV2EngineActivity(fixture(async (_directory, path) => {
      if (!path.startsWith("/api/session?")) return;
      pages++; return { data: [], cursor: { next: "repeated" } };
    }), ["/workspace"]);
    expect(result.verdict).toBe("unknown");
    expect(pages).toBe(2);
  });

  test("malformed list rows do not discard readable waits and session IDs are URL-encoded", async () => {
    const calls: string[] = [];
    const result = await readV2EngineActivity(fixture(async (_directory, path) => {
      calls.push(path);
      if (path.startsWith("/api/session?")) return { data: [null, { id: "session/with space" }] };
      if (path === "/api/session/session%2Fwith%20space/permission") return { data: [{ id: "permission" }, null] };
    }), ["/workspace"]);
    expect(result).toEqual({ verdict: "busy", busySessions: 0, waitingRequests: 1 });
    expect(calls).toContain("/api/session/session%2Fwith%20space/form");
  });

  test("large histories bound all HTTP reads to eight concurrent requests", async () => {
    let concurrent = 0;
    let maximum = 0;
    let reads = 0;
    const result = await readV2EngineActivity(async (_directory, path) => {
      concurrent++; maximum = Math.max(maximum, concurrent); reads++;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      concurrent--;
      if (path === "/api/session/active") return { data: {} };
      if (path.startsWith("/api/session?")) return { data: Array.from({ length: 30 }, (_, index) => ({ id: `session-${index}` })) };
      return { data: [] };
    }, ["/first", "/second", "/third"]);
    expect(result).toEqual(idle);
    expect(reads).toBe(3 * (4 + 30 * 2));
    expect(maximum).toBe(8);
  });

  test("no idle result is cached between probes", async () => {
    let waiting = false;
    const read = fixture(async (_directory, path) => {
      if (path.startsWith("/api/session?")) return { data: [{ id: "session" }] };
      if (path === "/api/session/session/form" && waiting) return { data: [{ id: "form" }] };
    });
    expect(await readV2EngineActivity(read, ["/workspace"])).toEqual(idle);
    waiting = true;
    expect((await readV2EngineActivity(read, ["/workspace"])).waitingRequests).toBe(1);
  });

  test("an expired probe stops queued history reads and cannot report idle", async () => {
    const controller = new AbortController();
    let reads = 0;
    const result = await readV2EngineActivity(fixture(async (_directory, path) => {
      reads++;
      if (path.startsWith("/api/session?")) return { data: Array.from({ length: 1_000 }, (_, index) => ({ id: `session-${index}` })) };
      if (path.endsWith("/permission")) controller.abort();
    }), ["/workspace"], controller.signal);
    expect(result.verdict).toBe("unknown");
    expect(reads).toBeLessThanOrEqual(12);
    let expiredReads = 0;
    expect((await readV2EngineActivity(async () => { expiredReads++; }, ["/workspace"], controller.signal)).verdict).toBe("unknown");
    expect(expiredReads).toBe(0);
  });
});
