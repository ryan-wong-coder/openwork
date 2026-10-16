"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Github,
  LoaderCircle,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { StaticSeededGradient } from "@openwork/ui/react";
import {
  getGithubIntegrationAccountRoute,
  getGithubIntegrationRoute,
  getGithubIntegrationSetupRoute,
  getPluginSourcesRoute,
} from "../../_lib/den-org";
import { buttonVariants, DenButton } from "../../_components/ui/button";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenInput } from "../../_components/ui/input";
import {
  type IntegrationRepo,
  useApplyGithubDiscovery,
  useConnectorInstanceConfiguration,
  useCreateGithubConnectorInstance,
  useGithubAccountRepositories,
  useGithubConnectorDiscovery,
  useGithubInstallCompletion,
  useIntegrations,
  useRemoveConnectorInstance,
  useSetConnectorInstanceAutoImport,
  useSyncConnectorInstanceNow,
} from "./integration-data";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

function parseInstallationId(value: string | null) {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function GithubIntegrationScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orgSlug } = useOrgDashboard();
  const connectorInstanceId = searchParams.get("connectorInstanceId")?.trim() ?? null;
  const connectorAccountId = searchParams.get("connectorAccountId")?.trim() ?? null;
  const mode = searchParams.get("mode")?.trim() ?? null;
  const installationId = parseInstallationId(searchParams.get("installation_id"));
  const state = searchParams.get("state")?.trim() ?? null;

  if (connectorInstanceId) {
    return (
      <GithubConnectorInstanceRouter
        connectorInstanceId={connectorInstanceId}
        mode={mode}
        onBack={() => router.push(getPluginSourcesRoute(orgSlug))}
      />
    );
  }

  if (connectorAccountId) {
    return <GithubConnectedAccountSelectionPhase connectorAccountId={connectorAccountId} />;
  }

  if (installationId && state) {
    return <GithubInstallCompletionRedirect installationId={installationId} state={state} />;
  }

  return (
    <DashboardPageTemplate
      icon={Github}
      title="连接 GitHub"
      description="从“集成”页面选择已连接账户以继续。"
    >
      <StatePanel
        title="此处暂无待处理操作"
        body="返回“集成”以连接新的 GitHub 账户或配置其他仓库。"
      />
    </DashboardPageTemplate>
  );
}

function GithubInstallCompletionRedirect({ installationId, state }: { installationId: number; state: string }) {
  const { orgSlug } = useOrgDashboard();
  const queryClient = useQueryClient();
  const completionQuery = useGithubInstallCompletion({ installationId, state });

  useEffect(() => {
    if (!completionQuery.data) return;

    queryClient.invalidateQueries({ queryKey: ["integrations"] });
    if (completionQuery.data.repositories.length > 0) {
      queryClient.setQueryData(
        ["integrations", "repos", "github", completionQuery.data.connectorAccount.id, "connected-account"],
        completionQuery.data.repositories,
      );
    }

    const nextUrl = getGithubIntegrationAccountRoute(orgSlug, completionQuery.data.connectorAccount.id);
    window.location.replace(nextUrl);
  }, [completionQuery.data, orgSlug, queryClient]);

  return (
    <DashboardPageTemplate
      icon={Github}
      title="正在完成 GitHub 连接"
      description="OpenWork 正在完成此组织的 GitHub 应用安装。"
    >
      {completionQuery.error ? (
        <StatePanel
          title="无法完成 GitHub 连接"
          body={completionQuery.error instanceof Error ? completionQuery.error.message : "GitHub 安装发生未知错误，请重试。"}
        />
      ) : (
        <section className="flex flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden />
          </div>
          <h2 className="mt-5 text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
            正在完成 GitHub 连接
          </h2>
          <p className="mt-2 max-w-[460px] text-[13px] leading-[1.6] text-gray-500">
            OpenWork 正在解析安装并加载可访问仓库。
          </p>
        </section>
      )}
    </DashboardPageTemplate>
  );
}

function GithubConnectorInstanceRouter({
  connectorInstanceId,
  mode,
  onBack,
}: {
  connectorInstanceId: string;
  mode: string | null;
  onBack: () => void;
}) {
  const configurationQuery = useConnectorInstanceConfiguration(connectorInstanceId);

  if (configurationQuery.isLoading) {
    return <ConfigurationLoadingState />;
  }

  const configuration = configurationQuery.data;
  const hasConfigured = Boolean(configuration && configuration.configuredPlugins.length > 0);
  const shouldRunDiscovery = !hasConfigured || mode === "rediscover";

  if (shouldRunDiscovery) {
    return (
      <GithubDiscoveryPhase
        connectorInstanceId={connectorInstanceId}
        onBack={onBack}
      />
    );
  }

  if (!configuration) {
    return (
      <GithubDiscoveryPhase
        connectorInstanceId={connectorInstanceId}
        onBack={onBack}
      />
    );
  }

  return (
    <GithubConnectorInstanceManagePhase
      configuration={configuration}
      onBack={onBack}
    />
  );
}

function ConfigurationLoadingState() {
  return (
    <DashboardPageTemplate
      icon={Puzzle}
      title="正在加载…"
      description="OpenWork 正在加载此仓库的连接器配置。"
    >
      <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-center shadow-xs">
        <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-gray-400" />
        <p className="mt-3 text-[14px] text-gray-500">正在加载连接器配置…</p>
      </div>
    </DashboardPageTemplate>
  );
}

function GithubConnectorInstanceManagePhase({
  configuration,
  onBack,
}: {
  configuration: {
    autoImportNewPlugins: boolean;
    configuredPlugins: Array<{
      id: string;
      name: string;
      description: string | null;
      memberCount: number;
      componentCounts: Record<string, number>;
      rootPath: string | null;
    }>;
    connectorInstanceId: string;
    connectorInstanceName: string;
    importedConfigObjectCount: number;
    mappingCount: number;
    repositoryFullName: string | null;
  };
  onBack: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orgSlug } = useOrgDashboard();
  const removeMutation = useRemoveConnectorInstance();
  const autoImportMutation = useSetConnectorInstanceAutoImport();
  const syncNowMutation = useSyncConnectorInstanceNow();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoImportChecked, setAutoImportChecked] = useState(configuration.autoImportNewPlugins);

  useEffect(() => {
    setAutoImportChecked(configuration.autoImportNewPlugins);
  }, [configuration.autoImportNewPlugins]);

  const repoName = configuration.repositoryFullName ?? configuration.connectorInstanceName;

  async function handleRemove() {
    await removeMutation.mutateAsync(configuration.connectorInstanceId);
    onBack();
  }

  function handleRediscover() {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("connectorInstanceId", configuration.connectorInstanceId);
    params.set("mode", "rediscover");
    router.push(`${getGithubIntegrationRoute(orgSlug)}?${params.toString()}`);
  }

  async function handleAutoImportToggle(nextValue: boolean) {
    setAutoImportChecked(nextValue);
    try {
      await autoImportMutation.mutateAsync({
        autoImportNewPlugins: nextValue,
        connectorInstanceId: configuration.connectorInstanceId,
      });
    } catch {
      setAutoImportChecked(configuration.autoImportNewPlugins);
    }
  }

  async function handleSyncNow() {
    syncNowMutation.reset();
    await syncNowMutation.mutateAsync(configuration.connectorInstanceId);
  }

  return (
    <DashboardPageTemplate
      icon={Puzzle}
      title={repoName}
      description="管理 OpenWork 从此仓库导入的插件。"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-400 transition hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        <div className="flex items-center gap-2">
          <DenButton
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            disabled={syncNowMutation.isPending}
            loading={syncNowMutation.isPending}
            onClick={() => void handleSyncNow()}
          >
            立即同步
          </DenButton>
          <DenButton variant="secondary" size="sm" icon={RefreshCw} onClick={handleRediscover}>
            重新发现
          </DenButton>
        </div>
      </div>

      {syncNowMutation.isSuccess ? (
        <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[12.5px] text-emerald-800">
          同步已排队： {syncNowMutation.data} 个目标。
        </div>
      ) : syncNowMutation.error ? (
        <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[12.5px] text-red-700">
          {syncNowMutation.error instanceof Error ? syncNowMutation.error.message : "同步此仓库失败，请重试。"}
        </div>
      ) : null}

      <div className="space-y-8">
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              已导入插件
            </h2>
            <p className="text-[11px] text-gray-400">
              {configuration.configuredPlugins.length} 个插件
            </p>
          </div>

          <div className="mb-4 flex items-start justify-between gap-5 rounded-2xl border border-gray-100 bg-white px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
                自动导入新插件
              </p>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-gray-500">
                后续推送中出现新的插件结构时，OpenWork 将自动发现并导入。
              </p>
              {autoImportMutation.error ? (
                <p className="mt-2 text-[12px] text-red-700">
                  {autoImportMutation.error instanceof Error ? autoImportMutation.error.message : "更新自动导入设置失败，请重试。"}
                </p>
              ) : null}
            </div>
            <Toggle
              checked={autoImportChecked}
              busy={autoImportMutation.isPending}
              onChange={(next) => void handleAutoImportToggle(next)}
            />
          </div>

          {configuration.configuredPlugins.length > 0 ? (
            <div className="grid gap-3">
              {configuration.configuredPlugins.map((plugin) => (
                <PluginListItem key={plugin.id} plugin={plugin} />
              ))}
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-gray-200 bg-white px-5 py-10 text-center">
              <p className="text-[14px] font-medium tracking-[-0.02em] text-gray-800">
                尚未导入插件
              </p>
              <p className="mx-auto mt-2 max-w-[400px] text-[13px] leading-6 text-gray-400">
                重新发现以从此仓库选择插件。
              </p>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-400">
            危险操作
          </h2>
          <div className="overflow-hidden rounded-2xl border border-red-100 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
                  移除此仓库
                </p>
                <p className="mt-1 text-[12.5px] leading-[1.6] text-gray-500">
                  删除 OpenWork 从此仓库导入的全部内容，GitHub 连接保持有效。
                </p>
              </div>
              <DenButton
                variant="destructive"
                size="sm"
                icon={Trash2}
                onClick={() => setConfirmOpen(true)}
                loading={removeMutation.isPending}
              >
                移除
              </DenButton>
            </div>
            {removeMutation.error ? (
              <div className="border-t border-red-100 bg-red-50 px-5 py-2 text-[12px] text-red-700">
                {removeMutation.error instanceof Error ? removeMutation.error.message : "移除此仓库失败，请重试。"}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <RemoveRepositoryConfirmDialog
        open={confirmOpen}
        repoName={repoName}
        pluginCount={configuration.configuredPlugins.length}
        configObjectCount={configuration.importedConfigObjectCount}
        busy={removeMutation.isPending}
        onClose={() => {
          if (!removeMutation.isPending) setConfirmOpen(false);
        }}
        onConfirm={() => {
          void handleRemove();
          setConfirmOpen(false);
        }}
      />
    </DashboardPageTemplate>
  );
}

const COMPONENT_TYPE_LABELS: Record<string, { singular: string; plural: string }> = {
  skill: { singular: "项技能", plural: "项技能" },
  agent: { singular: "个智能体", plural: "个智能体" },
  command: { singular: "条命令", plural: "条命令" },
  hook: { singular: "个钩子", plural: "个钩子" },
  mcp: { singular: "MCP 服务器", plural: "MCP 服务器" },
  mcp_server: { singular: "MCP 服务器", plural: "MCP 服务器" },
  lsp_server: { singular: "LSP 服务器", plural: "LSP 服务器" },
  monitor: { singular: "个监控", plural: "个监控" },
  settings: { singular: "项设置", plural: "项设置" },
};

function formatComponentCount(type: string, count: number) {
  const label = COMPONENT_TYPE_LABELS[type] ?? {
    singular: type.replace(/_/g, " "),
    plural: `${type.replace(/_/g, " ")}s`,
  };
  return `${count} ${count === 1 ? label.singular : label.plural}`;
}

function PluginListItem({ plugin }: {
  plugin: {
    id: string;
    name: string;
    description: string | null;
    componentCounts: Record<string, number>;
    rootPath: string | null;
  };
}) {
  const orderedCountEntries = Object.entries(plugin.componentCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const repoPath = plugin.rootPath === null
    ? null
    : plugin.rootPath === ""
      ? "/"
      : plugin.rootPath;

  return (
    <article className="group overflow-hidden rounded-2xl border border-gray-100 bg-white transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      <div className="flex items-stretch">
        <div className="relative w-[72px] shrink-0 overflow-hidden">
          <StaticSeededGradient seed={plugin.id} className="absolute inset-0" />
          <div className="relative flex h-full items-center justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/60 bg-white shadow-[0_8px_20px_-8px_rgba(15,23,42,0.3)]">
              <Puzzle className="h-4.5 w-4.5 text-gray-700" aria-hidden />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-gray-900">
                {plugin.name}
              </h3>
              {plugin.description ? (
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-[1.55] text-gray-500">
                  {plugin.description}
                </p>
              ) : null}
            </div>
            {repoPath ? (
              <code className="shrink-0 rounded-md bg-gray-50 px-2 py-0.5 font-mono text-[11px] text-gray-500">
                {repoPath}
              </code>
            ) : null}
          </div>

          {orderedCountEntries.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-50 pt-3">
              {orderedCountEntries.map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-0.5 text-[11.5px] text-gray-600"
                >
                  <span className="font-semibold text-gray-900">{count}</span>
                  <span className="text-gray-500">
                    {formatComponentCount(type, count).replace(`${count} `, "")}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Toggle({
  checked,
  busy,
  onChange,
}: {
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-[#0f172a]" : "bg-gray-200"
      } ${busy ? "opacity-60" : ""} focus:outline-hidden focus:ring-2 focus:ring-[#0f172a]/20 focus:ring-offset-2`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_6px_-1px_rgba(15,23,42,0.3)] transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function RemoveRepositoryConfirmDialog({
  open,
  repoName,
  pluginCount,
  configObjectCount,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  repoName: string;
  pluginCount: number;
  configObjectCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Trash2 className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
              移除 {repoName}?
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-gray-600">
              这将删除 OpenWork 从此仓库导入的全部内容，包括：
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px] leading-6 text-gray-600">
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>
                  <strong>{pluginCount}</strong> 个已导入插件{pluginCount === 1 ? "" : "s"}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>
                  <strong>{configObjectCount}</strong> 导入的配置对象{configObjectCount === 1 ? "" : "s"} 及其全部版本
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>此仓库的连接器映射、来源绑定与同步历史</span>
              </li>
              <li className="flex gap-2">
                <span className="text-gray-400">•</span>
                <span>仅从此仓库创建且现已为空的集合</span>
              </li>
            </ul>
            <p className="mt-3 text-[12px] leading-5 text-gray-500">
              GitHub 连接保持有效，之后可从“集成”页面重新添加此仓库。
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DenButton variant="secondary" onClick={onClose} disabled={busy}>
            取消
          </DenButton>
          <DenButton variant="destructive" icon={Trash2} loading={busy} onClick={onConfirm}>
            移除仓库
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function GithubConnectedAccountSelectionPhase({ connectorAccountId }: { connectorAccountId: string }) {
  const { orgSlug } = useOrgDashboard();
  const { data: connections = [], isFetching: connectionsFetching, isLoading: connectionsLoading } = useIntegrations();
  const repositoriesQuery = useGithubAccountRepositories(connectorAccountId);
  const connectMutation = useCreateGithubConnectorInstance();
  const [query, setQuery] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

  const connection = connections.find((entry) => entry.provider === "github" && entry.account.id === connectorAccountId) ?? null;
  const configuredByFullName = new Map(
    (connection?.repos ?? [])
      .filter((entry) => entry.connectorInstanceId)
      .map((entry) => [entry.fullName, entry.connectorInstanceId as string]),
  );
  const allRepos = repositoriesQuery.data ?? [];
  const unconfiguredRepos = allRepos.filter((repo) => !configuredByFullName.has(repo.fullName));
  const filteredRepos = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const base = !normalized
      ? allRepos
      : allRepos.filter((repository) =>
          `${repository.fullName}\n${repository.description}`.toLowerCase().includes(normalized),
        );

    const priority = (repository: IntegrationRepo): number => {
      if (configuredByFullName.has(repository.fullName)) return 0;
      if (repository.manifestKind) return 1;
      return 2;
    };

    return [...base].sort((left, right) => {
      const diff = priority(left) - priority(right);
      if (diff !== 0) return diff;
      return left.fullName.localeCompare(right.fullName);
    });
  }, [allRepos, configuredByFullName, query]);
  const selectedRepo = unconfiguredRepos.find((repo) => repo.id === selectedRepoId) ?? null;

  async function handleConnectRepo() {
    if (!connection?.account.installationId || !selectedRepo || !selectedRepo.defaultBranch) {
      return;
    }

    const repositoryId = Number(selectedRepo.id);
    if (!Number.isInteger(repositoryId) || repositoryId <= 0) {
      return;
    }

    const result = await connectMutation.mutateAsync({
      branch: selectedRepo.defaultBranch,
      connectorAccountId,
      connectorInstanceName: selectedRepo.fullName,
      installationId: connection.account.installationId,
      repositoryFullName: selectedRepo.fullName,
      repositoryId,
    });
    window.location.assign(getGithubIntegrationSetupRoute(orgSlug, result.connectorInstanceId));
  }

  const accessLabel = connection?.account.repositorySelection === "selected"
    ? "仅所选项"
    : "所有仓库";
  const ownerLogin = connection?.account.ownerName ?? connection?.account.name ?? null;
  const totalReadable = allRepos.length;

  return (
    <DashboardPageTemplate
      icon={Github}
      title="添加仓库"
      description={ownerLogin
        ? `选择 @${ownerLogin} 安装已能读取的仓库。`
        : "选择此 GitHub 安装已有读取权限的仓库。"}
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          href={getPluginSourcesRoute(orgSlug)}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-400 transition hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        {ownerLogin ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3 py-1 text-[12px] font-medium text-gray-600">
            <Github className="h-3.5 w-3.5 text-gray-500" aria-hidden />
            @{ownerLogin}
          </span>
        ) : null}
      </div>

      {repositoriesQuery.isLoading || (!connection && (connectionsLoading || connectionsFetching)) ? (
        <StatePanel
          title="正在加载仓库"
          body="OpenWork 正在检查此 GitHub 安装可读取的仓库。"
        />
      ) : repositoriesQuery.error ? (
        <StatePanel
          title="无法加载仓库"
          body={repositoriesQuery.error instanceof Error ? repositoriesQuery.error.message : "无法加载 GitHub 仓库，请重试。"}
        />
      ) : !connection ? (
        <StatePanel
          title="未找到连接器账户"
          body="OpenWork 未找到此 GitHub 连接账户，请返回“集成”并按需重新连接。"
        />
      ) : (
        <div className="space-y-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              仓库
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-gray-400">
              <span>{unconfiguredRepos.length} 个未配置</span>
              <span className="text-gray-300">·</span>
              <span>{totalReadable} 个可读取</span>
              <span className="text-gray-300">·</span>
              <span>{accessLabel}</span>
            </div>
          </div>

          {allRepos.length > 0 ? (
            <>
              <DenInput
                type="search"
                icon={Search}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索仓库"
              />

              {filteredRepos.length > 0 ? (
                <div className="grid gap-2">
                  {filteredRepos.map((repository) => {
                    const configuredInstanceId = configuredByFullName.get(repository.fullName) ?? null;
                    return (
                      <RepositoryCard
                        key={repository.id}
                        fullName={repository.fullName}
                        defaultBranch={repository.defaultBranch ?? null}
                        manifestKind={repository.manifestKind ?? null}
                        marketplacePluginCount={repository.marketplacePluginCount ?? null}
                        configuredInstanceId={configuredInstanceId}
                        configuredHref={configuredInstanceId ? `${getGithubIntegrationRoute(orgSlug)}?connectorInstanceId=${encodeURIComponent(configuredInstanceId)}` : null}
                        selected={!configuredInstanceId && selectedRepoId === repository.id}
                        onSelect={() => {
                          if (!configuredInstanceId) setSelectedRepoId(repository.id);
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center">
                  <p className="text-[14px] font-medium tracking-[-0.02em] text-gray-800">
                    没有符合搜索条件的仓库
                  </p>
                  <p className="mx-auto mt-2 max-w-[360px] text-[13px] leading-6 text-gray-400">
                    请尝试其他关键词，或从上方列表中选择。
                  </p>
                </div>
              )}

              {selectedRepo ? (
                <div className="flex flex-col-reverse items-stretch justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-gray-900">
                      {selectedRepo.fullName}
                    </p>
                    <p className="truncate text-[11.5px] text-gray-500">
                      <GitBranch className="mr-1 inline h-3 w-3 text-gray-400" aria-hidden />
                      {selectedRepo.defaultBranch ?? "默认分支不可用"}
                    </p>
                  </div>
                  <DenButton
                    disabled={!selectedRepo.defaultBranch}
                    loading={connectMutation.isPending}
                    onClick={() => void handleConnectRepo()}
                  >
                    开始发现
                  </DenButton>
                </div>
              ) : unconfiguredRepos.length > 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-400">
                  从上方选择仓库以开始发现。
                </div>
              ) : null}
            </>
          ) : null}

          {unconfiguredRepos.length === 0 && allRepos.length > 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center">
              <p className="text-[14px] font-medium tracking-[-0.02em] text-gray-800">
                此处已全部配置完成
              </p>
              <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-6 text-gray-500">
                {connection.account.repositorySelection === "selected"
                  ? "此 GitHub 安装仅限所选仓库，OpenWork 已全部配置完成。"
                  : "此 GitHub 安装已可访问该所有者的全部仓库，目前没有未配置仓库。"}
              </p>
              {connection.account.repositorySelection === "selected" && connection.account.manageUrl ? (
                <a
                  href={connection.account.manageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`${buttonVariants({ variant: "primary", size: "sm" })} mt-5 inline-flex gap-2`}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  在 GitHub 上授权更多仓库
                </a>
              ) : null}
            </div>
          ) : null}

          {allRepos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center">
              <p className="text-[14px] font-medium tracking-[-0.02em] text-gray-800">
                没有可用仓库
              </p>
              <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-6 text-gray-500">
                此 GitHub 安装目前没有 OpenWork 可读取的仓库。
              </p>
            </div>
          ) : null}

          {connectMutation.error ? (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {connectMutation.error instanceof Error ? connectMutation.error.message : "创建连接器实例失败，请重试。"}
            </div>
          ) : null}
        </div>
      )}
    </DashboardPageTemplate>
  );
}

function manifestLabel(kind: "agent-plugin" | "marketplace" | "plugin" | null, marketplacePluginCount: number | null): string | null {
  if (kind === "agent-plugin") {
    return "已发现代理插件";
  }
  if (kind === "marketplace") {
    if (marketplacePluginCount && marketplacePluginCount > 1) {
      return `Claude 插件市场 · ${marketplacePluginCount} 个插件`;
    }
    return "已发现 Claude 市场";
  }
  if (kind === "plugin") {
    return "已发现 Claude 插件";
  }
  return null;
}

function RepositoryCard({
  fullName,
  defaultBranch,
  manifestKind,
  marketplacePluginCount,
  configuredInstanceId,
  configuredHref,
  selected,
  onSelect,
}: {
  fullName: string;
  defaultBranch: string | null;
  manifestKind: "agent-plugin" | "marketplace" | "plugin" | null;
  marketplacePluginCount: number | null;
  configuredInstanceId: string | null;
  configuredHref: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = manifestLabel(manifestKind, marketplacePluginCount);
  const isConfigured = Boolean(configuredInstanceId);

  const innerContent = (
    <div className="flex items-stretch">
      <div className="relative w-[72px] shrink-0 overflow-hidden">
        <StaticSeededGradient seed={fullName} className="absolute inset-0" />
        <div className="relative flex h-full items-center justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/60 bg-white shadow-[0_8px_20px_-8px_rgba(15,23,42,0.3)]">
            <GitBranch className="h-4 w-4 text-gray-700" aria-hidden />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-4 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
              {fullName}
            </p>
            {isConfigured ? (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-gray-600">
                已配置
              </span>
            ) : null}
            {badge ? (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-emerald-700">
                {badge}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-gray-500">
            {defaultBranch ? `${defaultBranch} 分支` : "默认分支不可用"}
          </p>
        </div>

        {isConfigured ? (
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition group-hover:bg-gray-100 group-hover:text-gray-900"
          >
            <Settings className="h-4 w-4" />
          </span>
        ) : (
          <span
            role="radio"
            aria-checked={selected}
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition ${
              selected
                ? "border-[#0f172a] bg-[#0f172a] text-white"
                : "border-gray-300 bg-white text-transparent group-hover:border-gray-500"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${selected ? "bg-white" : "bg-transparent"}`} />
          </span>
        )}
      </div>
    </div>
  );

  const baseClass = `group block w-full overflow-hidden rounded-2xl border text-left transition ${
    selected
      ? "border-[var(--dls-border)] bg-[var(--dls-active)]"
      : "border-gray-100 bg-white hover:border-gray-200 hover:bg-[var(--dls-hover)]"
  }`;

  if (isConfigured && configuredHref) {
    return (
      <Link href={configuredHref} aria-label={`配置 ${fullName}`} className={baseClass}>
        {innerContent}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onSelect} className={baseClass}>
      {innerContent}
    </button>
  );
}

function GithubDiscoveryPhase({ connectorInstanceId, onBack }: { connectorInstanceId: string; onBack: () => void }) {
  const discoveryQuery = useGithubConnectorDiscovery(connectorInstanceId);
  const applyMutation = useApplyGithubDiscovery();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [autoImportNewPlugins, setAutoImportNewPlugins] = useState(true);

  useEffect(() => {
    if (!discoveryQuery.data) {
      return;
    }

    setSelectedKeys(
      discoveryQuery.data.discoveredPlugins
        .filter((plugin) => plugin.supported && plugin.selectedByDefault)
        .map((plugin) => plugin.key),
    );
    // Discovery is a fresh-intent operation: default the toggle ON each time
    // the user enters the flow, regardless of the previously saved value.
    setAutoImportNewPlugins(true);
  }, [discoveryQuery.data]);

  const selectedPlugins = (discoveryQuery.data?.discoveredPlugins ?? []).filter((plugin) => selectedKeys.includes(plugin.key));

  async function handleApply() {
    const result = await applyMutation.mutateAsync({
      autoImportNewPlugins,
      connectorInstanceId,
      selectedKeys,
    });

    if (result.createdPluginNames.length === 0 && result.createdMappingCount === 0) {
      return;
    }
  }

  function toggleCandidate(key: string) {
    setSelectedKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  const repoName = discoveryQuery.data?.repositoryFullName ?? null;

  return (
    <DashboardPageTemplate
      icon={Sparkles}
      title={repoName ?? "发现仓库"}
      description="选择 OpenWork 应从此仓库导入的插件。"
    >
      <div className="mb-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-400 transition hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        {discoveryQuery.data ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-100 bg-white px-3 py-1 text-[11px] font-medium text-gray-600">
            <GitBranch className="h-3 w-3 text-gray-400" aria-hidden />
            <code className="font-mono">{discoveryQuery.data.sourceRevisionRef.slice(0, 7)}</code>
          </span>
        ) : null}
      </div>

      {discoveryQuery.isLoading ? (
        <DiscoveryLoadingState />
      ) : discoveryQuery.error ? (
        <StatePanel
          title="发现失败"
          body={discoveryQuery.error instanceof Error ? discoveryQuery.error.message : "OpenWork 无法检查已连接仓库，请重试。"}
        />
      ) : applyMutation.isSuccess ? (
        <DiscoveryAppliedState
          createdPluginNames={applyMutation.data.createdPluginNames}
          createdMappingCount={applyMutation.data.createdMappingCount}
          materializedConfigObjectCount={applyMutation.data.materializedConfigObjectCount}
          onDone={onBack}
        />
      ) : discoveryQuery.data ? (
        <div className="space-y-5">
          {discoveryQuery.data.warnings.length > 0 ? (
            <div className="rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-hover)] px-4 py-3 text-[12.5px] text-[var(--dls-text-primary)]">
              {discoveryQuery.data.warnings[0]}
            </div>
          ) : null}
          {discoveryQuery.data.treeSummary.truncated ? (
            <div className="rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-hover)] px-4 py-3 text-[12.5px] text-[var(--dls-text-primary)]">
              GitHub 返回的文件树被截断，发现结果基于目前已返回的路径。
            </div>
          ) : null}

          <div>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                已发现的插件
              </h2>
              <p className="text-[11px] text-gray-400">
                已选择 {selectedPlugins.length} / {discoveryQuery.data.discoveredPlugins.length} 项
              </p>
            </div>

            <div className="mb-4 flex items-start justify-between gap-5 rounded-2xl border border-gray-100 bg-white px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
                  自动导入新插件
                </p>
                <p className="mt-1 text-[12.5px] leading-[1.6] text-gray-500">
                  后续推送中出现新的插件结构时，OpenWork 将自动发现并导入。
                </p>
              </div>
              <Toggle
                checked={autoImportNewPlugins}
                busy={false}
                onChange={(next) => setAutoImportNewPlugins(next)}
              />
            </div>

            {discoveryQuery.data.discoveredPlugins.length > 0 ? (
              <div className="grid gap-3">
                {discoveryQuery.data.discoveredPlugins.map((plugin) => (
                  <DiscoveredPluginCard
                    key={plugin.key}
                    plugin={plugin}
                    selected={selectedKeys.includes(plugin.key)}
                    onToggle={() => {
                      if (plugin.supported) toggleCandidate(plugin.key);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center">
                <p className="text-[14px] font-medium tracking-[-0.02em] text-gray-800">
                  未发现兼容 Claude 的插件
                </p>
                <p className="mx-auto mt-2 max-w-[440px] text-[13px] leading-6 text-gray-500">
                  OpenWork 目前仅支持兼容 Claude 的插件与市场，请添加 <code className="rounded-sm bg-gray-100 px-1 py-0.5 text-[11px]">.claude-plugin/marketplace.json</code> 或 <code className="rounded-sm bg-gray-100 px-1 py-0.5 text-[11px]">.claude-plugin/plugin.json</code> 到此仓库。
                </p>
              </div>
            )}
          </div>

          {discoveryQuery.data.discoveredPlugins.length > 0 ? (
            <div className="flex flex-col-reverse items-stretch justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 text-[12.5px] text-gray-500">
                {selectedPlugins.length === 0
                  ? "请至少选择一个插件导入。"
                  : `将在 OpenWork 中创建 ${selectedPlugins.length} 个插件及其映射。`}
              </div>
              <DenButton
                disabled={selectedPlugins.length === 0}
                loading={applyMutation.isPending}
                onClick={() => void handleApply()}
              >
                创建插件与映射
              </DenButton>
            </div>
          ) : null}

          {applyMutation.error ? (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {applyMutation.error instanceof Error ? applyMutation.error.message : "应用发现结果失败，请重试。"}
            </div>
          ) : null}
        </div>
      ) : null}
    </DashboardPageTemplate>
  );
}

function DiscoveredPluginCard({
  plugin,
  selected,
  onToggle,
}: {
  plugin: {
    key: string;
    displayName: string;
    description: string | null;
    rootPath: string;
    sourceKind: string;
    supported: boolean;
    componentKinds: string[];
    warnings: string[];
  };
  selected: boolean;
  onToggle: () => void;
}) {
  const repoPath = plugin.rootPath === "" ? "/" : plugin.rootPath;

  const baseClass = `group block w-full overflow-hidden rounded-2xl border text-left transition ${
    !plugin.supported
      ? "cursor-not-allowed border-gray-100 bg-white opacity-70"
      : "border-gray-100 bg-white hover:border-gray-200 hover:bg-[var(--dls-hover)]"
  }`;

  return (
    <button type="button" onClick={onToggle} disabled={!plugin.supported} className={baseClass}>
      <div className="flex items-stretch">
        <div className="relative w-[72px] shrink-0 overflow-hidden">
          <StaticSeededGradient seed={plugin.key} className="absolute inset-0" />
          <div className="relative flex h-full items-center justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/60 bg-white shadow-[0_8px_20px_-8px_rgba(15,23,42,0.3)]">
              <Puzzle className="h-4 w-4 text-gray-700" aria-hidden />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-gray-900">
                  {plugin.displayName}
                </h3>
                {!plugin.supported ? (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-amber-700">
                    不支持
                  </span>
                ) : null}
              </div>
              {plugin.description ? (
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-[1.55] text-gray-500">
                  {plugin.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <code className="rounded-md bg-gray-50 px-2 py-0.5 font-mono text-[11px] text-gray-500">
                {repoPath}
              </code>
              <span
                role="checkbox"
                aria-checked={selected}
                aria-disabled={!plugin.supported}
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition ${
                  !plugin.supported
                    ? "border-gray-200 bg-gray-50 text-transparent"
                    : selected
                      ? "border-[#0f172a] bg-[#0f172a] text-white"
                      : "border-gray-300 bg-white text-transparent group-hover:border-gray-500"
                }`}
              >
                <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3">
                  <path
                    d="M2.5 6.2 4.8 8.4 9.5 3.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
          </div>

          {plugin.componentKinds.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-50 pt-3">
              {plugin.componentKinds.map((kind) => (
                <span
                  key={`${plugin.key}:${kind}`}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-0.5 text-[11.5px] text-gray-600"
                >
                  {kind.replaceAll("_", " ")}
                </span>
              ))}
            </div>
          ) : null}

          {plugin.warnings.length > 0 ? (
            <p className="mt-2 text-[11.5px] text-amber-700">{plugin.warnings[0]}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function DiscoveryAppliedState({
  createdPluginNames,
  createdMappingCount,
  materializedConfigObjectCount,
  onDone,
}: {
  createdPluginNames: string[];
  createdMappingCount: number;
  materializedConfigObjectCount: number;
  onDone: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-white">
      <div className="flex items-start gap-4 px-6 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-950">
            发现结果已应用
          </h2>
          <p className="mt-1 text-[12.5px] leading-[1.6] text-gray-500">
            OpenWork 已创建 <span className="font-semibold text-gray-900">{createdPluginNames.length}</span> 个插件、{" "}
            <span className="font-semibold text-gray-900">{createdMappingCount}</span> 个映射，以及{" "}
            <span className="font-semibold text-gray-900">{materializedConfigObjectCount}</span> 个导入的配置对象。
          </p>

          {createdPluginNames.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {createdPluginNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5 text-[11.5px] text-gray-700"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex justify-end border-t border-gray-100 bg-gray-50/60 px-6 py-3">
        <DenButton onClick={onDone}>返回集成</DenButton>
      </div>
    </div>
  );
}

function DiscoveryLoadingState() {
  return (
    <section className="flex flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
        <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden />
      </div>
      <h2 className="mt-5 text-[18px] font-semibold tracking-[-0.02em] text-gray-950">
        正在发现仓库中的市场与插件
      </h2>
      <p className="mt-2 max-w-[460px] text-[13px] leading-[1.6] text-gray-500">
        OpenWork 正在扫描仓库中兼容 Claude 的插件与市场清单。
      </p>
    </section>
  );
}

function StatePanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center">
      <p className="text-[14px] font-medium tracking-[-0.02em] text-gray-900">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-[13px] leading-6 text-gray-500">{body}</p>
    </div>
  );
}
