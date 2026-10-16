"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, ArrowLeft, CheckCircle2, Coins, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { INFERENCE_MODEL_ALIASES } from "@openwork/types/den/inference";
import { z } from "zod";
import { modelsAnalyticsSettingsSchema, modelsAnalyticsActivitySchema, modelsConsumptionSchema, type ModelsAnalyticsSettings } from "@openwork-ee/telemetry-contracts";
import { DenButton } from "../../_components/ui/button";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenInput } from "../../_components/ui/input";
import { DenSecretInput } from "../../_components/ui/secret-input";
import { DenSelect } from "../../_components/ui/select";
import { UnderlineTabs } from "../../_components/ui/tabs";
import { AnalyticsAdoptionLink, AnalyticsEmptyState, AnalyticsErrorState, AnalyticsLoading, analyticsSurfaceClass } from "../_features/analytics/analytics-layout";
import { StatCard } from "../_features/analytics/stat-card";
import { TrendChart } from "../_features/analytics/trend-chart";
import { DenNotice } from "../../_components/ui/notice";
import { DenSectionHeader } from "../../_components/ui/section-header";
import { DenTable } from "../../_components/ui/table";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { orgFeatureEnabled } from "../../_lib/den-org";
import { ItemRowsSkeleton } from "./item-list";

type Activity = z.infer<typeof modelsAnalyticsActivitySchema>;
type Consumption = z.infer<typeof modelsConsumptionSchema>;
type Tab = "Activity" | "Consumption" | "Integrations";
function groupRows<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const id = key(row); const group = groups.get(id); if (group) group.push(row); else groups.set(id, [row]); }
  return groups;
}
const formatCost = (value: number | null | undefined) => value === null || value === undefined ? "未知" : `$${value.toFixed(4)}`;

async function request(path: string, init?: RequestInit) {
  const { response, payload } = await requestJson(`/v1/inference/analytics/${path}`, init ?? { method: "GET" }, 12_000);
  if (!response.ok) throw new Error(getErrorMessage(payload, "无法加载任务分析，请重试。"));
  return payload;
}

function LangfuseSettings({ settings, refresh }: { settings: ModelsAnalyticsSettings; refresh: () => Promise<void> }) {
  const { runReauthableAction } = useOrgDashboard();
  const [host, setHost] = useState(settings.langfuseHost ?? "https://cloud.langfuse.com");
  const [region, setRegion] = useState(settings.langfuseHost === "https://us.cloud.langfuse.com" ? "us"
    : settings.langfuseHost && settings.langfuseHost !== "https://cloud.langfuse.com" ? "custom" : "eu");
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function act(action: "test" | "connect" | "disconnect") {
    setBusy(true); setMessage(null);
    try {
      await runReauthableAction("models-analytics-export", async () => {
        await request(action === "disconnect" ? "langfuse" : `langfuse/${action}`, {
          method: action === "disconnect" ? "DELETE" : "POST",
          ...(action === "disconnect" ? {} : { body: JSON.stringify({ host, publicKey, secretKey }) }),
        });
      });
      setMessage(action === "test" ? "连接已验证。" : action === "connect" ? "已连接，新的任务分析数据将发送到 Langfuse。" : "Langfuse 已断开。");
      if (action !== "test") { setPublicKey(""); setSecretKey(""); await refresh(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法连接 Langfuse，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
    <div>
      <DenBrandMark name="Langfuse" serviceUrl="https://langfuse.com" className="mb-4 size-8 rounded-lg" imageClassName="size-5" />
      <DenSectionHeader title="Langfuse" description="连接已有的 Langfuse 项目以导出新任务元数据，与团队其他跟踪记录一同管理模型活动。" />
      <p className="mt-4 text-xs leading-5 text-[#637291]">不包含提示词、回复与文件内容，不导出历史活动，可随时断开连接。</p>
    </div>
    <div className="grid content-start gap-4 rounded-xl border border-[#edf0f5] bg-[#fafbfc] p-5">
      {settings.exportEnabled ? <>
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />已连接</p>
        <p className="break-all text-xs text-[#637291]">{settings.langfuseHost}</p>
        <DenButton variant="secondary" disabled={busy} onClick={() => void act("disconnect")}>断开 Langfuse</DenButton>
      </> : <>
        <div className="grid gap-1.5"><label htmlFor="langfuse-region" className="text-xs font-medium text-[#30405F]">数据区域</label>
          <DenSelect id="langfuse-region" aria-label="数据区域" value={region} onChange={(event) => {
            setRegion(event.target.value);
            if (event.target.value === "eu") setHost("https://cloud.langfuse.com");
            if (event.target.value === "us") setHost("https://us.cloud.langfuse.com");
            if (event.target.value === "custom") setHost("");
          }}><option value="eu">欧洲</option><option value="us">美国</option><option value="custom">自托管</option></DenSelect>
        </div>
        {region === "custom" ? <label className="grid gap-1.5 text-xs font-medium text-[#30405F]">Langfuse 地址<DenInput type="url" value={host} onChange={(event) => setHost(event.target.value)} placeholder="https://langfuse.example.com" /></label> : null}
        <label className="grid gap-1.5 text-xs font-medium text-[#30405F]">公钥<DenInput autoComplete="off" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder="pk-lf-…" /></label>
        <label className="grid gap-1.5 text-xs font-medium text-[#30405F]">私钥<DenSecretInput autoComplete="new-password" value={secretKey} onChange={setSecretKey} placeholder="sk-lf-…" /></label>
        <div className="flex flex-wrap gap-2"><DenButton variant="secondary" disabled={busy || !publicKey || !secretKey || !host} onClick={() => void act("test")}>测试连接</DenButton>
          <DenButton disabled={busy || !publicKey || !secretKey || !host} onClick={() => void act("connect")}>连接 Langfuse</DenButton></div>
      </>}
      {message ? <p role="status" className="text-sm leading-5 text-[#30405F]">{message}</p> : null}
    </div>
  </div>;
}

function modelName(value: string) {
  const model = Object.entries(INFERENCE_MODEL_ALIASES).find(([id, model]) => id === value || model.upstreamModel === value);
  return model ? model[1].displayName.replace(/^OpenWork:\s*/, "") : value;
}

function Outcome({ events }: { events: Activity["events"] }) {
  const status = events.find((event) => event.type.startsWith("task.") && event.status)?.status;
  return <span className={`text-xs ${status === "failed" ? "text-[var(--ow-danger)]" : "text-[var(--dls-text-secondary)]"}`}>{status ?? "模型调用已记录"}</span>;
}

export function ModelsAnalyticsPanel() {
  const { orgContext } = useOrgDashboard();
  if (!orgFeatureEnabled(orgContext, "taskAnalyticsUi")) return null;
  return <EnabledModelsAnalyticsPanel />;
}

function EnabledModelsAnalyticsPanel() {
  const { orgContext, activeOrg, runReauthableAction } = useOrgDashboard();
  const queryClient = useQueryClient();
  const key = ["models-analytics", orgContext?.organization.id];
  const settingsKey = [...key, "settings"];
  const settingsQuery = useQuery({
    queryKey: settingsKey, enabled: Boolean(orgContext?.organization.id), retry: false,
    queryFn: async () => modelsAnalyticsSettingsSchema.parse(await request("settings")),
  });
  const settings = settingsQuery.data;
  const [tab, setTab] = useState<Tab>("Activity");
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState("model");
  const groupByLabel = groupBy === "member" ? "成员" : groupBy === "day" ? "日期" : "模型";
  const dataQuery = useQuery({
    queryKey: [...key, "data", days], enabled: settings?.enabled === true,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [events, usage] = await Promise.all([request(`activity?days=${days}`), request(`consumption?days=${days}`)]);
      return { activity: modelsAnalyticsActivitySchema.parse(events), consumption: modelsConsumptionSchema.parse(usage) };
    },
  });
  const activity = dataQuery.data?.activity;
  const [pagination, setPagination] = useState<{ firstPage: Activity | undefined; extra: Activity | null }>({ firstPage: activity, extra: null });
  // Reset before committing a new first page, never mixing old and new cursors.
  if (pagination.firstPage !== activity) setPagination({ firstPage: activity, extra: null });
  const extra = pagination.firstPage === activity ? pagination.extra : null;
  const consumption = dataQuery.data?.consumption;
  const busy = mutating || dataQuery.isFetching;
  const loading = !dataQuery.data && dataQuery.isPending;
  const memberName = (id: string) => orgContext?.members.find((member) => member.id === id)?.user.name ?? "前成员";
  async function refreshSettings() { await settingsQuery.refetch(); }
  async function choose(enabled: boolean) {
    setMutating(true); setError(null);
    try {
      await runReauthableAction("models-task-analytics", async () => {
        const updated = modelsAnalyticsSettingsSchema.parse(await request("settings", { method: "PATCH", body: JSON.stringify({ enabled, consentVersion: 1 }) }));
        // Cancel reads before clearing the consented view so late responses
        // cannot repopulate it after opting out.
        await queryClient.cancelQueries({ queryKey: [...key, "data"] });
        queryClient.removeQueries({ queryKey: [...key, "data"] });
        queryClient.setQueryData(settingsKey, updated);
        setSelected(null); setPagination({ firstPage: undefined, extra: null });
      });
    } catch (error) { setError(error instanceof Error ? error.message : "无法保存选择，请重试。"); }
    finally { setMutating(false); }
  }
  async function details(memberId: string, sessionId: string, taskId: string) {
    setError(null); setMutating(true);
    try { setSelected(modelsAnalyticsActivitySchema.parse(await request(`activity?${new URLSearchParams({ days: String(days), memberId, sessionId, taskId })}`))); }
    catch (error) { setError(error instanceof Error ? error.message : "无法加载此任务，请重试。"); }
    finally { setMutating(false); }
  }
  async function more() {
    const cursor = selected ? selected.next : extra ? extra.next : activity?.next;
    if (!cursor) return;
    setMutating(true); setError(null);
    try {
      const first = selected?.events[0];
      const query = new URLSearchParams({ days: String(days), ...cursor, ...(first ? { memberId: first.memberId, sessionId: first.sessionId, taskId: first.taskId } : {}) });
      const next = modelsAnalyticsActivitySchema.parse(await request(`activity?${query}`));
      if (selected) setSelected({ events: [...selected.events, ...next.events], next: next.next });
      // A poll may have replaced the pagination state while this request waited.
      else setPagination((current) => current === pagination ? {
        ...current, extra: { events: [...(extra?.events ?? []), ...next.events], next: next.next },
      } : current);
    } catch (error) { setError(error instanceof Error ? error.message : "无法加载更多活动，请重试。"); }
    finally { setMutating(false); }
  }
  if (settingsQuery.isPending) return <AnalyticsLoading label="正在加载任务分析" />;
  if (settingsQuery.isError) return <AnalyticsErrorState title="无法加载任务分析" onRetry={() => void settingsQuery.refetch()} retrying={settingsQuery.isFetching} />;
  if (!settings?.available || !settings.subscribed || !settings.modelsEnabled) return null;

  const unique = new Map([...(activity?.events ?? []), ...(extra?.events ?? [])].map((event) => [`${event.memberId}:${event.source}:${event.id}`, event]));
  const tasks = [...groupRows([...unique.values()], (event) => `${event.memberId}:${event.sessionId}:${event.taskId}`).values()];
  const usage = consumption?.groups ?? [];
  const groups = [...groupRows(usage, (group) => groupBy === "member" ? group.memberId : groupBy === "day" ? group.day : group.model ?? "未知模型")].map(([id, rows]) => ({
    id, name: groupBy === "member" ? memberName(id) : groupBy === "model" ? modelName(id) : id,
    calls: rows.reduce((total, row) => total + row.calls, 0), incomplete: rows.reduce((total, row) => total + row.incompleteCalls, 0),
    tokens: rows.every((row) => row.inputTokens === null && row.outputTokens === null) ? null : rows.reduce((total, row) => total + (row.inputTokens ?? 0) + (row.outputTokens ?? 0), 0),
    cost: rows.every((row) => row.costUsd === null) ? null : rows.reduce((total, row) => total + (row.costUsd ?? 0), 0),
  })).sort((a, b) => b.calls - a.calls);
  const calls = usage.reduce((total, row) => total + row.calls, 0);
  const incomplete = usage.reduce((total, row) => total + row.incompleteCalls, 0);
  const cost = usage.some((row) => row.costUsd !== null) ? usage.reduce((total, row) => total + (row.costUsd ?? 0), 0) : null;
  const tokens = usage.some((row) => row.inputTokens !== null || row.outputTokens !== null) ? usage.reduce((total, row) => total + (row.inputTokens ?? 0) + (row.outputTokens ?? 0), 0) : null;
  const daysWithUsage = groupRows(usage, (row) => row.day);
  const daily = Array.from({ length: days + 1 }, (_, index) => {
    const day = new Date(Date.now() - (days - index) * 86_400_000).toISOString().slice(0, 10);
    return { day, calls: (daysWithUsage.get(day) ?? []).reduce((sum, row) => sum + row.calls, 0) };
  });
  const message = error ?? (dataQuery.isError ? "无法刷新分析数据，请重试。当前显示上次成功刷新的数据。" : null);
  const tabs: { value: Tab; label: string; icon: typeof ActivityIcon }[] = [
    { value: "Activity", label: "活动", icon: ActivityIcon },
    { value: "Consumption", label: "用量", icon: Coins },
    { value: "Integrations", label: "集成", icon: Plug },
  ];
  return <section className="grid gap-5" data-testid="models-task-analytics" aria-label="任务分析">
    {!settings.enabled ? <div className={`${analyticsSurfaceClass} grid gap-6 p-6`}>
      <div>
        <span className="text-xs text-[var(--dls-text-secondary)]">OpenWork 模型已包含</span>
        <h2 className="mt-4 text-xl font-semibold tracking-tight text-[#07192C]">启用自定义洞察</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#637291]">查看模型用量、费用、任务活动以及团队使用的技能和工具。是否为团队的 OpenWork 任务开启分析？</p>
        <p className="mt-2 text-xs leading-5 text-[#637291]">不包含提示词、回复和文件内容。工作区管理员可查看分析数据，启用后才开始采集，可随时关闭。</p>
        {settings.consentedAt ? <p className="mt-3 text-sm text-[#637291]">任务分析已关闭，仍可正常使用 OpenWork 模型。</p> : null}
        <div className="mt-5 flex flex-wrap gap-2"><DenButton disabled={mutating} onClick={() => void choose(true)}>启用任务分析</DenButton>
          {!settings.consentedAt ? <DenButton variant="secondary" disabled={mutating} onClick={() => void choose(false)}>暂不迁移</DenButton> : null}</div>
      </div>
    </div> : <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold tracking-tight text-[#07192C]">任务分析</h2>
          <p className="mt-1 text-xs text-[#637291]">仅 OpenWork 模型 · 订阅已包含</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--dls-text-secondary)]">分析已开启</span>
          <DenButton variant="ghost" size="sm" disabled={mutating} onClick={() => void choose(false)}>关闭分析</DenButton>
        </div>
      </div>
      <UnderlineTabs tabs={tabs} activeTab={tab} onChange={(value) => { setTab(value); setSelected(null); }} />
      {tab !== "Integrations" ? <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <DenSelect aria-label="分析时段" className="h-9 w-40" value={String(days)} onChange={(event) => { setDays(Number(event.target.value)); setPagination({ firstPage: undefined, extra: null }); setSelected(null); }}>
              <option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option>
            </DenSelect>
            {tab === "Consumption" ? <DenSelect aria-label="用量分组方式" className="h-9 w-40" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              <option value="model">按模型</option><option value="member">按成员</option><option value="day">按天</option>
            </DenSelect> : null}
          </div>
          {dataQuery.isError ? null : <div className="flex items-center gap-3"><span className="text-xs text-[#637291]">自动更新</span>
            <DenButton variant="secondary" size="sm" disabled={busy} onClick={() => void dataQuery.refetch()}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${dataQuery.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />刷新分析数据</DenButton>
          </div>}
        </div>
        {!dataQuery.isError || dataQuery.data ? <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="模型调用" value={loading ? "…" : calls.toLocaleString(DEFAULT_DEN_LOCALE)} sub={`最近 ${days} 天`} />
          <StatCard title="已报告费用" value={loading ? "…" : formatCost(cost)} sub={incomplete ? "不完整 · 部分调用没有用量记录" : "提供商报告值，不代表账单金额"} />
          <StatCard title="已报告的 Token" value={loading ? "…" : tokens?.toLocaleString(DEFAULT_DEN_LOCALE) ?? "未知"} sub={incomplete ? "不完整 · 部分调用没有用量记录" : "输入与输出 Token"} />
          <StatCard title="已用模型" value={loading ? "…" : new Set(usage.flatMap((row) => row.model ? [row.model] : [])).size.toLocaleString(DEFAULT_DEN_LOCALE)} sub="通过 OpenWork 模型" />
        </div> : null}
      </> : null}
      {tab === "Activity" ? <div className={`${analyticsSurfaceClass} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-[#edf0f5] px-5 py-4">
          <div><h3 className="text-sm font-semibold text-[#07192C]">{selected ? "任务详情" : "近期活动"}</h3><p className="mt-1 text-xs text-[#637291]">{selected ? "此任务中的模型调用、技能与工具" : "启用分析后的新任务"}</p></div>
          {selected ? <DenButton variant="ghost" size="sm" onClick={() => setSelected(null)}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />返回活动</DenButton> : null}
        </div>
        {selected ? <DenTable headerTone="plain" rows={selected.events} getRowKey={(event) => `${event.source}:${event.memberId}:${event.id}`} columns={[
          { key: "event", header: "活动", render: (event) => <span className="text-sm text-[#30405F]">{event.type.replaceAll(".", " ")}</span> },
          { key: "detail", header: "详情", render: (event) => <div className="max-w-sm break-words text-sm text-[#30405F]">{event.model ? modelName(event.model) : event.skill ?? event.tool ?? "任务"}{event.skillVersion ? ` (${event.skillVersion})` : ""}{event.mcp ? <p className="mt-1 text-xs text-[#637291]">{event.mcp}</p> : null}{event.metadata ? <p className="mt-1 text-xs text-[#637291]">{Object.entries(event.metadata).map(([key, value]) => `${key}: ${value}`).join(", ")}</p> : null}</div> },
          { key: "duration", header: "持续时间", align: "right", render: (event) => <span className="whitespace-nowrap text-sm tabular-nums">{event.durationMs === undefined ? "—" : `${(event.durationMs / 1_000).toFixed(1)}s`}</span> },
          { key: "cost", header: "费用", align: "right", render: (event) => <span className="text-sm tabular-nums">{event.type === "model.call" ? formatCost(event.costUsd) : "—"}</span> },
        ]} /> : loading ? <ItemRowsSkeleton label="正在加载活动" rows={4} /> : dataQuery.isError && !dataQuery.data ? null : tasks.length ? <DenTable headerTone="plain" rows={tasks} getRowKey={(events) => `${events[0].memberId}:${events[0].sessionId}:${events[0].taskId}`} columns={[
          { key: "task", header: "任务", render: (events) => <button className="text-left text-sm font-medium text-[var(--dls-text-primary)] hover:underline" onClick={() => void details(events[0].memberId, events[0].sessionId, events[0].taskId)}>
            {events.some((event) => event.type === "skill.loaded") ? "使用技能的任务" : "模型任务"}<span className="mt-1 block text-xs font-normal text-[#637291]">{new Date(events[0].timestamp).toLocaleString(DEFAULT_DEN_LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></button> },
          { key: "member", header: "成员", render: (events) => <span className="text-sm text-[#30405F]">{memberName(events[0].memberId)}</span> },
          { key: "status", header: "结果", render: (events) => <Outcome events={events} /> },
          { key: "models", header: "模型", render: (events) => <span className="text-sm text-[#637291]">{[...new Set(events.flatMap((event) => event.model ? [modelName(event.model)] : []))].join(", ") || "—"}</span> },
        ]} /> : <AnalyticsEmptyState title="下次 OpenWork 模型任务将显示在此处" action={<AnalyticsAdoptionLink orgSlug={activeOrg?.slug} />}>
          <p>选择模型来源： <strong className="font-medium text-[#30405F]">OpenWork 模型</strong> ，在桌面模型选择器中选定后运行新任务。此页面会自动刷新。</p>
          <p className="mt-2">自有提供商连接的任务统计在“用量与采用率”中，此处模型费用仅包含 OpenWork 模型。</p>
        </AnalyticsEmptyState>}
        {(selected ? selected.next : extra ? extra.next : activity?.next) ? <div className="border-t border-[#edf0f5] p-4"><DenButton variant="secondary" size="sm" disabled={busy} onClick={() => void more()}>{selected ? "加载更多事件" : "加载更多活动"}</DenButton></div> : null}
      </div> : null}
      {tab === "Consumption" ? <>
        {loading ? <AnalyticsLoading label="正在加载用量" /> : dataQuery.isError && !dataQuery.data ? null : !usage.length ? <div className={analyticsSurfaceClass}><AnalyticsEmptyState title="尚未记录模型用量">使用 OpenWork 模型运行新任务后，可查看模型调用与提供商报告的用量。此处不包含自有提供商账户用量。</AnalyticsEmptyState></div> : <>
          <TrendChart title="模型调用趋势" subtitle={`每日调用次数 · 最近 ${days} 天 · UTC`} intervalLabel="" weeks={daily.map(({ day }) => ({ weekStart: day }))} series={[{ label: "模型调用", values: daily.map((row) => row.calls) }]} />
          <div className={`${analyticsSurfaceClass} overflow-hidden`}>
            <div className="border-b border-[#edf0f5] px-5 py-4"><h3 className="text-sm font-semibold text-[#07192C]">用量分组 {groupByLabel}</h3><p className="mt-1 text-xs text-[#637291]">OpenWork 模型已报告用量</p></div>
            <DenTable headerTone="plain" rows={groups} getRowKey={(group) => group.id} emptyLabel={loading ? "正在加载用量…" : "用量不可用。"} columns={[
              { key: "name", header: groupByLabel, render: (group) => <span className="text-sm font-medium text-[#30405F]">{group.name}</span> },
              { key: "calls", header: "调用次数", align: "right", render: (group) => <span className="text-sm tabular-nums">{group.calls.toLocaleString(DEFAULT_DEN_LOCALE)}</span> },
              { key: "tokens", header: "已报告的 Token", align: "right", render: (group) => <span className="text-sm tabular-nums">{group.tokens?.toLocaleString(DEFAULT_DEN_LOCALE) ?? "未知"}</span> },
              { key: "cost", header: "已报告费用", align: "right", render: (group) => <span className="text-sm font-medium tabular-nums">{formatCost(group.cost)}</span> },
              { key: "incomplete", header: "不完整用量", align: "right", render: (group) => <span className={group.incomplete ? "text-xs text-amber-700" : "text-xs text-[#637291]"}>{group.incomplete ? `${group.incomplete} 次调用` : "完整"}</span> },
            ]} />
          </div>
        </>}
        <p className="text-xs leading-5 text-[#637291]">缺失的用量保持为未知，调用中断时报告总数可能不完整。订阅共享用量限额显示在上方。</p>
      </> : null}
      {tab === "Integrations" ? <div className={`${analyticsSurfaceClass} p-5 sm:p-6`}><LangfuseSettings settings={settings} refresh={refreshSettings} /></div> : null}
      <p className="flex items-start gap-2 text-xs leading-5 text-[#637291]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />仅包含活动元数据，不包含提示词、回复或文件内容，不导入历史任务。</p>
    </>}
    {message ? dataQuery.isError && !dataQuery.data ? <AnalyticsErrorState title="无法加载任务分析" onRetry={() => void dataQuery.refetch()} retrying={dataQuery.isFetching} /> : <DenNotice tone="neutral" presentation="inline" message={message} action={dataQuery.isError ? <DenButton variant="secondary" size="sm" disabled={dataQuery.isFetching} onClick={() => void dataQuery.refetch()}>重试</DenButton> : undefined} /> : null}
  </section>;
}
