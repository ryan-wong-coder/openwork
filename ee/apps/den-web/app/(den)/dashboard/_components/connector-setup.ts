"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { connectorAccountReady } from "./connector-detail";
import { type ConnectorSignInMethod, connectorSignInMethod, oauthClientSecretRequired, oauthRequestFields } from "./connector-sign-in-method";
import { libraryQueryKeys } from "./library-data";
import { credentialModeForAuth, personalApiKeyStatus, usesMemberApiKey } from "./member-api-key";
import { resolveMcpAuthorizationPollOutcome } from "./mcp-account-authorization-state";
import { openMcpAuthorizationTab, safeMcpAuthorizationUrl, showMcpAuthorizationFailure } from "./mcp-authorization-url";
import {
  apiKeyAuthSchemeInput,
  DEFAULT_API_KEY_AUTH_SCHEME,
  type CreateMcpConnectionInput,
  type ExternalMcpApiKeyAuthScheme,
  type ExternalMcpConnection,
  type ExternalMcpPreset,
  type ExternalMcpTool,
  type McpRequirementsDiscovery,
  McpOAuthStartError,
  mcpConnectionQueryKeys,
  useCreateMcpConnection,
  useDeleteMcpConnection,
  useDiscoverMcpConnectionRequirements,
  useMcpConnections,
  useMcpConnectionTools,
  useStartMcpConnectionOAuth,
} from "./mcp-connections-data";
import type { SetupCheck } from "./setup-checks";

export type ConnectorTarget = {
  name: string;
  url: string;
  description: string;
  /** The catalog preset's own sign-in requirement, when the target came from the catalog. */
  preset?: Pick<ExternalMcpPreset, "authType" | "requiresOAuthClient" | "defaultOAuthClientId"> | null;
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

/** "send_message" reads as "Send message". */
export function toolTitle(tool: Pick<ExternalMcpTool, "name" | "title" | "annotations">): string {
  const raw = tool.title ?? tool.annotations?.title ?? tool.name.replace(/[_-]+/g, " ");
  const words = raw.trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : tool.name;
}

/** One sentence from a tool description, without markdown or trailing detail. */
export function toolSummary(tool: Pick<ExternalMcpTool, "description">): string {
  const text = (tool.description ?? "").replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentence = text.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? text;
  return sentence.length > 90 ? `${sentence.slice(0, 87).trimEnd()}...` : sentence;
}

export function toolsSentence(tools: readonly Pick<ExternalMcpTool, "name" | "title" | "annotations">[]): string {
  if (tools.length === 0) return "暂无待处理操作。";
  const examples = tools.slice(0, 2).map((tool) => toolTitle(tool).toLowerCase());
  const count = tools.length === 1 ? "1 项" : `${tools.length} 项内容`;
  return `${count}，例如 ${examples.join("和")}。`;
}

type SignInState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "failed"; message: string };

export type ConnectorSetupMode = "admin" | "member";

/** The fields step two needs from an admin before anyone can sign in. */
export type OAuthAppInput = { clientId: string; clientSecret: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Runs the four setup checks for one connector: OpenWork finds the server,
 * learns how people sign in, signs the viewer in, and reads what the AI can do.
 * The connection is created for the viewer only: at sign-in, when an admin
 * saves the key or OAuth app step two asks for, or right away when there is
 * nothing to sign in to.
 */
export function useConnectorSetup({ target, initialConnectionId, onConnectionCreated, mode = "member" }: {
  target: ConnectorTarget | null;
  initialConnectionId: string | null;
  onConnectionCreated?: (connectionId: string) => void;
  mode?: ConnectorSetupMode;
}) {
  const queryClient = useQueryClient();
  const { orgId, orgContext } = useOrgDashboard();
  const discover = useDiscoverMcpConnectionRequirements();
  const createConnection = useCreateMcpConnection();
  const deleteConnection = useDeleteMcpConnection();
  const startOAuth = useStartMcpConnectionOAuth();
  const usable = useMcpConnections("usable");
  const [discovery, setDiscovery] = useState<McpRequirementsDiscovery | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(initialConnectionId);
  const [createdHere, setCreatedHere] = useState(false);
  const [signIn, setSignIn] = useState<SignInState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const discoveredUrl = useRef<string | null>(null);
  const autoCreated = useRef(false);

  const connection: ExternalMcpConnection | null = usable.data?.find((entry) => entry.id === connectionId) ?? null;
  const findDone = discovery !== null && discovery.status !== "unreachable" && discovery.status !== "unsupported";
  const method: ConnectorSignInMethod | null = findDone && discovery ? connectorSignInMethod(discovery, target?.preset) : null;
  const signedIn = Boolean(connection && (connection.authType === "none" || connectorAccountReady(connection)));
  const apiKeyConfigured = connection?.authType === "apikey";
  const usesIndividualKeys = Boolean(connection && usesMemberApiKey(connection));
  const tools = useMcpConnectionTools(connectionId ?? "", signedIn && !usesIndividualKeys);

  useEffect(() => {
    // A deep link can resolve the catalog entry before the organization loads.
    if (!target || !orgId || discoveredUrl.current === target.url) return;
    discoveredUrl.current = target.url;
    setDiscovery(null);
    setDiscoveryError(null);
    discover.mutateAsync(target.url)
      .then((result) => setDiscovery(result))
      .catch((error: unknown) => setDiscoveryError(errorMessage(error, "OpenWork 无法连接此服务。")));
  }, [discover, orgId, target]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const createForMe = useCallback(async (auth: Pick<CreateMcpConnectionInput, "authType"> & Partial<Pick<CreateMcpConnectionInput, "apiKey" | "apiKeyAuthScheme" | "credentialMode" | "oauthClient">>) => {
    if (!target || !orgContext) throw new Error("组织仍在加载，请稍后重试。");
    const created = await createConnection.mutateAsync({
      name: target.name,
      url: target.url,
      authType: auth.authType,
      credentialMode: credentialModeForAuth(
        auth.authType,
        auth.credentialMode ?? (auth.authType === "oauth" ? "per_member" : "shared"),
      ),
      ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
      ...apiKeyAuthSchemeInput(auth.authType, auth.apiKeyAuthScheme ?? DEFAULT_API_KEY_AUTH_SCHEME),
      ...(auth.oauthClient ? { oauthClient: auth.oauthClient } : {}),
      ...(auth.authType === "oauth" ? oauthRequestFields(discovery) : {}),
      access: { orgWide: false, memberIds: [orgContext.currentMember.id], teamIds: [] },
    });
    setConnectionId(created.id);
    setCreatedHere(true);
    onConnectionCreated?.(created.id);
    await Promise.all([
      usable.refetch(),
      queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items }),
    ]);
    return created.id;
  }, [createConnection, discovery, onConnectionCreated, orgContext, queryClient, target, usable]);

  useEffect(() => {
    if (method !== "none" || connectionId || autoCreated.current) return;
    autoCreated.current = true;
    createForMe({ authType: "none" }).catch((error: unknown) => setSignIn({ kind: "failed", message: errorMessage(error, "无法添加此项，请重试。") }));
  }, [method, connectionId, createForMe]);

  /** Step two for a server that takes a key: the admin's key is shared by everyone who gets it. */
  const saveApiKey = useCallback(async (apiKey: string, apiKeyAuthScheme: ExternalMcpApiKeyAuthScheme) => {
    const key = apiKey.trim();
    if (!key) {
      setSaveError("请先粘贴密钥。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await createForMe({ authType: "apikey", credentialMode: "shared", apiKey: key, apiKeyAuthScheme });
    } catch (error) {
      setSaveError(errorMessage(error, "密钥保存失败，请重试。"));
    } finally {
      setSaving(false);
    }
  }, [createForMe]);

  /** Creates one organization connection; every granted member supplies their own key later. */
  const savePerMemberApiKeys = useCallback(async (apiKeyAuthScheme: ExternalMcpApiKeyAuthScheme) => {
    setSaving(true);
    setSaveError(null);
    try {
      await createForMe({ authType: "apikey", credentialMode: "per_member", apiKeyAuthScheme });
    } catch {
      setSaveError("连接保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }, [createForMe]);

  /** Step two for a server that only accepts a pre-registered OAuth app; sign-in follows. */
  const saveOAuthApp = useCallback(async (input: OAuthAppInput) => {
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    if (!clientId) {
      setSaveError("请先粘贴客户端 ID。");
      return;
    }
    if (!clientSecret && oauthClientSecretRequired(discovery)) {
      setSaveError(`${target?.name ?? "此服务器"} 还需要客户端密钥。`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await createForMe({ authType: "oauth", oauthClient: { clientId, ...(clientSecret ? { clientSecret } : {}) } });
    } catch (error) {
      setSaveError(errorMessage(error, "OAuth 应用保存失败，请重试。"));
    } finally {
      setSaving(false);
    }
  }, [createForMe, discovery, target?.name]);

  const startSignIn = useCallback(async () => {
    if (!target) return;
    stopPolling();
    setSignIn({ kind: "waiting" });
    let tab: Window | null = null;
    let id = connectionId;
    try {
      tab = openMcpAuthorizationTab({ connectionId: id ?? "", connectionName: target.name });
      id = id ?? await createForMe({ authType: "oauth" });
      const result = await startOAuth.mutateAsync(id);
      if (result.status === "connected") {
        tab.close();
        await usable.refetch();
        return;
      }
      if (!result.authorizeUrl) throw new Error(`${target.name} 未返回登录页面。`);
      tab.location.href = safeMcpAuthorizationUrl(result.authorizeUrl);
      const openedTab = tab;
      const pollId = id;
      const startedAt = Date.now();
      let fetching = false;
      pollTimer.current = setInterval(async () => {
        if (fetching) return;
        fetching = true;
        const refreshed = await usable.refetch();
        fetching = false;
        const current = refreshed.data?.find((entry) => entry.id === pollId);
        const outcome = resolveMcpAuthorizationPollOutcome({
          connected: Boolean(current && connectorAccountReady(current)),
          authorizationWindowClosed: openedTab.closed,
          elapsedMs: Date.now() - startedAt,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        if (outcome === "pending") return;
        stopPolling();
        if (outcome === "connected") {
          setSignIn({ kind: "idle" });
          void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items });
        } else {
          setSignIn({ kind: "failed", message: "登录未完成，请重试。" });
        }
      }, POLL_INTERVAL_MS);
    } catch (error) {
      const message = errorMessage(error, "未能开始登录，请重试。");
      showMcpAuthorizationFailure(tab, {
        connectionId: id ?? "",
        connectionName: target.name,
        message,
        ...(error instanceof McpOAuthStartError ? { details: error.details } : {}),
      });
      setSignIn({ kind: "failed", message });
    }
  }, [connectionId, createForMe, queryClient, startOAuth, stopPolling, target, usable]);

  /** Cancel removes a connection this flow created and never finished. */
  const discard = useCallback(async () => {
    stopPolling();
    if (connectionId && createdHere) {
      await deleteConnection.mutateAsync(connectionId).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items });
    }
  }, [connectionId, createdHere, deleteConnection, queryClient, stopPolling]);

  const name = target?.name ?? "此连接";
  const findFailed = discoveryError !== null || (discovery !== null && !findDone);
  const needsAdminInput = method === "api_key" || method === "oauth_app";
  const adminInputSaved = needsAdminInput && connection !== null;
  const blocked = needsAdminInput && mode === "member" && !connection;
  const methodFailed = method === "unsupported";
  const methodDone = method === "none" || method === "sign_in" || adminInputSaved;
  const usesKey = method === "api_key" || apiKeyConfigured;
  const canSignIn = !signedIn && signIn.kind !== "waiting" && (method === "sign_in" || (method === "oauth_app" && connection !== null));
  const toolList = tools.data?.tools ?? [];

  const methodDescription = (() => {
    if (methodFailed) return `OpenWork 无法确定 ${name} 的登录方式。`;
    if (method === "none") return "无需登录。";
    if (method === "sign_in") return `使用你自己的 ${name} 账户登录。`;
    if (method === "api_key") {
      if (adminInputSaved) return usesIndividualKeys ? "个人密钥已启用。" : "密钥已添加，所有人可使用。";
      return mode === "member" ? `管理员为 ${name} 添加密钥。` : `${name} 需要密钥。`;
    }
    if (method === "oauth_app") {
      if (adminInputSaved) return "OAuth 应用已添加。";
      return mode === "member" ? `管理员为 ${name} 添加 OAuth 应用。` : `${name} 需要你的 OAuth 应用。`;
    }
    return findDone ? "正在检查。" : "等待首次检查。";
  })();

  const signInDescription = (() => {
    if (signedIn) {
      if (connection?.authType === "none") return "没有需要登录的内容。";
      if (connection?.authType === "apikey") return usesIndividualKeys ? "现在每人均可在“我的资源库”中添加自己的密钥。" : "使用你添加的密钥。";
      return connection?.externalAccountId ? `身份为 ${connection.externalAccountId}。` : "已登录。";
    }
    if (usesIndividualKeys) return "每人添加自己的密钥。";
    if (signIn.kind === "failed") return signIn.message;
    if (signIn.kind === "waiting") return `已在新标签页中打开 ${name}，完成后请返回此页面。`;
    if (canSignIn) return `将在新标签页中打开 ${name}，完成后请返回此页面。`;
    if (usesKey && connection) return "正在检查密钥。";
    return "等待上方检查完成。";
  })();

  const checks: SetupCheck[] = [
    {
      id: "find",
      title: `查找 ${name}`,
      description: findFailed ? `OpenWork 无法连接 ${name}，请检查地址后重试。` : findDone ? `${name} 已响应。` : "正在查找。",
      status: findFailed ? "failed" : findDone ? "done" : "running",
    },
    {
      id: "sign-in-method",
      title: "确认登录方式",
      description: methodDescription,
      status: methodFailed ? "failed" : methodDone ? "done" : blocked ? "blocked" : needsAdminInput ? "current" : findDone ? "running" : "waiting",
    },
    {
      id: "sign-in",
      title: usesIndividualKeys
        ? "个人密钥已启用"
        : signedIn
        ? usesKey ? `已连接 ${name}` : `已登录 ${name}`
        : usesKey ? `连接 ${name}` : `登录 ${name}`,
      description: signInDescription,
      status: usesIndividualKeys
        ? "done"
        : signedIn
        ? "done"
        : signIn.kind === "failed" ? "failed"
          : signIn.kind === "waiting" || (usesKey && connection) || (method === "none" && !connection) ? "running"
            : canSignIn ? "current" : "waiting",
    },
    {
      id: "tools",
      title: usesIndividualKeys ? "首次使用已就绪" : "提供 AI 可用的工具",
      description: usesIndividualKeys
        ? "每人添加有效密钥后即可看到工具。"
        : tools.error
        ? "OpenWork 无法读取此服务的能力，请稍后重试。"
        : tools.data ? toolsSentence(toolList) : signedIn ? "正在读取。" : usesKey ? "密钥验证成功后将在此显示。" : "登录后将在此显示。",
      status: usesIndividualKeys ? "done" : tools.error ? "failed" : tools.data ? "done" : signedIn ? "running" : "waiting",
    },
  ];

  const doneCount = checks.filter((check) => check.status === "done").length;
  const stepNumber = Math.min(checks.findIndex((check) => check.status !== "done") + 1 || checks.length, checks.length);

  return {
    checks,
    allDone: doneCount === checks.length,
    stepNumber,
    connection,
    connectionId,
    tools: toolList,
    method,
    /** Step two is waiting on a key or OAuth app from this viewer. */
    needsInput: needsAdminInput && mode === "admin" && !connection,
    secretRequired: oauthClientSecretRequired(discovery),
    saving,
    saveError,
    saveApiKey,
    savePerMemberApiKeys,
    saveOAuthApp,
    canSignIn,
    signingIn: signIn.kind === "waiting",
    startSignIn,
    discard,
  };
}

/** Signs the viewer in to a connector someone gave them, from a list row or its page. */
export function useMemberSignIn() {
  const queryClient = useQueryClient();
  const startOAuth = useStartMcpConnectionOAuth();
  const usable = useMcpConnections("usable");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [apiKeyTarget, setApiKeyTarget] = useState<{ id: string; name: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items }),
    queryClient.invalidateQueries({ queryKey: mcpConnectionQueryKeys.all }),
  ]);

  async function signIn(item: {
    id: string;
    name: string;
    authType?: ExternalMcpConnection["authType"];
    credentialMode?: ExternalMcpConnection["credentialMode"];
  }) {
    const connection = usable.data?.find((entry) => entry.id === item.id);
    const authType = item.authType ?? connection?.authType;
    const credentialMode = item.credentialMode ?? connection?.credentialMode;
    if (authType === "apikey" && credentialMode === "per_member") {
      if (timer.current) clearInterval(timer.current);
      setPendingId(null);
      setFailure(null);
      setApiKeyTarget({ id: item.id, name: item.name });
      return;
    }
    if (timer.current) clearInterval(timer.current);
    setPendingId(item.id);
    setFailure(null);
    let tab: Window | null = null;
    try {
      tab = openMcpAuthorizationTab({ connectionId: item.id, connectionName: item.name });
      const result = await startOAuth.mutateAsync(item.id);
      if (result.status === "connected" || !result.authorizeUrl) {
        tab.close();
        setPendingId(null);
        await refresh();
        return;
      }
      tab.location.href = safeMcpAuthorizationUrl(result.authorizeUrl);
      const openedTab = tab;
      const startedAt = Date.now();
      timer.current = setInterval(() => {
        void refresh();
        if (openedTab.closed || Date.now() - startedAt > 90_000) {
          if (timer.current) clearInterval(timer.current);
          setPendingId(null);
        }
      }, 1500);
    } catch (error) {
      const message = errorMessage(error, "未能开始登录，请重试。");
      showMcpAuthorizationFailure(tab, {
        connectionId: item.id,
        connectionName: item.name,
        message,
        ...(error instanceof McpOAuthStartError ? { details: error.details } : {}),
      });
      setFailure({ id: item.id, message });
      setPendingId(null);
    }
  }

  function apiKeyStatus(connectionId: string) {
    const connection = usable.data?.find((entry) => entry.id === connectionId);
    return connection ? personalApiKeyStatus(connection) : null;
  }

  return {
    apiKeyStatus,
    apiKeyTarget,
    closeApiKey: () => setApiKeyTarget(null),
    failure,
    pendingId,
    signIn,
  };
}
