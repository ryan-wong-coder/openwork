"use client";

import { DEFAULT_DEN_LOCALE } from "../../../../_lib/locale";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { DenBrandMark } from "../../../_components/ui/brand-mark";
import { DenButton } from "../../../_components/ui/button";
import { DenNotice } from "../../../_components/ui/notice";
import { DenSegmented } from "../../../_components/ui/segmented";
import { DenSkeleton } from "../../../_components/ui/skeleton";
import { getAddConnectorRoute, getNewPluginRoute } from "../../../_lib/den-org";
import { FilterInput, ItemRow, ItemRowsSkeleton } from "../../_components/item-list";
import { brandHintFor, LetterTile } from "../../_components/item-logo";
import { useOrgDashboard } from "../../_providers/org-dashboard-provider";
import { AnalyticsEmptyState, AnalyticsErrorState, AnalyticsPageHeader, analyticsPageClass, analyticsSurfaceClass } from "../analytics/analytics-layout";
import { StatCard } from "../analytics/stat-card";
import {
  countingSinceLabel,
  failureLabel,
  filterLibraryUsage,
  lastUsedLabel,
  libraryUsageCopy,
  libraryUsageKinds,
  libraryUsageWindows,
  parseLibraryUsageFocus,
  parseLibraryUsageKind,
  parseLibraryUsageWindow,
  summarizeLibraryUsage,
  type LibraryUsageFilter,
  type LibraryUsageKind,
  type LibraryUsageRow,
} from "./library-usage-data";
import { ItemUsageDetail, PersonUsageDetail, type UsageHref } from "./library-usage-detail";
import { useLibraryUsage, useLibraryUsageAvailable } from "./use-library-usage";

/** A row opens the item's usage: who uses it and how often; that page links to where it is managed. */
function UsageRow({ kind, row, now, tracksFailures, usageHref }: { kind: LibraryUsageKind; row: LibraryUsageRow; now: number; tracksFailures: boolean; usageHref: UsageHref }) {
  const href = usageHref({ item: row.id, member: null });
  const lastUsed = lastUsedLabel(row.lastUsedAt, now);
  const failed = failureLabel(row);
  // Usage has no provider ID or service URL: resolve only exact known names,
  // never infer a service from a custom MCP connector's name.
  const brand = kind === "connectors" || kind === "plugins" ? brandHintFor(row.name) : null;
  const logo = brand && (brand.simpleIconSlug || brand.serviceUrl)
    ? <DenBrandMark name={row.name} {...brand} className="size-8 rounded-[7px]" imageClassName="size-[18px]" />
    : <LetterTile name={row.name} />;
  return <li data-testid="library-usage-row" data-item={row.name} data-analytics-row>
    <div className={tracksFailures ? "max-w-[732px]" : "max-w-[644px]"}>
      <ItemRow logo={logo} title={row.name} description={row.detail} href={href}
        comparison={<span className={`grid shrink-0 gap-4 text-[13px] tabular-nums ${tracksFailures ? "grid-cols-[56px_56px_72px_104px]" : "grid-cols-[56px_56px_104px]"}`}>
          <span data-item-uses className="text-[var(--dls-text-primary)]">{row.uses.toLocaleString(DEFAULT_DEN_LOCALE)}</span>
          <span>{row.people.toLocaleString(DEFAULT_DEN_LOCALE)}</span>
          {tracksFailures ? <span data-item-failures className={(row.failures ?? 0) > 0 ? "font-medium text-[var(--ow-danger)]" : undefined}>{failed}</span> : null}
          {lastUsed && row.lastUsedAt ? <time dateTime={row.lastUsedAt} title={new Date(row.lastUsedAt).toLocaleString(DEFAULT_DEN_LOCALE)}>{lastUsed}</time> : <span data-item-unused>未使用</span>}
        </span>} />
    </div>
  </li>;
}

/** Skeleton in the destination's layout: the same number of stat cards, then its list. */
function UsageLoading({ cards = 4 }: { cards?: number }) {
  return (
    <>
      <div className={`grid gap-3.5 sm:grid-cols-2 ${cards === 4 ? "lg:grid-cols-4" : cards === 3 ? "lg:grid-cols-3" : ""}`} aria-hidden="true">
        {Array.from({ length: cards }, (_, card) => card).map((card) => <div key={card} className={`${analyticsSurfaceClass} p-5`}><DenSkeleton className="h-3 w-24" /><DenSkeleton className="mt-4 h-7 w-16" /><DenSkeleton className="mt-3 h-2.5 w-32" /></div>)}
      </div>
      <div className={analyticsSurfaceClass}><ItemRowsSkeleton label="正在加载用量" rows={5} /></div>
    </>
  );
}

function KindEmpty({ kind }: { kind: LibraryUsageKind }) {
  const { activeOrg } = useOrgDashboard();
  const copy = libraryUsageCopy[kind];
  const href = kind === "connectors" ? getAddConnectorRoute(activeOrg?.slug) : getNewPluginRoute(activeOrg?.slug);
  return (
    <div className={analyticsSurfaceClass} data-testid="library-usage-empty">
      <AnalyticsEmptyState title={copy.emptyTitle} action={<DenButton href={href}><Plus className="mr-2 h-4 w-4" aria-hidden />{copy.emptyAction}</DenButton>}>
        {copy.emptyBody}
      </AnalyticsEmptyState>
    </div>
  );
}

export function LibraryUsageScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeOrg } = useOrgDashboard();
  const available = useLibraryUsageAvailable();
  const kind = parseLibraryUsageKind(searchParams.get("view"));
  const days = parseLibraryUsageWindow(searchParams.get("days"));
  const focus = parseLibraryUsageFocus(searchParams);
  const [filter, setFilter] = useState<LibraryUsageFilter>("all");
  const [name, setName] = useState("");
  const usage = useLibraryUsage(kind, days);
  const [now] = useState(() => Date.now());
  const copy = libraryUsageCopy[kind];

  function setParam(key: "view" | "days", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    // An item belongs to one kind; switching kinds goes back to its list.
    if (key === "view") params.delete("item");
    router.replace(`?${params.toString()}`, { scroll: false });
    if (key === "view") { setFilter("all"); setName(""); }
  }

  /** Drill-down links keep the kind and range, so Back returns to the same list. */
  const usageHref: UsageHref = (change) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", kind);
    for (const [key, value] of Object.entries(change)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    return `?${params.toString()}`;
  };

  const report = usage.data?.kind === kind ? usage.data : undefined;
  const summary = report ? summarizeLibraryUsage(report.items) : null;
  const tracksFailures = summary?.failures !== null && summary?.failures !== undefined;
  const hasFailures = (summary?.failures ?? 0) > 0;
  const rows = report ? filterLibraryUsage(report.items, filter, name) : [];
  const since = report ? countingSinceLabel(report, now) : null;
  const nothingRecorded = report ? !report.trackingSince && report.items.every((row) => row.uses === 0) : false;
  const focusedItem = report && focus && "itemId" in focus ? report.items.find((row) => row.id === focus.itemId) ?? null : null;

  return (
    <div className={`${analyticsPageClass} min-w-0`} data-testid="library-usage">
      <AnalyticsPageHeader orgSlug={activeOrg?.slug} active="library" title="插件与连接器"
        caption={since ? <span data-testid="library-usage-since">{since}</span> : undefined} />

      {!available ? (
        <div className={analyticsSurfaceClass}>
          <AnalyticsEmptyState title="你无法查看用量">请联系管理员申请用量分析访问权限。</AnalyticsEmptyState>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="library-usage-toolbar">
            {focus && "itemId" in focus ? <span /> : <DenSegmented aria-label="显示内容" value={kind} onChange={(value) => setParam("view", value)} options={libraryUsageKinds.map((option) => ({ value: option, label: libraryUsageCopy[option].label }))} />}
            <DenSegmented aria-label="时间范围" value={String(days)} onChange={(value) => setParam("days", value)} options={libraryUsageWindows.map((window) => ({ value: String(window), label: `${window} 天` }))} />
          </div>

          {usage.isPending || (!report && usage.isFetching) ? <UsageLoading cards={focus && "memberId" in focus ? (kind === "skills" ? 2 : 3) : kind === "skills" ? 3 : 4} /> : usage.isError && !report ? (
            <AnalyticsErrorState title={`无法加载${copy.plural}使用情况`} onRetry={() => void usage.refetch()} retrying={usage.isFetching} />
          ) : !report || !summary ? null : focus && "memberId" in focus ? (
            <PersonUsageDetail kind={kind} days={days} memberId={focus.memberId} report={report} now={now} usageHref={usageHref} />
          ) : focus && "itemId" in focus ? (focusedItem
            ? <ItemUsageDetail kind={kind} days={days} item={focusedItem} now={now} usageHref={usageHref} />
            : <div className={analyticsSurfaceClass} data-testid="library-usage-item-missing">
              <AnalyticsEmptyState title={`此${copy.noun}已不在你的资源库中`} action={<DenButton variant="secondary" href={usageHref({ item: null })}>{`全部${copy.plural}`}</DenButton>} />
            </div>
          ) : summary.total === 0 ? <KindEmpty kind={kind} /> : (
            <>
              {usage.isError ? <DenNotice tone="neutral" presentation="inline" message="刷新失败，当前显示上次的统计结果。" action={<DenButton variant="secondary" size="sm" onClick={() => void usage.refetch()}>重试</DenButton>} /> : null}

              {nothingRecorded ? (
                <div className={analyticsSurfaceClass} data-testid="library-usage-no-usage">
                  <AnalyticsEmptyState title="暂无用量" />
                </div>
              ) : (
                <div className={`grid gap-3.5 sm:grid-cols-2 ${tracksFailures ? "lg:grid-cols-4" : "lg:grid-cols-3"}`} data-testid="library-usage-summary">
                  <StatCard title="使用中" value={`${summary.used} / ${summary.total}`} />
                  <StatCard title="使用次数" value={summary.uses.toLocaleString(DEFAULT_DEN_LOCALE)} />
                  {tracksFailures ? <div role="group" aria-label="失败次数" data-testid="library-usage-failed" data-state={hasFailures ? "attention" : "neutral"}>
                    <StatCard attention={hasFailures} title="失败" value={(summary.failures ?? 0).toLocaleString(DEFAULT_DEN_LOCALE)} sub={summary.uses > 0 ? `占使用次数的 ${Math.round(((summary.failures ?? 0) / summary.uses) * 100)}%` : "尚未运行任何内容"} />
                  </div> : null}
                  <StatCard title="未使用" value={`${summary.unused}`} />
                </div>
              )}

              {nothingRecorded ? null : <div className="flex flex-wrap items-center gap-2" data-testid="library-usage-filters">
                <FilterInput value={name} onChange={setName} className="w-[240px] max-w-full" />
                <DenSegmented aria-label={`使用的${copy.plural}`} value={filter} onChange={setFilter}
                  options={[{ value: "all", label: "全部" }, { value: "unused", label: "未使用" }, ...(tracksFailures ? [{ value: "failing" as const, label: "运行失败" }] : [])]} />
              </div>}

              <div className={`${analyticsSurfaceClass} min-w-0 overflow-x-auto`} data-testid="library-usage-table">
                <div className={tracksFailures ? "min-w-[660px]" : "min-w-[580px]"}>
                  <div className={`grid items-center gap-4 px-5 py-2.5 text-xs text-[var(--dls-text-secondary)] ${tracksFailures ? "max-w-[732px] grid-cols-[minmax(0,1fr)_56px_56px_72px_104px]" : "max-w-[644px] grid-cols-[minmax(0,1fr)_56px_56px_104px]"}`} data-testid="library-usage-columns">
                    <span>{copy.label.replace(/s$/, "")}</span><span>使用次数</span><span>人员</span>{tracksFailures ? <span>失败</span> : null}<span>上次使用</span>
                  </div>
                  {rows.length === 0
                    ? <p className="border-t border-[#e3e7ee] px-5 py-6 text-[13px] text-[#637291]">{filter === "unused" && !name.trim() ? `本周期内每项${copy.noun}都已使用。` : filter === "failing" && !name.trim() ? "此时段没有失败记录。" : `没有匹配的${copy.plural}，请尝试其他名称。`}</p>
                    : <ul className="divide-y divide-[#e3e7ee] border-t border-[#e3e7ee]">{rows.map((row) => <UsageRow key={row.id} kind={kind} row={row} now={now} tracksFailures={tracksFailures} usageHref={usageHref} />)}</ul>}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
