import { getMcpConnectionRoute } from "../../_lib/den-org";
import type { ExternalMcpConnection } from "./mcp-connections-data";

/** An org sign-in nobody has finished, or a server still waiting on admin setup. */
export function connectorSetupUnfinished(connection: Pick<ExternalMcpConnection, "setupRequired" | "credentialMode" | "authType" | "connected">): boolean {
  if (connection.setupRequired) return true;
  return connection.credentialMode === "shared" && connection.authType !== "none" && !connection.connected;
}

/** Where Finish goes: the connector page, where an admin signs in or adds the key or OAuth app it still needs. */
export function finishSetupHref(orgSlug: string | null, connection: Pick<ExternalMcpConnection, "id">): string {
  return getMcpConnectionRoute(orgSlug, connection.id);
}

export function signInSentence(connection: Pick<ExternalMcpConnection, "name" | "authType" | "credentialMode">): string {
  if (connection.authType === "none") return "无需登录";
  if (connection.authType === "apikey") return connection.credentialMode === "per_member"
    ? "每人添加自己的密钥"
    : "所有人使用组织密钥";
  return connection.credentialMode === "per_member"
    ? `每个人使用自己的 ${connection.name} 账户登录`
    : `所有人共用一个 ${connection.name} 账户`;
}
