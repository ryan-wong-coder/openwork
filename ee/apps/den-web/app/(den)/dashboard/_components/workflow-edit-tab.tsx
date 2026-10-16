"use client";

import { Save, TestTube2 } from "lucide-react";
import { useState } from "react";
import type { WorkflowCapability, WorkflowDetail, WorkflowTestResult } from "@openwork/types/workflows";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenChip } from "../../_components/ui/chip";
import { DenInput } from "../../_components/ui/input";
import { DenSectionHeader } from "../../_components/ui/section-header";
import { DenTextarea } from "../../_components/ui/textarea";
import { WorkflowInputForm } from "./workflow-input-form";
import { WorkflowMarkdownPreview } from "./workflow-artifact-result";
import { WorkflowFriendlyValue } from "./workflow-friendly-value";
import { describeToolStep } from "./workflow-plain-language";
import type { WorkflowFields } from "./use-workflow-detail-state";
import { StructuredConfigEditor } from "./structured-config-editor";
import { structuredSchemaLabels } from "./structured-config-value";

export type WorkflowEditTabProps = {
  detail: WorkflowDetail;
  fields: WorkflowFields;
  parsedInputSchema: unknown;
  hasInputForm: boolean;
  inputFormValue: Record<string, unknown>;
  tested: { result: WorkflowTestResult; fingerprint: string } | null;
  fingerprint: string;
  pending: boolean;
  onUpdate: (key: keyof WorkflowFields, value: string) => void;
  onTest: () => void;
  onSave: () => void;
  visualConfiguration?: boolean;
};

function capabilityDescription(capability: WorkflowCapability): { title: string; service: string } {
  const path = capability.scriptPath.replace(/^tools\./, "").split(".");
  const namespace = path[0] ?? "";
  const tool = path.at(-1) ?? capability.capabilityName;
  return describeToolStep({
    id: capability.capabilityName,
    kind: "tool",
    label: capability.capabilityName,
    namespace,
    tool,
    scriptPath: capability.scriptPath,
    assignsTo: null,
    parallelGroup: null,
  });
}

export function WorkflowEditTab({
  detail,
  fields,
  parsedInputSchema,
  hasInputForm,
  inputFormValue,
  tested,
  fingerprint,
  pending,
  onUpdate,
  onTest,
  onSave,
  visualConfiguration = false,
}: WorkflowEditTabProps) {
  const [inputValid, setInputValid] = useState(true);
  const [inputSchemaValid, setInputSchemaValid] = useState(true);
  const [outputSchemaValid, setOutputSchemaValid] = useState(true);
  const invalidOptions = visualConfiguration && (!inputValid || !inputSchemaValid || !outputSchemaValid);
  return (
    <div data-tab="edit" role="tabpanel" aria-label="编辑">
      <DenCard size="spacious">
        <DenSectionHeader
          title="编辑工作流"
          description="先测试更改，通过后保存为新版本。"
        />
        <div className="mt-6 flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[12px] font-medium text-gray-600">
              名称
              <DenInput className="mt-1" value={fields.name} onChange={(event) => onUpdate("name", event.currentTarget.value)} />
            </label>
            <label className="text-[12px] font-medium text-gray-600">
              说明
              <DenInput className="mt-1" value={fields.description} onChange={(event) => onUpdate("description", event.currentTarget.value)} />
            </label>
          </div>
          <label className="text-[12px] font-medium text-gray-600">
            源码
            <DenTextarea
              aria-label="工作流源码"
              className="mt-1 min-h-72 font-mono text-[12px]"
              value={fields.code}
              onChange={(event) => onUpdate("code", event.currentTarget.value)}
            />
          </label>
          <div>
            {!visualConfiguration || hasInputForm ? <p className="text-[12px] font-medium text-gray-600">输入示例</p> : null}
            {hasInputForm ? (
              <WorkflowInputForm
                schema={parsedInputSchema}
                value={inputFormValue}
                onChange={(next) => onUpdate("input", JSON.stringify(next, null, 2))}
              />
            ) : null}
            {visualConfiguration ? <StructuredConfigEditor label={hasInputForm ? "高级输入选项" : "输入示例"} text={fields.input || "{}"} onChange={(next) => onUpdate("input", next)} onValidChange={setInputValid} disabled={pending} suggestions={false} allowRootValue /> : <DenTextarea
              aria-label="输入示例 JSON"
              className="mt-2 min-h-36 font-mono text-[11px]"
              value={fields.input}
              onChange={(event) => onUpdate("input", event.currentTarget.value)}
            />}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="text-[12px] font-medium text-gray-600">
              {!visualConfiguration ? "所需输入" : null}
              {visualConfiguration ? <StructuredConfigEditor label="输入格式" text={fields.inputSchema || "null"} onChange={(next) => onUpdate("inputSchema", next)} onValidChange={setInputSchemaValid} disabled={pending} suggestions={false} fieldLabels={structuredSchemaLabels} allowRootValue /> : <DenTextarea
                className="mt-1 min-h-36 font-mono text-[11px]"
                value={fields.inputSchema}
                onChange={(event) => onUpdate("inputSchema", event.currentTarget.value)}
              />}
            </div>
            <div className="text-[12px] font-medium text-gray-600">
              {!visualConfiguration ? "返回内容" : null}
              {visualConfiguration ? <StructuredConfigEditor label="返回格式" text={fields.outputSchema || "null"} onChange={(next) => onUpdate("outputSchema", next)} onValidChange={setOutputSchemaValid} disabled={pending} suggestions={false} fieldLabels={structuredSchemaLabels} allowRootValue /> : <DenTextarea
                className="mt-1 min-h-36 font-mono text-[11px]"
                value={fields.outputSchema}
                onChange={(event) => onUpdate("outputSchema", event.currentTarget.value)}
              />}
            </div>
          </div>
          <div>
            <p className="text-[12px] font-medium text-gray-600">使用的工具</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.currentVersion.requiredCapabilities.length === 0 ? (
                <DenChip tone="neutral" size="sm">无需外部工具</DenChip>
              ) : detail.currentVersion.requiredCapabilities.map((capability) => {
                const description = capabilityDescription(capability);
                return (
                  <DenChip key={`${capability.capabilityName}:${capability.scriptPath}`} tone="neutral" size="sm" title={capability.scriptPath}>
                    {description.title} · {description.service}
                  </DenChip>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-5">
            <DenButton variant="secondary" icon={TestTube2} disabled={pending || invalidOptions} onClick={onTest}>
              测试更改
            </DenButton>
            <DenButton
              icon={Save}
              disabled={pending || invalidOptions || tested?.fingerprint !== fingerprint}
              onClick={onSave}
            >
              保存新版本
            </DenButton>
          </div>
          {tested ? (
            <div className="space-y-4 border-t border-gray-100 pt-5">
              <h3 className="text-[12px] font-medium text-gray-600">测试输出</h3>
              <WorkflowFriendlyValue value={tested.result.value} />
              <details className="border-t border-gray-100 pt-3">
                <summary className="cursor-pointer text-[12px] font-medium text-gray-600">渲染预览</summary>
                <div className="mt-3"><WorkflowMarkdownPreview markdown={tested.result.markdown} /></div>
              </details>
            </div>
          ) : null}
        </div>
      </DenCard>
    </div>
  );
}
