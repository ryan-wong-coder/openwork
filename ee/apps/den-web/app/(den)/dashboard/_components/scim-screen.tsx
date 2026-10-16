"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { Copy, RefreshCw, Shield, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getRequestError, isReauthRequiredError, requestJson } from "../../_lib/den-flow";
import {
  type DenOrgScimConnection,
  type DenOrgScimHealth,
  getOrgAccessFlags,
  parseOrgScimPayload,
  permissionLockReason,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

function formatDateTime(value: string | null) {
  if (!value) {
    return "未配置";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未配置";
  }

  return date.toLocaleString(DEFAULT_DEN_LOCALE);
}

export function ScimScreen() {
  const { orgId, orgContext, runReauthableAction } = useOrgDashboard();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [ssoReady, setSsoReady] = useState(false);
  const [connection, setConnection] = useState<DenOrgScimConnection | null>(null);
  const [health, setHealth] = useState<DenOrgScimHealth>({
    unresolvedFailureCount: 0,
    lastFailureAt: null,
    lastFailureAction: null,
    lastFailureMessage: null,
    nextRetryAt: null,
    lastSuccessfulSyncAt: null,
  });
  const [visibleToken, setVisibleToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [updatingGroupMapping, setUpdatingGroupMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedValue, setCopiedValue] = useState<"base-url" | "token" | null>(null);

  const access = useMemo(
    () =>
      getOrgAccessFlags(
        orgContext?.currentMember.role ?? "member",
        orgContext?.currentMember.isOwner ?? false,
        orgContext?.currentMember.permissions,
      ),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.currentMember.permissions],
  );

  async function loadScimConfig(isCurrent = () => true) {
    if (!orgId || !access.canViewScim) {
      if (isCurrent()) {
        setBaseUrl(null);
        setSsoReady(false);
        setConnection(null);
        setHealth({
          unresolvedFailureCount: 0,
          lastFailureAt: null,
          lastFailureAction: null,
          lastFailureMessage: null,
          nextRetryAt: null,
          lastSuccessfulSyncAt: null,
        });
      }
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson(
        "/v1/scim",
        { method: "GET" },
        12000,
      );

      if (!response.ok) {
        throw getRequestError(payload, response, `无法加载 SCIM 设置（${response.status}）。`);
      }

      const parsed = parseOrgScimPayload(payload);
      if (isCurrent()) {
        setBaseUrl(parsed.baseUrl);
        setSsoReady(parsed.ssoReady);
        setConnection(parsed.connection);
        setHealth(parsed.health);
      }
    } catch (nextError) {
      if (isReauthRequiredError(nextError)) {
        throw nextError;
      }

      if (isCurrent()) {
        setError(
          nextError instanceof Error ? nextError.message : "无法加载 SCIM 设置，请重试。",
        );
      }
    } finally {
      if (isCurrent()) {
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    let active = true;
    void runReauthableAction("load-scim-settings", () => loadScimConfig(() => active)).catch((nextError) => {
      if (active) {
        setError(nextError instanceof Error ? nextError.message : "无法加载 SCIM 设置，请重试。");
      }
    });
    return () => {
      active = false;
    };
  }, [orgId, access.canViewScim]);

  useEffect(() => {
    if (!copiedValue) {
      return;
    }

    const timeout = window.setTimeout(() => setCopiedValue(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedValue]);

  async function copyValue(value: string | null, kind: "base-url" | "token") {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(kind);
    } catch {
      setError(`无法复制${kind === "token" ? "SCIM 令牌" : "SCIM 基础地址"}。`);
    }
  }

  async function handleRotateToken() {
    if (!access.canManageScim) {
      setError("你没有创建或轮换 SCIM 令牌的权限。");
      return;
    }

    if (!orgId) {
      setError("未找到组织。");
      return;
    }

    setError(null);
    setVisibleToken(null);
    try {
      await runReauthableAction("rotate-scim-token", async () => {
        setRotating(true);
        try {
          const { response, payload } = await requestJson(
            "/v1/scim/token",
            { method: "POST", body: JSON.stringify({}) },
            12000,
          );

          if (!response.ok) {
            throw getRequestError(payload, response, `无法轮换 SCIM 令牌（${response.status}）。`);
          }

          const parsed = parseOrgScimPayload(payload);
          if (!parsed.baseUrl || !parsed.connection || !parsed.scimToken) {
            throw new Error("SCIM 令牌轮换成功，但响应不完整，请刷新后检查。");
          }

          setBaseUrl(parsed.baseUrl);
          setSsoReady(parsed.ssoReady);
          setConnection(parsed.connection);
          setHealth(parsed.health);
          setVisibleToken(parsed.scimToken);
          setCopiedValue(null);
        } finally {
          setRotating(false);
        }
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "轮换 SCIM 令牌失败，请重试。",
      );
    }
  }

  async function handleRunReconciliation() {
    if (!access.canManageScim) {
      setError("你没有执行 SCIM 协调同步的权限。");
      return;
    }

    if (!orgId) {
      setError("未找到组织。");
      return;
    }

    setError(null);
    try {
      await runReauthableAction("reconcile-scim", async () => {
        setReconciling(true);
        try {
          const { response, payload } = await requestJson(
            "/v1/scim/reconcile",
            { method: "POST", body: JSON.stringify({}) },
            12000,
          );

          if (!response.ok) {
            throw getRequestError(payload, response, `无法同步 SCIM（${response.status}）。`);
          }

          await loadScimConfig();
        } finally {
          setReconciling(false);
        }
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "SCIM 协调同步失败，请重试。",
      );
    }
  }

  async function handleGroupMappingChange() {
    if (!access.canManageScim) {
      setError("你没有更改 SCIM 映射的权限。");
      return;
    }

    if (!connection) {
      setError("请先创建 SCIM 连接器，再启用群组同步。");
      return;
    }

    const groupMappingMode = connection.groupMappingMode === "create_teams"
      ? "metadata_only"
      : "create_teams";
    setError(null);
    setUpdatingGroupMapping(true);
    try {
      const { response, payload } = await requestJson(
        "/v1/scim",
        { method: "PATCH", body: JSON.stringify({ groupMappingMode }) },
        12000,
      );
      if (!response.ok) {
        throw getRequestError(payload, response, `无法更新 SCIM 组映射（${response.status}）。`);
      }
      const parsed = parseOrgScimPayload(payload);
      if (!parsed.connection) {
        throw new Error("SCIM 设置已更新，但响应不完整，请刷新后检查。");
      }
      setConnection(parsed.connection);
      setHealth(parsed.health);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "更新 SCIM 群组映射失败，请重试。");
    } finally {
      setUpdatingGroupMapping(false);
    }
  }

  async function handleDeleteConnection() {
    if (!access.canManageScim) {
      setError("你没有删除 SCIM 连接的权限。");
      return;
    }

    if (
      !orgId ||
      !window.confirm(
        "删除此 SCIM 连接？当前持有者令牌将立即失效。",
      )
    ) {
      return;
    }

    setError(null);
    try {
      await runReauthableAction("delete-scim-connection", async () => {
        setDeleting(true);
        try {
          const { response, payload } = await requestJson(
            "/v1/scim",
            { method: "DELETE" },
            12000,
          );

          if (response.status !== 204 && !response.ok) {
            throw getRequestError(payload, response, `无法删除 SCIM 连接（${response.status}）。`);
          }

          setConnection(null);
          setVisibleToken(null);
          setCopiedValue(null);
          await loadScimConfig();
        } finally {
          setDeleting(false);
        }
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "删除 SCIM 连接失败，请重试。",
      );
    }
  }

  if (!orgContext) {
    return (
      <DashboardPageTemplate
        icon={Shield}
        title="SCIM"
        description="通过组织范围的 SCIM 连接器，从身份提供商预配组织成员。"
      >
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载组织信息…
        </div>
      </DashboardPageTemplate>
    );
  }

  return (
    <DashboardPageTemplate
      icon={Shield}
      title="SCIM"
      description="为每个工作区创建一个 SCIM 连接器，然后向身份提供商配置此处显示的基础地址与持有者令牌。"
    >
      {!access.canViewScim ? (
        <div className="rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-6 py-5 text-[14px] text-[var(--dls-text-primary)]">
          {permissionLockReason("scim.view")}
        </div>
      ) : (
        <>
          {!access.canManageScim ? (
            <div className="mb-6 rounded-[24px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-5 py-4 text-[14px] text-[var(--dls-text-primary)]">
              {`只读。${permissionLockReason("scim.manage")}`}
            </div>
          ) : null}
          <div className="mb-6 flex flex-wrap gap-2 rounded-[24px] border border-gray-200 bg-white px-5 py-4 text-[12px] font-semibold shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <span className={`rounded-full px-3 py-1.5 ${orgContext.authMethods.sso ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
              {orgContext.authMethods.sso ? "SAML/SSO 已启用" : "SAML/SSO 未配置"}
            </span>
            <span className={`rounded-full px-3 py-1.5 ${connection ? "bg-cyan-50 text-cyan-700" : "bg-gray-100 text-gray-500"}`}>
              {connection ? "SCIM 已连接" : "SCIM 未配置"}
            </span>
          </div>

          {error ? (
            <DenNotice message={error} className="mb-6" />
          ) : null}

          {!ssoReady ? (
            <div className="mb-6 rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-6 py-5 text-[14px] text-[var(--dls-text-primary)]">
              <p className="font-semibold">请先配置 SAML/SSO，再启用 SCIM</p>
              <p className="mt-1 leading-6">
                请先为工作区添加已启用的 SSO 连接，再创建或轮换 SCIM 连接器令牌。
              </p>
            </div>
          ) : null}

          {health.unresolvedFailureCount > 0 ? (
            <div className="mb-6 rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-6 py-5 text-[14px] text-[var(--dls-text-primary)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">SCIM 需要处理</p>
                  <p className="mt-1 leading-6">
                    {health.unresolvedFailureCount} SCIM 同步问题{health.unresolvedFailureCount === 1 ? "" : "s"} 仍需重试或检查。
                  </p>
                  {health.lastFailureMessage ? (
                    <p className="mt-1 break-words text-[13px] leading-6">
                      上次问题： {health.lastFailureMessage}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[13px] leading-6">
                    上次失败 {formatDateTime(health.lastFailureAt)} · 下次重试 {formatDateTime(health.nextRetryAt)}
                  </p>
                </div>
                <DenButton variant="secondary" icon={RefreshCw} onClick={() => void handleRunReconciliation()} loading={reconciling} disabled={!access.canManageScim}>
                  立即协调同步
                </DenButton>
              </div>
            </div>
          ) : null}

          <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                  SCIM 基础地址
                </p>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">
                  在身份提供商要求 SCIM 端点时使用此地址。
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  SCIM 支持用户生命周期管理与群组同步。
                </p>
              </div>
              <DenButton
                variant="secondary"
                icon={Copy}
                onClick={() => void copyValue(baseUrl, "base-url")}
                disabled={!baseUrl}
              >
                {copiedValue === "base-url" ? "已复制" : "复制地址"}
              </DenButton>
            </div>

            <div className="mt-5 rounded-[20px] border border-gray-200 bg-gray-50 p-4">
              <code className="block break-all text-[13px] leading-6 text-gray-700">
                {baseUrl ?? (busy ? "正在加载…" : "不可用")}
              </code>
            </div>
          </div>

          <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                    根据 SCIM 群组创建团队
                  </p>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${connection?.groupMappingMode === "create_teams" ? "bg-cyan-50 text-cyan-700" : "bg-gray-100 text-gray-500"}`}>
                    {connection?.groupMappingMode === "create_teams" ? "已启用" : "关闭"}
                  </span>
                </div>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">
                  创建对应的 OpenWork 团队，并从身份提供商持续同步成员关系。手动管理的团队保持不变。
                </p>
              </div>
              <DenButton
                variant={connection?.groupMappingMode === "create_teams" ? "secondary" : "primary"}
                onClick={() => void handleGroupMappingChange()}
                loading={updatingGroupMapping}
                disabled={!access.canManageScim || !connection}
              >
                {connection?.groupMappingMode === "create_teams" ? "禁用" : "启用团队同步"}
              </DenButton>
            </div>
          </div>

          <div className="mb-6 rounded-[30px] border border-gray-200 bg-white p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                  连接器令牌
                </p>
                <p className="mt-1 text-[14px] leading-6 text-gray-500">
                  {connection
                    ? "身份提供商需要新密钥时，可轮换持有者令牌。"
                    : "创建工作区 SCIM 连接器，并生成首个持有者令牌。"}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <DenButton icon={RefreshCw} onClick={() => void handleRotateToken()} loading={rotating} disabled={!access.canManageScim || !ssoReady}>
                  {connection ? "轮换令牌" : "创建连接器"}
                </DenButton>
                {connection ? (
                  <DenButton
                    variant="destructive"
                    icon={Trash2}
                    onClick={() => void handleDeleteConnection()}
                    loading={deleting}
                    disabled={!access.canManageScim}
                  >
                    删除连接器
                  </DenButton>
                ) : null}
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-[20px] border border-gray-200 bg-gray-50 p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                  状态
                </p>
                <p className="mt-2 text-[15px] font-medium text-gray-900">
                  {busy ? "正在加载…" : connection ? "已连接" : "未配置"}
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  上次轮换 {formatDateTime(connection?.updatedAt ?? null)}
                </p>
                {connection ? (
                  <p className="mt-2 break-all text-[12px] text-gray-400">
                    内部提供商 ID： {connection.providerId}
                  </p>
                ) : null}
              </div>

              <div className="rounded-[20px] border border-cyan-100 bg-cyan-50 p-4 text-[13px] leading-6 text-cyan-900">
                SCIM 取消预配后会保留已断开的成员记录。仅在用户最后一个有效组织成员关系被移除后，才会删除全局用户。
                <p className="mt-2">
                  上次成功的 SCIM 同步： {formatDateTime(health.lastSuccessfulSyncAt)}.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-gray-200 bg-gray-50 p-4 text-[13px] leading-6 text-gray-600">
              OpenWork 会记录失败的 SCIM 生命周期操作以便重试，定期协调同步本地 SCIM 差异，并在此显示未解决问题，避免取消预配失败被忽略。
              <div className="mt-3">
                <DenButton variant="secondary" icon={RefreshCw} onClick={() => void handleRunReconciliation()} loading={reconciling} disabled={!access.canManageScim}>
                  运行协调同步
                </DenButton>
              </div>
            </div>

            {visibleToken ? (
              <div className="mt-5 rounded-[24px] bg-[#0f172a] p-6 text-white">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[16px] font-semibold tracking-[-0.03em]">
                      SCIM 持有者令牌已就绪
                    </p>
                    <p className="mt-1 text-[14px] leading-6 text-slate-300">
                      请立即复制，此值仅在创建或轮换后显示一次。
                    </p>
                  </div>
                  <DenButton
                    variant="secondary"
                    icon={Copy}
                    onClick={() => void copyValue(visibleToken, "token")}
                  >
                    {copiedValue === "token" ? "已复制" : "复制令牌"}
                  </DenButton>
                </div>

                <div className="mt-5 rounded-[20px] border border-white/10 bg-white/5 p-4">
                  <code className="block break-all text-[13px] leading-6 text-cyan-200">
                    {visibleToken}
                  </code>
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </DashboardPageTemplate>
  );
}
