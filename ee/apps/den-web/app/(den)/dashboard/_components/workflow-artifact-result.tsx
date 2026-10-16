"use client";

import { DEFAULT_DEN_LOCALE, denStatusLabel } from "../../../_lib/locale";

import type { ArtifactFreshness, WorkflowArtifactSnapshot } from "@openwork/types/workflows";
import { DenChip } from "../../_components/ui/chip";
import { DenNotice } from "../../_components/ui/notice";
import { WorkflowFriendlyValue } from "./workflow-friendly-value";

function decode(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function tableCells(line: string) {
  const values: string[] = [];
  let current = "";
  for (const character of line.slice(1, -1)) {
    if (character === "|" && !current.endsWith("\\")) {
      values.push(decode(current.trim()));
      current = "";
      continue;
    }
    if (character === "|" && current.endsWith("\\")) current = `${current.slice(0, -1)}|`;
    else current += character;
  }
  values.push(decode(current.trim()));
  return values;
}

export function WorkflowMarkdownPreview({ markdown }: { markdown: string }) {
  if (markdown.startsWith("```json\n") && markdown.endsWith("\n```")) {
    return <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-950 p-4 font-mono text-[12px] text-gray-100">{markdown.slice(8, -4)}</pre>;
  }
  const lines = markdown.split("\n");
  if (lines.length >= 2 && lines[0]?.startsWith("|") && lines[1]?.includes("---")) {
    const headers = tableCells(lines[0] ?? "");
    return (
      <div className="overflow-auto rounded-xl border border-gray-100">
        <table className="min-w-full text-left text-[12px]">
          <thead className="bg-gray-50"><tr>{headers.map((header) => <th key={header} className="px-3 py-2 font-medium text-gray-600">{header}</th>)}</tr></thead>
          <tbody>{lines.slice(2).map((line, rowIndex) => <tr key={`${rowIndex}:${line}`} className="border-t border-gray-100">{tableCells(line).map((entry, index) => <td key={`${index}:${entry}`} className="px-3 py-2 text-gray-700">{entry}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return <p className="whitespace-pre-wrap text-[13px] leading-6 text-gray-700">{decode(markdown)}</p>;
}

function runTime(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString(DEFAULT_DEN_LOCALE, { month: "short", day: "numeric" })} ${date.toLocaleTimeString(DEFAULT_DEN_LOCALE, { hour: "numeric", minute: "2-digit" })}`;
}

function statusLine(snapshot: WorkflowArtifactSnapshot, freshness: ArtifactFreshness | undefined, lastSuccessful: boolean | undefined): string {
  const parts = [
    `来自 ${runTime(snapshot.finishedAt)} 的${denStatusLabel(snapshot.source)}运行`,
    lastSuccessful ? "上次成功结果" : null,
    freshness?.state === "stale" ? "距上次运行已较久" : null,
  ];
  return parts.filter((part) => part !== null).join(" · ");
}

export function WorkflowArtifactResult(props: {
  snapshot: WorkflowArtifactSnapshot;
  freshness?: ArtifactFreshness;
  lastSuccessful?: boolean;
  technical?: boolean;
}) {
  const snapshot = props.snapshot;
  return (
    <div className="space-y-3" data-testid="den-workflow-artifact-result">
      <p className="text-[12px] text-gray-500">{statusLine(snapshot, props.freshness, props.lastSuccessful)}</p>
      {props.freshness?.state === "needs_attention" ? <DenNotice tone="warning" message={props.freshness.reason} /> : null}
      {snapshot.contentDeletedAt ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-4 text-[13px] text-gray-400">此次运行保存的结果已移除。</p>
      ) : snapshot.value === null && snapshot.markdown ? (
        <WorkflowMarkdownPreview markdown={snapshot.markdown} />
      ) : <WorkflowFriendlyValue value={snapshot.value} />}
      {props.technical ? (
        <details className="border-t border-gray-100 pt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-gray-600">技术详情</summary>
          <div className="mt-3 space-y-4">
            <div className="flex flex-wrap gap-2">
              <DenChip tone="neutral" mono>工作流版本 {snapshot.configObjectVersionId.slice(0, 8)}</DenChip>
              <DenChip tone="neutral">{snapshot.source === "scheduled" ? "已安排 · OpenWork 云端" : "手动"}</DenChip>
            </div>
            {snapshot.markdown ? <WorkflowMarkdownPreview markdown={snapshot.markdown} /> : <p className="text-[13px] text-gray-400">未保留渲染预览。</p>}
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-950 p-4 font-mono text-[12px] text-gray-100">{JSON.stringify(snapshot.value, null, 2)}</pre>
            <dl className="grid gap-3 rounded-xl border border-gray-100 p-4 text-[11px] sm:grid-cols-2">
              <div><dt className="text-gray-400">回执</dt><dd className="break-all font-mono text-gray-700">{snapshot.receiptId}</dd></div>
              <div><dt className="text-gray-400">工作流版本</dt><dd className="break-all font-mono text-gray-700">{snapshot.configObjectVersionId}</dd></div>
              <div><dt className="text-gray-400">代码摘要</dt><dd className="break-all font-mono">{snapshot.codeDigest}</dd></div>
              <div><dt className="text-gray-400">输入结构摘要</dt><dd className="break-all font-mono">{snapshot.inputSchemaDigest ?? "—"}</dd></div>
              <div><dt className="text-gray-400">输出结构摘要</dt><dd className="break-all font-mono">{snapshot.outputSchemaDigest ?? "—"}</dd></div>
              <div><dt className="text-gray-400">结果摘要</dt><dd className="break-all font-mono">{snapshot.resultDigest ?? "—"}</dd></div>
              <div><dt className="text-gray-400">渲染器</dt><dd>{snapshot.rendererVersion ?? "—"}</dd></div>
              <div><dt className="text-gray-400">自动化运行</dt><dd className="break-all font-mono">{snapshot.automationRunId ?? "手动"}</dd></div>
            </dl>
          </div>
        </details>
      ) : null}
    </div>
  );
}
