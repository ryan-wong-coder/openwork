"use client";

import { useSearchParams } from "next/navigation";
import { AdminAccessScreen } from "../admin-access-screen";
import { AdminDeferredContent } from "../admin-deferred-content";
import { Download, RefreshCw, Search } from "lucide-react";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { DenBadge } from "../../../app/(den)/_components/ui/badge";
import { DenButton } from "../../../app/(den)/_components/ui/button";
import { DenCard } from "../../../app/(den)/_components/ui/card";
import { DenInput } from "../../../app/(den)/_components/ui/input";
import { DenNotice } from "../../../app/(den)/_components/ui/notice";
import { DenPageHeader } from "../../../app/(den)/_components/ui/page-header";
import { DenSegmented } from "../../../app/(den)/_components/ui/segmented";
import { DenSelect } from "../../../app/(den)/_components/ui/select";
import { DenTable, type DenTableColumn } from "../../../app/(den)/_components/ui/table";
import {
  FREE_AUTO_RANGES,
  organizationsCsv,
  selectOrganizations,
  useFreeAutoUsage,
  type FreeAutoOrganizationUsage,
  type FreeAutoRange,
  type FreeAutoUsageReport,
  type OrganizationSort,
} from "./free-auto-usage-data";
import { formatCount, formatRelative, formatShare, formatTokens, formatUsd } from "./format";

const FreeAutoConversions = lazy(() => import("./conversions").then((module) => ({ default: module.FreeAutoConversions })));
const FreeAutoSpendChart = lazy(() => import("./spend-chart"));
const SORTS: Array<{ value: OrganizationSort; label: string }> = [
  { value: "spend", label: "费用" },
  { value: "requests", label: "请求数" },
  { value: "people", label: "活跃人员" },
  { value: "limit", label: "已达每周限额" },
  { value: "recent", label: "上次使用" },
];

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <DenCard className="flex min-w-0 flex-col gap-1 !rounded-lg !p-5">
      <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-gray-500">{label}</p>
      <p className="text-[26px] font-medium leading-8 tracking-[-0.5px] text-gray-900 tabular-nums">{value}</p>
      {detail ? <p className="text-[13px] leading-5 text-gray-500">{detail}</p> : null}
    </DenCard>
  );
}

function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <DenCard className="flex min-w-0 flex-col gap-5 !rounded-lg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-medium text-gray-900">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-[13px] leading-5 text-gray-500">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </DenCard>
  );
}

function downloadCsv(report: FreeAutoUsageReport) {
  const blob = new Blob([organizationsCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `free-auto-usage-${report.range.days}d-${report.generatedAt.slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function organizationColumns(now: number): DenTableColumn<FreeAutoOrganizationUsage>[] {
  return [
    {
      key: "organization", header: "组织", render: (row) => (
        <div className="min-w-[12rem]">
          <p className="font-medium text-gray-900">{row.name}</p>
          {row.subscribed ? <div className="mt-1 flex flex-wrap items-center gap-1.5"><DenBadge tone="info">已订阅模型</DenBadge></div> : null}
        </div>
      ),
    },
    { key: "people", header: "活跃人数 / 成员数", align: "right", render: (row) => <span className="tabular-nums">{formatCount(row.activePeople)} / {formatCount(row.memberCount)}</span> },
    {
      key: "requests", header: "请求数", align: "right", render: (row) => (
        <span className="tabular-nums">
          {formatCount(row.requests)}
          {row.estimatedRequests ? <span className="block text-[12px] text-gray-400">估算 {formatCount(row.estimatedRequests)}</span> : null}
        </span>
      ),
    },
    {
      key: "tokens", header: "输入 / 输出 Token", align: "right", render: (row) => (
        <span className="tabular-nums">
          {formatTokens(row.inputTokens)} / {formatTokens(row.outputTokens)}
          {row.cachedInputTokens ? <span className="block text-[12px] text-gray-400">{formatShare(row.cachedInputTokens, row.inputTokens)} 输入已缓存</span> : null}
        </span>
      ),
    },
    {
      key: "spend", header: "费用", align: "right", render: (row) => (
        <span className="tabular-nums font-medium text-gray-900">
          {formatUsd(row.costMicroUsd)}
          {row.activePeople ? <span className="block text-[12px] font-normal text-gray-400">{formatUsd(Math.round(row.costMicroUsd / row.activePeople))} 每人</span> : null}
        </span>
      ),
    },
    {
      key: "limit", header: "已达每周限额", align: "right", render: (row) => row.peopleAtWeeklyLimit
        ? <DenBadge tone="warning">{formatCount(row.peopleAtWeeklyLimit)} {"人"}</DenBadge>
        : <span className="text-gray-400">—</span>,
    },
    {
      key: "last", header: "上次使用", align: "right", render: (row) => (
        <span className="whitespace-nowrap text-gray-500" title={row.lastUsedAt ?? undefined}>{formatRelative(row.lastUsedAt, now)}</span>
      ),
    },
  ];
}

function Report({ report, refreshKey }: { report: FreeAutoUsageReport; refreshKey: number }) {
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<OrganizationSort>("spend");
  const rows = useMemo(() => selectOrganizations(report.organizations, { search, sort }), [report.organizations, search, sort]);
  const now = Date.parse(report.generatedAt);
  const { totals, members, guests, week, settings } = report;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2" aria-label="免费 Auto 设置">
        <DenBadge tone={settings.membersEnabled ? "success" : "neutral"}>成员 {settings.membersEnabled ? "已开启" : "已关闭"}</DenBadge>
        <DenBadge>{formatUsd(settings.weeklyLimitMicroUsd)} 每人每周</DenBadge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="免费用量费用" value={formatUsd(totals.costMicroUsd)} detail={`成员 ${formatUsd(members.costMicroUsd)} · 访客 ${formatUsd(guests.costMicroUsd)}`} />
        <Stat label="请求数" value={formatCount(totals.requests)} detail={`${formatShare(totals.estimatedRequests, totals.requests)} 按估算值计费`} />
        <Stat label="活跃人员" value={formatCount(members.activePeople)} detail={`已登录，来自 ${formatCount(totals.activeOrganizations)} 个组织`} />
        <Stat label="已达每周限额" value={formatCount(week.peopleAtWeeklyLimit)} detail={`本周共有 ${formatCount(week.activePeople)} 名活跃人员`} />
      </div>

      <AdminDeferredContent label="显示达到免费限额后的活动" placeholderClassName="h-96" eager={params.has("conversionStage") || params.has("search") || params.has("page")}>
        {() => <Suspense fallback={<div className="h-96 bg-slate-50" aria-busy="true" aria-label="正在加载转化活动" />}><FreeAutoConversions days={report.range.days} refreshKey={refreshKey} /></Suspense>}
      </AdminDeferredContent>

      <Section title="每日费用" description="免费 Auto 在每个 UTC 自然日的费用，分别统计已登录成员与未登录桌面端。">
        <AdminDeferredContent label="显示每日免费 Auto 费用" placeholderClassName="h-64">
          {() => <Suspense fallback={<div className="h-64 bg-slate-50" aria-busy="true" aria-label="正在加载每日费用图表" />}><FreeAutoSpendChart daily={report.daily} /></Suspense>}
        </AdminDeferredContent>
      </Section>

      <AdminDeferredContent label="显示组织用量" placeholderClassName="h-96">
      {() => <Section
        title="组织"
        description="按组织查看已登录成员的用量。每周额度按人分配，达到限额的人员会计入其本周使用过的每个组织。"
        action={<DenButton variant="secondary" size="sm" icon={Download} onClick={() => downloadCsv(report)}>导出 CSV</DenButton>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[14rem] flex-1">
            <DenInput icon={Search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索组织" aria-label="搜索组织" />
          </div>
          <DenSelect aria-label="排序组织" value={sort} onChange={(event) => setSort(event.target.value as OrganizationSort)}>
            {SORTS.map((option) => <option key={option.value} value={option.value}>排序： {option.label}</option>)}
          </DenSelect>
        </div>
        <DenTable columns={organizationColumns(now)} rows={rows} getRowKey={(row) => row.id} density="compact"
          emptyLabel={search ? "没有符合搜索条件的组织。" : "此范围内没有组织使用免费 Auto。"} />
        {report.otherOrganizations ? (
          <p className="text-[13px] text-gray-500">
            另有 {formatCount(report.otherOrganizations.organizations)} 个组织，共有 {formatCount(report.otherOrganizations.requests)} 次请求，以及 {formatUsd(report.otherOrganizations.costMicroUsd)} 费用。
          </p>
        ) : null}
      </Section>}
      </AdminDeferredContent>

      <Section title="未登录的桌面端" description="访客没有账户或组织，因此仅显示汇总数据。">
        <dl className="grid gap-4 sm:grid-cols-5">
          {[
            ["费用", formatUsd(guests.costMicroUsd)],
            ["请求数", formatCount(guests.requests)],
            ["按估算值计费", formatShare(guests.estimatedRequests, guests.requests)],
            ["输入 / 输出 Token", `${formatTokens(guests.inputTokens)} / ${formatTokens(guests.outputTokens)}`],
            ["已缓存输入", formatShare(guests.cachedInputTokens, guests.inputTokens)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[12px] text-gray-500">{label}</dt>
              <dd className="mt-1 text-[18px] font-medium tabular-nums text-gray-900">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <p className="text-[12px] leading-5 text-gray-400">
        费用为免费 Auto 从各额度扣除的金额：按 OpenAI 报告的 Token 与公开价格计算；未报告用量时使用固定估算值。日期均为 UTC。更新于 {formatRelative(report.generatedAt)}.
      </p>
    </div>
  );
}

export function FreeAutoUsagePage() {
  const params = useSearchParams();
  const rawDays = params.get("days");
  const days: FreeAutoRange = rawDays === "7" ? 7 : rawDays === "90" ? 90 : 30;
  const [refreshKey, setRefreshKey] = useState(0);
  const setDays = (value: string) => {
    const query = new URLSearchParams(window.location.search);
    query.set("days", value); query.delete("page");
    window.history.pushState(null, "", `/admin/free-auto?${query}`);
  };
  const { state, refresh } = useFreeAutoUsage(days);
  const report = state.report;
  if (state.status === "signed-out" || state.status === "forbidden") return <AdminAccessScreen state={state.status} message={state.message} onRetry={refresh} />;
  if (!report && state.status === "loading") return <AdminAccessScreen state="checking" />;
  if (!report && state.status === "error") return <AdminAccessScreen state="error" message={state.message} onRetry={refresh} />;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <DenPageHeader title="免费 Auto 用量" description="查看所有组织和未登录桌面端的免费 Auto 费用与使用情况。" />
        <div className="flex flex-wrap items-center gap-2">
          <DenSegmented aria-label="日期范围" value={String(days)} onChange={setDays}
            options={FREE_AUTO_RANGES.map((range) => ({ value: String(range), label: `${range} 天` }))} />
          <DenButton variant="secondary" size="sm" icon={RefreshCw} loading={state.status === "loading" && report !== null} onClick={() => { refresh(); setRefreshKey((value) => value + 1); }}>刷新</DenButton>
        </div>
      </div>
      {state.status === "error" ? (
        <DenNotice message={<span>{state.message} <button type="button" className="underline underline-offset-2" onClick={refresh}>重试</button></span>} />
      ) : null}
      {report ? <Report report={report} refreshKey={refreshKey} /> : null}
    </div>
  );
}
