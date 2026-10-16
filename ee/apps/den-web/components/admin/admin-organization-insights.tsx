"use client";

import { DEFAULT_DEN_LOCALE } from "../../app/_lib/locale";

import Link from "next/link";
import { lazy, Suspense } from "react";
import type { AdminOrganizationInsights as Report } from "@openwork/types/den/admin-organization";
import { DenTable, type DenTableColumn } from "../../app/(den)/_components/ui/table";
import { AdminDeferredContent } from "./admin-deferred-content";

const AdminUsageChart = lazy(() => import("./admin-usage-chart").then((module) => ({ default: module.AdminUsageChart })));
const AdminRankingChart = lazy(() => import("./admin-usage-chart").then((module) => ({ default: module.AdminRankingChart })));

const count = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE).format(value);
const percent = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { style: "percent", maximumFractionDigits: 1 }).format(value);
const usd = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value / 1_000_000);
type Totals = Pick<Report["insights"]["current"], "costMicroUsd" | "unpricedRequests">;
function Cost({ data }: { data: Totals }) {
  return <span>{data.costMicroUsd === 0 && data.unpricedRequests !== 0 ? "未知" : usd(data.costMicroUsd)}{data.unpricedRequests !== 0 && data.costMicroUsd > 0 ? <span className="ml-1 text-xs text-amber-800">（不完整）</span> : null}</span>;
}
function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 py-4"><dt className="text-xs font-medium text-slate-600">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{value}</dd><dd className="mt-2 text-xs text-slate-500">{detail}</dd></div>;
}

export function AdminOrganizationInsights({ organization, insights }: Pick<Report, "organization" | "insights">) {
  const current = insights.current;
  const previous = insights.previous;
  const change = previous.requests > 0 ? (current.requests - previous.requests) / previous.requests : null;
  const people: DenTableColumn<Report["insights"]["people"][number]>[] = [
    { key: "person", header: "人员", render: (person) => <div className="min-w-0 max-w-xs break-words">
      {person.userId ? <Link href={`/admin/users?${new URLSearchParams({ search: person.userId })}`} prefetch={false} className="font-medium text-slate-950 hover:underline">{person.name || person.email || "未命名成员"}</Link> : <span>{person.name || person.email || "成员不可用"}</span>}
      {person.email ? <p className="mt-1 text-xs text-slate-500">{person.email}</p> : null}
      {!person.currentMember ? <p className="mt-1 text-xs text-slate-500">前成员或不可用成员</p> : null}
    </div> },
    { key: "requests", header: "请求数", align: "right", render: (person) => count(person.requests) },
    { key: "days", header: "上次活动（UTC）", render: (person) => person.lastActiveDay ?? "未知" },
    { key: "tokens", header: "已报告的 Token", align: "right", render: (person) => count(person.tokens) },
    { key: "cost", header: "已记录费用", align: "right", render: (person) => <Cost data={person} /> },
  ];
  const models: DenTableColumn<Report["insights"]["models"][number]>[] = [
    { key: "model", header: "模型", render: (model) => <div className="max-w-xs break-words font-medium text-slate-950">{model.name}<p className="mt-1 text-xs font-normal text-slate-500">{model.provider}</p></div> },
    { key: "requests", header: "请求数", align: "right", render: (model) => count(model.requests) },
    { key: "share", header: "请求占比", align: "right", render: (model) => current.requests > 0 ? percent(model.requests / current.requests) : "—" },
    { key: "tokens", header: "已报告的 Token", align: "right", render: (model) => count(model.tokens) },
    { key: "cost", header: "已记录费用", align: "right", render: (model) => <Cost data={model} /> },
  ];
  return <div data-testid="admin-organization-insights" className="min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 py-4 text-xs text-slate-500"><p>{insights.from} – {insights.to} UTC</p><p>对比 {insights.previousFrom} – {insights.previousTo}</p></div>
    <dl aria-label="组织使用情况" className="grid grid-cols-2 gap-x-6 border-b border-slate-200 xl:grid-cols-4">
      <Stat label="活跃成员采用率" value={organization.memberCount > 0 ? percent(current.activeMembers / organization.memberCount) : "—"} detail={`${count(organization.memberCount)} 名当前成员中有 ${count(current.activeMembers)} 人使用 AI`} />
      <Stat label="请求趋势" value={change === null ? "—" : `${change > 0 ? "+" : ""}${percent(change)}`} detail={`${count(current.requests)} 次请求 · 上一时段 ${count(previous.requests)} 次`} />
      <Stat label="席位使用率" value={organization.seatLimit > 0 ? percent(organization.memberCount / organization.seatLimit) : "—"} detail={`${count(organization.memberCount)} 名成员 / ${count(organization.seatLimit)} 个席位`} />
      <Stat label="上次记录的使用" value={current.lastActiveDay ?? previous.lastActiveDay ?? "暂无用量"} detail={current.lastActiveDay || previous.lastActiveDay ? "UTC 自然日" : "最近 60 天没有网关请求"} />
    </dl>
    <dl className="grid grid-cols-2 gap-x-6 border-b border-slate-200 xl:grid-cols-4">
      <Stat label="AI 请求数" value={count(current.requests)} detail="最近 30 天" />
      <Stat label="已报告的 Token" value={count(current.tokens)} detail={current.unreportedRequests === null ? "Token 统计覆盖率未知" : `${count(current.unreportedRequests)} 次请求未报告 Token`} />
      <div className="py-4"><dt className="text-xs font-medium text-slate-600">已记录费用</dt><dd className="mt-2 text-2xl font-semibold tabular-nums text-slate-950"><Cost data={current} /></dd><dd className="mt-2 text-xs text-slate-500">{current.unpricedRequests === null ? "价格统计覆盖率未知" : `${count(current.unpricedRequests)} 次请求没有价格记录`}</dd></div>
      <Stat label="成功请求数" value={current.requests > 0 ? percent(current.successfulRequests / current.requests) : "—"} detail={`${count(current.requests)} 次请求中有 ${count(current.successfulRequests)} 次成功`} />
    </dl>
    {current.requests === 0 ? <p className="border-b border-slate-200 py-5 text-sm text-slate-500">当前时段没有已记录的网关请求。</p> : null}
    <section aria-label="组织活动趋势" className="border-b border-slate-200 py-6">
      <AdminDeferredContent label="显示组织活动图表" placeholderClassName="h-72">
        {() => <Suspense fallback={<div className="h-72" aria-busy="true" aria-label="正在加载活动图表" />}><AdminUsageChart daily={insights.daily} showActiveMembers /></Suspense>}
      </AdminDeferredContent>
    </section>
    <section aria-label="最活跃的人员" className="border-b border-slate-200 py-6">
      <h2 className="mb-4 text-sm font-semibold text-slate-950">最活跃的人员</h2>
      {insights.people.length ? <AdminDeferredContent label="显示活跃人员图表" placeholderClassName="h-64">
        {() => <Suspense fallback={<div className="h-64" aria-busy="true" aria-label="正在加载人员图表" />}><AdminRankingChart rows={insights.people.map((person) => ({ name: person.name || person.email || "成员不可用", requests: person.requests }))} label="AI 请求量最多的前八名人员" /></Suspense>}
      </AdminDeferredContent> : null}
      <DenTable columns={people} rows={insights.people} getRowKey={(person) => person.memberId} density="compact" emptyLabel="此时段没有人员记录 AI 用量。" />
    </section>
    <section aria-label="使用最多的模型" className="border-b border-slate-200 py-6">
      <h2 className="mb-4 text-sm font-semibold text-slate-950">使用最多的模型</h2>
      {insights.models.length ? <AdminDeferredContent label="显示模型用量图表" placeholderClassName="h-64">
        {() => <Suspense fallback={<div className="h-64" aria-busy="true" aria-label="正在加载模型图表" />}><AdminRankingChart rows={insights.models.map((model) => ({ name: model.name, requests: model.requests }))} label="AI 请求量最多的前八个模型" /></Suspense>}
      </AdminDeferredContent> : null}
      <DenTable columns={models} rows={insights.models} getRowKey={(model) => model.id} density="compact" emptyLabel="此时段没有模型用量记录。" />
    </section>
    <details className="py-4 text-xs leading-5 text-slate-500"><summary className="w-fit cursor-pointer font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-slate-500">指标定义</summary>
      <p className="mt-3">活动按已记录的网关请求统计，包含自有模型和 OpenWork 模型。采用率统计有用量的当前成员；历史汇总和排行榜包含前成员。每个时段包含 30 个 UTC 自然日，当前时段包含今天。排行榜最多显示八项，汇总包含所有人。成功请求指网关结果正常的请求；其他结果包括提供商错误、拒绝和中断。</p>
      <p className="mt-2">缺失的 Token 与价格保持为未知。模型名称来自已记录的模型标识。此处仅统计可观察的用量和模型偏好，不采集提示词、对话内容或推断用户意图。</p>
    </details>
  </div>;
}
