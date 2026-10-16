"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { CheckCircle2, Copy, KeyRound, LoaderCircle, RefreshCw, Shield, ShieldAlert, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenSecretInput } from "../../_components/ui/secret-input";
import { DenNotice } from "../../_components/ui/notice";
import { getRequestError, isReauthRequiredError, requestJson } from "../../_lib/den-flow";
import { getBillingRoute, getOrgAccessFlags, parseOrgSsoPayload, type DenOrgSsoConnection, permissionLockReason } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EnterprisePlanNotice } from "./enterprise-plan-notice";

function formatDateTime(value: string | null) {
  if (!value) return "未配置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未配置";
  return date.toLocaleString(DEFAULT_DEN_LOCALE);
}

type FormMode = "saml" | "oidc";

function readSsoTestMessage(value: unknown) {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "openwork:sso-test-complete") return null;
  if (!("intentId" in value) || typeof value.intentId !== "string") return null;
  return value.intentId;
}

export function SsoScreen() {
  const { orgId, orgContext, runReauthableAction } = useOrgDashboard();
  const [connection, setConnection] = useState<DenOrgSsoConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [domainVerificationToken, setDomainVerificationToken] = useState<string | null>(null);
  const [requestingDomainToken, setRequestingDomainToken] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testIntentId, setTestIntentId] = useState<string | null>(null);
  const [startingTest, setStartingTest] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const testPopupRef = useRef<Window | null>(null);
  const testPopupWatcherRef = useRef<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("saml");
  const [issuer, setIssuer] = useState("");
  const [domain, setDomain] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [cert, setCert] = useState("");
  const [audience, setAudience] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState("openid email profile");
  const [skipDiscovery, setSkipDiscovery] = useState(false);
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [jwksEndpoint, setJwksEndpoint] = useState("");
  const [userInfoEndpoint, setUserInfoEndpoint] = useState("");
  const [tokenEndpointAuthentication, setTokenEndpointAuthentication] = useState<"" | "client_secret_basic" | "client_secret_post">("");

  const access = useMemo(
    () => getOrgAccessFlags(orgContext?.currentMember.role ?? "member", orgContext?.currentMember.isOwner ?? false, orgContext?.currentMember.permissions),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.currentMember.permissions],
  );

  async function loadSsoConfig(isCurrent = () => true, quiet = false) {
    if (!orgId || !access.canViewSso) {
      if (isCurrent()) {
        setConnection(null);
      }
      return;
    }

    if (isCurrent() && !quiet) {
      setBusy(true);
      setError(null);
    }
    try {
      const { response, payload } = await requestJson("/v1/sso", { method: "GET", headers: getOrgScopedHeaders() }, 12000);
      if (!response.ok) {
        throw getRequestError(payload, response, `无法加载单点登录设置（${response.status}）。`);
      }

      const parsed = parseOrgSsoPayload(payload);
      if (isCurrent()) {
        setConnection(parsed.connection);
        if (!quiet) {
          syncFormFromConnection(parsed.connection);
          setEditing(false);
        }
      }
    } catch (nextError) {
      if (isReauthRequiredError(nextError)) {
        throw nextError;
      }

      if (isCurrent() && !quiet) {
        setError(nextError instanceof Error ? nextError.message : "无法加载 SSO 设置，请重试。");
      }
    } finally {
      if (isCurrent() && !quiet) {
        setBusy(false);
      }
    }
  }

  function getOrgScopedHeaders() {
    const headers = new Headers();
    if (orgId) {
      headers.set("x-openwork-legacy-org-id", orgId);
    }
    return headers;
  }

  function syncFormFromConnection(nextConnection: DenOrgSsoConnection | null) {
    if (!nextConnection) {
      return;
    }

    setFormMode(nextConnection.kind);
    setIssuer(nextConnection.issuer);
    setDomain(nextConnection.domain);
    if (nextConnection.saml) {
      setEntryPoint(nextConnection.saml.entryPoint ?? "");
      setAudience(nextConnection.saml.audience ?? "");
    }
    if (nextConnection.oidc) {
      setClientId(nextConnection.oidc.clientId ?? "");
      setScopes(nextConnection.oidc.scopes.length > 0 ? nextConnection.oidc.scopes.join(" ") : "openid email profile");
      setSkipDiscovery(nextConnection.oidc.skipDiscovery);
      setAuthorizationEndpoint(nextConnection.oidc.authorizationEndpoint ?? "");
      setTokenEndpoint(nextConnection.oidc.tokenEndpoint ?? "");
      setJwksEndpoint(nextConnection.oidc.jwksEndpoint ?? "");
      setUserInfoEndpoint(nextConnection.oidc.userInfoEndpoint ?? "");
      setTokenEndpointAuthentication(nextConnection.oidc.tokenEndpointAuthentication ?? "");
    }
  }

  useEffect(() => {
    let active = true;
    void runReauthableAction("load-sso-settings", () => loadSsoConfig(() => active)).catch((nextError) => {
      if (active) {
        setError(nextError instanceof Error ? nextError.message : "无法加载 SSO 设置，请重试。");
      }
    });
    return () => {
      active = false;
    };
  }, [orgId, access.canViewSso]);

  useEffect(() => {
    if (!copiedValue) return;
    const timeout = window.setTimeout(() => setCopiedValue(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedValue]);

  useEffect(() => {
    if (!testDialogOpen || connection?.testStatus !== "testing") return;
    const interval = window.setInterval(() => void loadSsoConfig(() => true, true), 1000);
    return () => window.clearInterval(interval);
  }, [testDialogOpen, connection?.testStatus, orgId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const completedIntentId = readSsoTestMessage(event.data);
      if (event.origin !== window.location.origin || !completedIntentId || completedIntentId !== testIntentId) return;
      stopTestPopupWatcher();
      testPopupRef.current?.close();
      testPopupRef.current = null;
      void loadSsoConfig(() => true, true);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [testIntentId, orgId]);

  function stopTestPopupWatcher() {
    if (testPopupWatcherRef.current !== null) {
      window.clearInterval(testPopupWatcherRef.current);
      testPopupWatcherRef.current = null;
    }
  }

  async function cancelTestIntent(intentId: string) {
    await requestJson(`/v1/sso/test/${encodeURIComponent(intentId)}/cancel`, {
      method: "POST",
      headers: getOrgScopedHeaders(),
      body: JSON.stringify({}),
    }, 12000);
    await loadSsoConfig(() => true, true);
  }

  function watchTestPopup(popup: Window, intentId: string) {
    stopTestPopupWatcher();
    testPopupRef.current = popup;
    testPopupWatcherRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      stopTestPopupWatcher();
      testPopupRef.current = null;
      void cancelTestIntent(intentId);
    }, 500);
  }

  async function copyValue(value: string | null, key: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(key);
    } catch {
      setError("无法复制此 SSO 值，请手动复制。");
    }
  }

  async function handleSave() {
    if (!orgId) {
      setError("未找到组织。");
      return;
    }
    if (!access.canManageSso) {
      setError("你没有更改 SSO 设置的权限。");
      return;
    }

    setError(null);
    try {
      await runReauthableAction("save-sso-settings", async () => {
        setSaving(true);
        try {
          const path = formMode === "saml" ? "/v1/sso/saml" : "/v1/sso/oidc";
          const body = formMode === "saml"
            ? {
                issuer,
                domain,
                entryPoint,
                cert,
                audience: audience || undefined,
              }
            : {
                issuer,
                domain,
                clientId,
                clientSecret,
                scopes: scopes.split(/\s+/).map((entry) => entry.trim()).filter(Boolean),
                skipDiscovery,
                authorizationEndpoint: authorizationEndpoint || undefined,
                tokenEndpoint: tokenEndpoint || undefined,
                jwksEndpoint: jwksEndpoint || undefined,
                userInfoEndpoint: userInfoEndpoint || undefined,
                tokenEndpointAuthentication: tokenEndpointAuthentication || undefined,
              };

          const { response, payload } = await requestJson(path, { method: "POST", headers: getOrgScopedHeaders(), body: JSON.stringify(body) }, 20000);
          if (!response.ok) {
            throw getRequestError(payload, response, `无法保存单点登录设置（${response.status}）。`);
          }

          const parsed = parseOrgSsoPayload(payload);
          setConnection(parsed.connection);
          syncFormFromConnection(parsed.connection);
          setDomainVerificationToken(parsed.domainVerificationToken);
          setEditing(false);
        } finally {
          setSaving(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存 SSO 设置失败，请重试。");
    }
  }

  async function handleDelete() {
    if (!access.canManageSso) {
      setError("你没有删除 SSO 设置的权限。");
      return;
    }

    if (!orgId || !window.confirm("删除此 SSO 连接？")) {
      return;
    }

    setError(null);
    try {
      await runReauthableAction("delete-sso-settings", async () => {
        setDeleting(true);
        try {
          const { response, payload } = await requestJson("/v1/sso", { method: "DELETE", headers: getOrgScopedHeaders() }, 12000);
          if (response.status !== 204 && !response.ok) {
            throw getRequestError(payload, response, `无法删除单点登录设置（${response.status}）。`);
          }
          setConnection(null);
          setEditing(false);
          await loadSsoConfig();
        } finally {
          setDeleting(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除 SSO 设置失败，请重试。");
    }
  }

  async function handleRequestDomainToken() {
    if (!access.canManageSso) {
      setError("你没有申请 SSO 域名验证令牌的权限。");
      return;
    }
    if (!orgId || !connection) return;
    setError(null);
    try {
      await runReauthableAction("request-sso-domain-token", async () => {
        setRequestingDomainToken(true);
        try {
          const { response, payload } = await requestJson("/v1/sso/request-domain-verification", { method: "POST", headers: getOrgScopedHeaders(), body: JSON.stringify({}) }, 12000);
          if (!response.ok) {
            throw getRequestError(payload, response, `无法请求域名验证（${response.status}）。`);
          }

          const token = typeof (payload as { domainVerificationToken?: unknown } | null)?.domainVerificationToken === "string"
            ? (payload as { domainVerificationToken: string }).domainVerificationToken
            : "";
          if (!token) {
            throw new Error("响应中缺少 SSO 域名验证令牌，请重试。");
          }
          setDomainVerificationToken(token);
        } finally {
          setRequestingDomainToken(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "申请域名验证失败，请重试。");
    }
  }

  async function handleVerifyDomain() {
    if (!access.canManageSso) {
      setError("你没有验证 SSO 域名的权限。");
      return;
    }
    if (!orgId || !connection) return;
    setError(null);
    try {
      await runReauthableAction("verify-sso-domain", async () => {
        setVerifyingDomain(true);
        try {
          const { response, payload } = await requestJson("/v1/sso/verify-domain", { method: "POST", headers: getOrgScopedHeaders(), body: JSON.stringify({}) }, 12000);
          if (response.status !== 204 && !response.ok) {
            throw getRequestError(payload, response, `无法验证域名（${response.status}）。`);
          }
          setDomainVerificationToken(null);
          await loadSsoConfig();
        } finally {
          setVerifyingDomain(false);
        }
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "验证 SSO 域名失败，请重试。");
    }
  }

  async function handleStartTest() {
    if (!orgId || !connection || !access.canManageSso) return;
    const popup = window.open("", "openwork-sso-test", "popup,width=520,height=720");
    if (!popup) {
      setError("OpenWork 无法打开 SSO 测试窗口，请允许弹出窗口后重试。");
      return;
    }

    setStartingTest(true);
    setTestDialogOpen(true);
    setError(null);
    try {
      await runReauthableAction("test-sso-settings", async () => {
        const { response, payload } = await requestJson("/v1/sso/test", {
          method: "POST",
          headers: getOrgScopedHeaders(),
          body: JSON.stringify({}),
        }, 12000);
        if (!response.ok) throw getRequestError(payload, response, `无法启动单点登录测试（${response.status}）。`);
        const intentId = typeof payload === "object" && payload !== null && "intentId" in payload && typeof payload.intentId === "string"
          ? payload.intentId
          : "";
        const testUrl = typeof payload === "object" && payload !== null && "testUrl" in payload && typeof payload.testUrl === "string"
          ? payload.testUrl
          : "";
        if (!intentId || !testUrl) throw new Error("SSO 测试响应不完整，请重试。");
        setTestIntentId(intentId);
        popup.location.href = testUrl;
        watchTestPopup(popup, intentId);
        await loadSsoConfig(() => true, true);
      });
    } catch (nextError) {
      popup.close();
      setTestDialogOpen(false);
      setError(nextError instanceof Error ? nextError.message : "启动 SSO 身份验证测试失败，请重试。");
    } finally {
      setStartingTest(false);
    }
  }

  function handleOpenTestDialog() {
    setTestIntentId(null);
    setTestDialogOpen(true);
  }

  async function handleEnable() {
    if (!access.canManageSso) return;
    setEnabling(true);
    setError(null);
    try {
      await runReauthableAction("enable-sso-settings", async () => {
        const { response, payload } = await requestJson("/v1/sso/enable", {
          method: "POST",
          headers: getOrgScopedHeaders(),
          body: JSON.stringify({}),
        }, 12000);
        if (response.status !== 204 && !response.ok) throw getRequestError(payload, response, `无法启用单点登录（${response.status}）。`);
        setTestDialogOpen(false);
        setTestIntentId(null);
        await loadSsoConfig();
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "启用 SSO 失败，请重试。");
    } finally {
      setEnabling(false);
    }
  }

  async function handleDisable() {
    if (!access.canManageSso || !window.confirm("关闭此工作区的 SSO？成员将使用其他可用登录方式。")) return;
    setDisabling(true);
    setError(null);
    try {
      await runReauthableAction("disable-sso-settings", async () => {
        const { response, payload } = await requestJson("/v1/sso/disable", {
          method: "POST",
          headers: getOrgScopedHeaders(),
          body: JSON.stringify({}),
        }, 12000);
        if (response.status !== 204 && !response.ok) throw getRequestError(payload, response, `无法禁用单点登录（${response.status}）。`);
        await loadSsoConfig();
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "关闭 SSO 失败，请重试。");
    } finally {
      setDisabling(false);
    }
  }

  function closeTestDialog() {
    setTestDialogOpen(false);
    if (testIntentId && connection?.testStatus === "testing") {
      testPopupRef.current?.close();
      void cancelTestIntent(testIntentId);
    }
    stopTestPopupWatcher();
    testPopupRef.current = null;
  }

  function handleCancelEdit() {
    syncFormFromConnection(connection);
    setEditing(false);
  }

  const formReadOnly = !access.canManageSso;
  const showConnectionForm = access.canViewSso && (!connection || editing || formReadOnly);

  if (!orgContext) {
    return (
      <DashboardPageTemplate icon={Shield} title="SSO" description="为此工作区配置企业单点登录。">
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">正在加载组织信息…</div>
      </DashboardPageTemplate>
    );
  }

  const ssoFormDisabled = formReadOnly || saving || !orgContext.entitlements.sso;

  return (
    <DashboardPageTemplate icon={Shield} title="SSO" description="为每个工作区配置一个企业 SSO 连接，并向团队共享生成的登录地址。">
      {!access.canViewSso ? (
        <div className="rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-6 py-5 text-[14px] text-[var(--dls-text-primary)]">{permissionLockReason("sso.view")}</div>
      ) : (
        <>
          {!orgContext.entitlements.sso ? (
            <EnterprisePlanNotice feature="SSO" plan="team" billingHref={getBillingRoute(orgContext.organization.slug)} />
          ) : null}
          {error ? <DenNotice message={error} className="mb-6" /> : null}
          {!access.canManageSso ? (
            <div className="mb-6 rounded-[24px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-5 py-4 text-[14px] text-[var(--dls-text-primary)]">
              {`只读。${permissionLockReason("sso.manage")}`}
            </div>
          ) : null}

          {showConnectionForm ? (
            <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <DenButton variant={formMode === "saml" ? "primary" : "secondary"} onClick={() => setFormMode("saml")} disabled={formReadOnly || saving}>SAML</DenButton>
                  <DenButton variant={formMode === "oidc" ? "primary" : "secondary"} onClick={() => setFormMode("oidc")} disabled={formReadOnly || saving}>OIDC</DenButton>
                </div>
                {connection && editing ? <DenButton variant="secondary" onClick={handleCancelEdit}>取消编辑</DenButton> : null}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <label className="block text-[14px] text-gray-700">
                  <span className="mb-2 block font-medium">{formMode === "saml" ? "身份提供商签发者地址" : "签发者地址"}</span>
                  <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="https://idp.example.com" disabled={ssoFormDisabled} />
                </label>
                <label className="block text-[14px] text-gray-700">
                  <span className="mb-2 block font-medium">域名</span>
                  <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="example.com" disabled={ssoFormDisabled} />
                </label>
                {formMode === "saml" ? (
                  <>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">SAML 入口</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={entryPoint} onChange={(event) => setEntryPoint(event.target.value)} placeholder="https://idp.example.com/sso" disabled={ssoFormDisabled} />
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">受众地址</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="默认使用 OpenWork 身份验证地址" disabled={ssoFormDisabled} />
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">身份提供商证书</span>
                      <textarea className="min-h-[140px] w-full rounded-[18px] border border-gray-200 px-4 py-3" value={cert} onChange={(event) => setCert(event.target.value)} placeholder="证书保存后不再返回" disabled={ssoFormDisabled} />
                      <span className="mt-1 block text-[12px] text-gray-500">证书保存后不再返回，仅在需要替换时填写。</span>
                    </label>
                    <div className="rounded-[18px] border border-gray-200 px-4 py-3 text-[14px] leading-6 text-gray-600 md:col-span-2">
                      组织 SAML 连接始终要求经过签名的 SAML 断言、时间戳与服务提供商发起的响应。
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-[14px] text-gray-700">
                      <span className="mb-2 block font-medium">客户端 ID</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={clientId} onChange={(event) => setClientId(event.target.value)} disabled={ssoFormDisabled} />
                    </label>
                    <label className="block text-[14px] text-gray-700">
                      <span className="mb-2 block font-medium">客户端密钥</span>
                      <DenSecretInput autoComplete="new-password" value={clientSecret} onChange={setClientSecret} placeholder="密钥保存后不再返回" disabled={ssoFormDisabled} />
                      <span className="mt-1 block text-[12px] text-gray-500">Den 不会返回客户端密钥。</span>
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">权限范围</span>
                      <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={scopes} onChange={(event) => setScopes(event.target.value)} placeholder="openid email profile" disabled={ssoFormDisabled} />
                    </label>
                    <label className="block text-[14px] text-gray-700 md:col-span-2">
                      <span className="mb-2 block font-medium">令牌端点认证方式</span>
                      <select className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={tokenEndpointAuthentication} onChange={(event) => setTokenEndpointAuthentication(event.target.value === "client_secret_basic" || event.target.value === "client_secret_post" ? event.target.value : "")} disabled={ssoFormDisabled}>
                        <option value="">使用提供商默认值</option>
                        <option value="client_secret_basic">client_secret_basic</option>
                        <option value="client_secret_post">client_secret_post</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-3 rounded-[18px] border border-gray-200 px-4 py-3 text-[14px] text-gray-700 md:col-span-2">
                      <input type="checkbox" checked={skipDiscovery} onChange={(event) => setSkipDiscovery(event.target.checked)} disabled={ssoFormDisabled} />
                      手动设置 OIDC 端点
                    </label>
                    {skipDiscovery ? (
                      <>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">授权端点</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={authorizationEndpoint} onChange={(event) => setAuthorizationEndpoint(event.target.value)} placeholder="https://idp.example.com/oauth2/v1/authorize" disabled={ssoFormDisabled} />
                        </label>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">令牌端点</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={tokenEndpoint} onChange={(event) => setTokenEndpoint(event.target.value)} placeholder="https://idp.example.com/oauth2/v1/token" disabled={ssoFormDisabled} />
                        </label>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">JWKS 端点</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={jwksEndpoint} onChange={(event) => setJwksEndpoint(event.target.value)} placeholder="https://idp.example.com/oauth2/v1/keys" disabled={ssoFormDisabled} />
                        </label>
                        <label className="block text-[14px] text-gray-700 md:col-span-2">
                          <span className="mb-2 block font-medium">用户信息端点</span>
                          <input className="w-full rounded-[18px] border border-gray-200 px-4 py-3" value={userInfoEndpoint} onChange={(event) => setUserInfoEndpoint(event.target.value)} placeholder="可选" disabled={ssoFormDisabled} />
                        </label>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <DenButton variant="primary" icon={RefreshCw} onClick={() => void handleSave()} disabled={ssoFormDisabled}>{saving ? "正在保存…" : "保存 SSO 连接"}</DenButton>
                <DenButton variant="secondary" icon={Trash2} onClick={() => void handleDelete()} disabled={deleting || !connection || !access.canManageSso}>{deleting ? "正在删除…" : "删除连接"}</DenButton>
              </div>
            </div>
          ) : null}

          <div className="rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">当前连接</p>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">使用下方生成的登录与提供商配置地址。</p>
              </div>
              {connection && !editing ? (
                <div className="flex flex-wrap gap-3">
                  <DenButton variant="secondary" onClick={() => setEditing(true)} disabled={!access.canManageSso}>编辑连接</DenButton>
                  {connection.status === "enabled" ? (
                    <DenButton variant="secondary" onClick={() => void handleDisable()} disabled={disabling || !access.canManageSso}>{disabling ? "正在禁用…" : "禁用 SSO"}</DenButton>
                  ) : connection.testStatus === "succeeded" ? (
                    <DenButton variant="primary" icon={CheckCircle2} onClick={() => void handleEnable()} disabled={enabling || !access.canManageSso}>{enabling ? "正在启用…" : "启用 SSO"}</DenButton>
                  ) : (
                    <DenButton variant="primary" icon={Shield} onClick={handleOpenTestDialog} disabled={!access.canManageSso || !connection.domainVerified}>启用配置</DenButton>
                  )}
                  <DenButton variant="secondary" icon={Trash2} onClick={() => void handleDelete()} disabled={deleting || !access.canManageSso}>{deleting ? "正在删除…" : "删除连接"}</DenButton>
                </div>
              ) : null}
            </div>

            {!connection && !busy ? <p className="mt-4 text-[14px] text-gray-500">尚未配置 SSO 连接。</p> : null}

            {connection ? (
              <div className="mt-5 space-y-4">
                {!connection.domainVerified ? (
                  <section data-testid="sso-domain-verification" className="overflow-hidden rounded-[24px] border border-[var(--dls-border)] bg-[var(--dls-surface)] text-[14px] text-[var(--dls-text-primary)]">
                    <div className="flex flex-col gap-4 border-b border-[var(--dls-border)] bg-[var(--dls-hover)] px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 rounded-full bg-amber-900 p-2 text-amber-50"><ShieldAlert size={18} aria-hidden="true" /></span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[16px] font-semibold tracking-[-0.02em]">请先验证域名</p>
                            <span className="rounded-full border border-amber-300 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">等待验证</span>
                          </div>
                          <p className="mt-1 max-w-2xl leading-6 text-[var(--dls-text-secondary)]">
                            DNS 检查确认工作区控制以下域名前，SSO 将保持未启用，也不会向用户提供： <strong>{connection.domain}</strong>.
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <DenButton variant="secondary" icon={KeyRound} onClick={() => void handleRequestDomainToken()} disabled={requestingDomainToken || !access.canManageSso}>
                          {requestingDomainToken ? "正在申请…" : "申请令牌"}
                        </DenButton>
                        <DenButton variant="primary" icon={RefreshCw} onClick={() => void handleVerifyDomain()} disabled={verifyingDomain || !access.canManageSso || !domainVerificationToken}>
                          {verifyingDomain ? "正在验证…" : "验证域名"}
                        </DenButton>
                      </div>
                    </div>

                    <div className="grid gap-px bg-[var(--dls-border)] md:grid-cols-2">
                      {[
                        { label: "记录类型", value: "TXT", key: "domain-record-type" },
                        { label: "主机 / 名称", value: connection.domainVerificationHost, key: "domain-record-host" },
                        { label: "完整 DNS 名称", value: connection.domainVerificationDnsName, key: "domain-record-name" },
                        { label: "值", value: domainVerificationToken, key: "domain-token" },
                      ].map((record) => (
                        <div key={record.key} className="bg-[var(--dls-surface)] px-5 py-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--dls-text-secondary)]">{record.label}</p>
                            {record.value ? (
                              <button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--dls-text-primary)] transition hover:bg-[var(--dls-active)]" onClick={() => void copyValue(record.value, record.key)}>
                                <Copy size={13} aria-hidden="true" /> {copiedValue === record.key ? "已复制" : "复制"}
                              </button>
                            ) : null}
                          </div>
                          <code className="block break-all text-[13px] leading-6 text-gray-800">{record.value ?? "申请令牌以显示 TXT 值"}</code>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 px-5 py-4 text-[13px] leading-5 text-[var(--dls-text-secondary)] sm:grid-cols-2">
                      <p><strong className="text-[var(--dls-text-primary)]">不同 DNS 提供商的填写方式有所差异：</strong> 提供商会自动附加域名时填写主机值，否则填写完整 DNS 名称。</p>
                      <p><strong className="text-[var(--dls-text-primary)]">一次性验证：</strong> 令牌在七天后过期。验证成功后可移除 TXT 记录，更改域名后需要重新验证。</p>
                    </div>
                  </section>
                ) : (
                  <div className="flex items-start gap-3 rounded-[20px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-900">
                    <CheckCircle2 className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
                    <div>
                      <p className="font-semibold">域名已验证{connection.status === "enabled" ? " · SSO 已启用" : ""}</p>
                      <p className="mt-1 text-emerald-800">{connection.status === "enabled" ? "已通过测试的配置正在生效。" : "配置仍未启用，请先测试再启用 SSO。"} DNS TXT 记录仅用于一次性验证，现在可移除。</p>
                    </div>
                  </div>
                )}

                <div data-testid="sso-provider-setup" className="space-y-4">
                  {[
                    ["登录地址", connection.signInUrl, "signin"],
                    ["重定向地址", connection.redirectUrl, "redirect"],
                    ["ACS 地址", connection.acsUrl, "acs"],
                    ["元数据地址", connection.metadataUrl, "metadata"],
                  ].map(([label, value, key]) => (
                    <div key={key as string} className="rounded-[20px] border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-gray-500">{label as string}</p>
                        <DenButton variant="secondary" icon={Copy} onClick={() => void copyValue((value as string | null) ?? null, key as string)} disabled={!value}>{copiedValue === key ? "已复制" : "复制"}</DenButton>
                      </div>
                      <code className="block break-all text-[13px] leading-6 text-gray-700">{(value as string | null) ?? "不适用"}</code>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4 text-[14px] text-gray-700">
                    <p className="font-medium text-gray-900">提供商</p>
                    <p className="mt-2">{connection.providerId}</p>
                    <p className="mt-2">{connection.kind.toUpperCase()} · {connection.domain}</p>
                    <p className="mt-2">域名已验证： {connection.domainVerified ? "是" : "否"}</p>
                  </div>
                  <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4 text-[14px] text-gray-700">
                    <p className="font-medium text-gray-900">状态</p>
                    <p className="mt-2">{connection.status === "enabled" ? "已启用" : "已保存 · 已禁用"}</p>
                    <p className="mt-2">测试： {connection.testStatus === "succeeded" ? "成功" : connection.testStatus === "failed" ? "失败" : connection.testStatus === "testing" ? "进行中" : "未测试"}</p>
                    <p className="mt-2">上次测试： {formatDateTime(connection.lastTestedAt)}</p>
                    <p className="mt-2">更新时间： {formatDateTime(connection.updatedAt)}</p>
                  </div>
                </div>

                {connection.testStatus === "failed" && connection.lastError ? <div data-testid="sso-test-failure" className="rounded-[20px] border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">{connection.lastError}</div> : null}
              </div>
            ) : null}
          </div>

          {testDialogOpen && connection ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]">
              <div role="dialog" aria-modal="true" aria-labelledby="sso-test-dialog-title" data-testid="sso-test-dialog" className="w-full max-w-[480px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_80px_-36px_rgba(15,23,42,0.6)]">
                <div className="relative border-b border-slate-100 bg-slate-50/70 px-6 pb-5 pt-6">
                  <button type="button" aria-label="关闭 SSO 测试" className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700" onClick={closeTestDialog}>
                    <X size={17} aria-hidden="true" />
                  </button>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">启用配置</p>
                  <h2 id="sso-test-dialog-title" className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-slate-950">启用 SSO 前先测试</h2>
                  <p className="mt-2 pr-8 text-[14px] leading-6 text-slate-600">独立窗口将使用已保存的配置执行真实身份验证。 {connection.kind.toUpperCase()} 独立窗口将使用已保存的配置执行真实身份验证。明确启用前，SSO 保持禁用。</p>
                </div>
                <div className="space-y-4 px-6 py-5">
                  {connection.testStatus === "testing" ? (
                    <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-[14px] text-violet-900">
                      <LoaderCircle className="mt-0.5 animate-spin" size={18} aria-hidden="true" />
                      <div><p className="font-semibold">身份验证测试进行中</p><p className="mt-1 text-violet-800">请在新窗口中完成登录，此窗口将自动更新。</p></div>
                    </div>
                  ) : connection.testStatus === "succeeded" ? (
                    <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-900">
                      <CheckCircle2 className="mt-0.5" size={18} aria-hidden="true" />
                      <div><p className="font-semibold">身份验证测试成功</p><p className="mt-1 text-emerald-800">已保存的确切配置通过测试，SSO 仍未启用。</p></div>
                    </div>
                  ) : connection.testStatus === "failed" ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-800">
                      <p className="font-semibold">身份验证测试失败</p>
                      <p className="mt-1">{connection.lastError ?? "请检查提供商配置后重试。"}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] text-slate-700">已保存的配置尚未测试。</div>
                  )}
                  <div className="flex flex-wrap justify-end gap-3">
                    <DenButton variant="secondary" onClick={closeTestDialog}>关闭</DenButton>
                    {connection.testStatus === "succeeded" ? (
                      <DenButton variant="primary" icon={CheckCircle2} onClick={() => void handleEnable()} disabled={enabling}>{enabling ? "正在启用…" : "启用 SSO"}</DenButton>
                    ) : (
                      <DenButton variant="primary" icon={Shield} onClick={() => void handleStartTest()} disabled={startingTest || connection.testStatus === "testing"}>
                        {startingTest ? "正在打开 SSO 登录…" : connection.testStatus === "failed" ? "重试 SSO 登录" : "SSO 登录"}
                      </DenButton>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </DashboardPageTemplate>
  );
}
