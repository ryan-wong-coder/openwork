import type { ExternalMcpAuthType, ExternalMcpCredentialMode } from "./mcp-connections-data";

export const MEMBER_API_KEY_MAX_LENGTH = 8192;
export const MEMBER_API_KEY_GRANT_HELP = "你暂时无法为此连接添加密钥，请联系管理员直接授权、通过团队授权或向所有人授权。";
export const MEMBER_API_KEY_UNCERTAIN_MESSAGE = "OpenWork 无法确认密钥是否已保存。重试可能替换已保存的密钥，请先检查连接状态。";

type MemberApiKeyConnection = {
  authType: ExternalMcpAuthType;
  credentialMode: ExternalMcpCredentialMode;
};

type PersonalApiKeyConnection = MemberApiKeyConnection & {
  connectedForMe: boolean;
  needsReconnect?: boolean;
  credentialHealth?: "unknown" | "ready" | "reconnect_required";
};

export type PersonalApiKeyStatus = "missing" | "saved_unverified" | "ready" | "reconnect_required";

export function usesMemberApiKey(connection: MemberApiKeyConnection): boolean {
  return connection.authType === "apikey" && connection.credentialMode === "per_member";
}

/** A stored personal key is not ready until an upstream request validates it. */
export function personalApiKeyStatus(connection: PersonalApiKeyConnection): PersonalApiKeyStatus | null {
  if (!usesMemberApiKey(connection)) return null;
  if (connection.needsReconnect === true || connection.credentialHealth === "reconnect_required") return "reconnect_required";
  if (!connection.connectedForMe) return "missing";
  return connection.credentialHealth === "ready" ? "ready" : "saved_unverified";
}

export function personalApiKeyStatusLabel(status: PersonalApiKeyStatus): string {
  if (status === "missing") return "无密钥";
  if (status === "saved_unverified") return "密钥已保存";
  if (status === "ready") return "密钥已保存";
  return "密钥被拒绝";
}

export function credentialModeForAuth(
  authType: ExternalMcpAuthType,
  selectedMode: ExternalMcpCredentialMode,
): ExternalMcpCredentialMode {
  return authType === "none" ? "shared" : selectedMode;
}

/** Member keys are opaque printable ASCII. Never trim or otherwise rewrite them. */
export function validateMemberApiKey(apiKey: string): string | null {
  if (!apiKey) return "请粘贴密钥。";
  if (apiKey.length > MEMBER_API_KEY_MAX_LENGTH) return "密钥过长。";
  if (!/^[\x21-\x7e]+$/.test(apiKey)) {
    return "请使用原始密钥，不要包含空格或控制字符。";
  }
  return null;
}

export function memberApiKeyFailureMessage(status?: number): string {
  if (status === 400) return "此密钥不被接受，请粘贴原始密钥后重试。";
  if (status === 403) return MEMBER_API_KEY_GRANT_HELP;
  if (status === 404) return "此连接已不可用，请重新加载页面。";
  if (status === 409) return "此连接已更改，请重新加载页面后重试。";
  return MEMBER_API_KEY_UNCERTAIN_MESSAGE;
}
