import { ApiError } from "./errors.js";
import { createHash } from "node:crypto";
import type { EnvService } from "./env-file.js";
import { externalFetch } from "./server-fetch.js";
import { readGlobalRuntimeOpencodeConfig, writeGlobalRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { writeOpenworkRuntimeConfigFile } from "./openwork-runtime-config.js";
import { syncManagedProviderAuth } from "./managed-provider-auth.js";
import type { ServerConfig } from "./types.js";
import { withConfigurationWriteLock } from "./configuration-write-lock.js";
import { GATEWAY_PROXY_TOKEN_ENV, gatewayProxyBaseURL } from "./gateway-proxy-auth.js";

export const GATEWAY_PROVIDER_ID = "modelhelm";
export const DEFAULT_GATEWAY_BASE_URL = "https://api.modelhelm.com/v1";
export const DEFAULT_GATEWAY_CHAT_MODEL = "anthropic/claude-sonnet-5";
export const DEFAULT_GATEWAY_IMAGE_MODEL = "openai/gpt-image-2";
export const GATEWAY_API_KEY_ENV = "OPENWORK_GATEWAY_API_KEY";
export const GATEWAY_MODEL_CATALOG_ENV = "OPENWORK_GATEWAY_MODEL_CATALOG";

export type GatewaySettings = {
  baseURL: string;
  chatModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: string;
  requestTimeoutMs: number;
  imageGenerationEnabled: boolean;
};
export type GatewayModel = { id: string; name: string; kind: "chat" | "image" | "other" };
export type GatewayConfigInput = Partial<GatewaySettings> & { apiKey?: string };

const fields = {
  baseURL: "OPENWORK_GATEWAY_BASE_URL",
  chatModel: "OPENWORK_GATEWAY_CHAT_MODEL",
  imageModel: "OPENWORK_GATEWAY_IMAGE_MODEL",
  imageSize: "OPENWORK_GATEWAY_IMAGE_SIZE",
  imageQuality: "OPENWORK_GATEWAY_IMAGE_QUALITY",
  requestTimeoutMs: "OPENWORK_GATEWAY_REQUEST_TIMEOUT_MS",
  imageGenerationEnabled: "OPENWORK_GATEWAY_IMAGE_GENERATION_ENABLED",
};

export function normalizeGatewayBaseURL(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ApiError(400, "gateway_url_invalid", "请输入有效的网关地址。"); }
  const local = url.hostname === "localhost" || url.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, "gateway_url_invalid", "网关地址必须使用 HTTPS；本地测试地址可使用 HTTP。请勿在地址中填写密钥。");
  }
  return url.href.replace(/\/+$/, "");
}

export async function readGatewaySettings(env: Pick<EnvService, "list">) {
  const records = new Map((await env.list()).map((record) => [record.key, record.value]));
  const read = (key: string) => records.has(key) ? records.get(key)?.trim() || "" : process.env[key]?.trim() || "";
  const timeout = Number(read(fields.requestTimeoutMs));
  const settings: GatewaySettings = {
    baseURL: normalizeGatewayBaseURL(read(fields.baseURL) || DEFAULT_GATEWAY_BASE_URL),
    chatModel: read(fields.chatModel) || DEFAULT_GATEWAY_CHAT_MODEL,
    imageModel: read(fields.imageModel) || DEFAULT_GATEWAY_IMAGE_MODEL,
    imageSize: read(fields.imageSize) || "1024x1024",
    imageQuality: read(fields.imageQuality) || "auto",
    requestTimeoutMs: Number.isFinite(timeout) && timeout >= 10_000 && timeout <= 600_000 ? timeout : 180_000,
    imageGenerationEnabled: read(fields.imageGenerationEnabled) !== "false",
  };
  return { settings, apiKey: read(GATEWAY_API_KEY_ENV) };
}

export async function publicGatewayConfig(env: Pick<EnvService, "list">, config?: ServerConfig) {
  const { settings, apiKey } = await readGatewaySettings(env);
  const runtime = config ? await readGlobalRuntimeOpencodeConfig(config) : null;
  const ready = config ? Boolean(apiKey) && runtimeGatewayReady(runtime?.provider, settings, config) : undefined;
  return { ...settings, configured: Boolean(apiKey), apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
    ...(ready === undefined ? {} : { ready, ...(!ready && apiKey ? { readinessReason: "模型目录尚未在此客户端同步，请同步目录并保存网关配置。" } : {}) }),
  };
}

export function gatewayErrorMessage(payload: unknown, key: string, fallback: string): string {
  const record = isRecord(payload) ? payload : {};
  const error = isRecord(record.error) ? record.error : record;
  const message = typeof error.message === "string" ? error.message : fallback;
  return (key ? message.replaceAll(key, "[已隐藏密钥]") : message).replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "[已隐藏密钥]").slice(0, 1500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogFingerprint(settings: GatewaySettings, apiKey: string) {
  return createHash("sha256").update(settings.baseURL).update("\0").update(apiKey).digest("hex");
}

function catalogValue(settings: GatewaySettings, apiKey: string, models: GatewayModel[], syncedAt: number) {
  return apiKey ? JSON.stringify({ version: 1, fingerprint: catalogFingerprint(settings, apiKey), models, syncedAt }) : "";
}

async function cachedCatalog(env: Pick<EnvService, "list">, settings: GatewaySettings, apiKey: string) {
  const raw = (await env.list()).find((entry) => entry.key === GATEWAY_MODEL_CATALOG_ENV)?.value;
  if (!raw) return { status: "missing", models: [] };
  if (raw.length > 4 * 1024 * 1024) return { status: "invalid", models: [] };
  try {
    const cache: unknown = JSON.parse(raw);
    if (!isRecord(cache) || cache.version !== 1 || cache.fingerprint !== catalogFingerprint(settings, apiKey)
      || !Array.isArray(cache.models) || cache.models.length > 5000) return { status: "invalid", models: [] };
    const models = parseGatewayModels({ data: cache.models });
    if (models.length !== cache.models.length) return { status: "invalid", models: [] };
    return { status: "valid", models };
  } catch { return { status: "invalid", models: [] }; }
}

function runtimeGatewayReady(providers: unknown, settings: GatewaySettings, config: ServerConfig): boolean {
  const provider = isRecord(providers) ? providers[GATEWAY_PROVIDER_ID] : null;
  if (!isRecord(provider) || provider.npm !== "@ai-sdk/openai-compatible" || !Array.isArray(provider.env) || !provider.env.includes(GATEWAY_PROXY_TOKEN_ENV)) return false;
  const options = isRecord(provider.options) ? provider.options : null;
  return options?.baseURL === gatewayProxyBaseURL(config) && options.gatewayBaseURL === settings.baseURL && isRecord(provider.models) && isRecord(provider.models[settings.chatModel]);
}

async function materializeGatewayProvider(config: ServerConfig, settings: GatewaySettings, models: GatewayModel[] | null) {
  const written = await writeGlobalRuntimeOpencodeConfig(config, (runtime) => {
    if (!models && (!isRecord(runtime.provider) || !(GATEWAY_PROVIDER_ID in runtime.provider))) return runtime;
    const provider = isRecord(runtime.provider) ? { ...runtime.provider } : {};
    if (models) provider[GATEWAY_PROVIDER_ID] = buildGatewayProvider(settings, models, config);
    else delete provider[GATEWAY_PROVIDER_ID];
    return { ...runtime, provider };
  });
  if (written.changed) await writeOpenworkRuntimeConfigFile(config);
  return written.changed;
}

/** Rehydrate a profile before its engines start, using only private local data. */
export async function restoreGatewayProvider(config: ServerConfig, env: Pick<EnvService, "list">) {
  const { settings, apiKey } = await readGatewaySettings(env);
  if (config.readOnly) {
    const runtime = await readGlobalRuntimeOpencodeConfig(config);
    return { changed: false, ready: Boolean(apiKey) && runtimeGatewayReady(runtime.provider, settings, config) };
  }
  const cache = await cachedCatalog(env, settings, apiKey);
  const matching = cache.models.some((model) => model.id === settings.chatModel && model.kind === "chat");
  if (apiKey && cache.status === "valid" && matching) {
    return { changed: await materializeGatewayProvider(config, settings, cache.models), ready: true };
  }
  const current = await readGlobalRuntimeOpencodeConfig(config);
  // Older profiles may already own a correctly routed provider. A catalog
  // with a failed endpoint/key binding is never reused for a changed gateway.
  if (apiKey && cache.status === "missing" && runtimeGatewayReady(current.provider, settings, config)) return { changed: false, ready: true };
  return { changed: await materializeGatewayProvider(config, settings, null), ready: false };
}

/** Explicit directory sync persists the verified catalog and repairs this profile. */
export async function syncGatewayModels(config: ServerConfig, env: EnvService, signal?: AbortSignal) {
  return withConfigurationWriteLock("gateway-configuration", async () => {
    signal?.throwIfAborted();
    const { settings, apiKey } = await readGatewaySettings(env);
    const models = parseGatewayModels(await gatewayRequest(settings, apiKey, "models", {}, signal));
    const syncedAt = Date.now();
    if (config.readOnly) return { models, syncedAt, changed: false };
    await env.upsertMany([{ key: GATEWAY_MODEL_CATALOG_ENV, value: catalogValue(settings, apiKey, models, syncedAt) }]);
    const changed = await materializeGatewayProvider(config, settings, models);
    const auth = await syncManagedProviderAuth({ config, env });
    return { models, syncedAt, changed: changed || auth.delivered.length > 0 || auth.removed.length > 0 };
  });
}

export async function gatewayRequest(settings: GatewaySettings, apiKey: string, path: string, init: RequestInit = {}, signal?: AbortSignal) {
  if (!apiKey) throw new ApiError(400, "gateway_key_missing", "请先在网关设置中保存 API 密钥。");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  let response: Response;
  let payload: unknown;
  try {
    response = await externalFetch(`${settings.baseURL}/${path}`, {
      ...init,
      redirect: "error",
      headers,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(settings.requestTimeoutMs)]) : AbortSignal.timeout(settings.requestTimeoutMs),
    });
    const text = await response.text();
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  } catch (error) {
    if (signal?.aborted) throw new ApiError(499, "gateway_request_cancelled", "网关请求已取消。");
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new ApiError(504, "gateway_request_timeout", "网关请求超时，请稍后重试或调整超时设置。");
    throw new ApiError(502, "gateway_unreachable", "无法连接网关，请检查地址和网络后重试。");
  }
  if (!response.ok) throw new ApiError(response.status, "gateway_request_failed", gatewayErrorMessage(payload, apiKey, "网关请求失败，请检查配置后重试。"));
  return payload;
}

export function parseGatewayModels(payload: unknown): GatewayModel[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new ApiError(502, "gateway_models_invalid", "网关未返回有效的模型目录。");
  const seen = new Set<string>();
  return payload.data.flatMap((entry): GatewayModel[] => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 256 || seen.has(entry.id.trim())) return [];
    const id = entry.id.trim(); seen.add(id);
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id;
    const kind = /image|imagen|dall-e|flux|stable-diffusion/i.test(id) ? "image"
      : /embedding|rerank|video|tts|audio|ocr|whisper/i.test(id) ? "other" : "chat";
    return [{ id, name, kind }];
  });
}

export async function listGatewayModels(env: Pick<EnvService, "list">, signal?: AbortSignal) {
  const { settings, apiKey } = await readGatewaySettings(env);
  const models = parseGatewayModels(await gatewayRequest(settings, apiKey, "models", {}, signal));
  return { models, syncedAt: Date.now() };
}

export function buildGatewayProvider(settings: GatewaySettings, models: GatewayModel[], config: Pick<ServerConfig, "port">) {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "ModelHelm",
    env: [GATEWAY_PROXY_TOKEN_ENV],
    options: { baseURL: gatewayProxyBaseURL(config), gatewayBaseURL: settings.baseURL, timeout: settings.requestTimeoutMs },
    // Model IDs are routing identities: retain their provider namespace verbatim.
    models: Object.fromEntries(models.filter((model) => model.kind === "chat").map((model) => [model.id, {
      name: model.name,
      tool_call: true,
      attachment: false,
      modalities: { input: ["text"], output: ["text"] },
    }])),
  };
}

export function parseGatewayInput(input: Record<string, unknown>, current: GatewaySettings): GatewayConfigInput {
  const result: GatewayConfigInput = { ...current };
  for (const key of ["baseURL", "chatModel", "imageModel", "imageSize", "imageQuality"]) {
    const value = input[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) throw new ApiError(400, "gateway_config_invalid", "网关选项不能为空。");
  }
  if (typeof input.baseURL === "string") result.baseURL = normalizeGatewayBaseURL(input.baseURL);
  if (typeof input.chatModel === "string") result.chatModel = input.chatModel.trim();
  if (typeof input.imageModel === "string") result.imageModel = input.imageModel.trim();
  if (typeof input.imageSize === "string") {
    if (!["auto", "1024x1024", "1536x1024", "1024x1536"].includes(input.imageSize)) throw new ApiError(400, "gateway_image_size_invalid", "请选择支持的图片尺寸。");
    result.imageSize = input.imageSize;
  }
  if (typeof input.imageQuality === "string") {
    if (!["auto", "low", "medium", "high"].includes(input.imageQuality)) throw new ApiError(400, "gateway_image_quality_invalid", "请选择支持的图片质量。");
    result.imageQuality = input.imageQuality;
  }
  if (input.requestTimeoutMs !== undefined) {
    if (typeof input.requestTimeoutMs !== "number" || !Number.isInteger(input.requestTimeoutMs) || input.requestTimeoutMs < 10_000 || input.requestTimeoutMs > 600_000) throw new ApiError(400, "gateway_timeout_invalid", "请求超时须在 10 到 600 秒之间。");
    result.requestTimeoutMs = input.requestTimeoutMs;
  }
  if (input.imageGenerationEnabled !== undefined) {
    if (typeof input.imageGenerationEnabled !== "boolean") throw new ApiError(400, "gateway_config_invalid", "图片生成功能须使用开关设置。");
    result.imageGenerationEnabled = input.imageGenerationEnabled;
  }
  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== "string" || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) throw new ApiError(400, "gateway_key_invalid", "API 密钥格式无效。");
    result.apiKey = input.apiKey.trim();
  }
  return result;
}

export async function saveGatewayConfig(config: ServerConfig, env: EnvService, input: Record<string, unknown>, signal?: AbortSignal) {
  return withConfigurationWriteLock("gateway-configuration", async () => {
    signal?.throwIfAborted();
    const current = await readGatewaySettings(env);
    const parsed = parseGatewayInput(input, current.settings);
    const { apiKey: submittedKey, ...settingsInput } = parsed;
    const settings: GatewaySettings = { ...current.settings, ...settingsInput };
    const apiKey = submittedKey === undefined ? current.apiKey : submittedKey;
    const models = apiKey ? parseGatewayModels(await gatewayRequest(settings, apiKey, "models", {}, signal)) : [];
    if (apiKey && !models.some((model) => model.id === settings.chatModel && model.kind === "chat")) throw new ApiError(400, "gateway_chat_model_missing", "所选对话模型不在网关目录中，请同步模型后重新选择。");
    if (apiKey && settings.imageGenerationEnabled && !models.some((model) => model.id === settings.imageModel && model.kind === "image")) throw new ApiError(400, "gateway_image_model_missing", "所选图片模型不在网关目录中，请同步模型后重新选择。");
    await env.upsertMany([
      ...Object.entries(fields).map(([key, name]) => ({ key: name, value: String(Reflect.get(settings, key)) })),
      // Persist an explicit empty value so clearing a key cannot revive an inherited one.
      { key: GATEWAY_API_KEY_ENV, value: apiKey },
      { key: GATEWAY_MODEL_CATALOG_ENV, value: catalogValue(settings, apiKey, models, Date.now()) },
    ]);
    await writeGlobalRuntimeOpencodeConfig(config, (runtime) => {
      const provider = isRecord(runtime.provider) ? { ...runtime.provider } : {};
      if (apiKey) provider[GATEWAY_PROVIDER_ID] = buildGatewayProvider(settings, models, config);
      else delete provider[GATEWAY_PROVIDER_ID];
      return { ...runtime, provider };
    });
    await writeOpenworkRuntimeConfigFile(config);
    const auth = await syncManagedProviderAuth({ config, env, ...(!apiKey ? { retiredProviderIds: [GATEWAY_PROVIDER_ID] } : {}) });
    return { config: await publicGatewayConfig(env, config), models, auth };
  });
}

export async function testGatewayConnection(env: Pick<EnvService, "list">, model?: string, signal?: AbortSignal) {
  const { settings, apiKey } = await readGatewaySettings(env);
  const started = Date.now();
  const selected = model?.trim() || settings.chatModel;
  const payload = await gatewayRequest(settings, apiKey, "chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: selected, messages: [{ role: "user", content: "Reply exactly GATEWAY_OK." }], max_tokens: 32, stream: false }),
  }, signal);
  const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  const message = isRecord(first) && isRecord(first.message) ? first.message : {};
  if (typeof message.content !== "string" || !message.content.trim()) throw new ApiError(502, "gateway_chat_invalid", "网关没有返回有效的对话结果，请选择其他模型后重试。");
  return { ok: true, model: selected, latencyMs: Date.now() - started, message: message.content.slice(0, 500) };
}
