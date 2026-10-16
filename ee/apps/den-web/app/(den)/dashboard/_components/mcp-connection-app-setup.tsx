"use client";

import { useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { isNativeProviderConnectionId, type ExternalMcpConnection } from "./mcp-connections-data";

export function connectionMcpSetupUrl(publicApiUrl: string, connectionId: string): string | null {
  if (!publicApiUrl.trim() || !connectionId.trim()) return null;
  try {
    const url = new URL(publicApiUrl.trim());
    if (url.protocol !== "https:"
      || url.username || url.password || url.search || url.hash
      || /\/api\/den(?:\/|$)/.test(url.pathname)) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/mcp/agent/connections/${encodeURIComponent(connectionId)}`;
    return url.toString();
  } catch {
    return null;
  }
}

export function McpConnectionAppSetup({ connection, publicApiUrl, enabled, className = "", label = "在其他应用中使用" }: {
  connection: Pick<ExternalMcpConnection, "id" | "exposeDirectly" | "nativeProviderKey">;
  publicApiUrl: string;
  enabled: boolean;
  className?: string;
  label?: string;
}) {
  const [copyResult, setCopyResult] = useState<{ url: string; status: "copying" | "copied" | "error" } | null>(null);
  const url = connectionMcpSetupUrl(publicApiUrl, connection.id);
  const status = copyResult?.url === url ? copyResult?.status : undefined;

  if (!enabled || !connection.exposeDirectly || isNativeProviderConnectionId(connection.id, connection.nativeProviderKey)) return null;

  async function copyUrl() {
    if (!url) return;
    setCopyResult({ url, status: "copying" });
    try {
      await navigator.clipboard.writeText(url);
      setCopyResult({ url, status: "copied" });
    } catch {
      setCopyResult({ url, status: "error" });
    }
  }

  return (
    <details className={`rounded-xl border border-gray-100 bg-gray-50 p-3 ${className}`}>
      <summary className="cursor-pointer text-[12px] font-medium text-gray-700">{label}</summary>
      <div className="mt-3 space-y-2 text-[12px] leading-5 text-gray-600">
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
          <p className="min-w-0 flex-1 break-all font-mono text-[11px] text-gray-800">
            {url || "公开 MCP 地址不可用，请重新加载页面。"}
          </p>
          <DenButton type="button" variant="secondary" size="sm" disabled={!url || status === "copying"} onClick={() => void copyUrl()}>
            {status === "copied" ? "已复制" : "复制"}
          </DenButton>
        </div>
        {status === "copied" ? <p role="status">MCP 地址已复制。</p> : null}
        {status === "error" ? <p role="alert" className="text-red-600">无法复制地址，请选中后手动复制。</p> : null}
        {url ? (
          <>
            <ol className="list-decimal space-y-1 pl-4">
              <li>在应用中添加远程 HTTP MCP 服务器。</li>
              <li>粘贴此 MCP 地址。</li>
              <li>选择 OAuth 并登录 OpenWork 组织。</li>
            </ol>
            <p>你可能仍需在 OpenWork 中连接提供商账户，现有访问授权与工具策略继续适用。</p>
          </>
        ) : null}
      </div>
    </details>
  );
}
