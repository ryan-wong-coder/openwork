import { z } from "zod";
import { HttpError } from "./errors";

export { API_PREFIX as PREFIX } from "./routes";
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Vary": "Cookie, Authorization",
  } });
}
export async function readBody(request: Request, limit = 256 * 1024): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpError(413, "body_too_large", "文件或请求过大。");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new HttpError(413, "body_too_large", "文件或请求过大。"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "json_required", "需要 JSON 请求。");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBody(request))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "invalid_json", "请求格式无效。"); }
}
export function assertMutationOrigin(request: Request, origin: string): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const supplied = request.headers.get("origin");
  if (supplied !== null && supplied !== origin) throw new HttpError(403, "origin_rejected", "请求来源无效。");
  if (request.headers.has("cookie") && supplied !== origin) throw new HttpError(403, "origin_required", "请从本站发起操作。");
}
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ code: error.code, message: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ code: "invalid_input", message: "请检查填写内容。", fields: error.issues.map(issue => issue.path.join(".")) }, 400);
  // Internal SQL, paths, payloads and credentials never become public errors.
  return json({ code: "internal_error", message: "暂时无法完成，请重试。" }, 500);
}

export function createRateLimiter(now: () => number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string, max = 20, windowMs = 60_000) => {
    const at = now();
    if (hits.size > 10_000) for (const [key, value] of hits) if (value.reset <= at) hits.delete(key);
    const previous = hits.get(key);
    const entry = previous && previous.reset > at ? previous : { count: 0, reset: at + windowMs };
    entry.count++; hits.set(key, entry);
    if (entry.count > max) throw new HttpError(429, "rate_limited", "操作过于频繁，请稍后重试。");
  };
}
