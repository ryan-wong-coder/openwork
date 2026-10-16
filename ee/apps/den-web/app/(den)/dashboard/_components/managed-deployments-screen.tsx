"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { Dialog } from "@base-ui/react/dialog";
import {
  awsRegionSchema, gcpRegionSchema, deploymentStepSchema, managedDeploymentConfigurationSchema, managedDeploymentInputSchema,
  managedDeploymentLaunchSchema, managedDeploymentListSchema, managedDeploymentSchema,
  type ManagedDeployment,
} from "@openwork/types/den/managed-deployments";
import { AlertTriangle, CheckCircle2, CircleDashed, Copy, ExternalLink, LockKeyhole, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenOptionCard } from "../../_components/ui/option-card";
import { DenPageHeader } from "../../_components/ui/page-header";
import { DenSelect } from "../../_components/ui/select";
import { DenSkeleton } from "../../_components/ui/skeleton";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { getOrgAccessFlags, orgFeatureEnabled, permissionLockReason } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { ConfirmDialog } from "./item-list";
import { deploymentStatus, providerName, readinessMessage, type DeploymentTone, type ProviderReadiness } from "./managed-deployments-state";
export { deploymentStatus } from "./managed-deployments-state";

type Configuration = z.infer<typeof managedDeploymentConfigurationSchema>;
type Launch = z.infer<typeof managedDeploymentLaunchSchema>;
type Check = ManagedDeployment["health"]["checks"][number];
type Tone = DeploymentTone;

const STEP_LABELS: Record<z.infer<typeof deploymentStepSchema>, string> = {
  runner_connected: "安装程序已连接", release_verified: "版本已验证", account_verified: "AWS 账户与域名已验证",
  infrastructure_applied: "基础设施已安装", services_ready: "服务已启动", health_verified: "HTTPS 与数据库已验证",
};
const FAILURE_LABELS: Record<string, string> = {
  release_verification_failed: "无法验证版本，请在 AWS 中查看安装日志。",
  infrastructure_failed: "基础设施安装失败，请在 AWS 中查看安装日志后重试。",
  certificate_failed: "AWS 无法签发 HTTPS 证书，请确认域名的 CAA 记录允许 amazon.com 后重试。",
  service_unhealthy: "服务未能启动，请在 AWS 中检查 ECS 服务事件后重试。",
  health_check_failed: "无法验证 HTTPS 或数据库，请检查域名 DNS 后重试。",
  network_check_failed: "现有网络无法托管 OpenWork。请根据 AWS CodeBuild 安装日志修复子网、路由、DNS 或 ECS 集群后重试。",
  runner_failed: "AWS 账户或托管区域不匹配，请检查部署详情。",
};
function gcpFailureMessage(code: string) {
  if (code === "runner_failed") return "Google Cloud 项目或 DNS 区域不匹配，请检查项目 ID、项目编号与公共 Cloud DNS 区域后重试。";
  if (code === "certificate_failed") return "Google Cloud 无法签发 HTTPS 证书，请检查域名 DNS 与证书状态后重试。";
  if (code === "service_unhealthy") return "服务未能启动，请在 Google Cloud Logging 中检查 Cloud Run 服务日志后重试。";
  if (code === "health_check_failed") return "无法验证 HTTPS 或数据库，请检查 Google Cloud 中的 DNS 与 Cloud SQL 后重试。";
  if (code === "release_verification_failed") return "无法验证版本，请检查 Google Cloud Shell 中的安装程序输出后重试。";
  return "安装失败，请检查 Google Cloud Shell 与 Google Cloud Logging 中的安装输出，修复问题后重试。";
}

const CHECK_LABELS: Record<Check["id"], string> = {
  api_health: "API", database_ready: "数据库连接", web_available: "网页应用", services_running: "服务",
  load_balancer_targets: "负载均衡器", database_instance: "数据库实例", database_storage: "数据库存储",
  database_backups: "备份", certificate: "HTTPS 证书",
};
const CODE_LABELS: Record<string, string> = {
  http_error: "返回错误", unreachable: "无法访问", slow: "响应较慢", not_running: "未运行", unhealthy: "不健康",
  unavailable: "无法检查", permission_denied: "无法检查：权限不足", low_storage: "空间不足", stale_backup: "没有近期备份",
  backups_disabled: "备份已关闭", not_issued: "尚未签发", expiring: "即将过期", expired: "已过期",
};

function relativeTime(iso: string | null) {
  if (!iso) return "从未";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} 小时前` : new Date(iso).toLocaleDateString(DEFAULT_DEN_LOCALE);
}

function checkDetail(check: Check) {
  const value = check.value ?? 0;
  if (check.status === "unknown" || (check.status !== "ok" && check.code && check.id !== "services_running" && check.id !== "load_balancer_targets")) {
    return CODE_LABELS[check.code ?? "unavailable"] ?? "无法检查";
  }
  switch (check.id) {
    case "api_health": case "web_available": return `${Math.round(value)} ms`;
    case "database_ready": return "已连接";
    case "services_running": return `${value} / ${check.total ?? 0} 项服务正在运行`;
    case "load_balancer_targets": return `${value} / ${check.total ?? 0} 条路由正在服务`;
    case "database_instance": return "可用";
    case "database_storage": return `剩余 ${value.toFixed(1)} / ${check.total ?? 0} GiB`;
    case "database_backups": return value < 1 ? "最近一小时内已备份" : `上次备份于 ${Math.round(value)} 小时前`;
    case "certificate": return `自动续期 · 剩余 ${Math.floor(value)} 天`;
  }
}

const toneText: Record<Tone, string> = { neutral: "text-gray-700", warning: "text-amber-700", danger: "text-red-700" };

function StatusIcon({ status }: { status: Check["status"] }) {
  if (status === "ok") return <CheckCircle2 aria-hidden className="size-4 text-gray-500" />;
  if (status === "warning") return <AlertTriangle aria-hidden className="size-4 text-amber-600" />;
  if (status === "failing") return <XCircle aria-hidden className="size-4 text-red-600" />;
  return <CircleDashed aria-hidden className="size-4 text-gray-400" />;
}

function networkLabel(network: Extract<ManagedDeployment, { provider: "aws" }>["target"]["network"]) {
  if (network.mode === "dedicated") return "专用 VPC";
  const cluster = network.ecsClusterArn ? ` · 集群 ${network.ecsClusterArn.split("/").pop()}` : "";
  return `${network.vpcId}${cluster}`;
}

function idList(value: string) {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function ProviderLock({ entry }: { entry: ProviderReadiness }) {
  return (
    <div className="space-y-2 text-[13px] text-gray-500" data-testid={`deployment-provider-lock-${entry.provider}`}>
      <p className="flex items-start gap-2"><LockKeyhole aria-hidden className="mt-0.5 size-4 shrink-0" />{readinessMessage(entry)}</p>
      {entry.missingFields?.length ? <details><summary className="cursor-pointer">技术详情</summary><p className="mt-2 break-words">需检查的配置字段： {entry.missingFields.join(", ")}</p></details> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 flex-col gap-1 border-b border-gray-100 py-2 text-[13px] last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="shrink-0 text-gray-500">{label}</span>
      <span className="min-w-0 break-words text-gray-900 [overflow-wrap:anywhere] sm:text-right">{children}</span>
    </div>
  );
}

export function ManagedDeploymentsScreen() {
  const { orgId, orgContext, runReauthableAction } = useOrgDashboard();
  const access = getOrgAccessFlags(orgContext?.currentMember.role ?? "member", orgContext?.currentMember.isOwner ?? false, orgContext?.currentMember.permissions);
  const enabled = orgFeatureEnabled(orgContext, "managedDeployments");
  const [deployments, setDeployments] = useState<ManagedDeployment[]>([]);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deploymentToRemove, setDeploymentToRemove] = useState<ManagedDeployment | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const generation = useRef(0);
  const available = configuration?.providers.some((entry) => entry.available && (entry.provider === "aws" || entry.provider === "gcp")) ?? false;
  const selected = deployments.find((entry) => entry.id === selectedId) ?? deployments[0] ?? null;

  useEffect(() => {
    const current = ++generation.current;
    setDeployments([]); setConfiguration(null); setLoadedAt(null); setSelectedId(null); setLaunch(null); setError(null); setActionError(null); setBusy(false); setDialogOpen(false); setDeploymentToRemove(null);
    setLoading(enabled && access.canViewDeployments);
    if (!enabled || !orgId || !access.canViewDeployments) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [list, settings] = await Promise.all([
          requestJson("/v1/managed-deployments", { method: "GET" }),
          requestJson("/v1/managed-deployments/configuration", { method: "GET" }),
        ]);
        if (!list.response.ok) throw new Error(getErrorMessage(list.payload, "无法加载部署，请重试。"));
        if (!settings.response.ok) throw new Error(getErrorMessage(settings.payload, "无法加载部署设置，请重试。"));
        const parsed = managedDeploymentListSchema.parse(list.payload);
        if (!stopped && generation.current === current) {
          setDeployments(parsed.deployments);
          setConfiguration(managedDeploymentConfigurationSchema.parse(settings.payload));
          setLoadedAt(new Date().toISOString());
          setError(null);
        }
      } catch (failure) {
        if (!stopped && generation.current === current) setError(failure instanceof Error ? failure.message : "无法加载部署，请重试。");
      } finally {
        if (!stopped && generation.current === current) {
          setLoading(false);
          timer = setTimeout(() => { void refresh(); }, 10_000);
        }
      }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [orgId, enabled, access.canViewDeployments]);

  function replace(item: ManagedDeployment) {
    setDeployments((previous) => previous.some((entry) => entry.id === item.id) ? previous.map((entry) => entry.id === item.id ? item : entry) : [...previous, item]);
  }

  async function prepare(deployment: ManagedDeployment, kind: Launch["kind"]) {
    const current = generation.current;
    setBusy(true); setActionError(null); setCopied(false);
    try {
      await runReauthableAction(kind === "install" ? `准备 ${providerName(deployment.provider)} 审批` : kind === "update" ? "准备更新" : "准备重试", async () => {
        const result = await requestJson(`/v1/managed-deployments/${deployment.id}/launch`, { method: "POST", body: JSON.stringify({ kind }) });
        if (!result.response.ok) throw getRequestError(result.payload, result.response, "无法准备安装程序，请重试。");
        const parsed = managedDeploymentLaunchSchema.parse(result.payload);
        if (generation.current === current) { setLaunch(parsed); replace(parsed.deployment); }
      });
    } catch (failure) {
      if (generation.current === current) setActionError(failure instanceof Error ? failure.message : "无法准备安装程序，请重试。");
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  async function remove(deployment: ManagedDeployment) {
    const current = generation.current;
    setBusy(true); setActionError(null);
    try {
      await runReauthableAction("移除部署", async () => {
        const result = await requestJson(`/v1/managed-deployments/${deployment.id}`, { method: "DELETE" });
        if (!result.response.ok) throw getRequestError(result.payload, result.response, "无法移除部署，请重试。");
        if (generation.current === current) { setDeployments((previous) => previous.filter((entry) => entry.id !== deployment.id)); setSelectedId(null); setLaunch(null); }
      });
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  const locked = !enabled ? "此工作区尚未启用部署，请联系 OpenWork 负责人启用。"
    : !access.canViewDeployments ? permissionLockReason("deployments.view") : null;
  const canCreate = Boolean(!locked && available && access.canManageDeployments);

  return (
    <section className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 p-4 sm:p-6" data-testid="managed-deployments-screen">
      <DenPageHeader title="部署" size="compact" className="max-sm:flex-col max-sm:gap-3" action={
        <DenButton type="button" disabled={!canCreate || loading} onClick={() => { setActionError(null); setDialogOpen(true); }}>创建部署</DenButton>
      } />
      {locked ? (
        <p className="flex items-center gap-2 text-[13px] text-gray-500"><LockKeyhole aria-hidden className="size-4" />{locked}</p>
      ) : (
        <>
          {error ? <p role="alert" className="text-[13px] text-red-700">{error} {loadedAt ? `正在显示来自 ${new Date(loadedAt).toLocaleTimeString(DEFAULT_DEN_LOCALE)} 的部署。` : ""}</p> : null}
          {!loading ? configuration?.providers.filter((entry) => !entry.available).map((entry) => <ProviderLock key={entry.provider} entry={entry} />) : null}
          {!loading && !access.canManageDeployments ? <p className="flex items-center gap-2 text-[13px] text-gray-500"><LockKeyhole aria-hidden className="size-4" />{permissionLockReason("deployments.manage")}</p> : null}
          {loading ? (
            <div className="space-y-2" aria-busy="true"><DenSkeleton className="h-12 w-full" /><DenSkeleton className="h-12 w-full" /></div>
          ) : deployments.length === 0 && !error ? (
            <p className="text-[13px] text-gray-500">暂无部署，使用公开域名在自己的云账户中创建一个。</p>
          ) : (
            <ul className="divide-y divide-gray-100" aria-label="部署">
              {deployments.map((item) => {
                const status = deploymentStatus(item);
                return (
                  <li key={item.id}>
                    <button type="button" data-testid="managed-deployment-row" aria-current={selected?.id === item.id} onClick={() => { setSelectedId(item.id); setLaunch(null); setDeploymentToRemove(null); setActionError(null); }}
                      className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2 text-left hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 aria-[current=true]:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_5rem_13rem]">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-gray-900" data-deployment-name>{item.name}</span>
                        <span className="block truncate text-[12px] text-gray-500">{providerName(item.provider)} · {item.provider === "aws" ? item.target.accountId : item.target.projectId} · {item.target.region}{item.provider === "aws" && item.target.network.mode === "existing" ? ` · ${item.target.network.vpcId}` : ""}</span>
                      </span>
                      <span className="text-right text-[13px] text-gray-500" data-deployment-version>{item.installedVersion ?? ""}</span>
                      <span className={`col-span-2 min-w-0 text-right text-[13px] sm:col-span-1 ${toneText[status.tone]}`} data-deployment-status>{status.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected ? (
            <DeploymentDetail deployment={selected} launch={launch?.deployment.id === selected.id ? launch : null} busy={busy} canManage={access.canManageDeployments}
              copied={copied} actionError={actionError} canPrepare={configuration?.providers.some((entry) => entry.provider === selected.provider && entry.available) ?? false}
              onPrepare={(kind) => { void prepare(selected, kind); }}
              onCopy={(command) => { void navigator.clipboard.writeText(command).then(() => setCopied(true)).catch(() => setActionError("复制失败，请打开“技术详情”并手动复制命令。")); }}
              onRemove={() => { setActionError(null); setDeploymentToRemove(selected); }} />
          ) : null}
        </>
      )}
      <ConfirmDialog destructive confirm={deploymentToRemove ? {
        title: `移除 ${deploymentToRemove.name}？`,
        description: `将从此工作区移除部署记录及其待处理审批。${providerName(deploymentToRemove.provider)} 资源与费用不受影响，此操作无法撤销。`,
        action: "Remove",
      } : null} onConfirm={async () => { if (deploymentToRemove) await remove(deploymentToRemove); }} onClose={() => setDeploymentToRemove(null)} />
      <CreateDeploymentDialog open={dialogOpen} onOpenChange={setDialogOpen} configuration={configuration} runReauthableAction={runReauthableAction}
        onCreated={(item) => { replace(item); setSelectedId(item.id); setLaunch(null); setDialogOpen(false); }} />
    </section>
  );
}

function DeploymentDetail({ deployment, launch, busy, canManage, canPrepare, copied, actionError, onPrepare, onCopy, onRemove }: {
  deployment: ManagedDeployment; launch: Launch | null; busy: boolean; canManage: boolean; canPrepare: boolean; copied: boolean;
  actionError: string | null; onPrepare: (kind: Launch["kind"]) => void; onCopy: (command: string) => void; onRemove: () => void;
}) {
  const status = deploymentStatus(deployment);
  const cloud = providerName(deployment.provider);
  const gcp = deployment.provider === "gcp";
  const run = deployment.run;
  const installed = Boolean(deployment.installedVersion);
  const runFailed = Boolean(run && (run.state === "failed" || run.expired));
  const failure = run?.events.find((event) => event.outcome === "failed");
  const nextStep = run?.events.length ?? 0;
  const neverStarted = !installed && (!run || run.state === "awaiting_approval");
  const health = deployment.health;
  return (
    <div className="flex min-w-0 flex-col gap-6 border-t border-gray-100 px-2 pt-6" data-testid="managed-deployment-detail">
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_13rem]">
        <h2 className="min-w-0 break-words text-[15px] font-semibold text-gray-900 [overflow-wrap:anywhere]">{deployment.name}</h2>
        <span className={`text-right text-[13px] ${toneText[status.tone]}`} data-testid="managed-deployment-status">{status.label}</span>
      </div>

      <div data-testid="managed-deployment-configuration">
        <Row label="地址">{installed ? <a className="underline-offset-2 hover:underline" href={deployment.webUrl} target="_blank" rel="noopener noreferrer">{deployment.domainName}</a> : deployment.domainName}</Row>
        <Row label="云端">{cloud} · {deployment.provider === "aws" ? deployment.target.accountId : deployment.target.projectId} · {deployment.target.region}</Row>
        {deployment.provider === "aws" ? <Row label="网络">{networkLabel(deployment.target.network)}</Row> : <><Row label="项目编号">{deployment.target.projectNumber}</Row><Row label="DNS 区域">{deployment.target.dnsZoneName}</Row></>}
        <Row label="版本">{deployment.installedVersion ?? "未安装"}{deployment.updateAvailable && deployment.availableVersion ? ` · ${deployment.availableVersion} 可用` : ""}</Row>
        <Row label="更新">需要批准</Row>
        {installed ? <Row label="上次健康报告">{relativeTime(health.reportedAt)}</Row> : null}
      </div>

      {installed ? (
        <section aria-labelledby="checks-heading" className="space-y-2">
          <h3 id="checks-heading" className="text-[13px] font-semibold text-gray-900">状态检查</h3>
          {health.state === "not_reporting" ? <p role="status" className="text-[13px] text-amber-700">自此之后未收到报告： {health.reportedAt ? new Date(health.reportedAt).toLocaleString(DEFAULT_DEN_LOCALE) : "安装完成"}。当前显示最后收到的检查结果，请检查以下服务中的健康检查代理： {gcp ? "Google Cloud Run 与 Cloud Scheduler" : "AWS Lambda"}.</p> : null}
          {health.state === "awaiting_report" ? <p className="text-[13px] text-gray-500">正在等待首次报告，之后每 5 分钟接收一次报告。</p> : null}
          {health.checks.length ? (
            <ul data-testid="managed-deployment-checks">
              {health.checks.map((check) => (
                <li key={check.id} className="flex min-h-10 items-center gap-3 border-b border-gray-100 py-2 text-[13px] last:border-b-0">
                  <StatusIcon status={check.status} />
                  <span className="text-gray-900">{CHECK_LABELS[check.id]}</span>
                  <span className="ml-auto text-gray-500">{checkDetail(check)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {run && run.state !== "ready" ? (
        <section aria-labelledby="run-heading" className="space-y-2">
          <h3 id="run-heading" className="text-[13px] font-semibold text-gray-900">{run.kind === "update" ? `更新至 ${run.version}` : run.kind === "retry" ? `重试 ${run.version}` : `安装 ${run.version}`}</h3>
          {run.state === "awaiting_approval" && !run.expired ? <p className="text-[13px] text-gray-500">正在等待在以下位置批准： {cloud}{gcp ? " Shell" : ""}.</p> : null}
          <ol data-testid="managed-deployment-steps">
            {deploymentStepSchema.options.map((step, index) => {
              const event = run.events.find((entry) => entry.step === step);
              const state = event ? (event.outcome === "succeeded" ? "ok" : "failing") : index === nextStep && run.state === "provisioning" && !run.expired ? "running" : "pending";
              return (
                <li key={step} className="flex min-h-9 items-center gap-3 text-[13px]">
                  {state === "ok" ? <CheckCircle2 aria-hidden className="size-4 text-gray-500" /> : state === "failing" ? <XCircle aria-hidden className="size-4 text-red-600" /> : <CircleDashed aria-hidden className={`size-4 ${state === "running" ? "text-gray-700 motion-safe:animate-pulse" : "text-gray-300"}`} />}
                  <span className={state === "pending" ? "text-gray-500" : "text-gray-900"}>{gcp && step === "account_verified" ? "Google Cloud 项目与域名已验证" : STEP_LABELS[step]}</span>
                  {event ? <time className="ml-auto text-gray-400" dateTime={event.receivedAt}>{new Date(event.receivedAt).toLocaleTimeString(DEFAULT_DEN_LOCALE)}</time> : null}
                </li>
              );
            })}
          </ol>
          {failure?.errorCode ? <p role="alert" className="text-[13px] text-red-700">{gcp ? gcpFailureMessage(failure.errorCode) : FAILURE_LABELS[failure.errorCode]}</p> : null}
          {run.expired && !failure ? <p role="alert" className="text-[13px] text-red-700">安装程序已停止报告，请在以下位置查看安装日志： {cloud}，然后重试。</p> : null}
        </section>
      ) : null}

      {launch?.command && run?.state === "awaiting_approval" && !run.expired ? (
        <section className="space-y-2" aria-label={`在 ${gcp ? "Google Cloud Shell" : "AWS CloudShell"} 中运行`}>
          <p className="text-[13px] text-gray-700">{deployment.provider === "gcp"
            ? `请在项目 ${deployment.target.projectId} 的 Google Cloud Shell 中检查并运行此命令。运行命令即批准${launch.kind === "update" ? "更新" : "安装"}，并在项目中创建或更改计费资源。OpenWork 不会代你运行。`
            : `以账户 ${deployment.target.accountId} 登录 AWS CloudShell 后运行此命令。它将更新现有安装程序，不会删除任何内容。`}</p>
          <div className="flex flex-wrap gap-2">
            <DenButton type="button" onClick={() => onCopy(launch.command ?? "")}><Copy aria-hidden className="size-4" />{copied ? "已复制" : "复制命令"}</DenButton>
            <a className={buttonVariants({ variant: "secondary" })} href={deployment.provider === "gcp" ? `https://console.cloud.google.com/?project=${encodeURIComponent(deployment.target.projectId)}&cloudshell=true` : `https://${deployment.target.region}.console.aws.amazon.com/cloudshell/home?region=${deployment.target.region}`} target="_blank" rel="noopener noreferrer">打开 {gcp ? "Google Cloud Shell" : "AWS CloudShell"}<ExternalLink aria-hidden className="size-4" /></a>
          </div>
          <details className="text-[13px]"><summary className="cursor-pointer text-gray-500">技术详情</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-3 font-mono text-[12px] text-gray-700">{launch.command}</pre></details>
        </section>
      ) : null}

      {actionError ? <p role="alert" className="text-[13px] text-red-700">{actionError}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {canManage && !installed && (!run || (run.state === "awaiting_approval" && !run.expired)) ? (
          launch?.approvalUrl ? (
            <a className={buttonVariants({})} href={launch.approvalUrl} target="_blank" rel="noopener noreferrer">在 AWS 中检查并批准<ExternalLink aria-hidden className="size-4" /></a>
          ) : !launch?.command ? <DenButton type="button" loading={busy} disabled={!canPrepare} onClick={() => onPrepare("install")}>准备 {cloud} 审批</DenButton> : null
        ) : null}
        {canManage && runFailed ? <DenButton type="button" loading={busy} disabled={!canPrepare} onClick={() => onPrepare(installed || run?.events.length || run?.state === "failed" ? "retry" : "install")}>准备重试</DenButton> : null}
        {canManage && installed && deployment.updateAvailable && !runFailed && run?.state !== "provisioning" && (launch?.kind !== "update" || run?.state === "ready") ? <DenButton type="button" loading={busy} disabled={!canPrepare} onClick={() => onPrepare("update")}>更新到 {deployment.availableVersion}</DenButton> : null}
        {installed ? <a className={buttonVariants({ variant: "secondary" })} href={deployment.webUrl} target="_blank" rel="noopener noreferrer">打开 OpenWork<ExternalLink aria-hidden className="size-4" /></a> : null}
        <a className={buttonVariants({ variant: "ghost" })} href={deployment.consoleUrl} target="_blank" rel="noopener noreferrer">打开方式 {cloud}<ExternalLink aria-hidden className="size-4" /></a>
        {canManage && neverStarted ? <DenButton type="button" variant="secondary" disabled={busy} data-testid="managed-deployment-remove" onClick={onRemove}>移除</DenButton> : null}
      </div>

      <details className="text-[13px]">
        <summary className="cursor-pointer text-gray-500" data-testid="deployment-technical-details-toggle">技术详情</summary>
        <div className="mt-2 space-y-2 text-gray-600">
          <p className="[overflow-wrap:anywhere]" data-testid="deployment-setup-directions">{`首次登录：打开 ${deployment.webUrl}/setup，输入部署的 ${gcp ? "Google Cloud Secret Manager" : "AWS Secrets Manager"} 密钥中 DEN_INITIAL_ADMIN_BOOTSTRAP_CODE 字段的代码。OpenWork 不会接收此代码。`}</p>
          <p>{gcp ? "安装程序的输出位于 Google Cloud Shell，服务和健康检查代理的日志位于 Google Cloud Logging。如果缺少健康报告，请检查 Cloud Run 和 Cloud Scheduler。报告仅包含检查结果。" : "安装日志位于 AWS CodeBuild，服务日志位于 CloudWatch。健康报告由你账户中的只读 AWS Lambda 函数提供，仅包含检查结果。"}</p>
          <p>{gcp ? "移除此记录不会删除 Google Cloud 资源或停止计费，Terraform 状态保留在你的项目中。" : "删除 AWS 安装程序堆栈不会删除 OpenWork 或其数据库，Terraform 状态保留在你的账户中。"}</p>
        </div>
      </details>
    </div>
  );
}

function CreateDeploymentDialog({ open, onOpenChange, configuration, runReauthableAction, onCreated }: {
  open: boolean; onOpenChange: (open: boolean) => void; configuration: Configuration | null;
  runReauthableAction: (label: string, action: () => Promise<void>) => Promise<void>; onCreated: (deployment: ManagedDeployment) => void;
}) {
  const [chosenProvider, setChosenProvider] = useState<"aws" | "gcp" | null>(null);
  const provider = chosenProvider ?? (configuration?.providers.find((entry) => entry.available && (entry.provider === "aws" || entry.provider === "gcp"))?.provider === "gcp" ? "gcp" : "aws");
  const readiness = configuration?.providers.find((entry) => entry.provider === provider);
  const [projectId, setProjectId] = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [gcpRegion, setGcpRegion] = useState("us-central1");
  const [dnsZoneName, setDnsZoneName] = useState("");
  const [name, setName] = useState("Production");
  const [accountId, setAccountId] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [domainName, setDomainName] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [networkMode, setNetworkMode] = useState<"dedicated" | "existing">("dedicated");
  const [vpcId, setVpcId] = useState("");
  const [serviceSubnets, setServiceSubnets] = useState("");
  const [loadBalancerSubnets, setLoadBalancerSubnets] = useState("");
  const [clusterArn, setClusterArn] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const network = networkMode === "dedicated" ? { mode: "dedicated" } : {
      mode: "existing", vpcId: vpcId.trim(), serviceSubnetIds: idList(serviceSubnets), loadBalancerSubnetIds: idList(loadBalancerSubnets),
      ...(clusterArn.trim() ? { ecsClusterArn: clusterArn.trim() } : {}),
    };
    if (!readiness?.available) { setError("此云平台尚未就绪，请联系 OpenWork 运维人员解除部署锁定。"); return; }
    const parsed = managedDeploymentInputSchema.safeParse(provider === "gcp"
      ? { provider, name, domainName, ownerEmail, target: { projectId: projectId.trim(), projectNumber: projectNumber.trim(), region: gcpRegion, dnsZoneName: dnsZoneName.trim() } }
      : { provider, name, domainName, ownerEmail, target: { accountId: accountId.trim(), region, route53ZoneId: zoneId.trim(), network } });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请检查部署详情。"); return; }
    if (!consent) { setError("请先确认云账户、权限与费用。"); return; }
    setBusy(true); setError(null);
    try {
      await runReauthableAction("创建部署", async () => {
        const result = await requestJson("/v1/managed-deployments", { method: "POST", body: JSON.stringify(parsed.data) });
        if (!result.response.ok) throw getRequestError(result.payload, result.response, "无法创建部署，请重试。");
        onCreated(managedDeploymentSchema.parse(result.payload));
        setConsent(false);
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法创建部署，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    // Keep a configuration draft open when choosing portaled provider/region
    // options. Close and Escape remain explicit dismissal paths.
    <Dialog.Root open={open} disablePointerDismissal onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Popup data-testid="create-deployment-dialog" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]">
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="text-[15px] font-semibold text-gray-900">创建部署</Dialog.Title>
            <Dialog.Close render={<DenButton type="button" variant="ghost" aria-label="关闭" disabled={busy}><X aria-hidden className="size-4" /></DenButton>} />
          </div>
          <form onSubmit={(event) => { void submit(event); }} className="space-y-4">
            <div className="space-y-1 text-[13px]">
              <label htmlFor="deployment-cloud" className="text-gray-700">云端</label>
              <DenSelect id="deployment-cloud" value={provider} onChange={(event) => {
                if (event.target.value === "aws" || event.target.value === "gcp") { setChosenProvider(event.target.value); setConsent(false); setError(null); }
              }}>
                {(configuration?.providers ?? []).map((entry) => (
                  <option key={entry.provider} value={entry.provider} disabled={!entry.available || entry.provider === "azure"}>{providerName(entry.provider)}{!entry.available ? "（已锁定）" : ""}</option>
                ))}
              </DenSelect>
            </div>
            <label className="block space-y-1 text-[13px]"><span className="text-gray-700">名称</span><DenInput value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
            {provider === "aws" ? <>
            <label className="block space-y-1 text-[13px]"><span className="text-gray-700">AWS 账户 ID</span><DenInput value={accountId} onChange={(event) => setAccountId(event.target.value)} required inputMode="numeric" placeholder="123456789012" /></label>
            <div className="space-y-1 text-[13px]">
              <label htmlFor="deployment-region" className="text-gray-700">区域</label>
              <DenSelect id="deployment-region" value={region} onChange={(event) => setRegion(event.target.value)}>
                {awsRegionSchema.options.map((value) => <option key={value} value={value}>{value}</option>)}
              </DenSelect>
            </div>
            <fieldset className="flex flex-col gap-2 text-[13px] [&>label]:rounded-lg" data-testid="deployment-network-options">
              <legend className="mb-1 text-gray-700">网络</legend>
              <DenOptionCard type="radio" name="deployment-network" testId="network-dedicated" checked={networkMode === "dedicated"} onChange={() => setNetworkMode("dedicated")}
                title="新建专用网络" description="创建专用 VPC、NAT 网关与 ECS 集群，适用于未承载其他服务的 AWS 账户。" />
              <DenOptionCard type="radio" name="deployment-network" testId="network-existing" checked={networkMode === "existing"} onChange={() => setNetworkMode("existing")}
                title="现有 VPC" description="在现有 VPC 中运行，也可使用现有 ECS 集群。安装程序仅可更改自己创建的资源。" />
            </fieldset>
            {networkMode === "existing" ? (
              <div className="space-y-4 border-l border-gray-200 pl-4">
                <label className="block space-y-1 text-[13px]"><span className="text-gray-700">VPC ID</span><DenInput value={vpcId} onChange={(event) => setVpcId(event.target.value)} required placeholder="vpc-0abc12345" /></label>
                <label className="block space-y-1 text-[13px]"><span className="text-gray-700">私有子网 ID</span><DenInput value={serviceSubnets} onChange={(event) => setServiceSubnets(event.target.value)} required placeholder="subnet-0aaa…, subnet-0bbb…" /><span className="block text-gray-500">至少两个，分布在不同可用区，并通过 NAT 访问外网。</span></label>
                <label className="block space-y-1 text-[13px]"><span className="text-gray-700">公共子网 ID</span><DenInput value={loadBalancerSubnets} onChange={(event) => setLoadBalancerSubnets(event.target.value)} required placeholder="subnet-0ccc…, subnet-0ddd…" /><span className="block text-gray-500">用于负载均衡器，至少两个，并路由至互联网网关。</span></label>
                <label className="block space-y-1 text-[13px]"><span className="text-gray-700">ECS 集群 ARN（可选）</span><DenInput value={clusterArn} onChange={(event) => setClusterArn(event.target.value)} placeholder="arn:aws:ecs:us-east-1:123456789012:cluster/platform" /><span className="block text-gray-500">留空将为 OpenWork 创建集群。</span></label>
              </div>
            ) : null}
            </> : <>
              <label className="block space-y-1 text-[13px]"><span className="text-gray-700">Google Cloud 项目 ID</span><DenInput value={projectId} onChange={(event) => setProjectId(event.target.value)} required placeholder="openwork-production" /></label>
              <label className="block space-y-1 text-[13px]"><span className="text-gray-700">Google Cloud 项目编号</span><DenInput value={projectNumber} onChange={(event) => setProjectNumber(event.target.value)} required inputMode="numeric" placeholder="123456789012" /></label>
              <div className="space-y-1 text-[13px]">
                <label htmlFor="deployment-gcp-region" className="text-gray-700">区域</label>
                <DenSelect id="deployment-gcp-region" value={gcpRegion} onChange={(event) => setGcpRegion(event.target.value)}>
                  {gcpRegionSchema.options.map((value) => <option key={value} value={value}>{value}</option>)}
                </DenSelect>
              </div>
            </>}
            <label className="block space-y-1 text-[13px]"><span className="text-gray-700">地址</span><DenInput value={domainName} onChange={(event) => setDomainName(event.target.value)} required placeholder="openwork.example.com" /></label>
            {provider === "aws" ? <label className="block space-y-1 text-[13px]"><span className="text-gray-700">此地址的 Route 53 托管区域 ID</span><DenInput value={zoneId} onChange={(event) => setZoneId(event.target.value)} required placeholder="Z0123456789ABC" /></label>
              : <div className="space-y-1 text-[13px]"><label htmlFor="deployment-dns-zone" className="text-gray-700">此地址的 Cloud DNS 托管区域名称</label><DenInput id="deployment-dns-zone" aria-describedby="deployment-dns-zone-hint" value={dnsZoneName} onChange={(event) => setDnsZoneName(event.target.value)} required placeholder="example-com" /><p id="deployment-dns-zone-hint" className="text-gray-500">使用此项目中为该地址提供解析的公共区域。</p></div>}
            <label className="block space-y-1 text-[13px]"><span className="text-gray-700">首位管理员邮箱</span><DenInput type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} required /></label>
            <label className="flex items-start gap-3 text-[13px] text-gray-700">
              <input type="checkbox" className="mt-0.5" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span className="min-w-0" data-testid="deployment-cost-consent">{provider === "gcp" ? "我控制此 Google Cloud 项目与公共 DNS 区域，且已启用计费。我将检查安装程序权限，并在 Google Cloud Shell 中运行命令批准。仅运行命令才会在项目中创建或更改需要计费的 Cloud Run、Cloud SQL、负载均衡器和存储资源。移除此记录不会删除这些资源或停止计费。OpenWork 仅接收部署进度与健康检查，不会收到首次登录代码。" : `我拥有此 AWS 账户和托管区域的控制权。AWS 将向我的账户收取容器、数据库、负载均衡器${networkMode === "dedicated" ? "及 NAT 网关（小型配置每月约 100–150 美元）" : "（小型配置每月约 60–100 美元，另加现有网络费用）"}的费用。我会在批准前检查安装程序在 AWS 中的权限。`}</span>
            </label>
            {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
            <DenButton type="submit" data-testid="create-deployment-submit" loading={busy} disabled={!consent || !readiness?.available}>创建部署</DenButton>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
