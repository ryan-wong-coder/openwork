import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.js";
import type { EnvService } from "./env-file.js";
import { gatewayErrorMessage, readGatewaySettings } from "./gateway-config.js";
import { gatewayProxyToken } from "./gateway-proxy-auth.js";
import { externalFetch, transferResponseBody } from "./server-fetch.js";
import type { ServerConfig } from "./types.js";

const CHAT_PATH = "/gateway/openai/chat/completions";
const REQUEST_LIMIT = 16 * 1024 * 1024;
const ERROR_LIMIT = 128 * 1024;
const CHAT_FIELDS = new Set([
  "model", "messages", "tools", "tool_choice", "parallel_tool_calls", "stream", "stream_options",
  "max_tokens", "max_completion_tokens", "temperature", "top_p", "n", "stop", "presence_penalty",
  "frequency_penalty", "logit_bias", "logprobs", "top_logprobs", "response_format", "seed", "user",
  "store", "metadata", "modalities", "audio", "prediction", "reasoning_effort", "service_tier",
  "safety_identifier", "prompt_cache_key", "prompt_cache_retention", "verbosity", "web_search_options",
  "functions", "function_call", "reasoning", "max_output_tokens",
]);
const RESPONSE_HEADERS = [
  "content-type", "x-request-id", "retry-after", "openai-processing-ms",
  "x-ratelimit-limit-requests", "x-ratelimit-limit-tokens", "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens",
];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(status: number, code: string, message: string, extraHeaders?: Headers) {
  const headers = new Headers(extraHeaders);
  headers.delete("content-type");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json({ error: { message, type: "gateway_proxy_error", code } }, {
    status, headers,
  });
}

function responseHeaders(upstream: Response, apiKey: string) {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value.replaceAll(apiKey, "[redacted]"));
  }
  return headers;
}

async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) {
        // Cancellation is best effort; some transports never settle cancel().
        void reader.cancel().catch(() => undefined);
        throw new ApiError(413, "gateway_request_too_large", "请求内容过大，请缩小对话内容后重试。");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** The engine receives this scoped credential, never the upstream gateway key. */
export async function forwardGatewayChat(config: ServerConfig, env: Pick<EnvService, "list">, request: Request): Promise<Response> {
  const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const expected = gatewayProxyToken(config);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.byteLength !== expectedBytes.byteLength || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return failure(401, "gateway_proxy_unauthorized", "本地模型代理凭证无效。");
  }
  if (new URL(request.url).pathname !== CHAT_PATH) return failure(404, "gateway_proxy_not_found", "本地模型代理不支持此路径。");
  if (request.method !== "POST") {
    const response = failure(405, "gateway_proxy_method_invalid", "本地模型代理仅支持对话请求。");
    response.headers.set("Allow", "POST");
    return response;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return failure(415, "gateway_proxy_content_type", "对话请求必须使用 JSON 格式。");
  }
  let apiKey = "";
  try {
    if (request.signal.aborted) return failure(499, "gateway_request_cancelled", "网关请求已取消。");
    const declaredSize = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > REQUEST_LIMIT) return failure(413, "gateway_request_too_large", "请求内容过大，请缩小对话内容后重试。");
    let payload: unknown;
    try { payload = JSON.parse(await boundedText(request.body, REQUEST_LIMIT)); }
    catch (error) {
      if (error instanceof ApiError || request.signal.aborted) throw error;
      return failure(400, "gateway_proxy_json_invalid", "对话请求不是有效的 JSON。");
    }
    if (!record(payload) || typeof payload.model !== "string" || !payload.model.trim() || payload.model.length > 256
      || !Array.isArray(payload.messages) || payload.messages.length === 0
      || (payload.tools !== undefined && !Array.isArray(payload.tools))
      || (payload.stream !== undefined && typeof payload.stream !== "boolean")) {
      return failure(400, "gateway_proxy_input_invalid", "请选择有效的模型并提供对话内容。");
    }
    const body = Object.fromEntries(Object.entries(payload).filter(([key]) => CHAT_FIELDS.has(key)));
    // One snapshot keeps URL and credential paired even while settings change.
    const gateway = await readGatewaySettings(env);
    apiKey = gateway.apiKey;
    if (!apiKey) return failure(503, "gateway_key_missing", "请先在网关设置中保存 API 密钥。");
    const upstream = await externalFetch(`${gateway.settings.baseURL}/chat/completions`, {
      method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: payload.stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(gateway.settings.requestTimeoutMs)]),
    });
    if (!upstream.ok) {
      let errorPayload: unknown;
      try { errorPayload = JSON.parse(await boundedText(upstream.body, ERROR_LIMIT)); }
      catch (error) {
        if (request.signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) throw error;
        errorPayload = null;
      }
      return failure(upstream.status, "gateway_request_failed", gatewayErrorMessage(errorPayload, apiKey, "网关请求失败，请检查网关配置后重试。"), responseHeaders(upstream, apiKey));
    }
    // Lock the source stream before dropping its Response. Backpressure and
    // cancellation then reach the upstream transport without buffering SSE.
    return new Response(transferResponseBody(upstream), { status: upstream.status, headers: responseHeaders(upstream, apiKey) });
  } catch (error) {
    if (request.signal.aborted) return failure(499, "gateway_request_cancelled", "网关请求已取消。");
    if (error instanceof ApiError) return failure(error.status, error.code, gatewayErrorMessage({ message: error.message }, apiKey, "网关请求失败。"));
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return failure(504, "gateway_request_timeout", "网关请求超时，请稍后重试或调整超时设置。");
    return failure(502, "gateway_unreachable", "无法连接网关，请检查地址和网络后重试。");
  }
}
