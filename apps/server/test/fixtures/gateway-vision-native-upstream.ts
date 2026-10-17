// Synthetic-only transport for the pinned native vision fixture. No API key,
// user file, external image URL, real inference or desktop window is involved.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { forwardGatewayChat, forwardGatewayMessages } from "../../src/gateway-proxy";
import { DEFAULT_GATEWAY_BASE_URL } from "../../src/gateway-config";
import { gatewayProxyToken } from "../../src/gateway-proxy-auth";
import type { ServerConfig } from "../../src/types";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Construct a tiny technical test image in memory: a valid 2 x 2 RGBA PNG with
// four coloured pixels. It is never written to a workspace for an agent to read.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const content = Buffer.concat([Buffer.from(type), data]);
  const footer = Buffer.alloc(4); footer.writeUInt32BE(crc32(content));
  return Buffer.concat([header, content, footer]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
export const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]))), chunk("IEND", Buffer.alloc(0))]);
export const pngURL = `data:image/png;base64,${png.toString("base64")}`;
export const pngHash = createHash("sha256").update(png).digest("hex");
export const visionModels = ["openai/gpt-6.1-sol", "anthropic/claude-sonnet-5"];
export const textModel = "fixture/text-only";

export function imageParts(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages.filter(record) : [];
  return messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(record) : [])
    .filter(part => part.type === "image_url" || part.type === "image");
}

export function verifyImage(body: Record<string, unknown>, protocol: "openai" | "anthropic") {
  const parts = imageParts(body);
  assert.equal(parts.length, 1, "First native turn must include exactly one real image block.");
  const part = parts[0];
  let bytes: Buffer;
  if (protocol === "openai") {
    assert.equal(part.type, "image_url"); assert.ok(record(part.image_url));
    assert.equal(part.image_url.url, pngURL, "OpenAI-compatible image_url must retain the complete inline PNG.");
    bytes = Buffer.from(String(part.image_url.url).split(",")[1], "base64");
  } else {
    assert.equal(part.type, "image"); assert.ok(record(part.source));
    assert.equal(part.source.type, "base64"); assert.equal(part.source.media_type, "image/png");
    assert.equal(part.source.data, png.toString("base64"));
    bytes = Buffer.from(String(part.source.data), "base64");
  }
  assert.deepEqual(bytes, png, "The synthetic upstream must receive the exact original PNG bytes.");
  return { mime: "image/png", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), encoding: protocol === "openai" ? "image_url/dataURL" : "source/base64" };
}

export async function syntheticVisionGateway(directory: string) {
  const captures: Array<{ protocol: "openai" | "anthropic"; body: Record<string, unknown> }> = [];
  const failures: string[] = [];
  const proxyRequests: Array<{ path: string; scoped: boolean }> = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    try {
      const body: unknown = await request.json(); assert.ok(record(body));
      const path = new URL(request.url).pathname;
      assert.equal(body.stream, true);
      if (path === "/v1/chat/completions") {
        assert.equal(request.headers.get("authorization"), "Bearer synthetic-vision-key");
        captures.push({ protocol: "openai", body });
        const chunks = [{ delta: { role: "assistant", content: "Synthetic image transport accepted." }, finish_reason: null }, { delta: {}, finish_reason: "stop" }];
        return new Response(chunks.map(choice => `data: ${JSON.stringify({ id: "synthetic-vision", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, ...choice }] })}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
      }
      assert.equal(path, "/claude/v1/messages");
      assert.equal(request.headers.get("x-api-key"), "synthetic-vision-key");
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(request.headers.get("anthropic-version"), "2023-06-01");
      captures.push({ protocol: "anthropic", body });
      const events = [
        { type: "message_start", message: { id: "msg_vision_synthetic", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Synthetic image transport accepted." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } },
        { type: "message_stop" },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Synthetic upstream failed");
      return Response.json({ error: "Synthetic vision assertion failed" }, { status: 400 });
    }
  } });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host", configPath: join(directory, "server.json"), clientProfile: "local-gateway",
    workspaces: [], authorizedRoots: [], corsOrigins: [], approval: { mode: "auto", timeoutMs: 1000 }, readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const env = { list: async () => [
    { key: "OPENWORK_GATEWAY_API_KEY", value: "synthetic-vision-key", updatedAt: 0 },
    { key: "OPENWORK_GATEWAY_BASE_URL", value: DEFAULT_GATEWAY_BASE_URL, updatedAt: 0 },
    { key: "OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS", value: "10000", updatedAt: 0 },
  ] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://api.modelhelm.com") {
      assert.equal(typeof input, "string");
      return originalFetch(`http://127.0.0.1:${upstream.port}${url.pathname}${url.search}`, init);
    }
    assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Fixture parent rejects all external network calls.");
    return originalFetch(input, init);
  }, originalFetch);
  const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/gateway/openai/messages") {
      assert.equal(request.headers.get("x-api-key"), gatewayProxyToken(config)); proxyRequests.push({ path, scoped: true });
      return forwardGatewayMessages(config, env, request);
    }
    if (path === "/gateway/openai/chat/completions") {
      assert.equal(request.headers.get("authorization"), `Bearer ${gatewayProxyToken(config)}`); proxyRequests.push({ path, scoped: true });
      return forwardGatewayChat(config, env, request);
    }
    return Response.json({ error: "Synthetic fixture route missing" }, { status: 404 });
  } });
  assert.ok(proxy.port); config.port = proxy.port;
  return { config, captures, failures, proxyRequests, stop() { proxy.stop(true); upstream.stop(true); globalThis.fetch = originalFetch; } };
}
