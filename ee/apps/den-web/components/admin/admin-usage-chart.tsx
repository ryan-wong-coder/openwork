"use client";

import { DEFAULT_DEN_LOCALE } from "../../app/_lib/locale";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DenSelect } from "../../app/(den)/_components/ui/select";

const compact = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const count = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE).format(value);
const usd = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
const ink = "var(--dls-text-primary)";
const muted = "var(--dls-text-secondary)";
const border = "var(--dls-border)";
const tipStyle = { borderColor: border, borderRadius: 4, fontSize: 12 };
type Point = { date: string; requests: number; tokens: number; costMicroUsd: number; activeMembers?: number };
type Metric = "requests" | "tokens" | "costMicroUsd" | "activeMembers";

export function AdminUsageChart({ daily, showActiveMembers = false }: { daily: Point[]; showActiveMembers?: boolean }) {
  const [metric, setMetric] = useState<Metric>("requests");
  const label = metric === "requests" ? "请求数" : metric === "tokens" ? "已报告的 Token" : metric === "activeMembers" ? "活跃成员" : "已记录费用";
  const data = daily.map((day) => ({ date: day.date, value: metric === "costMicroUsd" ? day.costMicroUsd / 1_000_000 : day[metric] ?? 0 }));
  const format = metric === "costMicroUsd" ? usd : count;
  return <div data-testid="admin-dashboard-chart" className="min-w-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold text-slate-950">活动趋势</h2>
      <DenSelect aria-label="图表指标" value={metric} onChange={(event) => setMetric(event.target.value === "tokens" ? "tokens" : event.target.value === "costMicroUsd" ? "costMicroUsd" : event.target.value === "activeMembers" ? "activeMembers" : "requests")} className="w-auto text-xs">
        <option value="requests">请求数</option><option value="tokens">已报告的 Token</option><option value="costMicroUsd">已记录费用</option>{showActiveMembers ? <option value="activeMembers">活跃成员</option> : null}
      </DenSelect>
    </div>
    <div data-testid={`admin-dashboard-chart-${metric}`} aria-label={`${daily.length} 个 UTC 自然日的${label}`} className="h-60 min-w-0 max-w-full overflow-hidden text-xs">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart accessibilityLayer data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={border} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} minTickGap={30} tick={{ fill: muted, fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={metric === "costMicroUsd" ? (value: number) => `$${compact(value)}` : compact} width={52} tick={{ fill: muted, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={metric === "costMicroUsd"} />
          <Tooltip contentStyle={tipStyle} labelFormatter={(value) => `${String(value)} UTC`} formatter={(value) => [typeof value === "number" ? format(value) : "未知", label]} isAnimationActive={false} />
          <Area dataKey="value" name={label} type="linear" stroke={ink} fill={ink} fillOpacity={0.06} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>;
}

export function AdminRankingChart({ rows, label }: { rows: { name: string; requests: number }[]; label: string }) {
  return <div aria-label={label} className="h-64 min-w-0 max-w-full overflow-hidden text-xs">
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={border} horizontal={false} />
        <XAxis type="number" tickFormatter={compact} tick={{ fill: muted, fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={150} tickFormatter={(value: string) => value.length > 22 ? `${value.slice(0, 20)}…` : value} tick={{ fill: muted, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tipStyle} formatter={(value) => [typeof value === "number" ? count(value) : "未知", "请求数"]} isAnimationActive={false} cursor={false} />
        <Bar dataKey="requests" name="Requests" fill={ink} maxBarSize={18} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
