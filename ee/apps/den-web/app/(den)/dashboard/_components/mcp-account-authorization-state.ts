export const MCP_AUTHORIZATION_WINDOW_CLOSED_MESSAGE =
  "OpenWork 确认连接前，登录标签页已关闭，请检查提供商错误后重试。";

export const MCP_AUTHORIZATION_TIMEOUT_MESSAGE =
  "OpenWork 无法确认连接，请检查此标签页中的提供商错误后重试。";

export const MCP_AUTHORIZATION_UNCONFIRMED_CONNECTED_MESSAGE =
  "提供商已响应，但 OpenWork 无法确认账户连接，请检查提供商配置后重试。";

export type McpAuthorizationPollOutcome = "connected" | "window_closed" | "timeout" | "pending";

export function resolveMcpAuthorizationPollOutcome(input: {
  connected: boolean;
  authorizationWindowClosed: boolean;
  elapsedMs: number;
  timeoutMs: number;
}): McpAuthorizationPollOutcome {
  if (input.connected) return "connected";
  if (input.authorizationWindowClosed) return "window_closed";
  if (input.elapsedMs >= input.timeoutMs) return "timeout";
  return "pending";
}
