import { SetupCanList, SetupTechnicalDetails } from "../(den)/_components/setup-frame-parts";
import type { McpRedirectDescription } from "./client-identity-model";

/** Plain sentences for what an OAuth scope string lets an app do. */
export function mcpPermissionLines(scope: string): string[] {
  const scopes = new Set(scope.split(/\s+/).filter(Boolean));
  return [
    ...(scopes.has("openid") || scopes.has("profile") || scopes.has("email") ? ["查看你的姓名与邮箱"] : []),
    ...(scopes.has("mcp:read") ? ["查找并读取工作区内容"] : []),
    ...(scopes.has("mcp:write") ? ["使用已连接工具，包括创建、更改或删除数据的操作"] : []),
    ...(scopes.has("offline_access") ? ["保持连接，直至你移除"] : []),
  ];
}

/** "Claude Code can" and the plain list of what it gets. */
export function McpConsentPermissions({ scope, actor = "此应用" }: { scope: string; actor?: string }) {
  return <SetupCanList actor={actor} items={mcpPermissionLines(scope)} />;
}

/** The raw scope string and app id, behind one collapsed row. */
export function McpTechnicalDetails({ scope, clientId, redirect }: { scope: string; clientId: string | null; redirect?: McpRedirectDescription | null }) {
  return (
    <SetupTechnicalDetails>
      <span>权限： {scope || "未请求"}</span>
      {clientId ? <span>应用 ID： {clientId}</span> : null}
      {redirect ? <span>完整返回地址： <span dir="ltr" data-testid="mcp-redirect-url">{redirect.url}</span></span> : null}
    </SetupTechnicalDetails>
  );
}
