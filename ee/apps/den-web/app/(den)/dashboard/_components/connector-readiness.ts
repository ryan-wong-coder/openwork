import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";
import type { ExternalMcpConnection } from "./mcp-connections-data";

export function connectorReadinessState(connection: ExternalMcpConnection) {
  if (connection.readiness === undefined) return null;
  if (connection.setupRequired || connection.authTypeMismatch || connection.issuerReviewRequired
    || (connection.credentialMode === "shared" && !connection.connected)) return "设置";
  if (connection.needsReconnect || (connection.credentialMode === "per_member" && !connection.connectedForMe)) return "登录";
  return connection.readiness?.status === "ready" ? "已就绪" : "无法验证";
}

export function connectorReadinessNote(connection: ExternalMcpConnection) {
  const state = connectorReadinessState(connection);
  if (state === "已就绪" && connection.readiness) {
    return `检查于 ${new Date(connection.readiness.checkedAt).toLocaleString(DEFAULT_DEN_LOCALE, { dateStyle: "short", timeStyle: "short" })}`;
  }
  if (state === "无法验证") {
    const reason = connection.readiness?.reason ?? "尚未检查。";
    const lastReady = connection.readiness?.lastSuccessfulAt;
    return lastReady ? `${reason} 上次就绪时间：${new Date(lastReady).toLocaleString(DEFAULT_DEN_LOCALE, { dateStyle: "short", timeStyle: "short" })}。` : reason;
  }
  return undefined;
}
