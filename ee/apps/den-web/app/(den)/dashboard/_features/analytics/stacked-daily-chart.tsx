"use client";

import { DEFAULT_DEN_LOCALE } from "../../../../_lib/locale";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../_components/ui/tooltip";
import { formatWeekLabel } from "./trend-chart";
import { assignSeriesColors } from "./series-colors";

type DailyStack = { date: string; total: number | null; values: Record<string, number | null> };
type StackSeries = { id: string; label: string };

function axisLabel(value: number) {
  const format = new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { maximumFractionDigits: 1 });
  if (value >= 1_000_000) return `${format.format(value / 1_000_000)}M`;
  if (value >= 1_000) return `${format.format(value / 1_000)}k`;
  return format.format(value);
}

export function formatUsageCost(microUsd: number) {
  return new Intl.NumberFormat(DEFAULT_DEN_LOCALE, {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(microUsd / 1_000_000);
}

export function StackedDailyChart({ daily, series, colors, emptyLabel, valueLabel = "已报告的 Token", valueFormat = "tokens" }: {
  daily: DailyStack[];
  series: StackSeries[];
  colors?: ReadonlyMap<string, string>;
  emptyLabel: string;
  valueLabel?: string;
  valueFormat?: "tokens" | "usd";
}) {
  const max = daily.reduce((largest, day) => Math.max(largest, day.total ?? 0), 0);
  const assignedColors = assignSeriesColors(series.map((entry) => entry.id), colors);
  const stacks = [...series].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({ ...entry, color: assignedColors.get(entry.id) }));
  const formatValue = (value: number | null) => value === null ? "未知" : valueFormat === "usd" ? formatUsageCost(value) : value.toLocaleString(DEFAULT_DEN_LOCALE);
  const formatAxis = valueFormat === "usd" ? formatUsageCost : axisLabel;

  return (
    <figure aria-label={`每日网关${valueLabel.toLowerCase()}`} className="min-w-0">
      <figcaption className="mb-4 text-xs text-gray-500">{valueLabel} 每天</figcaption>
      {max === 0 ? <p role="status" className="mb-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">{emptyLabel}</p> : null}
      <TooltipProvider>
        <div className="overflow-x-auto pb-2 pt-2" role="region" aria-label={`每日${valueFormat === "usd" ? "费用" : "Token"}图表，水平滚动以查看所有日期`} tabIndex={0}>
          <div className="grid min-w-[560px] grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-3">
            <div aria-hidden="true" className="grid h-52 min-w-[4.5rem] grid-rows-[0_1fr_0] whitespace-nowrap text-right text-[11px] tabular-nums text-gray-500">
              <span className="self-start -translate-y-1/2">{max > 0 ? formatAxis(max) : null}</span>
              <span className="self-center">{max > 0 ? formatAxis(max / 2) : null}</span>
              <span className="self-start -translate-y-1/2">{formatAxis(0)}</span>
            </div>
            <div className="relative h-52">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
                {[0, 1, 2].map((line) => <div key={line} className="border-t border-dashed border-gray-200" />)}
              </div>
              <div className="relative flex h-full items-end gap-1">
                {daily.map((day) => (
                  <Tooltip key={day.date}>
                    <TooltipTrigger
                      type="button"
                      aria-label={`${day.date} UTC: ${formatValue(day.total)} ${valueLabel.toLowerCase()}`}
                      className="flex h-full min-w-0 flex-1 flex-col-reverse items-stretch border-0 bg-transparent p-0 outline-none hover:bg-gray-100/50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset"
                    >
                      {stacks.map((entry) => (
                        <span
                          key={entry.id}
                          aria-hidden="true"
                          className="block w-full shrink-0"
                          style={{ height: `${max > 0 ? ((day.values[entry.id] ?? 0) / max) * 100 : 0}%`, backgroundColor: entry.color }}
                        />
                      ))}
                    </TooltipTrigger>
                    <TooltipContent className="max-h-72 overflow-y-auto">
                      <p className="font-medium">{day.date} UTC</p>
                      <p className="mb-2 text-white/80">{valueFormat === "usd" ? "总计（估算）" : "总计"}: {formatValue(day.total)}{valueFormat === "tokens" ? "个 Token" : ""}</p>
                      {stacks.filter((entry) => day.values[entry.id] === null || (day.values[entry.id] ?? 0) > 0).map((entry) => (
                        <div key={entry.id} className="flex items-start justify-between gap-4 py-0.5">
                          <span className="flex min-w-0 items-start gap-2">
                            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-sm" style={{ backgroundColor: entry.color }} />
                            <span className="min-w-0 break-words">{entry.label}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">{formatValue(day.values[entry.id] ?? null)}</span>
                        </div>
                      ))}
                      {day.total === 0 ? <p>{valueFormat === "usd" ? "没有已记录费用。" : "没有已报告 Token。"}</p> : null}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
            <div aria-hidden="true" className="col-start-2 flex justify-between text-[11px] text-gray-500">
              {daily.filter((_, index) => index === 0 || index === daily.length - 1 || index % 5 === 0).map((day) => <span key={day.date}>{formatWeekLabel(day.date)}</span>)}
            </div>
          </div>
        </div>
      </TooltipProvider>

      {stacks.length > 0 ? (
        <ul aria-label="图表图例" tabIndex={0} className="mt-5 flex max-h-28 flex-wrap gap-x-5 gap-y-2 overflow-y-auto text-xs text-gray-600">
          {stacks.map((entry) => <li key={entry.id} className="flex min-w-0 max-w-full items-start gap-2">
            <span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="min-w-0 break-words">{entry.label}</span>
          </li>)}
        </ul>
      ) : null}

    </figure>
  );
}
