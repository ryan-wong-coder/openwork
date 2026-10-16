import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createGatewayImageTools } from "./opencode-plugins/gateway-image-tools.js";
import { createV2SessionHomes, nativeSession, nativeSessionDirectory } from "./opencode-v2-session-home.js";
import { serve } from "./serve-node.js";
import type { ServerConfig } from "./types.js";

export type V2ImageSessionScope = { workspaceId: string; directory: string };
export type V2ImageSessionResolver = (sessionId: string, signal: AbortSignal) => Promise<V2ImageSessionScope>;

/** Native session history establishes ownership, never tool arguments or CWD. */
export function createV2ImageSessionResolver(
  config: ServerConfig,
  readNative: (path: string) => Promise<unknown>,
): V2ImageSessionResolver {
  const homes = createV2SessionHomes(config, readNative);
  return async (sessionId, signal) => {
    signal.throwIfAborted();
    const session = await readNative(`/api/session/${encodeURIComponent(sessionId)}`);
    const info = nativeSession(session);
    if (info?.id !== sessionId) throw new Error("无法确认图片所属的对话。");
    const home = await homes.resolve(session);
    const directory = nativeSessionDirectory(session);
    if (!home || !directory) throw new Error("无法确认图片所属的工作区。");
    for (const workspace of config.workspaces) {
      if (await homes.canonical(workspace.path) !== home) continue;
      signal.throwIfAborted();
      return { workspaceId: workspace.id, directory };
    }
    throw new Error("图片生成仅适用于当前已授权的本地工作区。");
  };
}

/** Separate credential for this one write. App-read credentials cannot use it. */
export async function createV2ImageBridge(
  hostRequest: (path: string, init?: RequestInit) => Promise<unknown>,
  resolveSession: V2ImageSessionResolver,
) {
  const token = randomBytes(32).toString("base64url");
  const definition = createGatewayImageTools(async () => undefined).openwork_image_generate;
  const inputSchema = z.object(definition.args).strict();
  const requestSchema = z.object({
    name: z.literal("openwork_image_generate"),
    input: inputSchema,
    sessionId: z.string().startsWith("ses_").max(256),
  }).strict();
  const server = await serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 401 });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/image") return new Response(null, { status: 404 });
    try {
      const text = await request.text();
      if (text.length > 64_000) return new Response(null, { status: 413 });
      const call = requestSchema.parse(JSON.parse(text));
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(610_000)]);
      const scope = await resolveSession(call.sessionId, signal);
      signal.throwIfAborted();
      const result = await hostRequest("/gateway/images", {
        method: "POST", signal,
        body: JSON.stringify({ ...call.input, context: { ...scope, sessionID: call.sessionId } }),
      });
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "图片生成未完成，请重试。" }, { status: 400 });
    }
  } });
  return { url: `http://127.0.0.1:${server.port}/image`, token, close: () => server.stop() };
}
