import { expect, spyOn, test } from "bun:test";
import { forwardGatewayMessages } from "../src/gateway-proxy";
import { gatewayProxyToken } from "../src/gateway-proxy-auth";
import type { ServerConfig } from "../src/types";

const upstreamUrl = "https://api.modelhelm.com/claude/v1/messages";
const fixtureKey = "synthetic-native-upstream-credential";
const payload = { model: "anthropic/claude-sonnet-5", max_tokens: 2048, messages: [{ role: "user", content: "fixture" }] };
const encode = (text: string) => new TextEncoder().encode(text);
function fixture(handler: (request: Request) => Response | Promise<Response> = () => Response.json({ type: "message", content: [] })) {
  const config: ServerConfig = {
    host: "127.0.0.1", port: 12345, token: "fixture-client", hostToken: "fixture-host", configPath: "/tmp/native-proxy-fixture.json",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [], workspaces: [], readOnly: false,
    startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  let calls = 0; let reads = 0;
  const values = new Map([["OPENWORK_GATEWAY_BASE_URL", "https://api.modelhelm.com/v1"], ["OPENWORK_GATEWAY_API_KEY", fixtureKey]]);
  const env = { list: async () => { reads += 1; return [...values].map(([key, value]) => ({ key, value, updatedAt: 0 })); } };
  const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    expect(url).toBe(upstreamUrl); calls += 1;
    return handler(new Request(input, init));
  });
  const request = (body: unknown = payload, headers: Record<string, string> = {}, options: { method?: string; path?: string; signal?: AbortSignal; raw?: string } = {}) => forwardGatewayMessages(config, env, new Request(`http://127.0.0.1:12345${options.path ?? "/gateway/openai/messages"}`, {
    method: options.method ?? "POST", headers: { "x-api-key": gatewayProxyToken(config), "Content-Type": "application/json", ...headers },
    ...(options.method === "GET" ? {} : { body: options.raw ?? JSON.stringify(body) }), ...(options.signal ? { signal: options.signal } : {}),
  }));
  return { config, values, request, calls: () => calls, reads: () => reads, stop: () => fetch.mockRestore() };
}

test("native route accepts only scoped credentials and rejects conflicting headers before settings access", async () => {
  const local = fixture();
  try {
    for (const key of ["", local.config.token, local.config.hostToken, "not-a-proxy-token", "é".repeat(43)]) expect((await local.request(payload, { "x-api-key": key })).status).toBe(401);
    expect((await local.request(payload, { Authorization: "Bearer invalid" })).status).toBe(401);
    expect(local.calls()).toBe(0); expect(local.reads()).toBe(0);
    const token = gatewayProxyToken(local.config);
    expect((await local.request(payload, { Authorization: `Bearer ${token}` })).status).toBe(200);
    const bearer = await forwardGatewayMessages(local.config, { list: async () => [...local.values].map(([key, value]) => ({ key, value, updatedAt: 0 })) }, new Request("http://localhost/gateway/openai/messages", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }));
    expect(bearer.status).toBe(200);
  } finally { local.stop(); }
});

test("native method, JSON, payload, beta and size guards prevent any upstream request", async () => {
  const local = fixture();
  try {
    expect((await local.request(payload, {}, { method: "GET" })).status).toBe(405);
    expect((await local.request(payload, {}, { path: "/gateway/openai/models" })).status).toBe(404);
    expect((await local.request(payload, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await local.request(payload, {}, { raw: "{" })).status).toBe(400);
    for (const body of [{}, [], { ...payload, model: "" }, { ...payload, messages: [] }, { ...payload, max_tokens: 0 }, { ...payload, max_tokens: 1.2 }, { ...payload, max_tokens: "12" }, { ...payload, tools: {} }, { ...payload, system: 42 }, { ...payload, thinking: "adaptive" }, { ...payload, output_config: [] }, { ...payload, stream: "yes" }]) expect((await local.request(body)).status).toBe(400);
    for (const beta of ["invalid beta", "bad_beta", "first,\tsecond", "first,\u00a0second", "x".repeat(1025)]) expect((await local.request(payload, { "anthropic-beta": beta })).status).toBe(400);
    expect((await local.request(payload, { "Content-Length": String(17 * 1024 * 1024) })).status).toBe(413);
    expect((await local.request({ ...payload, messages: [{ role: "user", content: "x".repeat(16 * 1024 * 1024) }] })).status).toBe(413);
    expect(local.calls()).toBe(0); expect(local.reads()).toBe(0);
  } finally { local.stop(); }
});

test("only exact official gateway and four full routing IDs may select native Claude", async () => {
  const local = fixture();
  try {
    for (const model of ["anthropic/claude-fable-5", "anthropic/claude-opus-5", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5"]) expect((await local.request({ ...payload, model })).status).toBe(200);
    expect(local.calls()).toBe(4);
    for (const model of ["claude-sonnet-5", "anthropic/claude-sonnet-5-fake", "other/claude-sonnet-5", "openai/gpt-6.1-sol"]) expect((await local.request({ ...payload, model })).status).toBe(400);
    for (const baseURL of ["https://api.modelhelm.com.evil.test/v1", "https://api.modelhelm.com/v1/custom", "https://custom.example.test/v1", "http://127.0.0.1:1234/v1"]) {
      local.values.set("OPENWORK_GATEWAY_BASE_URL", baseURL);
      expect((await local.request()).status).toBe(400);
    }
    expect(local.calls()).toBe(4);
  } finally { local.stop(); }
});

test("native body, version and sole beta header pass while credentials and destinations remain server controlled", async () => {
  let actual: unknown;
  const local = fixture(async request => {
    expect(request.url).toBe(upstreamUrl); expect(request.headers.get("x-api-key")).toBe(fixtureKey);
    expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(request.headers.get("anthropic-beta")).toBe("context-management-2025-06-27, prompt-caching-2024-07-31");
    for (const name of ["authorization", "cookie", "x-openwork-host-token", "x-private-header"]) expect(request.headers.get(name)).toBeNull();
    actual = await request.json();
    return Response.json({ type: "message", content: [{ type: "text", text: "ok" }] }, { headers: { "request-id": `req-${fixtureKey}`, "Set-Cookie": fixtureKey, "X-Private-Header": fixtureKey } });
  });
  try {
    const body = { ...payload, system: [{ type: "text", text: "fixture system", cache_control: { type: "ephemeral" } }], thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" }, tools: [{ name: "read", description: "Read fixture", input_schema: { type: "object" } }], tool_choice: { type: "auto" }, stop_sequences: ["stop"], stream: false };
    const response = await local.request({ ...body, baseURL: "https://evil.test", url: "https://evil.test", headers: { "x-api-key": "unsafe" }, api_key: "unsafe", reasoning_effort: "high" }, { "anthropic-version": "untrusted-version", "anthropic-beta": "context-management-2025-06-27, prompt-caching-2024-07-31", Cookie: "private=renderer", "X-OpenWork-Host-Token": local.config.hostToken, "X-Private-Header": "unsafe" });
    expect(response.status).toBe(200); expect(actual).toEqual(body); expect(local.reads()).toBe(1);
    expect(response.headers.get("request-id")).toBe("req-[redacted]"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull(); expect(response.headers.get("x-private-header")).toBeNull();
  } finally { local.stop(); }
});

test("native SSE streams immediately and preserves thinking signatures, tool inputs and usage byte for byte", async () => {
  let release: () => void = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  const first = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"fixture reasoning"}}\n\n';
  const last = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"synthetic-signature"}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-fixture","name":"read","input":{}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  const local = fixture(() => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode(first)); void released.then(() => { controller.enqueue(encode(last)); controller.close(); }); } }), { headers: { "Content-Type": "text/event-stream" } }));
  try {
    const response = await local.request({ ...payload, stream: true }); const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing native stream");
    expect(response.headers.get("content-type")).toStartWith("text/event-stream");
    const decoder = new TextDecoder(); let text = decoder.decode((await reader.read()).value, { stream: true }); expect(text).toBe(first);
    release(); while (true) { const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value, { stream: true }); }
    text += decoder.decode(); expect(text).toBe(first + last);
  } finally { release(); local.stop(); }
});

test("native upstream errors preserve status and redact credentials; redirects cannot be followed", async () => {
  let redirect = false; let large = false;
  const local = fixture(request => {
    expect(request.redirect).toBe("error");
    if (redirect) throw new TypeError(`Unexpected redirect ${fixtureKey}`);
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: large ? fixtureKey.repeat(10000) : `Invalid effort ${fixtureKey}` } }, { status: 400, headers: { "request-id": `req-${fixtureKey}`, "Retry-After": "7", "Set-Cookie": fixtureKey } });
  });
  try {
    const response = await local.request({ ...payload, output_config: { effort: "invalid-probe" } });
    expect(response.status).toBe(400); const text = await response.text(); expect(text).toContain('"type":"error"'); expect(text).not.toContain(fixtureKey);
    expect(response.headers.get("retry-after")).toBe("7"); expect(response.headers.get("set-cookie")).toBeNull();
    large = true; const bounded = await local.request(); expect(bounded.status).toBe(400); expect((await bounded.text()).length).toBeLessThan(1000);
    redirect = true; const failed = await local.request(); expect(failed.status).toBe(502); expect(await failed.text()).not.toContain(fixtureKey);
  } finally { local.stop(); }
});

test("native missing-key, caller abort and timeout responses never expose upstream credentials", async () => {
  const local = fixture(() => { throw new DOMException(`Timeout ${fixtureKey}`, "TimeoutError"); });
  try {
    const aborted = new AbortController(); aborted.abort();
    expect((await local.request(payload, {}, { signal: aborted.signal })).status).toBe(499); expect(local.reads()).toBe(0);
    local.values.set("OPENWORK_GATEWAY_API_KEY", ""); expect((await local.request()).status).toBe(503); expect(local.calls()).toBe(0);
    local.values.set("OPENWORK_GATEWAY_API_KEY", fixtureKey); const timeout = await local.request();
    expect(timeout.status).toBe(504); expect(await timeout.text()).not.toContain(fixtureKey);
  } finally { local.stop(); }
});
