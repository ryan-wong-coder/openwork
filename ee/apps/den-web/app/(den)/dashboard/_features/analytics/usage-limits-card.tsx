"use client";

import { DEFAULT_DEN_LOCALE } from "../../../../_lib/locale";

import type { InferenceUsageBucket } from "../../../_lib/inference-status";
import { analyticsSurfaceClass } from "./analytics-layout";

type InferenceWindowType = InferenceUsageBucket["windowType"];

const WINDOW_LABEL: Record<InferenceWindowType, string> = {
  five_hour: "五小时用量限额",
  weekly: "每周用量限额",
  monthly: "每月用量限额",
};

const WINDOW_ORDER: InferenceWindowType[] = ["five_hour", "weekly", "monthly"];

function formatResetLabel(bucket: InferenceUsageBucket): string {
  const reset = new Date(bucket.windowEndAt);
  if (Number.isNaN(reset.getTime())) return "—";
  if (bucket.windowType === "five_hour") {
    return `重置于 ${reset.toLocaleTimeString(DEFAULT_DEN_LOCALE, { hour: "numeric", minute: "2-digit" })}`;
  }
  return `重置于 ${reset.toLocaleDateString(DEFAULT_DEN_LOCALE, { month: "short", day: "numeric" })}`;
}

function computeRemainingPercent(bucket: InferenceUsageBucket): number {
  if (bucket.limitAmount <= 0) return 0;
  const ratio = 1 - bucket.usedAmount / bucket.limitAmount;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(100, ratio * 100));
}

export function UsageLimitsCard({ buckets }: { buckets: InferenceUsageBucket[] }) {
  const ordered = WINDOW_ORDER
    .map((windowType) => buckets.find((bucket) => bucket.windowType === windowType))
    .filter((bucket): bucket is InferenceUsageBucket => Boolean(bucket));

  if (ordered.length === 0) return null;

  return <section aria-label="用量限额" className="grid gap-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-[#07192C]">共享用量限额</h2>
      <p className="text-xs text-[#637291]">套餐已包含，由活跃成员共享</p>
    </div>
    <div className="grid gap-3.5 sm:grid-cols-3">
      {ordered.map((bucket) => {
        const remaining = computeRemainingPercent(bucket);
        return <div key={bucket.windowType} className={`${analyticsSurfaceClass} p-5`}>
          <p className="text-xs font-medium text-[#637291]">{WINDOW_LABEL[bucket.windowType]}</p>
          <p className="mt-3 text-[26px] font-semibold tracking-tight text-[#07192C] tabular-nums">{remaining.toFixed(1)}% <span className="text-sm font-normal text-[#637291]">剩余</span></p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#edf0f5]" role="progressbar" aria-label={`剩余 ${WINDOW_LABEL[bucket.windowType]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}>
            <div className={`h-full rounded-full transition-[width] ${remaining <= 10 ? "bg-[var(--ow-warning)]" : "bg-[var(--dls-accent)]"}`} style={{ width: `${remaining}%` }} />
          </div>
          <p className="mt-2.5 text-xs text-[#637291]">{formatResetLabel(bucket)}</p>
        </div>;
      })}
    </div>
  </section>;
}

