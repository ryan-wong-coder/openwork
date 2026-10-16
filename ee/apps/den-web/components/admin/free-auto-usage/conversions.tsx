"use client";

import { DEFAULT_DEN_LOCALE } from "../../../app/_lib/locale";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { adminFreeAutoConversionsSchema, freeAutoConversionStageSchema, type AdminFreeAutoConversions } from "@openwork/types/den/admin-free-auto";
import { DenButton } from "../../../app/(den)/_components/ui/button";
import { DenInput } from "../../../app/(den)/_components/ui/input";
import { DenSelect } from "../../../app/(den)/_components/ui/select";
import { DenNotice } from "../../../app/(den)/_components/ui/notice";
import { DenTable, type DenTableColumn } from "../../../app/(den)/_components/ui/table";
import { useAdminListLocation } from "../admin-list-location";
import { requestAdmin } from "../admin-request";
import { AdminDeferredContent } from "../admin-deferred-content";
import { formatCount, formatShare } from "./format";

const Chart = dynamic(() => import("./conversion-chart"), { loading: () => <div className="h-64 bg-slate-50" aria-label="正在加载转化图表" /> });
const STAGES = [
  { value: "all", label: "所有结果" }, { value: "signed-in", label: "之后已登录" },
  { value: "new-account", label: "已创建账户" }, { value: "subscribed", label: "付费订阅" }, { value: "unlinked", label: "未关联访客" },
];
type Row = AdminFreeAutoConversions["rows"][number];
function date(value: string | null) {
  return value ? new Date(value).toLocaleString(DEFAULT_DEN_LOCALE, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "—";
}
function elapsed(after: string | null, before: string) {
  if (!after) return null;
  const minutes = Math.max(0, Math.floor((Date.parse(after) - Date.parse(before)) / 60_000));
  return minutes < 60 ? `达到限制后 ${minutes} 分钟` : minutes < 1440 ? `达到限制后 ${Math.floor(minutes / 60)} 小时` : `达到限制后 ${Math.floor(minutes / 1440)} 天`;
}
function milestone(value: string | null, before: string) {
  return <span className="whitespace-nowrap" title={value ?? "没有已记录的事件"}>{date(value)}{value ? <span className="block text-xs text-slate-500">{elapsed(value, before)}</span> : null}</span>;
}
const columns: DenTableColumn<Row>[] = [
  { key: "person", header: "人员 / 使用路径", render: (row) => <div className="min-w-44">
    {row.userId ? <Link prefetch={false} className="font-medium text-slate-900 underline-offset-4 hover:underline" href={`/admin/users?search=${encodeURIComponent(row.email ?? row.userId)}`}>{row.name ?? row.email ?? "账号"}</Link> : <span className="text-slate-500">未关联访客的使用路径</span>}
    <p className="text-xs text-slate-500">{row.email ?? "未识别到账户"}</p>
    <p className="mt-1 text-xs text-slate-500">{row.startedAsGuest ? "访客使用路径" : "已登录成员"}</p>
  </div> },
  { key: "limit", header: "已触及限额", render: (row) => <span className="whitespace-nowrap" title={row.exhaustedAt}>{date(row.exhaustedAt)}</span> },
  { key: "signin", header: "之后已登录", render: (row) => milestone(row.signedInAt, row.exhaustedAt) },
  { key: "signup", header: "新账户", render: (row) => milestone(row.signedUpAt, row.exhaustedAt) },
  { key: "subscription", header: "付费订阅", render: (row) => milestone(row.subscribedAt, row.exhaustedAt) },
];

export function FreeAutoConversions({ days, refreshKey }: { days: number; refreshKey: number }) {
  const params = useSearchParams();
  const parsed = freeAutoConversionStageSchema.safeParse(params.get("conversionStage") ?? "all");
  const stage = parsed.success ? parsed.data : "all";
  const { search, draftSearch, page, setSearch, setPage } = useAdminListLocation();
  const [report, setReport] = useState<AdminFreeAutoConversions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ days: String(days), page: String(page), search, stage });
      requestAdmin(`/v1/admin/free-auto/conversions?${query}`, (value) => {
        const result = adminFreeAutoConversionsSchema.safeParse(value);
        return result.success ? result.data : null;
      }, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        if (result.access === "ready") { setReport(result.data); setError(null); }
        else { setError(result.message); if (result.access !== "error") setReport(null); }
        setLoading(false);
      }).catch(() => { if (!controller.signal.aborted) { setError("无法加载免费 Auto 转化数据，请重试。"); setLoading(false); } });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [days, page, refreshKey, search, stage]);
  const changeStage = (value: string) => {
    const query = new URLSearchParams(window.location.search);
    if (value === "all") query.delete("conversionStage"); else query.set("conversionStage", value);
    query.delete("page");
    window.history.pushState(null, "", `/admin/free-auto${query.size ? `?${query}` : ""}`);
  };
  const metrics = report ? [
    { label: "已达限额", value: report.totals.reachedLimit, filter: "all" }, { label: "之后已登录", value: report.totals.signedIn, filter: "signed-in" },
    { label: "新账户数", value: report.totals.newAccounts, filter: "new-account" }, { label: "付费订阅数", value: report.totals.subscribed, filter: "subscribed" },
  ] : [];
  return <section className="flex min-w-0 flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="free-auto-conversions-title" aria-busy={loading}>
    <div><h2 id="free-auto-conversions-title" className="text-base font-medium text-slate-900">达到免费限额后</h2>
</div>
    {error ? <DenNotice message={error} /> : null}
    {!report && loading ? <p className="text-sm text-slate-500" role="status">正在加载转化活动…</p> : null}
    {report ? <>
      <div className="grid grid-cols-2 border-y border-slate-200 md:grid-cols-4">{metrics.map((metric) => <button key={metric.filter} type="button" onClick={() => changeStage(metric.filter)}
        className="min-w-0 px-3 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500" aria-label={`显示${metric.label}`} aria-pressed={stage === metric.filter}>
        <span className="block text-xs text-slate-500">{metric.label}</span><span className="mt-2 block text-2xl font-medium tabular-nums text-slate-900">{formatCount(metric.value)}</span>
        <span className="mt-1 block text-xs text-slate-500">{metric.filter === "all" ? "账户与匿名使用路径" : `占触及限额群体的 ${formatShare(metric.value, report.totals.reachedLimit)}`}</span>
      </button>)}</div>
      {report.totals.reachedLimit ? <div><AdminDeferredContent label="显示转化活动图表" placeholderClassName="h-64">{() => <Chart daily={report.daily} />}</AdminDeferredContent><p className="mt-2 text-xs text-slate-500">按此范围内首次触及限额的 UTC 日期分组。近期用户仍可能继续转化。</p></div>
        : <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">此范围内尚未记录触及限额的活动，启用跟踪后新活动将显示在这里。</p>}
      <div className="flex flex-wrap gap-3"><div className="min-w-48 flex-1"><DenInput icon={Search} aria-label="搜索转化人员" placeholder="按姓名、邮箱或用户 ID 搜索人员" value={draftSearch} onChange={(event) => setSearch(event.target.value.slice(0, 160))} /></div>
        <DenSelect aria-label="转化结果" value={stage} onChange={(event) => changeStage(event.target.value)}>{STAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</DenSelect></div>
      <DenTable columns={columns} rows={report.rows} getRowKey={(row) => row.id} density="compact" emptyLabel="没有符合筛选条件的使用路径。" />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span>{formatCount(report.page.total)} 个匹配账户 / 使用路径 · 页 {page} · 日期均为 UTC</span>
        <div className="flex gap-2"><DenButton variant="secondary" size="sm" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>上一个</DenButton><DenButton variant="secondary" size="sm" disabled={loading || !report.page.hasMore} onClick={() => setPage(page + 1)}>下一步</DenButton></div></div>
      <details className="text-xs leading-5 text-slate-500"><summary className="cursor-pointer text-slate-600">归因规则</summary>
        <p className="mt-2">已知账户在所选范围内仅统计一次；未关联访客按随机使用路径统计，不代表独立人数。访客登录指同一客户端标识已通过身份验证；成员登录指触及限额后创建了新会话；新账户必须在访客触及限额后创建。</p>
        <p className="mt-2">付费转化要求触及限额后新建的订阅发生实际支付，并归因于结账创建者。既有订阅、续费、试用、失败支付和队友不计入。登录与购买分别统计，归因窗口均为 30 天。</p>
        <p className="mt-2">仅提供新版客户端和服务记录的活动。不按 IP 匹配访客，也不回填历史访客身份。共享应用配置可能使用同一条路径。为限制滥用，每个网络在每个 UTC 自然日最多记录 100 条新访客路径。 {formatCount(report.totals.unlinkedGuests)} 条访客使用路径在此范围内仍未关联账户。 {report.firstRecordedAt ? `最早保留的观测记录：${date(report.firstRecordedAt)} UTC。` : "尚未记录观察数据。"}</p>
      </details>
    </> : null}
  </section>;
}
