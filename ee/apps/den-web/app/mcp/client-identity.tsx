"use client";

import { SetupLine, type SetupFact } from "../(den)/_components/setup-frame-parts";
import { describeMcpRedirect, type McpRedirectDescription } from "./client-identity-model";
import { McpAppFact } from "./mcp-story";
import type { McpClient } from "./use-mcp-client";
import { knownMcpCimdDomain, mcpCimdDomain } from "./client-trust-constants";

/** Where the approval is sent, from the signed authorize query. */
export function useMcpRedirect(oauthQuery: string): McpRedirectDescription | null {
  return describeMcpRedirect(oauthQuery ? new URLSearchParams(oauthQuery).get("redirect_uri") : null);
}

/** The App and Returns to rows that lead every consent panel (P9). */
export function mcpIdentityFacts(client: McpClient, redirect: McpRedirectDescription | null): { app: SetupFact; returnsTo: SetupFact } {
  const domain = mcpCimdDomain(client.clientId);
  return {
    app: { label: "应用", value: (
      <span className="flex min-w-0 flex-col items-end gap-1">
        <span className="flex min-w-0 items-center gap-2"><McpAppFact client={client} /></span>
        {domain ? <span dir="ltr" className="break-all whitespace-normal font-mono text-xs" data-testid="mcp-client-domain">{domain}</span> : null}
      </span>
    ) },
    returnsTo: { label: "返回至", value: redirect?.host ?? "未知", mono: true, testId: "mcp-redirect-host" },
  };
}

/** Registration and a signed OAuth request do not verify the app's publisher. */
export function McpUnverifiedAppWarning({ redirect, client }: { redirect: McpRedirectDescription | null; client?: McpClient }) {
  // Wait for the signed-query public-client lookup to succeed before recognizing
  // a domain. Never infer trust from a DCR callback, name, or logo.
  const knownDomain = client?.loaded && client.metadataResolved ? knownMcpCimdDomain(client.clientId) : null;
  if (knownDomain) {
    return (
      <section aria-label="应用身份" className="flex min-w-0 flex-col gap-2" data-testid="mcp-known-app-identity">
        <SetupLine>应用信息提供方 <span className="font-medium" data-testid="mcp-identity-domain">{knownDomain}</span>.</SetupLine>
        <SetupLine>仅当你发起了此连接，并信任应用使用所列权限时授权。</SetupLine>
      </section>
    );
  }
  return (
    <section aria-label="未验证的应用" className="flex min-w-0 flex-col gap-2 border-l-2 border-[var(--dls-text-secondary)] pl-3" data-testid="mcp-unverified-app-warning">
      <SetupLine><strong className="font-semibold">未验证的应用</strong></SetupLine>
      <SetupLine>
        OpenWork 尚未验证访问请求者身份。仅当你发起了此连接，并信任应用使用所列权限代表你操作时授权。
      </SetupLine>
      {redirect ? (
        <div className="flex min-w-0 flex-col gap-1">
          <SetupLine>请检查应用提供的返回主机：</SetupLine>
          <span dir="ltr" className="break-all font-mono text-xs leading-5 text-[var(--dls-text-primary)]" data-testid="mcp-warning-redirect-host">{redirect.host}</span>
        </div>
      ) : (
        <SetupLine>返回地址不可用，请取消并从原应用重新连接。</SetupLine>
      )}
    </section>
  );
}

/**
 * One plain line above the button when the return address needs a second
 * look: a loopback-only redirect (anything on this computer could use the
 * access) or an app that shared no name (name the host to check).
 */
export function McpReturnLine({ client, redirect, short = false }: { client: McpClient; redirect: McpRedirectDescription | null; short?: boolean }) {
  if (!client.loaded) return null;
  if (redirect?.loopbackOnly) {
    return (
      <p className="m-0 text-[13px] leading-5 text-[var(--setup-ink-soft)]" role="status" data-testid="mcp-loopback-warning">
        {short
          ? "此应用将返回你的计算机，仅当你刚刚在此发起登录时继续。"
          : "此应用将返回你的计算机，其中运行的任何程序都可能使用此访问权限。仅当你刚刚在此发起登录时继续。"}
      </p>
    );
  }
  if (!client.name && redirect) {
    return (
      <p className="m-0 text-[13px] leading-5 text-[var(--setup-ink-soft)]" role="status" data-testid="mcp-unnamed-app-line">
        此应用未提供名称，仅在你认识以下应用时继续： {redirect.host} ，且此次登录由你发起。
      </p>
    );
  }
  return null;
}
