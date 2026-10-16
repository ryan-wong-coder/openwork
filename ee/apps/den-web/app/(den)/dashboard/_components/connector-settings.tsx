"use client";

import { Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { DenSelect } from "../../_components/ui/select";
import { DenInput } from "../../_components/ui/input";
import { ApiKeySchemeAdvanced } from "./connector-setup-fields";
import { ConfirmDialog } from "./item-list";
import { credentialModeForAuth } from "./member-api-key";
import { McpCredentialInput } from "./mcp-credential-input";
import { apiKeyAuthSchemeInput, type ExternalMcpApiKeyAuthScheme, type ExternalMcpAuthType, type ExternalMcpCredentialMode, type ExternalMcpConnection, type McpIssuerReview, type UpdateMcpConnectionInput, useReviewMcpIssuer, useUpdateMcpConnection } from "./mcp-connections-data";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

/** Rename a connector, move its address, rotate its key, or replace its OAuth app, in place on its page. */
/** `lockedReason` shows the settings read-only with why (DESIGN.md P4), e.g. the caller can't edit this connection. */
export function ConnectorSettingsForm({ connection, onSaved, lockedReason = null }: { connection: ExternalMcpConnection; onSaved: (message: string) => void; lockedReason?: string | null }) {
  const updateConnection = useUpdateMcpConnection();
  const [name, setName] = useState(connection.name);
  const [url, setUrl] = useState(connection.url);
  const [authType, setAuthType] = useState<ExternalMcpAuthType>(connection.authType);
  const [credentialMode, setCredentialMode] = useState<ExternalMcpCredentialMode>(connection.credentialMode);
  const [apiKeyAuthScheme, setApiKeyAuthScheme] = useState<ExternalMcpApiKeyAuthScheme>(connection.apiKeyAuthScheme);
  const [showOAuthApp, setShowOAuthApp] = useState(Boolean(connection.oauthClientId) || connection.oauthClientRequired === true);
  const [scopes, setScopes] = useState((connection.requestedScopes ?? []).join(" "));
  const [exposeDirectly, setExposeDirectly] = useState(connection.exposeDirectly);
  const [apiKey, setApiKey] = useState("");
  const [clientId, setClientId] = useState(connection.oauthClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managedByPlugin = connection.identityManagedBy.length > 0;
  const usesKey = authType === "apikey";
  const usesOAuthApp = authType === "oauth" && showOAuthApp;
  const chosenMode = credentialModeForAuth(authType, credentialMode);
  const usesSharedKey = usesKey && chosenMode === "shared";
  const usesPersonalKey = usesKey && chosenMode === "per_member";
  const normalizedApiKey = apiKey.trim();
  const identityChanged = url.trim() !== connection.url
    || authType !== connection.authType
    || chosenMode !== connection.credentialMode
    || (usesKey && apiKeyAuthScheme !== connection.apiKeyAuthScheme);
  const requestedScopes = [...new Set(scopes.split(/[\s,]+/).filter(Boolean))];
  const scopesChanged = requestedScopes.join(" ") !== (connection.requestedScopes ?? []).join(" ");
  const clientChanged = usesOAuthApp && (clientId.trim() !== (connection.oauthClientId ?? "") || Boolean(clientSecret.trim()));
  const changed = name.trim() !== connection.name || identityChanged || Boolean(usesSharedKey && normalizedApiKey) || clientChanged || scopesChanged || exposeDirectly !== connection.exposeDirectly;
  const keyRequired = usesSharedKey && identityChanged && !normalizedApiKey;
  const disabled = !changed || !name.trim() || !url.trim() || keyRequired || (clientChanged && !clientId.trim()) || !connection.updatedAt;

  async function save() {
    if (!connection.updatedAt) return;
    setError(null);
    const input: UpdateMcpConnectionInput = {
      connectionId: connection.id,
      expectedUpdatedAt: connection.updatedAt,
      name: name.trim(),
      url: url.trim(),
      authType,
      credentialMode: chosenMode,
      exposeDirectly,
      ...(authType === "oauth" && !managedByPlugin ? { requestedScopes } : {}),
      ...(!managedByPlugin ? apiKeyAuthSchemeInput(authType, apiKeyAuthScheme) : {}),
      ...(usesSharedKey && !managedByPlugin && normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
      ...(clientChanged && clientId.trim()
        ? { oauthClient: { clientId: clientId.trim(), ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}) } }
        : {}),
      access: connection.access ?? { orgWide: false, memberIds: [], teamIds: [] },
    };
    try {
      const updated = await updateConnection.mutateAsync(input);
      setApiKey("");
      setClientSecret("");
      onSaved(usesPersonalKey
        ? `${updated.name} 已就绪，现在每个人都可以在“我的资源库”中添加自己的密钥。`
        : updated.reconnectionRequired ? `${updated.name} 已保存，请重新登录以使用。` : `${updated.name} 已保存。`);
    } catch (cause) {
      setError(usesPersonalKey
        ? "连接保存失败，请检查设置后重试。"
        : cause instanceof Error ? cause.message : "保存失败，请重试。");
    }
  }

  return (
    <>
    <form
      className="flex flex-col gap-3 px-5 py-4"
      data-testid="connector-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (identityChanged) setConfirming(true);
        else void save();
      }}
    >
      <fieldset disabled={lockedReason !== null} className="flex min-w-0 flex-col gap-3">
      <Field label="名称">
        <DenInput value={name} onChange={(event) => setName(event.target.value)} data-testid="connector-settings-name" />
      </Field>
      <Field label="地址">
        <DenInput value={url} onChange={(event) => setUrl(event.target.value)} disabled={managedByPlugin} data-testid="connector-settings-url" />
      </Field>
      {managedByPlugin ? <p className="text-[12px] text-gray-500">服务器与登录设置由插件所有者管理。</p> : null}
      <Field label="登录方式">
        <DenSelect value={authType} disabled={managedByPlugin} onChange={(event) => {
          const value = event.target.value;
          if (value === "oauth" || value === "apikey" || value === "none") setAuthType(value);
        }}>
          <option value="oauth">使用账户登录</option>
          <option value="apikey">API密钥</option>
          <option value="none">无需登录</option>
        </DenSelect>
      </Field>
      <Field label="成员登录方式">
        <DenSelect value={chosenMode} disabled={managedByPlugin || authType === "none"} onChange={(event) => {
          const value = event.target.value;
          if (value === "per_member" || value === "shared") setCredentialMode(value);
        }}>
          <option value="per_member">{usesKey ? "每人添加自己的密钥" : "每人分别登录"}</option>
          <option value="shared">{usesKey ? "所有人共用一个密钥" : "所有人共用一个账户"}</option>
        </DenSelect>
      </Field>
      {authType === "none" ? <p className="text-[12px] text-gray-500">此连接为共享连接，无需个人登录。</p> : null}
      {usesKey ? (
        <ApiKeySchemeAdvanced value={apiKeyAuthScheme} onChange={setApiKeyAuthScheme} disabled={managedByPlugin} testId="connector-settings-api-key-auth-scheme" />
      ) : null}
      {authType === "oauth" && !showOAuthApp ? <DenButton type="button" variant="secondary" size="sm" onClick={() => setShowOAuthApp(true)}>添加 OAuth 应用</DenButton> : null}
      {usesSharedKey && !managedByPlugin ? (
        <Field label={keyRequired ? "新 API 密钥" : "新 API 密钥（可选）"}>
          <McpCredentialInput kind="secret" name="connector-settings-api-key" autoComplete="off" data-ph-no-capture value={apiKey} onChange={setApiKey} saved={connection.connected && !identityChanged} placeholder="API密钥" savedPlaceholder="留空以保留已保存的密钥" data-testid="connector-settings-api-key" replaceTestId="connector-settings-replace-api-key" />
        </Field>
      ) : null}
      {usesOAuthApp ? (
        <>
          <Field label="OAuth 客户端 ID">
            <McpCredentialInput kind="identifier" name="connector-settings-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="客户端 ID" />
          </Field>
          <Field label="新客户端密钥（可选）">
            <McpCredentialInput kind="secret" name="connector-settings-client-secret" value={clientSecret} onChange={setClientSecret} saved={connection.oauthClientConfigured === true} placeholder="客户端密钥" savedPlaceholder="留空以保留已保存的密钥" />
          </Field>
        </>
      ) : null}
      {authType === "oauth" ? (
        <Field label="请求的 OAuth 权限范围">
          <DenInput value={scopes} disabled={managedByPlugin} onChange={(event) => setScopes(event.target.value)} placeholder="records.read records.write" data-testid="connector-settings-scopes" />
        </Field>
      ) : null}
      <label className="flex items-center gap-2 text-[13px] text-gray-700">
        <input type="checkbox" checked={exposeDirectly} onChange={(event) => setExposeDirectly(event.target.checked)} />
        可在其他 MCP 应用中使用
      </label>
      </fieldset>
      {error ? <p className="text-[13px] text-red-600" role="alert">{error}</p> : null}
      <div className="flex items-center justify-end gap-3">
        {lockedReason ? (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-gray-500" data-testid="connector-settings-locked">
            <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            {lockedReason}
          </p>
        ) : null}
        <DenButton type="submit" size="sm" loading={updateConnection.isPending} disabled={disabled || lockedReason !== null}>保存更改</DenButton>
      </div>
    </form>
    {connection.authType === "oauth" ? <ConnectorIssuerReview connection={connection} onSaved={onSaved} /> : null}
    <ConfirmDialog
        confirm={confirming ? {
          title: `更改 ${connection.name} 的连接方式？`,
          description: "已保存的登录与 API 密钥将被清除，所有人需要重新连接。",
          action: "Save and sign everyone out",
        } : null}
        onConfirm={save}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

/** Review changed authorization servers before allowing a fresh sign-in. */
function ConnectorIssuerReview({ connection, onSaved }: { connection: ExternalMcpConnection; onSaved: (message: string) => void }) {
  const review = useReviewMcpIssuer();
  const [preview, setPreview] = useState<McpIssuerReview | null>(null);
  const [issuer, setIssuer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function inspect() {
    setError(null);
    try {
      const result = await review.mutateAsync({ connectionId: connection.id, action: "preview" });
      setPreview(result);
      setIssuer(result.advertisedIssuers.includes(result.currentIssuer ?? "") ? result.currentIssuer ?? "" : result.advertisedIssuers[0] ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录服务器加载失败，请重试。");
    }
  }

  async function confirm() {
    if (!issuer || !connection.updatedAt) return;
    const result = await review.mutateAsync({ connectionId: connection.id, action: "confirm", expectedUpdatedAt: connection.updatedAt, authorizationServerIssuer: issuer });
    setPreview(null);
    onSaved(result.reconnectionRequired ? "登录服务器已保存，请重新登录后使用。" : "当前登录服务器已确认。");
  }

  return (
    <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4">
      {connection.issuerReviewRequired ? <p className="text-[13px] text-gray-600">登录服务器已更改，需要管理员检查。</p> : null}
      <DenButton type="button" variant="secondary" size="sm" loading={review.isPending} onClick={() => void inspect()}>检查登录服务器</DenButton>
      {preview ? <>
        <p className="text-[12px] text-gray-500">已保存的服务器： {preview.currentIssuer ?? "无"}</p>
        <Field label="登录服务器">
          <DenSelect value={issuer} onChange={(event) => setIssuer(event.target.value)}>
            {preview.advertisedIssuers.map((value) => <option key={value} value={value}>{value}</option>)}
          </DenSelect>
        </Field>
        {preview.advertisedIssuers.length === 0 ? <p className="text-[12px] text-gray-500">未找到登录服务器，请检查地址后重试。</p> : null}
        <DenButton type="button" size="sm" disabled={!issuer || !connection.updatedAt || review.isPending} onClick={() => setConfirming(true)}>保存登录服务器</DenButton>
      </> : null}
      {error ? <p className="text-[12px] text-red-600" role="alert">{error}</p> : null}
      <ConfirmDialog confirm={confirming ? { title: `对 ${connection.name} 使用此登录服务器？`, description: `${issuer}。所有人都需要重新登录；更换服务器会清除已保存的登录状态和 OAuth 应用凭据。`, action: "Save sign-in server" } : null} onConfirm={confirm} onClose={() => setConfirming(false)} />
    </div>
  );
}
