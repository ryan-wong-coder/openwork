import { DenRequestTimeoutError, getErrorMessage, requestJson } from "../../_lib/den-flow";
import { ORG_SCOPE_HEADER } from "../../_lib/org-scope";
import { gatewayMemberConnectionsResponseSchema, type GatewayMemberConnectionsResponse } from "@openwork/types/den/inference";

export type GatewayMemberConnection = GatewayMemberConnectionsResponse["connections"][number];

export const gatewayMemberConnectionKey = (row: GatewayMemberConnection) => `${row.providerId}:${row.credentialSetId}`;

export function gatewayMemberAuthorizationCompleted(connection: GatewayMemberConnection, previousRevision: string | null) {
  return !connection.configurationRequired && connection.ready && connection.authorizationRevision !== null && connection.authorizationRevision !== previousRevision;
}

async function memberRequest(path: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 15000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await requestJson(path, { ...init, signal: controller.signal }, timeoutMs);
  } catch (error) {
    if (timedOut) throw new DenRequestTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function loadGatewayMemberConnections(orgId: string, signal?: AbortSignal) {
  const { response, payload } = await memberRequest("/v1/inference-providers/member-connections", {
    headers: { [ORG_SCOPE_HEADER]: orgId },
  }, signal);
  if (!response.ok) throw new Error(getErrorMessage(payload, "模型加载失败，请重试。"));
  const result = gatewayMemberConnectionsResponseSchema.safeParse(payload);
  if (!result.success) throw new Error("模型加载失败，请重试。");
  return result.data.connections;
}

export async function startGatewayMemberConnection(orgId: string, row: GatewayMemberConnection, signal: AbortSignal) {
  if (!row.hasAccess) throw new Error("你已无权访问这些模型，请联系管理员。");
  if (row.configurationRequired) throw new Error("管理员完成配置后，你才能登录。");
  const query = new URLSearchParams({ credentialSetId: row.credentialSetId });
  const { response, payload } = await memberRequest(`/v1/inference-providers/${encodeURIComponent(row.providerId)}/oauth/start?${query}`, {
    headers: { [ORG_SCOPE_HEADER]: orgId, Accept: "application/json" },
  }, signal);
  if (!response.ok) throw new Error(getErrorMessage(payload, "未能开始登录，请重试；若问题持续，请联系管理员。"));
  if (!payload || typeof payload !== "object" || !("authUrl" in payload) || typeof payload.authUrl !== "string") {
    throw new Error("未能开始登录，请重试。");
  }
  const url = new URL(payload.authUrl);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === window.location.origin))) {
    throw new Error("未能开始登录，请重试。");
  }
  return payload.authUrl;
}

export async function disconnectGatewayMemberConnection(orgId: string, row: GatewayMemberConnection, signal: AbortSignal) {
  const query = new URLSearchParams({ credentialSetId: row.credentialSetId });
  const { response, payload } = await memberRequest(`/v1/inference-providers/${encodeURIComponent(row.providerId)}/oauth?${query}`, {
    method: "DELETE", headers: { [ORG_SCOPE_HEADER]: orgId },
  }, signal, 20000);
  if (!response.ok) throw new Error(getErrorMessage(payload, "退出登录未完成，请重试。"));
}
