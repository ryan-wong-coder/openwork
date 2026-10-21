import { randomBytes } from "node:crypto";
import { z } from "zod";
import { serve } from "./serve-node.js";
import { OpenWorkExtensionsPreview } from "./opencode-plugins/openwork-extensions-preview.js";
import { openworkReadTransport, type OpenworkReadTransport } from "./opencode-plugins/openwork-read-transport.js";
import { createV2ReadAdapter, readV2SessionActivity } from "./opencode-v2-read-adapter.js";
import { isRecord } from "./workspace-kv-store.js";
import { createV2BrowserBridge } from "./opencode-v2-browser-bridge.js";
import { createV2ImageBridge, type V2ImageSessionResolver } from "./opencode-v2-image-bridge.js";
import { isStandaloneAgentProfile } from "./opencode-plugins/local-client-profile.js";
import { ZENO_PERSONAL_INSTRUCTION } from "./opencode-plugins/zeno-personal-tools.js";

const requestSchema = z.object({ name: z.enum(["openwork_context", "openwork_query", "openwork_skills"]), input: z.unknown() });
// The read endpoint executes only reads. It may also describe the personal
// tool registered by this same trusted profile; that descriptor grants no
// command execution through /read. Other dedicated executors stay hidden.
function readAffordances(value: unknown, personalRegistered: boolean): unknown {
  if (Array.isArray(value)) return value.map(entry => readAffordances(entry, personalRegistered));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === "affordances" || key === "availableAffordances"
      ? Array.isArray(entry) ? entry.filter(item => isRecord(item) && (
        personalRegistered && isRecord(item.executor) && item.executor.kind === "tool" && item.executor.tool === "zeno_personal"
        || item.kind === "query" && (!isRecord(item.executor) || item.executor.kind === "openwork")
      )) : entry
      : readAffordances(entry, personalRegistered)]));
}

/** Process-local app-read and browser endpoints, closed with their engine.
 * Build this host entry as one bundle: packaged desktops relocate engine plugin
 * files, and the shared factory and its request-local transport must use the
 * same AsyncLocalStorage instance rather than separately bundled copies. */
export async function createV2ContextBridge(
  hostRequest: (path: string, init?: RequestInit) => Promise<unknown>,
  options?: { resolveImageSession?: V2ImageSessionResolver; clientProfile?: "local-gateway" | "connected" },
) {
  const clientProfile = options?.clientProfile ?? (isStandaloneAgentProfile() ? "local-gateway" : "connected");
  const standalone = isStandaloneAgentProfile(clientProfile);
  const token = randomBytes(32).toString("base64url");
  const plugin = await OpenWorkExtensionsPreview(undefined, { clientProfile });
  const server = await serve({ hostname: "127.0.0.1", port: 0, fetch: async request => {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 401 });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/read") return new Response(null, { status: 404 });
    try {
      const text = await request.text();
      if (text.length > 64_000) return new Response(null, { status: 413 });
      const call = requestSchema.parse(JSON.parse(text));
      const deadline = AbortSignal.timeout(60_000);
      const read = (path: string, init?: RequestInit) => {
        const signal = AbortSignal.any([request.signal, deadline, ...(init?.signal ? [init.signal] : [])]);
        signal.throwIfAborted();
        return hostRequest(path, { ...init, signal });
      };
      // Internal plugin discovery only: not a model-visible tool. This read
      // runs in the background and never participates in prompt admission.
      if (call.name === "openwork_skills") {
        if (standalone) return Response.json({ skills: [], instruction: "" });
        return Response.json(await read("/experimental/connect/skills"));
      }
      const transport: OpenworkReadTransport = {
        engine: "v2",
        activity: (workspaceId: string, sessionId: string) => readV2SessionActivity(path => read(path), workspaceId, sessionId),
        get: createV2ReadAdapter(path => read(path)),
        // v1 still serves sessions created there (e.g. by headless callers)
        // after the one-shot history import. Plain GETs through the host's v1
        // mount keep its workspace ownership checks.
        other: { engine: "v1", get: path => read(path) },
        post: async (path: string, body: Record<string, unknown>, signal?: AbortSignal) => {
          if (path !== "/experimental/ui-control/request" || !["context", "query"].includes(String(body.kind))) {
            throw new Error("Only OpenWork reads are available");
          }
          return read(path, { method: "POST", body: JSON.stringify(body), signal });
        },
      };
      const result = await openworkReadTransport.run(transport, async () => {
        if (call.name === "openwork_query") return plugin.tool.openwork_query.execute(call.input);
        const context: unknown = JSON.parse(await plugin.tool.openwork_context.execute());
        const filtered = readAffordances(context, standalone);
        return JSON.stringify(isRecord(filtered) ? { ...filtered, instructions: {
          context: "Use openwork_query for the discovered read-only affordances. For other conversations, use session.search then session.read. Session reads include current activity and background-agent counts.",
          ...(standalone ? { personal: ZENO_PERSONAL_INSTRUCTION } : {}),
        } } : filtered);
      });
      return new Response(result, { headers: { "Content-Type": "application/json" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "OpenWork read failed" }, { status: 400 });
    }
  } });
  const browser = await createV2BrowserBridge().catch(async error => { await server.stop(); await plugin.dispose(); throw error; });
  const image = options?.resolveImageSession
    ? await createV2ImageBridge(hostRequest, options.resolveImageSession).catch(async (error) => {
      await browser.close(); await server.stop(); await plugin.dispose(); throw error;
    })
    : undefined;
  return { url: `http://127.0.0.1:${server.port}/read`, token, clientProfile, browser: { url: browser.url, token: browser.token },
    ...(image ? { image: { url: image.url, token: image.token } } : {}),
    close: async () => { await image?.close(); await browser.close(); await server.stop(); await plugin.dispose(); } };
}
