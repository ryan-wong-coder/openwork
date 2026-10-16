import { forwardGatewayChat } from "../../src/gateway-proxy";
import { gatewayProxyToken } from "../../src/gateway-proxy-auth";
import { serve } from "../../src/serve-node";
import type { ServerConfig } from "../../src/types";

const deadline = process.argv.includes("--deadline");
let closed: () => void = () => {};
let heartbeat: ReturnType<typeof setInterval> | undefined;
const upstreamClosed = new Promise<void>(resolve => { closed = resolve; });
const upstream = await serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
  const stop = () => { clearInterval(heartbeat); closed(); };
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
      heartbeat = setInterval(() => controller.enqueue(new TextEncoder().encode(": heartbeat\n\n")), 20);
      request.signal.addEventListener("abort", stop, { once: true });
    },
    cancel: stop,
  }), { headers: { "Content-Type": "text/event-stream" } });
} });
const config: ServerConfig = {
  host: "127.0.0.1", port: 0, token: "fixture-client", hostToken: "fixture-host", configPath: "/tmp/proxy-cancellation-fixture.json",
  approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [], workspaces: [],
  readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
};
const env = { list: async () => [
  { key: "OPENWORK_GATEWAY_BASE_URL", value: `http://127.0.0.1:${upstream.port}/v1`, updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_API_KEY", value: "synthetic-cancellation-key", updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS", value: "10000", updatedAt: 0 },
] };
const proxy = await serve({ hostname: "127.0.0.1", port: 0, fetch: request => forwardGatewayChat(config, env, request) });
config.port = proxy.port;
const controller = new AbortController();
const startedAt = Date.now();
try {
  const response = await fetch(`http://127.0.0.1:${proxy.port}/gateway/openai/chat/completions`, {
    method: "POST", headers: { Authorization: `Bearer ${gatewayProxyToken(config)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "anthropic/claude-sonnet-5", messages: [{ role: "user", content: "你好" }], stream: true }), signal: controller.signal,
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing stream");
  await reader.read();
  if (!deadline) controller.abort();
  let readerCancelled = false;
  try { while (!(await reader.read()).done) {} } catch { readerCancelled = true; }
  const upstreamCancelled = await Promise.race([upstreamClosed.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000))]);
  process.stdout.write(`${JSON.stringify({ readerCancelled, upstreamCancelled, ...(deadline ? { elapsedMs: Date.now() - startedAt } : {}) })}\n`);
  if (!readerCancelled || !upstreamCancelled) process.exitCode = 1;
} finally {
  controller.abort();
  clearInterval(heartbeat);
  await proxy.stop();
  await upstream.stop();
}
