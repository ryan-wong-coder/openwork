"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { Popover } from "@base-ui/react/popover";
import type { GatewayUsageGroupBy } from "@openwork/types/den/gateway-usage";
import { Filter, Search } from "lucide-react";
import { useId, useState } from "react";
import { DenBadge } from "../../_components/ui/badge";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenSelect } from "../../_components/ui/select";
import { formatUsageCost, StackedDailyChart } from "../_features/analytics/stacked-daily-chart";
import { useSeriesColors } from "../_features/analytics/use-series-colors";
import { useGatewayUsage } from "./gateway-usage-data";
import { GatewayUsageCoverageNotice } from "./gateway-usage-coverage-notice";

export function GatewayUsageSection({ orgId }: { orgId: string }) {
  const id = useId();
  const [groupBy, setGroupBy] = useState<GatewayUsageGroupBy>("model");
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const [filterIds, setFilterIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const query = useGatewayUsage(orgId, groupBy, filterIds);
  const loading = query.isPending || query.isFetching || query.isPlaceholderData;
  const usage = !loading && !query.isError ? query.data : undefined;
  const noTeams = groupBy === "team" && usage?.emptyReason === "no_teams";
  const filterKind = groupBy === "model" ? "提供商" : groupBy === "team" ? "团队" : "成员";
  const selectedLabel = filterIds.length === 1 ? (groupBy === "model" ? "提供商" : groupBy === "team" ? "团队" : "成员") : filterKind;
  const options = query.data?.filterOptions;
  const matches = options?.filter((option) => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const isCost = metric === "cost";
  const missing = usage ? (isCost ? usage.unpricedRequests : usage.unreportedRequests) : undefined;
  const hasMissing = missing === null || (typeof missing === "number" && missing > 0);
  const unknownCost = isCost && usage?.totalCostMicroUsd === 0 && hasMissing;
  const valueLabel = isCost
    ? (groupBy === "team" ? "团队费用 · 美元" : "费用 · 美元")
    : (groupBy === "team" ? "团队归属 Token" : "已报告的 Token");
  const chartSeries = usage
    ? usage.series.filter((series) => usage.daily.some((day) => isCost
      ? typeof day.costValues[series.id] === "number"
      : (day.values[series.id] ?? 0) > 0))
    : [];
  // Keep assignments in this mounted section while the chart reloads for filters.
  const colors = useSeriesColors(usage?.series.map((series) => series.id) ?? [], `${orgId}:${groupBy}`);
  const chartDays = usage?.daily.map((day) => ({
    date: day.date,
    total: isCost
      ? (day.totalCostMicroUsd === 0 && Object.values(day.costValues).some((value) => value === null) ? null : day.totalCostMicroUsd)
      : day.totalTokens,
    values: isCost ? day.costValues : Object.fromEntries(Object.entries(day.values).filter(([, value]) => value > 0)),
  }));

  return (
    <section aria-labelledby={`${id}-heading`} className="mb-10 min-w-0" data-testid="gateway-usage">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight text-gray-950">用量</h2>
        <p className="text-xs text-gray-500">最近 31 天 · UTC</p>
      </div>
      <DenCard className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">{valueLabel}</p>
            {usage ? <p className="mt-1 break-words text-3xl font-semibold tracking-tight text-gray-950 tabular-nums">{noTeams ? "—" : isCost ? (unknownCost ? "未知" : formatUsageCost(usage.totalCostMicroUsd)) : usage.totalTokens.toLocaleString(DEFAULT_DEN_LOCALE)}</p>
              : <p role="status" className="mt-2 text-sm text-gray-500">{loading ? "正在加载用量…" : "用量数据不可用"}</p>}
            <p className="mt-2 text-xs text-gray-500">所有网关提供商，包括 OpenWork 模型。</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <span id={`${id}-metric-label`} className="text-xs font-medium text-gray-600">显示</span>
              <div role="group" aria-labelledby={`${id}-metric-label`} className="flex h-10 items-center gap-1 rounded-lg bg-gray-100 p-1">
                <button type="button" aria-pressed={!isCost} onClick={() => setMetric("tokens")} className={`h-full rounded-md px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${!isCost ? "bg-white text-gray-950" : "text-gray-500 hover:text-gray-900"}`}>Token</button>
                <button type="button" aria-pressed={isCost} onClick={() => setMetric("cost")} className={`h-full rounded-md px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${isCost ? "bg-white text-gray-950" : "text-gray-500 hover:text-gray-900"}`}>费用</button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-group`} className="text-xs font-medium text-gray-600">分组方式</label>
              <DenSelect id={`${id}-group`} aria-label="分组方式" className="w-36" value={groupBy} onChange={(event) => {
                const value = event.target.value;
                if (value !== "model" && value !== "team" && value !== "person") return;
                setGroupBy(value);
                setFilterIds([]);
                setSearch("");
                setFilterOpen(false);
              }}>
                <option value="model">模型</option>
                <option value="team">团队</option>
                <option value="person">人员</option>
              </DenSelect>
            </div>
            <Popover.Root open={filterOpen} onOpenChange={(open) => { setFilterOpen(open); if (!open) setSearch(""); }}>
              <Popover.Trigger disabled={noTeams} className={buttonVariants({ variant: "secondary", className: "focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50" })} aria-label={`按${filterKind}筛选${filterIds.length ? `，已选择 ${filterIds.length} 项` : "，已全部包含"}`}>
                <Filter className="size-4" aria-hidden="true" />
                筛选
                {!noTeams && filterIds.length > 0 ? <DenBadge>{filterIds.length}</DenBadge> : null}
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
                  <Popover.Popup className="max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 outline-none">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <Popover.Title className="text-sm font-semibold">筛选条件 {filterKind}</Popover.Title>
                      <DenButton variant="ghost" size="sm" disabled={!filterIds.length} onClick={() => setFilterIds([])}>清除</DenButton>
                    </div>
                    <Popover.Description className="mb-3 text-xs text-gray-500">选择一项或多项 {filterKind}。不选择时包含全部。</Popover.Description>
                    <DenInput type="search" icon={Search} aria-label={`搜索${filterKind}`} placeholder={`搜索${filterKind}…`} value={search} onChange={(event) => setSearch(event.target.value)} />
                    <fieldset className="mt-3 max-h-64 overflow-y-auto">
                      <legend className="sr-only">已包含 {filterKind}</legend>
                      {matches?.map((option) => <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-gray-50">
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-blue-600" checked={filterIds.includes(option.id)} onChange={(event) => {
                          const checked = event.target.checked;
                          setFilterIds((current) => checked ? [...current, option.id] : current.filter((value) => value !== option.id));
                        }} />
                        <span className="min-w-0 break-words">{option.label}</span>
                      </label>)}
                      {!options ? <p role="status" className="px-2 py-4 text-xs text-gray-500">{query.isError ? "筛选选项不可用，请在下方重新加载用量。" : "正在加载筛选选项…"}</p>
                        : matches?.length === 0 ? <p role="status" className="px-2 py-4 text-xs text-gray-500">{options.length ? `没有与搜索内容匹配的${filterKind}。` : `没有可用的${filterKind}。`}</p> : null}
                    </fieldset>
                    <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
                      <Popover.Close className={buttonVariants({ variant: "secondary", size: "sm" })}>完成</Popover.Close>
                    </div>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>

        {!noTeams ? <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <p>{filterIds.length ? `已选择 ${filterIds.length} 项${selectedLabel}` : `全部${filterKind}`}</p>
          {filterIds.length > 0 ? <DenButton variant="ghost" size="sm" onClick={() => setFilterIds([])}>清除筛选</DenButton> : null}
        </div> : null}
        {groupBy === "team" && !noTeams ? <p className="mt-2 max-w-3xl text-xs leading-5 text-gray-500">用量按当前团队成员关系分组。属于多个团队的人员会计入各团队，因此团队总额可能高于模型或人员总额。</p> : null}

        <div className="mt-6" aria-busy={loading}>
          {loading ? <div role="status" className="flex min-h-64 items-center justify-center rounded-xl bg-gray-50 text-sm text-gray-500">正在加载每日用量…</div>
            : query.isError ? <div className="grid min-h-64 content-center justify-items-start gap-4">
              <DenNotice tone="error" message={query.error.message} />
              <DenButton variant="secondary" onClick={() => void query.refetch()}>重新加载用量</DenButton>
            </div>
              : noTeams ? <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
                <p className="text-base font-medium text-gray-900">暂无团队</p>
                <p className="max-w-md text-sm text-gray-500">创建团队以按团队查看用量，或将分组方式切换为模型或人员。</p>
              </div>
                : usage && chartDays ? <StackedDailyChart daily={chartDays} series={chartSeries} colors={colors} valueLabel={valueLabel} valueFormat={isCost ? "usd" : "tokens"} emptyLabel={isCost ? (unknownCost ? "这些请求暂未提供费用估算。" : "所选条件在此时段内没有费用记录。") : filterIds.length ? "没有符合筛选条件的已报告 Token。" : "此时段没有已报告的网关 Token。"} /> : null}
        </div>
        {usage && !noTeams && !isCost ? <GatewayUsageCoverageNotice usage={usage} /> : null}
        {isCost ? <div role="note" className="mt-5 text-xs leading-5 text-gray-500">
          <p>费用按每次请求记录时公开的模型价格估算。 <a href="https://openworklabs.com/docs/ai-gateway/token-costs" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-gray-900">查看费用计算方式</a></p>
        </div> : null}
      </DenCard>
    </section>
  );
}
