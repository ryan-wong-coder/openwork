"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { CalendarClock, Trash2 } from "lucide-react";
import type { WorkflowArtifactSnapshot, WorkflowDetail } from "@openwork/types/workflows";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenChip } from "../../_components/ui/chip";
import { DenList, DenListRow } from "../../_components/ui/list-row";
import { DenSectionHeader } from "../../_components/ui/section-header";
import { DenSwitch } from "../../_components/ui/switch";
import { WorkflowArtifactResult } from "./workflow-artifact-result";
import { WorkflowFlowDiagram } from "./workflow-flow-diagram";
import { workflowDiagramInput } from "./use-workflow-detail-state";

export type WorkflowRunsTabProps = {
  detail: WorkflowDetail;
  snapshots: WorkflowArtifactSnapshot[];
  selectedSnapshot: WorkflowArtifactSnapshot | null;
  selectedReceiptId: string | null;
  technical: boolean;
  pending: boolean;
  automationCount: number;
  automateHref: string | null;
  onTechnicalChange: (checked: boolean) => void;
  onSelectRun: (receiptId: string) => void;
  onDeleteRun: (receiptId: string) => void;
  onUpdateAutomation: (input: {
    automationId: string;
    pluginId: string;
    configObjectVersionId: string;
    input: unknown;
  }) => void;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString(DEFAULT_DEN_LOCALE);
}

export function WorkflowRunsTab({
  detail,
  snapshots,
  selectedSnapshot,
  selectedReceiptId,
  technical,
  pending,
  automationCount,
  automateHref,
  onTechnicalChange,
  onSelectRun,
  onDeleteRun,
  onUpdateAutomation,
}: WorkflowRunsTabProps) {
  const selectedVersion = selectedSnapshot
    ? detail.versions.find((version) => version.id === selectedSnapshot.configObjectVersionId) ?? detail.currentVersion
    : detail.currentVersion;

  return (
    <div className="grid gap-6" data-tab="runs" role="tabpanel" aria-label="运行记录">
      <DenCard>
        <DenSectionHeader
          title="历史运行"
          description="选择一次运行以查看执行步骤与保存结果。"
          action={<DenChip tone="neutral" size="sm">{snapshots.length}</DenChip>}
        />
        <div className="mt-5">
          {snapshots.length === 0 ? (
            <p className="text-[13px] text-gray-400">暂无运行记录。</p>
          ) : (
            <DenList>
              {snapshots.map((snapshot) => (
                <DenListRow
                  key={snapshot.receiptId}
                  focused={snapshot.receiptId === selectedReceiptId}
                  onClick={() => onSelectRun(snapshot.receiptId)}
                  ariaLabel={`查看 ${formatDate(snapshot.finishedAt)} 的运行`}
                  title={formatDate(snapshot.finishedAt)}
                  chips={
                    <>
                      <DenChip tone={snapshot.status === "failed" ? "danger" : "success"}>
                        {snapshot.status === "failed" ? "失败" : "成功"}
                      </DenChip>
                      {snapshot.contentDeletedAt ? <DenChip tone="neutral">结果已移除</DenChip> : null}
                    </>
                  }
                  meta={
                    <span>
                      {snapshot.source === "manual" ? "手动" : "已安排"}
                      {technical ? ` · ${snapshot.receiptId}` : ""}
                    </span>
                  }
                  action={
                    !snapshot.contentDeletedAt && detail.canManage ? (
                      <DenButton
                        variant="ghost"
                        size="xs"
                        icon={Trash2}
                        aria-label="删除此次运行保存的结果"
                        disabled={pending}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!window.confirm("删除此次运行保存的输入与结果？日期与状态将保留。")) return;
                          onDeleteRun(snapshot.receiptId);
                        }}
                      />
                    ) : null
                  }
                />
              ))}
            </DenList>
          )}
        </div>
      </DenCard>

      <DenCard>
        <DenSectionHeader
          title="所选运行"
          description={selectedSnapshot ? `${formatDate(selectedSnapshot.finishedAt)} · ${selectedSnapshot.source === "manual" ? "手动" : "已安排"}` : "请选择上方的一次历史运行。"}
          action={selectedSnapshot ? (
            <span className="flex items-center gap-2 text-[12px] text-gray-500">
              显示技术详情
              <DenSwitch
                checked={technical}
                onChange={onTechnicalChange}
                size="sm"
                aria-label="显示所选运行的技术详情"
              />
            </span>
          ) : null}
        />
        {selectedSnapshot ? (
          <div className="mt-5 grid gap-6">
            {selectedVersion.graph ? (
              <WorkflowFlowDiagram
                graph={selectedVersion.graph}
                technical={technical}
                inputValues={workflowDiagramInput(selectedSnapshot, selectedVersion.exampleInput)}
                run={{
                  toolCalls: selectedSnapshot.toolCalls,
                  status: selectedSnapshot.status,
                  errorMessage: selectedSnapshot.errorMessage,
                  finishedAt: selectedSnapshot.finishedAt,
                }}
              />
            ) : null}
            <WorkflowArtifactResult
              snapshot={selectedSnapshot}
              freshness={selectedSnapshot.receiptId === detail.latestSnapshot?.receiptId ? detail.freshness : undefined}
              lastSuccessful={selectedSnapshot.receiptId === detail.latestSuccessfulSnapshot?.receiptId}
              technical={technical}
            />
          </div>
        ) : null}
      </DenCard>

      <DenCard>
        <DenSectionHeader
          title="版本"
          description="更新前，计划任务继续使用已保存的版本。"
        />
        <DenList className="mt-5">
          {detail.versions.map((version, index) => (
            <DenListRow
              key={version.id}
              title={index === 0 ? "当前" : "更早"}
              chips={index === 0 ? <DenChip tone="success">当前</DenChip> : <DenChip tone="neutral">更早</DenChip>}
              meta={
                <span>
                  {new Date(version.createdAt).toLocaleDateString(DEFAULT_DEN_LOCALE, { month: "short", day: "numeric", year: "numeric" })}
                  {` · ${version.automationReferences.length} 项计划`}
                  {technical ? ` · ${version.id}` : ""}
                </span>
              }
              action={detail.canManage && index > 0 && version.automationReferences.length > 0 ? (
                <div className="flex flex-col items-end gap-2">
                  {version.automationReferences.map((reference) => (
                    <DenButton
                      key={reference.id}
                      variant="secondary"
                      size="xs"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`将 ${reference.name} 更新至当前版本？计划和已保存的输入将保持不变。`)) return;
                        onUpdateAutomation({
                          automationId: reference.id,
                          pluginId: detail.pluginId,
                          configObjectVersionId: detail.currentVersion.id,
                          input: reference.input,
                        });
                      }}
                    >
                      更新 {reference.name}
                    </DenButton>
                  ))}
                </div>
              ) : null}
            />
          ))}
        </DenList>
      </DenCard>

      <DenCard>
        <DenSectionHeader
          title="计划任务"
          description={automationCount === 0 ? "暂无计划任务。" : `${automationCount} 项启用的计划。`}
          action={
            <div className="flex items-center gap-3">
              <DenChip tone="neutral" size="sm">{automationCount}</DenChip>
              {detail.canManage && automateHref ? (
                <DenButton href={automateHref} target="_blank" rel="noopener noreferrer" icon={CalendarClock}>
                  自动执行
                </DenButton>
              ) : null}
            </div>
          }
        />
      </DenCard>
    </div>
  );
}
