import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forwardGatewayChat } from "../src/gateway-proxy";
import { gatewayProxyToken } from "../src/gateway-proxy-auth";
import { serve } from "../src/serve-node";
import type { ServerConfig } from "../src/types";

const fixtureKey = "synthetic-proxy-upstream-credential";
const chat = { model: "anthropic/claude-sonnet-5", messages: [{ role: "user", content: "你好" }] };
const encode = (text: string) => new TextEncoder().encode(text);

async function fixture(handler: (request: Request) => Response | Promise<Response>) {
  let upstreamRequests = 0;
  let envReads = 0;
  const upstream = await serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    upstreamRequests += 1;
    return handler(request);
  } });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture-client-token", hostToken: "fixture-host-token", configPath: "/tmp/gateway-proxy-fixture/server.json",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [], workspaces: [],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const values = new Map([
    ["OPENWORK_GATEWAY_API_KEY", fixtureKey], ["OPENWORK_GATEWAY_BASE_URL", `http://127.0.0.1:${upstream.port}/v1`],
    ["OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS", "10000"],
  ]);
  const env = { list: async () => { envReads += 1; return [...values].map(([key, value]) => ({ key, value, updatedAt: 0 })); } };
  const proxy = await serve({ hostname: "127.0.0.1", port: 0, fetch: request => forwardGatewayChat(config, env, request) });
  config.port = proxy.port;
  const url = `http://127.0.0.1:${proxy.port}/gateway/openai/chat/completions`;
  const request = (body: unknown = chat, headers: Record<string, string> = {}) => fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${gatewayProxyToken(config)}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  return { config, env, values, url, request, envReads: () => envReads, upstreamRequests: () => upstreamRequests, stop: async () => { await proxy.stop(); await upstream.stop(); } };
}

test("only the scoped proxy credential can use the one POST route", async () => {
  const local = await fixture(() => Response.json({ choices: [] }));
  try {
    for (const token of ["", local.config.token, local.config.hostToken, "unrelated-token", "é".repeat(43)]) {
      const response = await local.request(chat, { Authorization: `Bearer ${token}` });
      expect(response.status).toBe(401);
    }
    const headers = { Authorization: `Bearer ${gatewayProxyToken(local.config)}` };
    expect((await fetch(local.url, { headers })).status).toBe(405);
    expect((await fetch(local.url.replace("chat/completions", "models"), { method: "POST", headers })).status).toBe(404);
    expect((await local.request(chat, { "Content-Type": "text/plain" })).status).toBe(415);
    expect(local.upstreamRequests()).toBe(0);
    expect(local.envReads()).toBe(0);
  } finally { await local.stop(); }
});

test("one atomic settings read selects routing and credentials while standard chat fields pass through", async () => {
  let actualBody: unknown;
  const local = await fixture(async request => {
    expect(new URL(request.url).pathname).toBe("/v1/chat/completions");
    expect(request.headers.get("authorization")).toBe(`Bearer ${fixtureKey}`);
    expect(request.headers.get("cookie")).toBeNull();
    expect(request.headers.get("x-openwork-host-token")).toBeNull();
    actualBody = await request.json();
    return Response.json({ choices: [{ message: { content: "你好" } }] }, { headers: {
      "X-Request-Id": `request-${fixtureKey}`, "Set-Cookie": "private=upstream", "Location": "https://example.test/redirect", "X-Private-Secret": fixtureKey,
    } });
  });
  try {
    const standard = { ...chat, messages: [{ role: "user", content: "上下文".repeat(25000) }], tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }], tool_choice: "auto", stream_options: { include_usage: true }, reasoning: { effort: "high" }, max_completion_tokens: 1200 };
    const response = await local.request({ ...standard, url: "https://example.test/wrong", baseURL: "https://example.test/wrong", headers: { Authorization: "unsafe" }, Authorization: "unsafe", api_key: "unsafe" }, { Cookie: "private=renderer", "X-OpenWork-Host-Token": local.config.hostToken });
    expect(response.status).toBe(200);
    expect(actualBody).toEqual(standard);
    expect(local.envReads()).toBe(1);
    expect(await response.json()).toEqual({ choices: [{ message: { content: "你好" } }] });
    expect(response.headers.get("x-request-id")).toBe("request-[redacted]");
    for (const name of ["set-cookie", "location", "x-private-secret", "content-encoding"]) expect(response.headers.get(name)).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally { await local.stop(); }
});

test("SSE starts immediately and preserves chunk data, tool calls, usage, and DONE", async () => {
  let release: () => void = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  const first = 'data: {"choices":[{"delta":{"content":"first 你好"}}]}\n\n';
  const last = 'data: {"choices":[{"delta":{"tool_calls":[{"id":"tool-1","function":{"name":"write","arguments":"{}"}}]}}],"usage":{"completion_tokens":7}}\n\ndata: [DONE]\n\n';
  const local = await fixture(() => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encode(first)); void released.then(() => { controller.enqueue(encode(last)); controller.close(); }); },
  }), { headers: { "Content-Type": "text/event-stream", "X-Request-Id": "stream-fixture" } }));
  try {
    const response = await local.request({ ...chat, stream: true, stream_options: { include_usage: true } });
    expect(response.headers.get("content-type")).toStartWith("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error("Missing stream");
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value, { stream: true });
    expect(text).toBe(first);
    release();
    while (true) { const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value, { stream: true }); }
    text += decoder.decode();
    expect(text).toBe(first + last);
    expect(local.envReads()).toBe(1);
  } finally { release(); await local.stop(); }
});

test("upstream failures redact the real key and redirects never receive credentials", async () => {
  let redirectedRequests = 0;
  const redirectTarget = await serve({ hostname: "127.0.0.1", port: 0, fetch: () => { redirectedRequests += 1; return Response.json({}); } });
  let redirect = false;
  const local = await fixture(() => redirect
    ? new Response(null, { status: 302, headers: { Location: `http://127.0.0.1:${redirectTarget.port}/collect` } })
    : Response.json({ error: { message: `Failed authorization ${fixtureKey}` } }, { status: 429, headers: { "Retry-After": "7", "Set-Cookie": fixtureKey } }));
  try {
    const failed = await local.request();
    expect(failed.status).toBe(429);
    const text = await failed.text();
    expect(text).toContain("已隐藏密钥");
    expect(text).not.toContain(fixtureKey);
    expect(failed.headers.get("retry-after")).toBe("7");
    expect(failed.headers.get("set-cookie")).toBeNull();
    redirect = true;
    expect((await local.request()).status).toBe(502);
    expect(redirectedRequests).toBe(0);
  } finally { await local.stop(); await redirectTarget.stop(); }
});

test("invalid, oversized and unconfigured requests never leave the host", async () => {
  const local = await fixture(() => Response.json({ choices: [] }));
  try {
    for (const body of [[], {}, { ...chat, model: "" }, { ...chat, messages: [] }, { ...chat, tools: {} }, { ...chat, stream: "yes" }]) expect((await local.request(body)).status).toBe(400);
    const huge = await forwardGatewayChat(local.config, local.env, new Request(local.url, {
      method: "POST", headers: { Authorization: `Bearer ${gatewayProxyToken(local.config)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...chat, messages: [{ role: "user", content: "x".repeat(16 * 1024 * 1024) }] }),
    }));
    expect(huge.status).toBe(413);
    local.values.set("OPENWORK_GATEWAY_API_KEY", "");
    expect((await local.request()).status).toBe(503);
    expect(local.upstreamRequests()).toBe(0);
  } finally { await local.stop(); }
});

let nativeFixtureSource: Promise<string> | undefined;
async function nativeTransportResult(deadline = false, messages = false) {
  // Bun 1.3.x rejects fetch body reads after abort but leaves its HTTP socket
  // open. Node's fetch transport gets an independent strict close assertion.
  // Electron uses electron.net.fetch and is not exercised by this fixture.
  nativeFixtureSource ??= (async () => {
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, "fixtures/gateway-proxy-cancellation.ts")], target: "node", format: "esm", external: ["bun:sqlite", "drizzle-orm/bun-sqlite", "jsonc-parser"] });
    expect(build.success).toBe(true);
    const output = build.outputs[0];
    if (!output) throw new Error("Missing Node fixture");
    return (await output.text()).replaceAll('"jsonc-parser"', JSON.stringify(import.meta.resolve("jsonc-parser")));
  })();
  const directory = await mkdtemp(join(tmpdir(), "openwork-proxy-node-"));
  try {
    const path = join(directory, "proxy.mjs");
    await writeFile(path, await nativeFixtureSource);
    const process = Bun.spawn(["node", path, ...(deadline ? ["--deadline"] : []), ...(messages ? ["--messages"] : [])], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    expect(code).toBe(0);
    expect(stderr).not.toContain("synthetic-cancellation-key");
    return JSON.parse(stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("caller cancellation closes both HTTP streams on the standalone Node transport", async () => {
  expect(await nativeTransportResult()).toEqual({ readerCancelled: true, upstreamCancelled: true });
});

test("the configured deadline terminates an already streaming response and closes upstream", async () => {
  const result = await nativeTransportResult(true);
  expect(result).toMatchObject({ readerCancelled: true, upstreamCancelled: true });
  expect(result.elapsedMs).toBeGreaterThanOrEqual(9500);
  expect(result.elapsedMs).toBeLessThan(15000);
}, 20000);

test("native Messages cancellation closes both real Node HTTP streams", async () => {
  expect(await nativeTransportResult(false, true)).toEqual({ readerCancelled: true, upstreamCancelled: true });
});

test("native Messages deadline closes an already streaming upstream", async () => {
  const result = await nativeTransportResult(true, true);
  expect(result).toMatchObject({ readerCancelled: true, upstreamCancelled: true });
  expect(result.elapsedMs).toBeGreaterThanOrEqual(9500);
  expect(result.elapsedMs).toBeLessThan(15000);
}, 20000);

test("Bun caller cancellation rejects further reads without claiming upstream socket closure", async () => {
  let timer: ReturnType<typeof setInterval> | undefined;
  const local = await fixture(() => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode('data: {"choices":[]}\n\n'));
      timer = setInterval(() => controller.enqueue(encode(": heartbeat\n\n")), 100);
    },
    cancel() { clearInterval(timer); },
  }), { headers: { "Content-Type": "text/event-stream" } }));
  const controller = new AbortController();
  try {
    const response = await forwardGatewayChat(local.config, local.env, new Request(local.url, {
      method: "POST", headers: { Authorization: `Bearer ${gatewayProxyToken(local.config)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...chat, stream: true }), signal: controller.signal,
    }));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing stream");
    await reader.read();
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
  } finally { controller.abort(); clearInterval(timer); await local.stop(); }
});
