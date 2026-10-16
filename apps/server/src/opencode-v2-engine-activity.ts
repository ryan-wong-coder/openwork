type NativeRead = (directory: string, path: string) => Promise<unknown>;

export type V2EngineActivityCount = {
  verdict: "idle" | "busy" | "unknown";
  busySessions: number;
  waitingRequests: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function data(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

/**
 * Read the same native v2 endpoints as readV2SessionActivity. The active map
 * alone omits sessions parked on a permission or form, including child tasks.
 * Every listed session is therefore inspected, without a roots-only filter.
 * Global native lists also include location-wide requests. Counts include the
 * requests actually observed if any probe fails; a definite busy answer wins.
 */
export async function readV2EngineActivity(read: NativeRead, directories: readonly string[], signal?: AbortSignal): Promise<V2EngineActivityCount> {
  const running = new Set<string>();
  const waiting = new Set<string>();
  let unknown = false;
  let available = 8;
  const readers: Array<() => void> = [];
  const limitedRead: NativeRead = async (directory, path) => {
    signal?.throwIfAborted();
    if (available > 0) available -= 1;
    else await new Promise<void>((resolve) => readers.push(resolve));
    try { signal?.throwIfAborted(); return await read(directory, path); }
    finally {
      const next = readers.shift();
      if (next) next(); else available += 1;
    }
  };

  const includeWaiting = (payload: unknown, kind: string, sessionId?: string) => {
    const requests = data(payload);
    if (!Array.isArray(requests)) { unknown = true; return; }
    for (const [index, request] of requests.entries()) {
      if (!isRecord(request)) { unknown = true; continue; }
      if (request.sessionID !== undefined && typeof request.sessionID !== "string") unknown = true;
      const owner = typeof request.sessionID === "string" ? request.sessionID : sessionId ?? "global";
      const id = typeof request.id === "string" && request.id ? request.id : `unidentified:${index}`;
      waiting.add(JSON.stringify([owner, kind, id]));
    }
  };

  const inspect = async (directory: string) => {
    const ids = new Set<string>();
    await Promise.all([
      (async () => {
        try {
          const statuses = data(await limitedRead(directory, "/api/session/active"));
          if (!isRecord(statuses)) { unknown = true; return; }
          for (const [id, status] of Object.entries(statuses)) {
            if (!id || !isRecord(status) || typeof status.type !== "string") { unknown = true; continue; }
            ids.add(id); // Also inspect newly created sessions absent from the list snapshot.
            if (["running", "busy", "retry", "compacting", "thinking", "responding", "waiting"].includes(status.type)) running.add(id);
            else if (status.type !== "idle" && status.type !== "error") unknown = true;
          }
        } catch { unknown = true; }
      })(),
      (async () => {
        const url = new URL("/api/session", "http://engine");
        url.searchParams.set("limit", "200");
        const cursors = new Set<string>();
        try {
          while (true) {
            const result = await limitedRead(directory, url.pathname + url.search);
            const rows = data(result);
            if (!Array.isArray(rows)) { unknown = true; return; }
            for (const row of rows) {
              if (!isRecord(row) || typeof row.id !== "string" || !row.id) { unknown = true; continue; }
              ids.add(row.id);
            }
            if (isRecord(result) && result.cursor !== undefined && !isRecord(result.cursor)) { unknown = true; return; }
            const next = isRecord(result) && isRecord(result.cursor) ? result.cursor.next : undefined;
            if (next === null || next === undefined || next === "") return;
            if (typeof next !== "string" || cursors.has(next)) { unknown = true; return; }
            cursors.add(next);
            url.searchParams.set("cursor", next);
          }
        } catch { unknown = true; }
      })(),
      ...(["permission", "form"]).map(async (kind) => {
        try {
          includeWaiting(await limitedRead(directory, kind === "permission" ? "/api/permission/request" : "/api/form"), kind);
        } catch { unknown = true; }
      }),
    ]);
    const pending = [...ids];
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      for (let id = pending[index++]; id && !signal?.aborted; id = pending[index++]) {
        await Promise.all(["permission", "form"].map(async (kind) => {
          try {
            includeWaiting(await limitedRead(directory, `/api/session/${encodeURIComponent(id)}/${kind}`), kind, id);
          } catch { unknown = true; }
        }));
      }
    }));
  };

  const pending = [...new Set(directories)];
  // Bound workspace fan-out as well as native HTTP concurrency. No idle result
  // is cached: an unanswered request can appear between successive checks.
  await Promise.all(Array.from({ length: Math.min(2, pending.length) }, async () => {
    for (let directory = pending.shift(); directory !== undefined; directory = pending.shift()) {
      if (signal?.aborted) { unknown = true; break; }
      if (!directory.trim()) { unknown = true; continue; }
      await inspect(directory);
    }
  }));
  return {
    verdict: running.size > 0 || waiting.size > 0 ? "busy" : unknown || signal?.aborted ? "unknown" : "idle",
    busySessions: running.size,
    waitingRequests: waiting.size,
  };
}
