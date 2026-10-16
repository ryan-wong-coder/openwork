import { forwardGatewayChat, forwardGatewayMessages } from "../../src/gateway-proxy";
import { gatewayProxyToken } from "../../src/gateway-proxy-auth";
import { serve } from "../../src/serve-node";
import type { ServerConfig } from "../../src/types";

const deadline = process.argv.includes("--deadline");
const native = process.argv.includes("--messages");
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
// Test-process-only rewrite: production still enforces the exact official
// origin. Both sides below use real Node HTTP sockets, with no external call.
if (native) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://api.modelhelm.com/claude/v1/messages") return originalFetch(`http://127.0.0.1:${upstream.port}/native/messages`, init);
    return originalFetch(input, init);
  }, originalFetch);
}
const config: ServerConfig = {
  host: "127.0.0.1", port: 0, token: "fixture-client", hostToken: "fixture-host", configPath: "/tmp/proxy-cancellation-fixture.json",
  approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [], workspaces: [],
  readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
};
const env = { list: async () => [
  { key: "OPENWORK_GATEWAY_BASE_URL", value: native ? "https://api.modelhelm.com/v1" : `http://127.0.0.1:${upstream.port}/v1`, updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_API_KEY", value: "synthetic-cancellation-key", updatedAt: 0 },
  { key: "OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS", value: "10000", updatedAt: 0 },
] };
const proxy = await serve({ hostname: "127.0.0.1", port: 0, fetch: request => (native ? forwardGatewayMessages : forwardGatewayChat)(config, env, request) });
config.port = proxy.port;
const controller = new AbortController();
const startedAt = Date.now();
try {
  const response = await fetch(`http://127.0.0.1:${proxy.port}/gateway/openai/${native ? "messages" : "chat/completions"}`, {
    method: "POST", headers: { Authorization: `Bearer ${gatewayProxyToken(config)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "anthropic/claude-sonnet-5", max_tokens: 2048, messages: [{ role: "user", content: "你好" }], stream: true }), signal: controller.signal,
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
