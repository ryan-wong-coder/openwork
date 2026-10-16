"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useOrgDashboard } from "../../_providers/org-dashboard-provider";
import { EnterprisePlanNotice } from "../../_components/enterprise-plan-notice";
import { ModelUsageList } from "./model-usage-list";
import { ProjectFilter } from "./project-filter";
import { StatCard } from "./stat-card";
import { TrendChart } from "./trend-chart";
import { useAnalytics, useProjectOptions } from "./use-analytics";
import { AnalyticsEmptyState, AnalyticsErrorState, AnalyticsLoading, AnalyticsPageHeader, analyticsPageClass, analyticsSurfaceClass } from "./analytics-layout";
import { getMembersRoute } from "../../../_lib/den-org";
import { DenButton } from "../../../_components/ui/button";
import { DenNotice } from "../../../_components/ui/notice";

/* ── Formatting ── */

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function successRate(completed: number, failed: number): string {
  const total = completed + failed;
  if (total === 0) return "—";
  return `${Math.round((completed / total) * 100)}%`;
}

function selectionShare(value: number, defaultCount: number, manualCount: number): string {
  const total = defaultCount + manualCount;
  return total === 0 ? "暂无模型会话" : `占模型会话的 ${Math.round((value / total) * 100)}%`;
}

/* ── Main screen ── */

export function AnalyticsScreen() {
  const { activeOrg, orgContext } = useOrgDashboard();
  const [projectValue, setProjectValue] = useState("");

  // Server enforces the same gate with a 402 on /v1/telemetry/analytics
  // (entitlements.ts); this mirrors the SSO / desktop policies screens.
  const locked = Boolean(orgContext) && !orgContext?.entitlements.analytics;

  const projectOptions = useProjectOptions(!locked);
  const { data, isLoading, isFetching, isError, refetch } = useAnalytics(!locked, projectValue);

  const projectScoped = projectValue.length > 0;
  // A workspace nobody has used yet gets one clear empty state, not a page of zeros.
  const noActivity = Boolean(data) && !projectScoped && !isError
    && (data?.activeMembers30d ?? 0) === 0 && (data?.sessions30d ?? 0) === 0
    && (data?.tasksCompleted30d ?? 0) + (data?.tasksFailed30d ?? 0) === 0
    && (data?.weekly ?? []).every((week) => week.activeMembers === 0 && week.sessions === 0);
  const weekly = data?.weekly ?? [];
  const tasks7d = (data?.tasksCompleted7d ?? 0) + (data?.tasksFailed7d ?? 0);
  const modelUsage = data?.models.usage30d ?? [];
  const defaultModelSessions = data?.models.selection30d.default ?? 0;
  const manualModelSessions = data?.models.selection30d.manual ?? 0;

  return (
    <div className={analyticsPageClass}>
      <AnalyticsPageHeader orgSlug={activeOrg?.slug} active="adoption"
        title="用量与采用率"
        action={!locked && !isError ? <DenButton variant="secondary" disabled={isFetching} onClick={() => void refetch()}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />刷新分析数据</DenButton> : null} />

      {locked ? (
        <EnterprisePlanNotice feature="用量分析" detail="当前套餐不提供团队用量。" />
      ) : isError && !data ? <AnalyticsErrorState title="无法加载分析数据" onRetry={() => void refetch()} retrying={isFetching} />
      : isLoading ? <AnalyticsLoading label="正在加载分析数据" /> : noActivity ? (
        <div className={analyticsSurfaceClass} data-testid="analytics-no-activity">
          <AnalyticsEmptyState title="暂无活动"
            action={<DenButton variant="secondary" href={getMembersRoute(activeOrg?.slug)}>邀请团队成员</DenButton>}>
            成员登录 OpenWork 并运行首个任务后，用量将在此显示。不包含提示词、代码或文件内容。
          </AnalyticsEmptyState>
        </div>
      ) : (
      <>
      {isError ? <DenNotice tone="neutral" presentation="inline" message="无法刷新分析数据，当前显示上次可用数据。" action={<DenButton variant="secondary" size="sm" disabled={isFetching} onClick={() => void refetch()}>重试</DenButton>} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
      <ProjectFilter options={projectOptions} value={projectValue} onValueChange={setProjectValue} />
      <span className="text-xs text-[#637291]">最近 12 周趋势</span>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="OpenWork 用户"
          value={isLoading ? "…" : `${data?.members ?? 0}`}
          sub={projectScoped ? "组织总计，未按项目筛选" : `${data?.pendingInvites ?? 0} 项待接受邀请`}
        />
        <StatCard
          title="本周活跃用户"
          value={isLoading ? "…" : `${data?.activeMembers7d ?? 0}`}
          sub={`最近 30 天有 ${data?.activeMembers30d ?? 0} 名活跃成员`}
        />
        <StatCard
          title="本周会话"
          value={isLoading ? "…" : `${data?.sessions7d ?? 0}`}
          sub={`最近 30 天共 ${data?.sessions30d ?? 0} 次`}
        />
        <StatCard
          title="本周任务"
          value={isLoading ? "…" : `${tasks7d}`}
          sub={`成功率 ${successRate(data?.tasksCompleted7d ?? 0, data?.tasksFailed7d ?? 0)}`}
        />
      </div>

      {/* Trend charts */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <TrendChart isLoading={isLoading}
          title="每周活跃用户"
          subtitle={projectScoped ? "最近 12 周内发生匹配项目事件的成员" : "最近 12 周内至少发生一次事件的成员"}
          weeks={weekly}
          series={[{ label: "活跃用户", values: weekly.map((w) => w.activeMembers) }]}
        />
        <TrendChart isLoading={isLoading}
          title="每周会话数"
          subtitle="最近 12 周的独立会话"
          weeks={weekly}
          series={[{ label: "会话", values: weekly.map((w) => w.sessions) }]}
        />
      </div>

      <div>
        <TrendChart isLoading={isLoading}
          title="每周任务数"
          subtitle="最近 12 周已完成与失败的任务运行"
          weeks={weekly}
          series={[
            { label: "已完成", values: weekly.map((w) => w.tasksCompleted) },
            { label: "失败", values: weekly.map((w) => w.tasksFailed) },
          ]}
        />
      </div>

      {/* Model usage */}
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[#07192C]">模型</h2>
        <div className="mt-3 grid gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <ModelUsageList models={modelUsage} isLoading={isLoading} />
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-1">
            <StatCard
              title="默认模型"
              value={isLoading ? "…" : `${defaultModelSessions}`}
              sub={selectionShare(defaultModelSessions, defaultModelSessions, manualModelSessions)}
            />
            <StatCard
              title="手动选择"
              value={isLoading ? "…" : `${manualModelSessions}`}
              sub={selectionShare(manualModelSessions, defaultModelSessions, manualModelSessions)}
            />
          </div>
        </div>
      </div>

      {/* 30-day detail */}
      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatCard
          title="平均任务时长"
          value={isLoading ? "…" : formatDuration(data?.avgTaskDurationMs30d ?? null)}
          sub="最近 30 天已完成任务"
        />
        <StatCard
          title="已完成任务"
          value={isLoading ? "…" : `${data?.tasksCompleted30d ?? 0}`}
          sub="最近 30 天"
        />
        <StatCard
          title="失败任务"
          attention={(data?.tasksFailed30d ?? 0) > 0}
          value={isLoading ? "…" : `${data?.tasksFailed30d ?? 0}`}
          sub={`最近 30 天成功率 ${successRate(data?.tasksCompleted30d ?? 0, data?.tasksFailed30d ?? 0)}`}
        />
      </div>

      {/* Privacy note */}
      <p className="border-t border-[#e3e7ee] pt-4 text-xs leading-5 text-[#637291]">
        遥测不包含提示词、代码、文件内容、差异、密钥或终端输出。成员登录 OpenWork 并开始运行任务后，用量数据将在此显示。
      </p>
      </>
      )}
    </div>
  );
}
