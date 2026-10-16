import type { ManagedDeployment } from "@openwork/types/den/managed-deployments";

export type DeploymentTone = "neutral" | "warning" | "danger";
export type ProviderReadiness = {
  provider: "aws" | "gcp" | "azure";
  available: boolean;
  reason?: "ready" | "not_configured" | "invalid_configuration" | "not_supported" | "feature_disabled";
  missingFields?: string[];
};

export function providerName(provider: ProviderReadiness["provider"]) {
  return provider === "aws" ? "AWS" : provider === "gcp" ? "Google Cloud" : "Azure";
}

/** Configuration values and secrets never belong in readiness copy. */
export function readinessMessage(entry: ProviderReadiness) {
  const name = providerName(entry.provider);
  if (entry.available) return `${name} 已准备好，等待部署方审批。`;
  switch (entry.reason) {
    case "feature_disabled": return `此工作区尚未启用 ${name} 部署，请联系 OpenWork 运营人员开启。`;
    case "invalid_configuration": return `${name} 安装程序配置无效，需要 OpenWork 运营人员修正已发布版本的配置。`;
    case "not_supported": return `暂不支持 ${name} 部署，请联系 OpenWork 运营人员确认支持的云平台。`;
    default: return `此 OpenWork 环境尚未配置 ${name} 安装程序，需要运营人员发布并配置经验证的安装程序版本。`;
  }
}

/** Installation/update failures take precedence over the last known health. */
export function deploymentStatus(deployment: ManagedDeployment): { label: string; tone: DeploymentTone } {
  const run = deployment.run;
  const installed = Boolean(deployment.installedVersion);
  if (run && run.state !== "ready") {
    if (run.expired) return { label: installed ? "更新已停止报告" : "安装程序已停止报告", tone: "danger" };
    if (run.state === "failed") return { label: installed ? "更新失败" : "安装失败", tone: "danger" };
    if (run.state === "awaiting_approval") return { label: `等待 ${deployment.provider === "gcp" ? "Google Cloud" : "AWS"} 审批`, tone: "neutral" };
    if (run.state === "provisioning") return { label: installed ? "正在更新" : "正在安装", tone: "neutral" };
  }
  if (!installed && !run) return { label: "尚未启动", tone: "neutral" };
  switch (deployment.health.state) {
    case "operational": return { label: "运行正常", tone: "neutral" };
    case "degraded": return { label: "功能受限", tone: "warning" };
    case "down": return { label: "服务不可用", tone: "danger" };
    case "not_reporting": return { label: "未报告", tone: "warning" };
    case "awaiting_report": return { label: "等待首次报告", tone: "neutral" };
  }
}
