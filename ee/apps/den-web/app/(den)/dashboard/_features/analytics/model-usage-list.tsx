"use client";

import type { TelemetryAnalyticsModels } from "@openwork-ee/telemetry-contracts";
import { analyticsSurfaceClass, AnalyticsEmptyState } from "./analytics-layout";

export function ModelUsageList({ models, isLoading }: {
  models: TelemetryAnalyticsModels["usage30d"];
  isLoading: boolean;
}) {
  const max = Math.max(1, ...models.map((model) => model.sessions));

  return (
    <div className={`${analyticsSurfaceClass} p-5`}>
      <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-[#07192C]">按模型查看会话</h3>
      <p className="mt-0.5 text-[12px] text-[#637291]">最近 30 天的独立会话</p>
      <div className="mt-4 space-y-3">
        {isLoading ? <p className="text-[12px] text-[#637291]">正在加载模型用量…</p> : null}
        {!isLoading && models.length === 0 ? <AnalyticsEmptyState title="暂无模型用量">团队使用 OpenWork 时，模型会话将显示在此处。</AnalyticsEmptyState> : null}
        {models.map((model) => (
          <div key={model.id}>
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className="min-w-0 truncate font-medium text-[#30405F]" title={model.label}>{model.label}</span>
              <span className="shrink-0 tabular-nums text-[#637291]">{model.sessions}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EBEEF4]">
              <div className="h-full rounded-full bg-[var(--dls-accent)]" style={{ width: `${(model.sessions / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
