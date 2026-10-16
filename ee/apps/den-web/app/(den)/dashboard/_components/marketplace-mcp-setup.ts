import type { ExternalMcpAuthType, ExternalMcpCredentialMode, ExternalMcpPreset } from "./mcp-connections-data";
import type { MarketplacePluginCloudReadinessConnection } from "./marketplace-data";

function normalizeMcpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    return `${url.protocol.toLowerCase()}//${url.host}${pathname}${url.search}`;
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function findPresetForRequirement(presets: ExternalMcpPreset[], connection: MarketplacePluginCloudReadinessConnection): ExternalMcpPreset | null {
  const url = normalizeMcpUrl(connection.url);
  if (!url) return null;
  return presets.find((preset) => normalizeMcpUrl(preset.url) === url) ?? null;
}

export function serviceNameForRequirement(connection: MarketplacePluginCloudReadinessConnection, preset: ExternalMcpPreset | null): string {
  return preset?.displayName ?? titleCase(connection.serverName || connection.name || "MCP 服务器");
}

export function pluginSetupAuthType(preset: ExternalMcpPreset | null): ExternalMcpAuthType {
  return preset?.authType ?? "oauth";
}

export function pluginSetupInitialState(preset: ExternalMcpPreset | null): {
  authAssumed: boolean;
  authType: ExternalMcpAuthType;
  credentialMode: ExternalMcpCredentialMode;
} {
  const authType = pluginSetupAuthType(preset);
  return {
    authAssumed: !preset,
    authType,
    credentialMode: pluginSetupCredentialMode(authType, "per_member"),
  };
}

export function pluginSetupCredentialMode(authType: ExternalMcpAuthType, selectedMode: ExternalMcpCredentialMode): ExternalMcpCredentialMode {
  return authType === "oauth" ? selectedMode : "shared";
}

export function pluginSetupAuthLabel(authType: ExternalMcpAuthType): string {
  switch (authType) {
    case "oauth":
      return "OAuth";
    case "apikey":
      return "API密钥";
    case "none":
      return "无需身份验证";
  }
}

export function pluginSetupRequest(input: {
  apiKey: string;
  authType: ExternalMcpAuthType;
  credentialMode: ExternalMcpCredentialMode;
  oauthClient?: { clientId: string; clientSecret?: string };
}): {
  apiKey?: string;
  authType: ExternalMcpAuthType;
  credentialMode: ExternalMcpCredentialMode;
  oauthClient?: { clientId: string; clientSecret?: string };
} {
  return {
    authType: input.authType,
    credentialMode: pluginSetupCredentialMode(input.authType, input.credentialMode),
    ...(input.authType === "apikey" ? { apiKey: input.apiKey } : {}),
    ...(input.authType === "oauth" && input.oauthClient ? { oauthClient: input.oauthClient } : {}),
  };
}

export function pluginSetupSuccessCopy(input: {
  authType: ExternalMcpAuthType;
  credentialMode: ExternalMcpCredentialMode;
  pluginName: string;
  serviceName: string;
}): { body: string; linkLabel: string | null } {
  if (input.authType === "oauth" && input.credentialMode === "per_member") {
    return {
      body: `${input.serviceName} 已为 ${input.pluginName} 就绪，请选择“连接”以授权账户。`,
      linkLabel: null,
    };
  }
  if (input.authType === "oauth") {
    return {
      body: `${input.serviceName} 已为 ${input.pluginName} 就绪，请选择“连接”以授权组织账户。`,
      linkLabel: null,
    };
  }
  return {
    body: `${input.serviceName} 已为 ${input.pluginName} 就绪，无需用户登录。`,
    linkLabel: null,
  };
}

export type PluginReadinessConnectionAction = {
  connectionId: string;
  label: string;
  note: string;
  type: "connect_member" | "connect_org";
};

export function pluginReadinessConnectionAction(
  connection: MarketplacePluginCloudReadinessConnection,
  canManageConnections: boolean,
): PluginReadinessConnectionAction | null {
  if (connection.id && connection.credentialMode === "per_member" && connection.connectedForMe === false) {
    return {
      connectionId: connection.id,
      label: "连接",
      note: "无需离开此页面即可授权账户。",
      type: "connect_member",
    };
  }
  if (canManageConnections && connection.id && connection.credentialMode === "shared" && connection.connectedForMe === false) {
    return {
      connectionId: connection.id,
      label: "连接",
      note: "无需离开此页面即可授权一个组织账户。",
      type: "connect_org",
    };
  }
  return null;
}

export function pluginRequirementNeedsAdminSetup(connection: MarketplacePluginCloudReadinessConnection): boolean {
  if (connection.id === null) return true;
  if (connection.authTypeMismatch === true) return true;
  if (connection.oauthClientRequired === true && connection.oauthClientConfigured === false) return true;
  return connection.connectedForMe === false && (connection.authType === "apikey" || connection.authType === "none");
}

export function pluginSetupActionLabel(preset: ExternalMcpPreset | null): string {
  return preset ? "快速连接" : "配置连接";
}
