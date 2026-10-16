import { localizeDenError } from "../../_lib/error-copy";
import { denStatusLabel, DEFAULT_DEN_LOCALE } from "../../_lib/locale";
import { workflowRunPreviewSchema, type WorkflowRunPreview } from "@openwork/types/workflows";
import { denApiCredentials, denBrowserEndpoint } from "./den-api-origin";
import { getAuthResumeUrl } from "./auth-resume";
import { ORG_SCOPE_HEADER, getRequestOrgScope, shouldPinOrgScopePath } from "./org-scope";
import { getRuntimeConfig } from "./runtime-config";
import { getSafeMemberReturnTo } from "./member-auth-routing";

export type AuthMode = "sign-in" | "sign-up";
export type SocialAuthProvider = "github" | "google";

export type OrgLimitError = {
  error: "org_limit_reached";
  message: string;
  limitType: "members" | "workers";
  currentCount: number;
  limit: number;
};

export type OrgPaymentRequiredError = {
  error: "payment_required";
  reason: "seat_subscription_required";
  subscriptionType: "seat";
  message: string;
  currentCount: number;
  freeSeatCount: number;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  authProviders: string[];
};

export class ReauthRequiredError extends Error {
  readonly error = "reauth";
  readonly reason: string | null;

  constructor(message: string, reason: string | null) {
    super(message);
    this.name = "ReauthRequiredError";
    this.reason = reason;
  }
}

function formatDeadlineDuration(timeoutMs: number): string {
  if (timeoutMs < 1000) return `${timeoutMs} 毫秒`;
  const seconds = timeoutMs / 1000;
  return Number.isInteger(seconds) ? `${seconds} 秒` : `${seconds.toFixed(1)} 秒`;
}

export class DenRequestTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly outcome: "unknown" = "unknown";

  constructor(timeoutMs: number, cause?: unknown) {
    super(
      `等待 ${formatDeadlineDuration(timeoutMs)} 后 OpenWork 已停止等待，操作结果未知。`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "DenRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class DenRequestCanceledError extends Error {
  readonly outcome: "unknown" = "unknown";

  constructor(cause?: unknown) {
    super(
      "控制台收到结果前，请求已取消，操作结果未知。",
      cause === undefined ? undefined : { cause },
    );
    this.name = "DenRequestCanceledError";
  }
}

export type WorkflowRun = {
  id: string;
  workflow: WorkflowRunPreview | null;
  source: string;
  status: "succeeded" | "failed";
  errorKind: string | null;
  errorMessage: string | null;
  toolCallCount: number;
  toolCalls: Array<{ name: string }>;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  orgMembershipId: string | null;
};


type PosthogClient = {
  capture?: (eventName: string, properties?: Record<string, unknown>) => void;
  identify?: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset?: () => void;
};

declare global {
  interface Window {
    posthog?: PosthogClient;
  }
}

export const PENDING_SOCIAL_SIGNUP_STORAGE_KEY = "openwork:web:pending-social-signup";
export const AUTH_TOKEN_STORAGE_KEY = "openwork:web:auth-token";
export const PENDING_AUTH_INTENT_STORAGE_KEY = "openwork:web:pending-auth-intent";
export const DEFAULT_AUTH_NAME = "OpenWork 用户";
export const WORKSPACE_REAUTH_SECURITY_MESSAGE = "为保护账户安全，请先确认身份，再更改工作区设置。";

export type AuthIntent = "models";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getAuthInfoForMode(mode: AuthMode): string {
  return mode === "sign-up"
    ? "创建账户以开始使用 OpenWork。"
    : "登录后继续使用 OpenWork。";
}

export function getEmailDomain(email: string): string {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1 || atIndex + 1 >= email.length) {
    return "unknown";
  }
  return email.slice(atIndex + 1).toLowerCase();
}

export function trackPosthogEvent(eventName: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.posthog?.capture?.(eventName, properties);
  } catch {
    // Ignore analytics delivery failures.
  }
}

export function identifyPosthogUser(user: AuthUser) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.posthog?.identify?.(user.id, {
      email: user.email,
      name: user.name ?? undefined
    });
  } catch {
    // Ignore analytics delivery failures.
  }
}

export function resetPosthogUser() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.posthog?.reset?.();
  } catch {
    // Ignore analytics delivery failures.
  }
}

export function normalizeAuthModeParam(value: string | null | undefined): AuthMode | null {
  return value === "sign-in" || value === "sign-up" ? value : null;
}

export function normalizeAuthIntentParam(value: string | null | undefined): AuthIntent | null {
  return value === "models" ? value : null;
}

export function getSocialProviderLabel(provider: SocialAuthProvider): string {
  return provider === "github" ? "GitHub" : "Google";
}

export function getSocialCallbackUrl(authCallbackBaseUrl = "", requestedReturnTo?: string | null): string {
  try {
    const origin = authCallbackBaseUrl || (typeof window !== "undefined" ? window.location.origin : "");
    if (!origin) {
      return "/";
    }
    if (typeof window !== "undefined") {
      const resumeUrl = getAuthResumeUrl(window.location, origin);
      if (resumeUrl) {
        return resumeUrl;
      }
    }
    const callbackUrl = new URL("/", origin);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      for (const key of ["mode", "desktopAuth", "desktopScheme", "webAuth", "webAuthReturn", "invite", "intent"]) {
        const value = params.get(key)?.trim() ?? "";
        if (value) {
          callbackUrl.searchParams.set(key, value);
        }
      }
      const returnTo = getSafeMemberReturnTo(requestedReturnTo === undefined ? params.get("returnTo") : requestedReturnTo);
      if (returnTo) {
        callbackUrl.searchParams.set("returnTo", returnTo);
      }
    }
    return callbackUrl.toString();
  } catch {
    if (authCallbackBaseUrl) {
      try {
        return new URL("/", authCallbackBaseUrl).toString();
      } catch {
        // Fall through to the hosted default when the configured URL is invalid.
      }
    }
    return typeof window !== "undefined" ? `${window.location.origin}/` : "/";
  }
}

export function formatMoneyMinor(amount: number | null, currency: string | null): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return "不可用";
  }

  const normalizedCurrency = (currency ?? "USD").toUpperCase();
  const majorValue = amount / 100;

  try {
    return new Intl.NumberFormat(DEFAULT_DEN_LOCALE, {
      style: "currency",
      currency: normalizedCurrency
    }).format(majorValue);
  } catch {
    return `${majorValue.toFixed(2)} ${normalizedCurrency}`;
  }
}

export function formatSubscriptionStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (!normalized) {
    return "未知";
  }

  return denStatusLabel(normalized);
}

export function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    const trimmed = payload.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("<!doctype") || lower.startsWith("<html") || lower.includes("<body")) {
      return `${fallback} 上游服务返回了 HTML 错误页面。`;
    }
    if (trimmed.length > 240) {
      return `${fallback} 上游服务返回了无法识别的错误信息。`;
    }
    return localizeDenError(trimmed);
  }

  if (!isRecord(payload)) {
    return fallback;
  }

  const message = payload.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return localizeDenError(message);
  }

  const error = payload.error;
  if (typeof error === "string" && error.trim().length > 0) {
    return localizeDenError(error);
  }

  return fallback;
}

export function getOrgLimitError(payload: unknown): OrgLimitError | null {
  if (!isRecord(payload) || payload.error !== "org_limit_reached") {
    return null;
  }

  if (
    (payload.limitType !== "members" && payload.limitType !== "workers") ||
    typeof payload.message !== "string" ||
    typeof payload.currentCount !== "number" ||
    typeof payload.limit !== "number"
  ) {
    return null;
  }

  return {
    error: "org_limit_reached",
    message: payload.message,
    limitType: payload.limitType,
    currentCount: payload.currentCount,
    limit: payload.limit,
  };
}

export function getOrgPaymentRequiredError(payload: unknown): OrgPaymentRequiredError | null {
  if (!isRecord(payload) || payload.error !== "payment_required") {
    return null;
  }

  if (
    payload.reason !== "seat_subscription_required" ||
    payload.subscriptionType !== "seat" ||
    typeof payload.message !== "string" ||
    typeof payload.currentCount !== "number" ||
    typeof payload.freeSeatCount !== "number"
  ) {
    return null;
  }

  return {
    error: "payment_required",
    reason: "seat_subscription_required",
    subscriptionType: "seat",
    message: payload.message,
    currentCount: payload.currentCount,
    freeSeatCount: payload.freeSeatCount,
  };
}

export function getReauthRequiredError(payload: unknown, response: Response): ReauthRequiredError | null {
  if (response.status !== 403 || !isRecord(payload) || payload.error !== "reauth") {
    return null;
  }

  return new ReauthRequiredError(
    getErrorMessage(payload, WORKSPACE_REAUTH_SECURITY_MESSAGE),
    typeof payload.reason === "string" ? payload.reason : null,
  );
}

export function getRequestError(payload: unknown, response: Response, fallback: string) {
  return getReauthRequiredError(payload, response) ?? new Error(getErrorMessage(payload, fallback));
}

export function isReauthRequiredError(error: unknown): error is ReauthRequiredError {
  return error instanceof ReauthRequiredError;
}

export function getUser(payload: unknown): AuthUser | null {
  if (!isRecord(payload) || !isRecord(payload.user)) {
    return null;
  }

  const user = payload.user;
  if (typeof user.id !== "string" || typeof user.email !== "string") {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: typeof user.name === "string" ? user.name : null,
    authProviders: Array.isArray(user.authProviders)
      ? user.authProviders.filter((provider): provider is string => typeof provider === "string")
      : []
  };
}

export function getToken(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  return typeof payload.token === "string" ? payload.token : null;
}

function parseWorkflowRun(value: unknown): WorkflowRun | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.source !== "string"
    || (value.status !== "succeeded" && value.status !== "failed")
    || typeof value.toolCallCount !== "number"
    || typeof value.durationMs !== "number"
    || typeof value.startedAt !== "string"
    || typeof value.finishedAt !== "string"
    || typeof value.createdAt !== "string"
  ) {
    return null;
  }

  const toolCalls = Array.isArray(value.toolCalls)
    ? value.toolCalls.flatMap((call) =>
        isRecord(call) && typeof call.name === "string" ? [{ name: call.name }] : [],
      )
    : [];
  const workflow = workflowRunPreviewSchema.safeParse(value.workflow);

  return {
    id: value.id,
    workflow: workflow.success ? workflow.data : null,
    source: value.source,
    status: value.status,
    errorKind: typeof value.errorKind === "string" ? value.errorKind : null,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
    toolCallCount: value.toolCallCount,
    toolCalls,
    durationMs: value.durationMs,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    createdAt: value.createdAt,
    orgMembershipId: typeof value.orgMembershipId === "string" ? value.orgMembershipId : null,
  };
}

export function getWorkflowRuns(payload: unknown): WorkflowRun[] {
  if (!isRecord(payload) || !Array.isArray(payload.runs)) {
    return [];
  }
  return payload.runs.flatMap((run) => {
    const parsed = parseWorkflowRun(run);
    return parsed ? [parsed] : [];
  });
}

export async function requestJson(path: string, init: RequestInit = {}, timeoutMs = 30000) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!headers.has("Authorization") && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
    const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim() ?? "";
    if (token) headers.set("Authorization", "Bearer " + token);
  }

  const orgScope = getRequestOrgScope();
  if (orgScope && !headers.has(ORG_SCOPE_HEADER) && shouldPinOrgScopePath(path)) {
    headers.set(ORG_SCOPE_HEADER, orgScope);
  }

  const shouldAttachTimeout = !init.signal && timeoutMs > 0;
  const timeoutController = shouldAttachTimeout ? new AbortController() : null;
  let didReachDashboardDeadline = false;
  const timeoutHandle = timeoutController
    ? setTimeout(() => {
        didReachDashboardDeadline = true;
        timeoutController.abort();
      }, timeoutMs)
    : null;

  let response: Response;
  try {
    if (typeof window !== "undefined") {
      await getRuntimeConfig();
    }
    const endpoint = path.startsWith("/api/auth/") ? path : denBrowserEndpoint(path);
    response = await fetch(endpoint, {
      ...init,
      headers,
      credentials: init.credentials ?? denApiCredentials(endpoint, path),
      signal: init.signal ?? timeoutController?.signal
    });
    if (path === "/v1/me" && response.status === 401 && typeof window !== "undefined") {
      await fetch("/api/auth/clear-session-cookie", {
        method: "POST",
        credentials: "include"
      }).catch(() => null);
    }
  } catch (error) {
    // Only the deadline created by this helper becomes a timeout. An abort
    // supplied by a caller becomes a distinct cancellation error.
    if (didReachDashboardDeadline) {
      throw new DenRequestTimeoutError(timeoutMs, error);
    }
    if (init.signal?.aborted && error instanceof Error && error.name === "AbortError") {
      throw new DenRequestCanceledError(error);
    }
    throw error;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  const reauthError = getReauthRequiredError(payload, response);
  if (reauthError) {
    throw reauthError;
  }

  return { response, payload, text };
}
