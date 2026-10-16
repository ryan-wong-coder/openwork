"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { History, RefreshCw } from "lucide-react";
import { useState } from "react";
import type {
  GeneratedArtifactView,
  WorkflowArtifactSnapshot,
  WorkflowDetail,
} from "@openwork/types/workflows";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenChip } from "../../_components/ui/chip";
import { DenList } from "../../_components/ui/list-row";
import { DenSectionHeader } from "../../_components/ui/section-header";
import { DenSwitch } from "../../_components/ui/switch";
import { DenTextarea } from "../../_components/ui/textarea";
import { WorkflowArtifactResult } from "./workflow-artifact-result";
import { WorkflowFlowDiagram } from "./workflow-flow-diagram";
import { formFieldsFromSchema, WorkflowInputForm } from "./workflow-input-form";
import { summarizeGraph } from "./workflow-plain-language";
import { StructuredConfigEditor } from "./structured-config-editor";
import {
  workflowDiagramInput,
  type WorkflowFields,
} from "./use-workflow-detail-state";

export type WorkflowOverviewTabProps = {
  detail: WorkflowDetail;
  fields: WorkflowFields;
  views: GeneratedArtifactView[];
  technical: boolean;
  showJsonInput: boolean;
  parsedInputSchema: unknown;
  hasInputForm: boolean;
  inputFormValue: Record<string, unknown>;
  pending: boolean;
  viewPending: boolean;
  canManageDisplays: boolean;
  onTechnicalChange: (checked: boolean) => void;
  onShowJsonInputChange: (show: boolean) => void;
  onInputChange: (value: string) => void;
  onRun: () => void;
  onActivateView: (viewId: string, revisionId: string) => void;
  onRetireView: (viewId: string) => void;
  visualConfiguration?: boolean;
};

function shortDigest(value: string | null) {
  return value ? `${value.slice(0, 15)}…${value.slice(-8)}` : "—";
}

function cspSummary(csp: {
  connectDomains: string[];
  resourceDomains: string[];
  frameDomains: string[];
  baseUriDomains: string[];
}) {
  const domains = [...csp.connectDomains, ...csp.resourceDomains, ...csp.frameDomains, ...csp.baseUriDomains];
  return domains.length === 0 ? "CSP：无外部来源" : `CSP: ${domains.join(", ")}`;
}

function replay(snapshot: WorkflowArtifactSnapshot | null) {
  return snapshot ? {
    toolCalls: snapshot.toolCalls,
    status: snapshot.status,
    errorMessage: snapshot.errorMessage,
    finishedAt: snapshot.finishedAt,
  } : null;
}

export function WorkflowOverviewTab({
  detail,
  fields,
  views,
  technical,
  showJsonInput,
  parsedInputSchema,
  hasInputForm,
  inputFormValue,
  pending,
  viewPending,
  canManageDisplays,
  onTechnicalChange,
  onShowJsonInputChange,
  onInputChange,
  onRun,
  onActivateView,
  onRetireView,
  visualConfiguration = false,
}: WorkflowOverviewTabProps) {
  const [structuredInputValid, setStructuredInputValid] = useState(true);
  const latestReplay = detail.latestSnapshot ?? detail.latestSuccessfulSnapshot;
  const latestResult = detail.latestSnapshot ?? detail.latestSuccessfulSnapshot;
  const replayVersion = latestReplay
    ? detail.versions.find((version) => version.id === latestReplay.configObjectVersionId) ?? detail.currentVersion
    : detail.currentVersion;
  const graphSummary = replayVersion.graph ? summarizeGraph(replayVersion.graph) : null;
  const flowInput = workflowDiagramInput(latestReplay, replayVersion.exampleInput);

  return (
    <div className="grid gap-6" data-tab="overview" data-testid="workflow-overview" role="tabpanel" aria-label="概览">
      <DenCard>
        <form
          aria-label="运行工作流"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (detail.canRun && !pending && (!visualConfiguration || structuredInputValid)) onRun();
          }}
        >
          <DenSectionHeader title="运行工作流" description="检查下方详情后运行，结果将显示在此处。" />
          {detail.canRun ? (
            <fieldset disabled={pending} className="mt-5 min-w-0 space-y-5">
              {hasInputForm ? (
                formFieldsFromSchema(parsedInputSchema)?.length === 0 ? (
                  <p className="text-[13px] text-gray-500">无需填写详情，此工作流可直接运行。</p>
                ) : (
                  <WorkflowInputForm
                    schema={parsedInputSchema}
                    value={inputFormValue}
                    onChange={(next) => onInputChange(JSON.stringify(next, null, 2))}
                  />
                )
              ) : visualConfiguration ? (
                <StructuredConfigEditor label="运行输入" text={fields.input || "{}"} onChange={onInputChange} onValidChange={setStructuredInputValid} disabled={pending} suggestions={false} allowRootValue />
              ) : (
                <p className="text-[13px] text-gray-500">此工作流使用结构化输入，运行前请在“高级输入”中检查已保存的值。</p>
              )}
              {!visualConfiguration || hasInputForm ? <div className="text-[12px] text-gray-500">
                <DenButton type="button" variant="ghost" size="xs" aria-expanded={showJsonInput} onClick={() => onShowJsonInputChange(!showJsonInput)}>
                  高级输入
                </DenButton>
                {showJsonInput ? <div className="mt-3 block">
                  {visualConfiguration ? <StructuredConfigEditor label="运行输入" text={fields.input || "{}"} onChange={onInputChange} onValidChange={setStructuredInputValid} disabled={pending} suggestions={false} allowRootValue /> : <><p>工作流输入（JSON）</p><DenTextarea
                    aria-label="运行输入详情"
                    className="mt-2 min-h-32 font-mono text-[11px]"
                    value={fields.input}
                    onChange={(event) => onInputChange(event.currentTarget.value)}
                  /></>}
                </div> : null}
              </div> : null}
              <div className="border-t border-gray-100 pt-4">
                <DenButton type="submit" icon={RefreshCw} loading={pending} disabled={visualConfiguration && !structuredInputValid} className="w-full sm:w-auto">
                  {pending ? "正在运行…" : "运行工作流"}
                </DenButton>
              </div>
            </fieldset>
          ) : (
            <p className="mt-5 text-[13px] text-gray-500">你没有运行此工作流的权限。</p>
          )}
        </form>
      </DenCard>

      <DenCard>
        <DenSectionHeader
          title="最新结果"
          description="最近一次运行保存的结果。"
        />
        <div className="mt-5">
          {latestResult ? (
            <WorkflowArtifactResult
              snapshot={latestResult}
              freshness={latestResult.receiptId === detail.latestSnapshot?.receiptId ? detail.freshness : undefined}
              lastSuccessful={latestResult.receiptId === detail.latestSuccessfulSnapshot?.receiptId}
              technical={technical}
            />
          ) : (
            <p className="text-[13px] text-gray-400">运行此工作流以查看首次结果。</p>
          )}
        </div>
      </DenCard>

      <DenCard>
        <DenSectionHeader
          title="运行方式"
          description={graphSummary?.sentence ?? "暂未提供此工作流的示意图。"}
          action={
            <div className="flex flex-wrap items-center gap-3">
              {graphSummary ? (
                <DenChip tone="neutral" size="sm">
                  {graphSummary.stepCount} 个步骤
                </DenChip>
              ) : null}
              <span className="flex items-center gap-2 text-[12px] text-gray-500">
                显示技术详情
                <DenSwitch
                  checked={technical}
                  onChange={onTechnicalChange}
                  size="sm"
                  aria-label="显示技术详情"
                />
              </span>
            </div>
          }
        />
        {replayVersion.graph ? (
          <div className="mt-5">
            <WorkflowFlowDiagram
              graph={replayVersion.graph}
              technical={technical}
              inputValues={flowInput}
              run={replay(latestReplay)}
            />
          </div>
        ) : null}
      </DenCard>

      <details className="rounded-2xl border border-gray-100 bg-white p-6">
        <summary className="mb-5 cursor-pointer text-[13px] font-medium text-gray-600">自定义结果展示</summary>
        <DenSectionHeader
          title="自定义展示"
          description="可将结果显示为代理设计的图表、表格或卡片布局；配置前使用标准视图。"
          action={
            <DenChip tone="neutral" size="sm">
              {views.length} 种展示
            </DenChip>
          }
        />
        <div className="mt-5">
          {views.length === 0 ? (
            <p className="border-t border-dashed border-gray-200 py-8 text-center text-[13px] text-gray-400">
              暂无自定义展示。在 OpenWork 对话中输入：“为 {detail.title} 工作流设计一个展示界面。”
            </p>
          ) : (
            <DenList>
              {views.map((view) => (
                <div key={view.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[14px] font-medium text-gray-950">{view.title}</h3>
                        <DenChip tone={view.status === "active" ? "success" : "neutral"}>
                          {view.status === "active" ? "使用中" : "未使用"}
                        </DenChip>
                      </div>
                      <p className="mt-1 text-[12px] text-gray-500">
                        {view.description || "此工作流结果的自定义布局。"}
                      </p>
                    </div>
                    {canManageDisplays && view.status === "active" ? (
                      <DenButton
                        variant="destructive"
                        size="sm"
                        loading={viewPending}
                        onClick={() => onRetireView(view.id)}
                      >
                        停止使用
                      </DenButton>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4">
                    {view.revisions.map((revision) => {
                      const active = revision.id === view.activeRevisionId;
                      return (
                        <div key={revision.id}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
                              <History className="h-3.5 w-3.5" aria-hidden />
                              <span>{new Date(revision.createdAt).toLocaleString(DEFAULT_DEN_LOCALE)}</span>
                              <DenChip tone={revision.buildStatus === "ready" ? active ? "success" : "neutral" : "danger"}>
                                {active ? "使用中" : revision.buildStatus === "ready" ? "已就绪" : "构建失败"}
                              </DenChip>
                            </div>
                            {canManageDisplays && revision.buildStatus === "ready" && !active && revision.retiredAt === null ? (
                              <DenButton
                                size="xs"
                                variant="secondary"
                                loading={viewPending}
                                onClick={() => onActivateView(view.id, revision.id)}
                              >
                                使用此版本
                              </DenButton>
                            ) : null}
                          </div>
                          <details className="mt-3 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
                            <summary className="cursor-pointer font-medium text-gray-600">技术详情</summary>
                            <p className="mt-2 break-all font-mono text-[10px]">{revision.id}</p>
                            <div className="mt-2 grid gap-1 md:grid-cols-2 xl:grid-cols-4">
                              <span>{revision.compilerName} {revision.compilerVersion}</span>
                              <span>React {revision.reactVersion}</span>
                              <span>{revision.compiledHtmlBytes === null ? "无编译产物" : `${revision.compiledHtmlBytes.toLocaleString(DEFAULT_DEN_LOCALE)} 字节`}</span>
                              <span>{new Date(revision.createdAt).toLocaleString(DEFAULT_DEN_LOCALE)}</span>
                              <span className="md:col-span-2">源码 {shortDigest(revision.sourceDigest)}</span>
                              <span className="md:col-span-2">资源 {shortDigest(revision.resourceDigest)}</span>
                              <span className="md:col-span-2 xl:col-span-4">{cspSummary(revision.csp)}</span>
                            </div>
                            <p className="mt-2 break-all font-mono text-[10px] text-gray-400">{revision.resourceUri}</p>
                            {revision.diagnostics.length ? (
                              <ul className="mt-2 flex flex-col gap-1 text-red-600">
                                {revision.diagnostics.map((diagnostic, index) => (
                                  <li key={`${diagnostic.message}-${index}`}>
                                    {diagnostic.level}: {diagnostic.message}
                                    {diagnostic.line ? ` (${diagnostic.line}:${diagnostic.column ?? 0})` : ""}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </details>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </DenList>
          )}
        </div>
      </details>
    </div>
  );
}
