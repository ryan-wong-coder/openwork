"use client";

import { DEFAULT_DEN_LOCALE } from "../../app/_lib/locale";

import Link from "next/link";
import { lazy, Suspense, useEffect, useState } from "react";
import { adminDashboardSchema, type AdminDashboard as Dashboard, type AdminOrganizationUsageTotals } from "@openwork/types/den/admin-organization";
import { DenButton, buttonVariants } from "../../app/(den)/_components/ui/button";
import { DenTable, type DenTableColumn } from "../../app/(den)/_components/ui/table";
import { requestAdmin } from "./admin-request";
import { AdminDeferredContent } from "./admin-deferred-content";

const AdminUsageChart = lazy(() => import("./admin-usage-chart").then((module) => ({ default: module.AdminUsageChart })));

const count = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE).format(value);
const compact = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const usd = (value: number) => new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value / 1_000_000);
const recordedCost = (totals: AdminOrganizationUsageTotals) => totals.costMicroUsd === 0 && totals.unpricedRequests !== 0 ? "未知" : usd(totals.costMicroUsd);

function Coverage({ totals }: { totals: AdminOrganizationUsageTotals }) {
  if (totals.unpricedRequests === 0 && totals.unreportedRequests === 0) return null;
  return <p data-testid="admin-dashboard-coverage" className="mt-3 text-xs text-amber-800">
    {totals.unpricedRequests === null ? "价格统计覆盖率未知" : `${count(totals.unpricedRequests)} 次请求没有价格记录`}
    {" · "}{totals.unreportedRequests === null ? "Token 统计覆盖率未知" : `${count(totals.unreportedRequests)} 次请求未报告 Token`}
  </p>;
}

function Metric({ label, value, detail, href, testId }: { label: string; value: string; detail: string; href?: string; testId: string }) {
  return <div data-testid={testId} className="min-w-0 px-5 py-5 first:pl-0 sm:odd:pl-0 xl:odd:pl-5 xl:first:pl-0">
    <dt className="text-[13px] font-medium text-slate-600">{href ? <Link href={href} prefetch={false} className="hover:text-slate-950 hover:underline">{label}</Link> : label}</dt>
    <dd className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-slate-950">{value}</dd>
    <dd className="mt-2 text-xs text-slate-500">{detail}</dd>
  </div>;
}

function UsageChart({ data }: { data: Dashboard }) {
  const columns: DenTableColumn<Dashboard["daily"][number]>[] = [
    { key: "date", header: "日期（UTC）", render: (day) => day.date },
    { key: "requests", header: "请求数", align: "right", render: (day) => count(day.requests) },
    { key: "tokens", header: "已报告的 Token", align: "right", render: (day) => count(day.tokens) },
    { key: "cost", header: "已记录费用", align: "right", render: recordedCost },
  ];
  return <section aria-label="AI 用量趋势" className="min-w-0 border-b border-slate-200 py-6">
    <AdminDeferredContent label="显示活动图表" placeholderClassName="h-72">
      {() => <Suspense fallback={<div className="h-72" aria-busy="true" aria-label="正在加载用量图表" />}><AdminUsageChart daily={data.daily} /></Suspense>}
    </AdminDeferredContent>
    {data.totals.requests === 0 ? <p className="text-sm text-slate-500">此时段没有已记录的网关请求。</p> : null}
    <Coverage totals={data.totals} />
    <details className="mt-4 text-xs text-slate-600">
      <summary className="w-fit cursor-pointer py-1 font-medium focus-visible:outline-2 focus-visible:outline-slate-500">每日明细</summary>
      <div className="mt-3"><DenTable columns={columns} rows={data.daily} getRowKey={(day) => day.date} density="compact" /></div>
    </details>
  </section>;
}

export function AdminDashboard({ totalOrganizations, totalUsers, refreshKey, onAccessDenied }: {
  totalOrganizations: number; totalUsers: number; refreshKey: string | null; onAccessDenied: (access: "signed-out" | "forbidden") => void;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void requestAdmin("/v1/admin/dashboard", (payload) => {
      const parsed = adminDashboardSchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.access === "ready") setData(result.data);
      else if (result.access === "forbidden" || result.access === "signed-out") onAccessDenied(result.access);
      else setError(result.message);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "无法加载控制台指标，请重试。");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt, onAccessDenied, refreshKey]);
  const organizations: DenTableColumn<Dashboard["organizations"][number]>[] = [
    { key: "organization", header: "组织", render: (org) => <Link href={`/admin/organizations/${encodeURIComponent(org.id)}/insights`} prefetch={false} className="font-medium text-slate-950 hover:underline">{org.name}</Link> },
    { key: "requests", header: "请求数", align: "right", render: (org) => count(org.requests) },
    { key: "tokens", header: "已报告的 Token", align: "right", render: (org) => compact(org.tokens) },
    { key: "cost", header: "已记录费用", align: "right", render: (org) => <span>{recordedCost(org)}{org.unpricedRequests !== 0 ? <span className="ml-1 text-xs text-amber-800" title="部分价格缺失或统计覆盖率未知">（不完整）</span> : null}</span> },
  ];
  return <div data-testid="admin-dashboard">
    <div className="flex flex-wrap items-center justify-between gap-3 pt-5 text-xs text-slate-500">
      <p>{data ? `${data.from} – ${data.to} UTC` : "最近 30 天 · UTC"}</p>
      <p role={loading ? "status" : undefined}>{loading ? "正在更新指标…" : data ? `更新于 ${new Date(data.generatedAt).toLocaleTimeString(DEFAULT_DEN_LOCALE)}` : "指标不可用"}</p>
    </div>
    <dl className="grid grid-cols-2 divide-y divide-slate-200 border-b border-slate-200 sm:divide-y-0 xl:grid-cols-4" aria-label="平台指标" aria-busy={loading}>
      <Metric label="组织" value={count(totalOrganizations)} detail={data ? `${count(data.activeOrganizations)} 个组织在 30 天内使用过 AI` : "所有组织"} href="/admin/organizations" testId="admin-dashboard-organizations" />
      <Metric label="活跃用户" value={data ? count(data.activeUsers.days30) : "—"} detail={data ? `7 天内 ${count(data.activeUsers.days7)} 人 · 今天 ${count(data.activeUsers.today)} 人` : loading ? "正在加载最近 30 天的活动…" : "活动数据不可用"} href="/admin/users" testId="admin-dashboard-active-users" />
      <Metric label="AI 请求数" value={data ? count(data.totals.requests) : "—"} detail={data ? `已报告 ${count(data.totals.tokens)} 个 Token` : loading ? "正在加载最近 30 天的用量…" : "用量数据不可用"} testId="admin-dashboard-requests" />
      <Metric label="已记录费用" value={data ? recordedCost(data.totals) : "—"} detail={data && data.totals.unpricedRequests !== 0 ? "部分费用 · 美元 · 30 天" : "美元 · 30 天"} testId="admin-dashboard-cost" />
    </dl>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-4 text-sm text-red-700"><p>{error}{data ? " 当前显示上次成功加载的数据。" : " 请重试以加载活动和用量。"}</p><DenButton variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>重新加载指标</DenButton></div> : null}
    {data ? <>
      <UsageChart data={data} />
      <section aria-label="最活跃的组织" className="py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-950">最活跃的组织</h2><Link href="/admin/organizations" prefetch={false} className={buttonVariants({ variant: "ghost", size: "sm" })}>查看组织</Link></div>
        <DenTable columns={organizations} rows={data.organizations} getRowKey={(org) => org.id} density="compact" emptyLabel="此时段没有组织记录 AI 用量。" />
      </section>
      <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 py-3 text-xs text-slate-500"><p>{count(totalUsers)} 名用户 · 活动包含登录与遥测</p></div>
    </> : loading ? <p role="status" className="py-10 text-sm text-slate-500">正在加载活动与 AI 用量…</p> : null}
  </div>;
}
