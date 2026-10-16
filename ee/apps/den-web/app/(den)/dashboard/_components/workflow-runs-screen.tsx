"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EnterprisePlanNotice } from "./enterprise-plan-notice";
import { AnalyticsEmptyState, AnalyticsErrorState, AnalyticsPageHeader, analyticsPageClass, analyticsSurfaceClass } from "../_features/analytics/analytics-layout";
import { WorkflowFlowDiagram } from "./workflow-flow-diagram";
import { ItemPanel, ItemRow, ItemRowsSkeleton } from "./item-list";
import { LetterTile } from "./item-logo";
import {
  getWorkflowRuns,
  getErrorMessage,
  requestJson,
  type WorkflowRun,
} from "../../_lib/den-flow";

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}

function WorkflowRunCard({ run }: { run: WorkflowRun }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  return <li data-run-id={run.id} data-testid={`workflow-run-${run.id}`} data-analytics-row>
    <ItemRow logo={<LetterTile name={run.workflow?.title ?? "单次任务"} />}
      title={run.workflow ? <span data-testid={`workflow-run-link-${run.id}`}>{run.workflow.title}</span> : run.source === "adhoc" ? "单次任务" : "工作流运行"}
      href={run.workflow ? `/dashboard/library/workflows/${encodeURIComponent(run.workflow.configObjectId)}` : undefined}
      description={<><span className={run.status === "failed" ? "text-[var(--ow-danger)] sm:hidden" : "sm:hidden"}>{run.status === "succeeded" ? "成功" : "失败"} </span><time data-testid={`workflow-run-time-${run.id}`} dateTime={run.finishedAt}>{new Date(run.finishedAt).toLocaleString(DEFAULT_DEN_LOCALE)}</time></>}
      comparison={<span className={`hidden shrink-0 text-[13px] sm:block ${run.status === "failed" ? "text-[var(--ow-danger)]" : "text-[var(--dls-text-secondary)]"}`}>{run.status === "succeeded" ? "成功" : "失败"}</span>}
      action={<DenButton variant="plain" size="inline" data-testid={`workflow-run-preview-${run.id}`} aria-expanded={previewOpen} aria-controls={`run-preview-${run.id}`} onClick={() => setPreviewOpen(!previewOpen)}><ChevronRight size={16} strokeWidth={1.5} aria-hidden className={previewOpen ? "rotate-90" : undefined} />详情</DenButton>} />
    {previewOpen ? <div id={`run-preview-${run.id}`}>
      {run.workflow ? run.workflow.graph ? <div data-testid={`workflow-run-visualization-${run.id}`} role="region" aria-label={`${run.workflow.title} 工作流可视图`} className="px-5 pb-3">
        <WorkflowFlowDiagram graph={run.workflow.graph} />
      </div> : <p className="px-5 pb-3 text-[13px] text-[var(--dls-text-secondary)]">此次运行的可视化不可用。</p> : null}
      <WorkflowRunTechnicalDetails run={run} />
    </div> : null}
  </li>;
}

function WorkflowRunTechnicalDetails({ run }: { run: WorkflowRun }) {
  return <details className="px-5 pb-3 text-xs text-[var(--dls-text-secondary)]">
    <summary data-testid={`workflow-run-details-${run.id}`} className="cursor-pointer font-medium">技术详情</summary>
    <dl className="mt-3 flex flex-col gap-2">
      <div><dt>源码</dt><dd className="break-all font-mono">{run.source}</dd></div>
      <div><dt>工具调用</dt><dd>{run.toolCallCount}{run.toolCalls.length > 0 ? <span className="ml-2 break-all font-mono">{run.toolCalls.map((call) => call.name).join(", ")}</span> : null}</dd></div>
      <div><dt>持续时间</dt><dd>{formatDuration(run.durationMs)}</dd></div>
      {run.errorMessage ? <div><dt>错误</dt><dd className="break-words text-[var(--ow-danger)]">{run.errorMessage}</dd></div> : null}
    </dl>
  </details>;
}

export function WorkflowRunsScreen() {
  const { activeOrg, orgContext } = useOrgDashboard();
  const entitled = orgContext?.entitlements.analytics === true;
  const { data: runs, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ["workflow-runs", orgContext?.organization.id],
    enabled: entitled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { response, payload } = await requestJson("/v1/workflow-runs", { method: "GET" }, 12000);
      if (!response.ok) throw new Error(getErrorMessage(payload, "无法加载工作流运行记录，请重试。"));
      return getWorkflowRuns(payload);
    },
  });

  return <div className={analyticsPageClass}>
    <AnalyticsPageHeader orgSlug={activeOrg?.slug} active="workflows" title="工作流运行记录"
      action={entitled && !isError ? <DenButton variant="secondary" disabled={isFetching} onClick={() => void refetch()}>
        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />刷新运行记录
      </DenButton> : null} />
    {!entitled ? <EnterprisePlanNotice feature="工作流运行历史" detail="当前套餐不提供运行历史。" /> : <>
      {isError ? !runs ? <AnalyticsErrorState title="无法加载工作流运行记录" onRetry={() => void refetch()} retrying={isFetching} /> : <DenNotice tone="neutral" presentation="inline" message="刷新失败，当前显示上次运行记录。" action={<DenButton variant="secondary" size="sm" disabled={isFetching} onClick={() => void refetch()}>重试</DenButton>} /> : null}
      {isPending ? <ItemPanel><ItemRowsSkeleton label="正在加载工作流运行记录" rows={4} /></ItemPanel>
        : runs?.length === 0 ? <div className={analyticsSurfaceClass}>
          <AnalyticsEmptyState title="暂无工作流运行记录">运行已保存工作流或单次任务后，可在此查看活动。</AnalyticsEmptyState>
        </div> : runs ? <ol className="divide-y divide-[var(--dls-border)] rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-surface)]" aria-label="工作流运行记录">
          {runs.map((run) => <WorkflowRunCard key={run.id} run={run} />)}
        </ol> : null}
    </>}
  </div>;
}
