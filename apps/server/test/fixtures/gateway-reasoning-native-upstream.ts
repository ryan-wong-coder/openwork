// Shared manual-native fixture transport. All credentials and model responses
// are synthetic. Only this process rewrites the fixed official URL to loopback.
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { forwardGatewayChat, forwardGatewayMessages } from "../../src/gateway-proxy";
import { DEFAULT_GATEWAY_BASE_URL } from "../../src/gateway-config";
import { gatewayProxyToken } from "../../src/gateway-proxy-auth";
import type { ServerConfig } from "../../src/types";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const CLAUDE_MODEL = "anthropic/claude-opus-5.5";
export const CLAUDE_MODELS = ["anthropic/claude-fable-5", "anthropic/claude-opus-5", CLAUDE_MODEL, "anthropic/claude-sonnet-5"];
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

function blocks(messages: unknown, type: string): Record<string, unknown>[] {
  assert.ok(Array.isArray(messages));
  return messages.filter(record).flatMap(message => Array.isArray(message.content)
    ? message.content.filter(record).filter(block => block.type === type) : []);
}

export async function syntheticNativeGateway(directory: string) {
  const cc: Record<string, unknown>[] = [];
  const anthropic: Record<string, unknown>[] = [];
  const proxyRequests: Array<{ path: string; scoped: boolean }> = [];
  await mkdir(join(directory, "workspace"), { recursive: true });
  const proof = join(directory, "workspace/native-proof.txt");
  await writeFile(proof, "Synthetic native tool result.\n");
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body: unknown = await request.json();
    assert.ok(record(body));
    const path = new URL(request.url).pathname;
    if (path === "/v1/chat/completions") {
      assert.equal(request.headers.get("authorization"), "Bearer synthetic-upstream-key");
      const title = JSON.stringify(body.messages).includes("Generate a title for");
      if (!title) cc.push(body);
      const chunks = [
        ...(title ? [] : [{ reasoning_content: "Synthetic thought." }]),
        { content: title ? "Synthetic native proof" : "Synthetic answer" },
      ];
      const sse = [...chunks.map(delta => ({ delta, finish_reason: null })), { delta: {}, finish_reason: "stop" }]
        .map(choice => `data: ${JSON.stringify({ id: "synthetic-completion", object: "chat.completion.chunk", created: 1,
          model: body.model, choices: [{ index: 0, ...choice }] })}\n\n`).join("");
      return new Response(sse + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    }
    assert.equal(path, "/claude/v1/messages");
    assert.equal(request.headers.get("x-api-key"), "synthetic-upstream-key");
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("anthropic-version"), "2023-06-01");
    const messageEfforts = Array.isArray(body.messages) ? body.messages.filter(record)
      .filter(message => message.role === "system" && record(message.output_config)).map(message => message.output_config) : [];
    const selectedMessageEffort = messageEfforts.at(-1);
    const topEffort = record(body.output_config) ? body.output_config.effort : undefined;
    const effort = record(selectedMessageEffort) ? selectedMessageEffort.effort : topEffort;
    const capturePath = process.env.OPENWORK_TEST_NATIVE_BODY_PATH;
    if (!anthropic.length && capturePath) await writeFile(capturePath, JSON.stringify({
      betaHeader: request.headers.get("anthropic-beta"), body,
    }, null, 2));
    if (process.env.OPENWORK_TEST_NATIVE_DEBUG === "1") console.log(JSON.stringify({ phase: "synthetic-anthropic-wire", model: body.model,
      effort, topEffort: topEffort ?? null, betaHeader: request.headers.get("anthropic-beta"), thinking: body.thinking ?? null,
      tools: Array.isArray(body.tools) ? body.tools.length : 0,
      messageEfforts,
      toolResults: blocks(body.messages, "tool_result").length }));
    assert.equal(body.model, CLAUDE_MODEL);
    assert.equal(body.stream, true);
    assert.ok(record(body.thinking));
    assert.equal(body.thinking.type, "adaptive");
    assert.equal(body.thinking.display, "summarized");
    assert.ok(["high", "xhigh", "max"].includes(String(effort)));
    assert.equal(body.reasoning_effort, undefined);
    anthropic.push(body);
    const signature = `synthetic-signature-${effort}`;
    const toolId = `toolu_native_${effort}`;
    const results = blocks(body.messages, "tool_result");
    if (results.length) {
      const thinking = blocks(body.messages, "thinking");
      assert.ok(thinking.some(block => block.thinking === "Synthetic Claude thought." && block.signature === signature), "Thinking text/signature must survive tool continuation.");
      assert.ok(blocks(body.messages, "tool_use").some(block => block.id === toolId && block.name === "read"));
      assert.ok(results.some(block => block.tool_use_id === toolId && JSON.stringify(block.content).includes("Synthetic native tool result.")), "The actual local read result must reach the native wire.");
    }
    const toolTurn = effort === "high" && results.length === 0;
    let input: Record<string, string> = {};
    if (toolTurn) {
      assert.ok(Array.isArray(body.tools));
      const read = body.tools.find((tool: unknown) => record(tool) && tool.name === "read");
      assert.ok(record(read) && record(read.input_schema) && record(read.input_schema.properties));
      const properties = read.input_schema.properties;
      const pathKey = ["filePath", "file_path", "path"].find(key => Object.hasOwn(properties, key));
      assert.ok(pathKey, "Pinned native read schema must expose a file path.");
      input = { [pathKey]: proof };
    }
    const events: Array<Record<string, unknown>> = [
      { type: "message_start", message: { id: `msg_native_${anthropic.length}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Synthetic Claude thought." } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature } },
      { type: "content_block_stop", index: 0 },
      ...(toolTurn ? [
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: toolId, name: "read", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
      ] : [
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Synthetic Claude answer" } },
      ]),
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: toolTurn ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } },
      { type: "message_stop" },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  } });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host",
    configPath: join(directory, "server.json"), clientProfile: "local-gateway", workspaces: [], authorizedRoots: [], corsOrigins: [],
    approval: { mode: "auto", timeoutMs: 1000 }, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const env = { list: async () => [
    { key: "OPENWORK_GATEWAY_API_KEY", value: "synthetic-upstream-key", updatedAt: 0 },
    { key: "OPENWORK_GATEWAY_BASE_URL", value: DEFAULT_GATEWAY_BASE_URL, updatedAt: 0 },
    { key: "OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS", value: "10000", updatedAt: 0 },
  ] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://api.modelhelm.com") {
      assert.equal(typeof input, "string", "The externalFetch seam uses a string URL.");
      return originalFetch(`http://127.0.0.1:${upstream.port}${url.pathname}${url.search}`, init);
    }
    assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Native fixture refuses all external network calls.");
    return originalFetch(input, init);
  }, originalFetch);
  const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    const scoped = gatewayProxyToken(config);
    if (path === "/gateway/openai/messages") {
      assert.equal(request.headers.get("x-api-key"), scoped);
      proxyRequests.push({ path, scoped: true });
      return forwardGatewayMessages(config, env, request);
    }
    if (path !== "/gateway/openai/chat/completions") return Response.json({ error: "Synthetic fixture route not found" }, { status: 404 });
    assert.equal(request.headers.get("authorization"), `Bearer ${scoped}`);
    proxyRequests.push({ path, scoped: true });
    return forwardGatewayChat(config, env, request);
  } });
  assert.ok(proxy.port !== undefined);
  config.port = proxy.port;
  return { config, cc, anthropic, proxyRequests, async stop() {
    proxy.stop(true); upstream.stop(true); globalThis.fetch = originalFetch;
  } };
}

export function assertSyntheticClaudeRequests(requests: Record<string, unknown>[]) {
  const efforts = requests.map(request => {
    const systems = Array.isArray(request.messages) ? request.messages.filter(record).filter(message => message.role === "system" && record(message.output_config)) : [];
    const update = systems.at(-1)?.output_config;
    return record(update) ? update.effort : record(request.output_config) ? request.output_config.effort : undefined;
  });
  assert.deepEqual(efforts, ["high", "high", "xhigh", "max"]);
  assert.ok(requests[1] && blocks(requests[1].messages, "tool_result").length > 0);
  const effortTransport = requests.map(request => record(request.output_config) ? "top-level" : "message-update");
  return { model: CLAUDE_MODEL, selectedEfforts: ["high", "xhigh", "max"], nativeCatalogEfforts: CLAUDE_EFFORTS, effortTransport,
    thinking: "adaptive/summarized", thinkingSignatureReplay: true, syntheticReadToolRoundTrip: true, scopedProxyAuthentication: true, upstreamRequests: requests.length };
}
