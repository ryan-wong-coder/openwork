"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson, getRequestError } from "../../_lib/den-flow";
import { getWorkbotSettingsRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { DenButton } from "../../_components/ui/button";
import { DenSwitch } from "../../_components/ui/switch";
import { DenInput } from "../../_components/ui/input";
import { DenSecretInput } from "../../_components/ui/secret-input";
import { auditSummaryClass, AuditChevron } from "./audit-logs-details";
import type { ExternalMcpConnection } from "./mcp-connections-data";

const setupSchema = z.object({
  enabled: z.boolean(),
  installed: z.boolean(),
  hasSigningSecret: z.boolean(),
  eligible: z.boolean(),
  rolloutEnabled: z.boolean(),
  runnerAvailable: z.boolean(),
  shadowMode: z.boolean(),
  dailyLimit: z.number(),
  model: z.string().nullable().default(null),
  modelManagedByOrganization: z.boolean().default(false),
  defaultModel: z.string().nullable().default(null),
  progressUpdates: z.boolean().default(false),
  models: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  channelIds: z.array(z.string()),
  metrics: z.object({
    completed: z.number(),
    failed: z.number(),
    active: z.number(),
    awaitingConnection: z.number(),
    firstTextMedianMs: z.number().nullable(),
    finalMedianMs: z.number().nullable(),
    helpful: z.number(),
    needsWork: z.number(),
  }),
  manifest: z.unknown(),
});
export function SlackAssistantSetup({ connection }: { connection: ExternalMcpConnection }) {
  const { orgContext, orgSlug, runReauthableAction } = useOrgDashboard();
  const client = useQueryClient();
  const [secret, setSecret] = useState("");
  const [channels, setChannels] = useState<string | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const orgId = orgContext?.organization.id;
  const isSlack = (() => {
    try {
      return new URL(connection.url).hostname === "mcp.slack.com";
    } catch {
      return false;
    }
  })();
  const path = `/v1/mcp-connections/${connection.id}/slack-assistant`;
  const queryKey = ["slack-assistant", orgId, connection.id];
  const headers = { "x-openwork-org-id": orgId ?? "" };
  const query = useQuery({
    queryKey,
    enabled: isSlack && Boolean(orgId),
    queryFn: async () => setupSchema.parse(await request(path, { headers })),
  });
  async function request(url: string, init: RequestInit) {
    const { response, payload } = await requestJson(url, init);
    if (!response.ok) throw getRequestError(payload, response, "Slack 配置请求失败，请重试。");
    return payload;
  }
  if (!isSlack) return null;
  const data = query.data;
  async function save(
    enabled: boolean,
    changes: { shadowMode?: boolean; model?: string | null; progressUpdates?: boolean } = {},
  ) {
    setBusy(true);
    setError(null);
    try {
      await runReauthableAction("slack-assistant-setup", async () => {
        await request(path, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            enabled,
            shadowMode: changes.shadowMode ?? data?.shadowMode ?? false,
            dailyLimit: limit ?? data?.dailyLimit ?? 100,
            channelIds: channels === null ? (data?.channelIds ?? []) : channels.split(/[\s,]+/).filter(Boolean),
            ...(secret ? { signingSecret: secret } : {}),
            ...(changes.model !== undefined ? { model: changes.model } : {}),
            ...(changes.progressUpdates !== undefined ? { progressUpdates: changes.progressUpdates } : {}),
          }),
        });
        setSecret("");
        setChannels(null);
        setLimit(null);
        await client.invalidateQueries({ queryKey });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法保存 Slack 配置，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function install() {
    setBusy(true);
    setError(null);
    try {
      await runReauthableAction("slack-assistant-setup", async () => {
        const result = z
          .object({ url: z.string().url() })
          .parse(await request(`${path}/install`, { method: "POST", headers }));
        window.location.assign(result.url);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法开始 Slack 安装，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-10 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5" aria-label="Slack 中的 OpenWork" data-testid="slack-assistant-setup">
      <div>
        <h2 className="text-base font-semibold">Slack 中的 OpenWork</h2>
        <p className="mt-1 text-sm text-gray-500">
          提及 @openwork 即可以自己的身份、连接与权限开展工作，每名成员需连接自己的 Slack 账户。
        </p>
      </div>
      {query.isPending ? <p role="status">正在加载 Slack 配置…</p> : null}
      {query.error ? <p role="alert">无法加载 Slack 配置，请重试。</p> : null}
      {data && !data.eligible ? <p>启用助手前，请先选择个人账户模式。</p> : null}
      {data && !data.rolloutEnabled ? (
        <p className="text-sm text-gray-500">
          请联系平台管理员在 /admin 中为此工作区启用 Slack 助手。
        </p>
      ) : null}
      {data && !data.runnerAvailable ? (
        <p className="text-sm text-gray-500" role="status">
          此部署不可用：Slack 助手需要 OpenWork 云端运行器，而此处尚未配置。部署运维人员可启用。
        </p>
      ) : null}
      {data ? (
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" aria-label="最近 24 小时">
          {[
            ["已完成", data.metrics.completed],
            ["已启用", data.metrics.active],
            ["需要连接", data.metrics.awaitingConnection],
            ["失败", data.metrics.failed],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="mt-1 text-lg font-medium">{value}</p>
            </div>
          ))}
        </div>
      ) : null}
      {data ? (
        <p className="text-xs text-gray-500">
          最近 24 小时 · 首次回复中位数：{" "}
          {data.metrics.firstTextMedianMs === null ? "—" : `${(data.metrics.firstTextMedianMs / 1000).toFixed(1)}s`} · 有帮助： {data.metrics.helpful} · 需要处理： {data.metrics.needsWork}
        </p>
      ) : null}
      {data?.eligible ? (
        <>
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-100 text-sm">
            <span>在 Slack 中启用 @openwork</span>
            <DenSwitch
              checked={data.enabled}
              disabled={busy || (!data.enabled && (!data.rolloutEnabled || !data.runnerAvailable || (!data.hasSigningSecret && !secret)))}
              aria-label="在 Slack 中启用 @openwork"
              testId="slack-assistant-enabled"
              onChange={(checked) => void save(checked)}
            />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Slack 应用签名密钥
            <DenSecretInput
              autoComplete="off"
              data-ph-no-capture
              data-testid="slack-assistant-signing-secret"
              value={secret}
              onChange={setSecret}
              saved={data.hasSigningSecret}
              placeholder="从 Slack 应用设置中粘贴"
              savedPlaceholder="已安全保存"
              replaceTestId="slack-assistant-replace-signing-secret"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <DenButton variant="secondary" disabled={busy || !secret} onClick={() => void save(data.enabled)}>
              保存密钥
            </DenButton>
            <DenButton disabled={busy || !data.hasSigningSecret || !data.runnerAvailable} onClick={() => void install()}>
              {data.installed ? "在 Slack 中重新安装" : "添加到 Slack"}
            </DenButton>
          </div>
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-100 text-sm">
            <span>发布期间私密发送回复</span>
            <DenSwitch
              checked={data.shadowMode}
              disabled={busy || !data.hasSigningSecret}
              aria-label="发布期间私密发送回复"
              testId="slack-assistant-shadow"
              onChange={(checked) => void save(data.enabled, { shadowMode: checked })}
            />
          </div>
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-gray-100 text-sm">
            <span>工作时显示进度</span>
            <DenSwitch
              checked={data.progressUpdates}
              disabled={busy || !data.hasSigningSecret}
              aria-label="工作时显示进度"
              testId="slack-assistant-progress"
              onChange={(checked) => void save(data.enabled, { progressUpdates: checked })}
            />
          </div>
          <p className="text-xs text-gray-500">
            访问权限遵循此连接器的工作区、团队与成员授权。关闭助手后将停止接收新请求。
          </p>
          {data.models.length > 0 && data.modelManagedByOrganization ? (
            <p className="text-sm" data-testid="slack-assistant-model">
              模型： {data.models.find((m) => m.id === data.model)?.name ?? data.model ?? `Default${data.defaultModel ? ` (${data.models.find((m) => m.id === data.defaultModel)?.name ?? data.defaultModel})` : ""}`}{" "}
              <Link href={getWorkbotSettingsRoute(orgSlug)} className="text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
                在“管理 › Workbot”中更改
              </Link>
            </p>
          ) : data.models.length > 0 ? (
            <label className="block text-sm">
              模型
              {/* Name the control explicitly; the implicit label would also read out the selected model. */}
              <select
                aria-label="模型"
                value={data.model ?? ""}
                disabled={busy || !data.hasSigningSecret}
                onChange={(e) => void save(data.enabled, { model: e.target.value || null })}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2"
              >
                <option value="">
                  默认{data.defaultModel ? ` (${data.models.find((m) => m.id === data.defaultModel)?.name ?? data.defaultModel})` : ""}
                </option>
                {data.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <details className="group text-sm" data-testid="slack-assistant-limits">
            <summary className={auditSummaryClass} data-testid="slack-assistant-limits-toggle"><AuditChevron />发布范围限制</summary>
            <div className="flex flex-col items-start gap-3 pb-3">
              <label className="flex w-full flex-col gap-1">
                允许的频道 ID
                <DenInput
                  value={channels ?? data.channelIds.join(", ")}
                  onChange={(e) => setChannels(e.target.value)}
                  placeholder="所有频道"
                />
              </label>
              <p className="text-xs text-gray-500">
                使用逗号分隔 ID，符合条件的成员仍可使用私信。
              </p>
              <label className="flex w-full flex-col gap-1">
                每名成员每日请求数
                <DenInput
                  type="number"
                  min={1}
                  max={1000}
                  value={limit ?? data.dailyLimit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
              </label>
              <DenButton
                variant="secondary"
                disabled={busy || !data.hasSigningSecret || (channels === null && limit === null)}
                onClick={() => void save(data.enabled)}
              >
                保存限额
              </DenButton>
            </div>
          </details>
          <details className="group text-sm" data-testid="slack-assistant-manifest">
            <summary className={auditSummaryClass} data-testid="slack-assistant-manifest-toggle"><AuditChevron />Slack 应用清单</summary>
            <p className="my-2 text-xs text-gray-500">
              将这些设置合并到为此连接注册的 Slack 应用中，保留已有用户 OAuth 与 MCP 设置。
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-gray-50 p-3 text-xs">
              {JSON.stringify(data.manifest, null, 2)}
            </pre>
          </details>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
