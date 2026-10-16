"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { FEATURE_KEYS, FEATURES, type FeatureKey } from "@openwork/features";
import { denFeatureCopy } from "../../app/_lib/feature-copy";
import { DenButton } from "../../app/(den)/_components/ui/button";
import { DenSwitch } from "../../app/(den)/_components/ui/switch";

export type AdminFeatureState = {
  enabled: boolean;
  source: "unavailable" | "killed" | "lock" | "override" | "everyone";
  everyone: boolean;
  killed: boolean;
  override: boolean | null;
  overrideApplies: boolean;
};
export type AdminOrganizationFeatures = Record<FeatureKey, AdminFeatureState>;

function describeSource(state: AdminFeatureState): string {
  switch (state.source) {
    case "everyone": return state.everyone ? "对所有人启用" : "对所有人关闭";
    case "override": return "为此组织单独设置";
    case "lock": return "由部署配置设置";
    case "killed": return "已全局关闭";
    case "unavailable": return "此部署不包含该功能";
  }
}

/** Keep the registry-sized editor out of every organization row until opened. */
export function AdminOrganizationFeatureControls({ organizationId, features, loadFeatures, saving, error, onChange }: {
  organizationId: string;
  features: AdminOrganizationFeatures | null;
  loadFeatures: (organizationId: string, signal: AbortSignal) => Promise<void>;
  saving: boolean;
  error: string | null;
  onChange: (key: FeatureKey, enabled: boolean | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!expanded || features) return;
    const controller = new AbortController();
    setLoadError(null);
    void loadFeatures(organizationId, controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "无法加载功能，请重试。");
    });
    return () => controller.abort();
  }, [expanded, features, organizationId, loadFeatures, attempt]);

  return (
    <details className="group mt-4 border-t border-slate-200 pt-4" data-testid="admin-organization-features" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary data-testid="admin-organization-features-toggle" className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} strokeWidth={1.5} className="transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        功能
      </summary>
      {expanded && !features ? (
        loadError ? (
          <div className="mt-3 text-sm text-red-700" role="alert">
            <p>{loadError}</p>
            <DenButton variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>重新加载功能</DenButton>
          </div>
        ) : (
          <div className="mt-3 grid gap-2" role="status" aria-label="正在加载组织功能" data-testid="admin-features-loading">
            {[0, 1, 2].map((row) => <div key={row} className="h-10 rounded-lg bg-gray-100" aria-hidden="true" />)}
          </div>
        )
      ) : null}
      {expanded && features ? (
        <div>
          <a href="/admin/features" className="mt-3 inline-block text-xs font-medium text-slate-500 underline-offset-2 hover:underline">所有功能</a>
          <ul className="mt-2 grid gap-2">
            {FEATURE_KEYS.filter((key) => features[key].source !== "unavailable").map((key) => {
              const state = features[key];
              const definition = denFeatureCopy(key, FEATURES[key]);
              return (
                <li key={key} className="flex items-start gap-3">
                  <label className="flex min-w-0 flex-1 items-start gap-2">
                    <DenSwitch testId={`admin-capability-${key}`} aria-label={definition.label} checked={state.enabled} size="sm"
                      disabled={!state.overrideApplies || saving} onChange={(enabled) => onChange(key, enabled)} />
                    <span className="min-w-0">
                      <span className="text-sm text-slate-700">{definition.label}</span>
                      <span className="ml-2 text-xs text-slate-500" data-testid={`admin-capability-source-${key}`}>{describeSource(state)}</span>
                      <span className="block text-xs leading-5 text-slate-500">{definition.description}</span>
                    </span>
                  </label>
                  {state.source === "override" && state.overrideApplies ? (
                    <button type="button" data-testid={`admin-capability-reset-${key}`} disabled={saving} onClick={() => onChange(key, null)}
                      className="shrink-0 text-xs font-medium text-slate-500 underline-offset-2 hover:underline disabled:opacity-50">
                      使用全局设置
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {error ? <p data-testid="admin-capability-error" role="alert" className="mt-2 text-xs text-red-700">保存失败，已撤销此更改。 {error}</p> : null}
    </details>
  );
}
