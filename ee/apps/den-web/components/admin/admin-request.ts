import { localizeDenError } from "../../app/_lib/error-copy";
import { denApiCredentials, denBrowserEndpoint } from "../../app/(den)/_lib/den-api-origin";

const AUTH_TOKEN_STORAGE_KEY = "openwork:web:auth-token";

/**
 * Keeps password-login bearer credentials alongside the web-host session
 * cookie; the same-origin browser proxy forwards both to Den API.
 */
export function withStoredBearer(headers: Record<string, string>): Record<string, string> {
  if (typeof window === "undefined") return headers;
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim();
    return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
  } catch {
    // Cookie sign-in still works when browser storage is unavailable.
    return headers;
  }
}

export type AdminAccess = "ready" | "signed-out" | "forbidden" | "error";

export type AdminResult<T> =
  | { access: "ready"; data: T }
  | { access: Exclude<AdminAccess, "ready">; message: string };

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const message = "message" in payload ? payload.message : undefined;
    const error = "error" in payload ? payload.error : undefined;
    if (typeof message === "string" && message) return localizeDenError(message);
    if (typeof error === "string" && error) return localizeDenError(error);
  }
  return fallback;
}

/** GET an admin endpoint and map the response to the access states every admin page shows. */
export async function requestAdmin<T>(path: string, parse: (payload: unknown) => T | null, signal?: AbortSignal): Promise<AdminResult<T>> {
  const endpoint = denBrowserEndpoint(path);
  const response = await fetch(endpoint, {
    method: "GET",
    credentials: denApiCredentials(endpoint),
    signal,
    headers: withStoredBearer({ Accept: "application/json" }),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (response.status === 401) return { access: "signed-out", message: "请使用 OpenWork 管理员账户登录后继续。" };
  if (response.status === 403) return { access: "forbidden", message: "此账户不在 OpenWork 管理员允许名单中。" };
  if (!response.ok) return { access: "error", message: errorMessage(payload, `请求失败（HTTP ${response.status}），请重试。`) };
  const data = parse(payload);
  return data === null ? { access: "error", message: "服务器返回的数据无法识别，请刷新后重试。" } : { access: "ready", data };
}

/** PUT/POST JSON to an admin endpoint; returns the parsed payload or the server's error message. */
export async function sendAdmin(path: string, method: "PUT" | "POST", body: unknown): Promise<{ ok: true; payload: unknown } | { ok: false; message: string }> {
  const endpoint = denBrowserEndpoint(path);
  const response = await fetch(endpoint, {
    method,
    credentials: denApiCredentials(endpoint),
    headers: withStoredBearer({ Accept: "application/json", "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) return { ok: false, message: errorMessage(payload, `请求失败（HTTP ${response.status}），请重试。`) };
  return { ok: true, payload };
}
