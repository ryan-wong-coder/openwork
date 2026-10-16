import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";
/**
 * LiteLLM gateway provider requests and display helpers. Request bodies mirror
 * den-api's /v1/inference-providers/litellm schemas; keys are write-only and
 * never read back.
 */
import type { GatewayLiteLlmAttentionReason, GatewayLiteLlmStatus, GatewayLiteLlmSyncResult } from "@openwork/types/den/gateway";
import { auditOperationHeaders, type AuditOperationContext } from "@openwork/types/den/audit";
import { z } from "zod";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import { readInferenceProviderFromPayload, type DenInferenceProvider } from "./inference-provider-request";

export const LITELLM_PROVIDER_ID = "litellm";
export const LITELLM_DOC_URL = "https://docs.litellm.ai";

/** What the admin chooses: one shared key, each person pastes theirs, or OpenWork creates them. */
export type LiteLlmMode = "org" | "member" | "issued";
export type LiteLlmIssueStrategy = "per_team" | "mirror";
export type LiteLlmMirrorFallback = "per_team" | "error";

export type LiteLlmCreateInput = {
  name: string;
  baseUrl: string;
  mode: LiteLlmMode;
  apiKey: string;
  access: { allMembers: boolean; memberIds: string[]; teamIds: string[] };
  issueStrategy?: LiteLlmIssueStrategy;
  mirrorFallback?: LiteLlmMirrorFallback;
};

/** The admin-facing mode of a saved provider. */
export function liteLlmStatusMode(status: Pick<GatewayLiteLlmStatus, "mode" | "keySource">): LiteLlmMode {
  return status.mode === "org" ? "org" : status.keySource === "issued" ? "issued" : "member";
}

export function buildLiteLlmCreateBody(input: LiteLlmCreateInput) {
  return {
    name: input.name.trim() || "LiteLLM",
    baseUrl: input.baseUrl.trim(),
    mode: input.mode,
    ...(input.mode === "issued" ? { issueStrategy: input.issueStrategy ?? "per_team", mirrorFallback: input.mirrorFallback ?? "per_team" } : {}),
    apiKey: input.apiKey.trim(),
    ...(input.access.allMembers ? { allMembers: true } : {}),
    ...(input.access.memberIds.length ? { memberIds: [...new Set(input.access.memberIds)] } : {}),
    ...(input.access.teamIds.length ? { teamIds: [...new Set(input.access.teamIds)] } : {}),
  };
}

/** Client-side check before the server verifies the key against the proxy. */
export function liteLlmCreateError(input: LiteLlmCreateInput): string | null {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) return "请输入 LiteLLM 代理地址。";
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "LiteLLM 地址必须以 https:// 开头。";
  } catch { return "输入完整地址，例如 https://litellm.example.com。"; }
  if (!input.apiKey.trim()) return input.mode === "org" ? "粘贴所有人共用的 LiteLLM 密钥。"
    : input.mode === "issued" ? "粘贴 LiteLLM 管理员密钥，以便 OpenWork 为每人创建密钥。"
      : "粘贴 LiteLLM 管理员密钥，以便 OpenWork 读取模型与团队。";
  return null;
}

export function liteLlmKeyLabel(mode: LiteLlmMode) {
  return mode === "org" ? "组织密钥" : "管理员密钥";
}

export function liteLlmModeLabel(mode: LiteLlmMode) {
  return mode === "org" ? "一个组织密钥" : mode === "issued" ? "由 OpenWork 创建密钥" : "每人使用自己的密钥";
}

export function liteLlmIssueStrategyLabel(strategy: LiteLlmIssueStrategy) {
  return strategy === "mirror" ? "复制已有密钥" : "每个 LiteLLM 团队一个";
}

export function liteLlmMirrorFallbackLabel(fallback: LiteLlmMirrorFallback) {
  return fallback === "error" ? "显示错误" : "使用所属团队";
}

export function liteLlmAttentionLabel(reason: GatewayLiteLlmAttentionReason) {
  return reason === "not_in_litellm" ? "不在 LiteLLM 中"
    : reason === "no_key_to_mirror" ? "没有可复制的密钥"
      : reason === "no_models" ? "没有允许的模型"
        : "无法创建密钥";
}

export function liteLlmSpendLabel(status: Pick<GatewayLiteLlmStatus, "spendTracking">) {
  return status.spendTracking ? "已跟踪，价格来自 LiteLLM" : "未跟踪，由 LiteLLM 为每个密钥设置预算";
}

export function liteLlmAccessTitle(mode: LiteLlmMode) {
  return mode === "org" ? "谁可以使用" : mode === "issued" ? "密钥分配人员" : "可连接密钥的人员";
}

export function liteLlmAccessGroupId(provider: Pick<DenInferenceProvider, "litellm" | "modelGroups">): string | null {
  const mode = provider.litellm ? liteLlmStatusMode(provider.litellm) : "org";
  const name = mode === "issued" ? "获得 LiteLLM 密钥" : mode === "member" ? "可连接 LiteLLM 密钥" : "所有 LiteLLM 模型";
  return provider.modelGroups?.find((group) => group.name === name)?.id ?? provider.modelGroups?.[0]?.id ?? null;
}

/** "Synced 5 min ago", or "Never synced". */
export function liteLlmSyncedLabel(lastSyncedAt: string | null, now = Date.now()) {
  if (!lastSyncedAt) return "从未同步";
  const at = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(at)) return "从未同步";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "刚刚同步";
  if (minutes < 60) return `${minutes} 分钟前同步`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前同步`;
  return `已同步 ${new Date(at).toLocaleDateString(DEFAULT_DEN_LOCALE)}`;
}

const syncResultSchema: z.ZodType<GatewayLiteLlmSyncResult> = z.object({
  modelCount: z.number(), groupCount: z.number(), teamCount: z.number(),
  members: z.object({ matched: z.number(), rejected: z.number(), unavailable: z.number(), removed: z.number() }),
  warnings: z.array(z.string()),
  issued: z.object({ people: z.number(), keys: z.number(), notInLiteLlm: z.number(), noKeyToMirror: z.number(), noModels: z.number(), errors: z.number(), removed: z.number() }).optional(),
});

function readResult(payload: unknown) {
  const provider = readInferenceProviderFromPayload(payload);
  const sync = z.object({ sync: syncResultSchema }).safeParse(payload);
  if (!provider || !sync.success) throw new Error("服务器返回了无法识别的 LiteLLM 响应，请重试。");
  return { provider, sync: sync.data.sync };
}

export async function createLiteLlmProvider(input: LiteLlmCreateInput, auditContext?: AuditOperationContext) {
  const { response, payload } = await requestJson("/v1/inference-providers/litellm", {
    method: "POST", body: JSON.stringify(buildLiteLlmCreateBody(input)), headers: auditOperationHeaders(auditContext),
  }, 30000);
  if (!response.ok) throw getRequestError(payload, response, `无法连接 LiteLLM（${response.status}）。`);
  return readResult(payload);
}

export async function syncLiteLlmProvider(providerId: string, auditContext?: AuditOperationContext) {
  const { response, payload } = await requestJson(`/v1/inference-providers/${encodeURIComponent(providerId)}/litellm/sync`, {
    method: "POST", headers: auditOperationHeaders(auditContext),
  }, 60000);
  if (!response.ok) throw getRequestError(payload, response, `无法同步 LiteLLM（${response.status}）。`);
  return readResult(payload);
}

export async function replaceLiteLlmKey(providerId: string, apiKey: string, auditContext?: AuditOperationContext) {
  return updateLiteLlm(providerId, { apiKey: apiKey.trim() }, auditContext);
}

export async function updateLiteLlmIssue(providerId: string, input: { issueStrategy?: LiteLlmIssueStrategy; mirrorFallback?: LiteLlmMirrorFallback }, auditContext?: AuditOperationContext) {
  return updateLiteLlm(providerId, input, auditContext);
}

async function updateLiteLlm(providerId: string, body: Record<string, string>, auditContext?: AuditOperationContext) {
  const { response, payload } = await requestJson(`/v1/inference-providers/${encodeURIComponent(providerId)}/litellm`, {
    method: "PATCH", body: JSON.stringify(body), headers: auditOperationHeaders(auditContext),
  }, 120000);
  if (!response.ok) throw getRequestError(payload, response, `无法替换 LiteLLM 密钥（${response.status}）。`);
  return readResult(payload);
}

export function liteLlmSyncSummary(sync: GatewayLiteLlmSyncResult) {
  const parts = [`${sync.modelCount} 个模型`];
  if (sync.issued) {
    parts.push(`${sync.issued.people} 人的密钥`);
    const missing = sync.issued.notInLiteLlm + sync.issued.noKeyToMirror + sync.issued.noModels + sync.issued.errors;
    if (missing) parts.push(`${missing} 项需要处理`);
    if (sync.issued.removed) parts.push(`已移除 ${sync.issued.removed}`);
  }
  if (sync.members.rejected) parts.push(`${sync.members.rejected} 项密钥被 LiteLLM 拒绝`);
  if (sync.members.removed) parts.push(`${sync.members.removed} 人已失去访问权限`);
  return `已同步 ${parts.join(", ")}。`;
}
