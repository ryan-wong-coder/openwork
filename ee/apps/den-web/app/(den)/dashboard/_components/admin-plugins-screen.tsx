"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { DenPageHeader } from "../../_components/ui/page-header";
import { DenButton } from "../../_components/ui/button";
import { getNewPluginRoute, getPluginRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { managedAccessStatus } from "./access-summary";
import { useDenToast } from "./den-toast";
import { ItemPage } from "./item-header";
import { FilterInput, ItemMenu, ItemRow, removeEntry, ItemPanel, ItemRowsSkeleton, LinkButton } from "./item-list";
import { PluginLogo } from "./item-logo";
import { draftFromPluginGrants } from "./item-sharing";
import { usePluginAccess } from "./plugin-access-data";
import { type DenPluginSummary, pluginDetailQueryOptions, useArchivePlugin, usePluginDirectory } from "./plugin-data";

function PluginsEmpty({ orgSlug }: { orgSlug: string | null }) {
  return (
    <ItemPanel>
      <div className="flex flex-col items-center gap-3 px-5 py-8 text-center" data-testid="plugins-empty">
        <h2 className="text-sm font-medium text-[var(--dls-text-primary)]">暂无插件</h2>
        <p className="text-[13px] text-[var(--dls-text-secondary)]">创建插件以向团队共享技能。</p>
        <DenButton icon={Plus} href={getNewPluginRoute(orgSlug)}>创建插件</DenButton>
        <p className="text-xs text-[var(--dls-text-secondary)]">分配访问权限前，仅你自己可使用。</p>
      </div>
    </ItemPanel>
  );
}

function PluginRow({ plugin }: { plugin: DenPluginSummary }) {
  const toast = useDenToast();
  const queryClient = useQueryClient();
  const { orgSlug, orgContext } = useOrgDashboard();
  const access = usePluginAccess(plugin.id, { enabled: !plugin.accessIncluded });
  const archive = useArchivePlugin();
  const href = getPluginRoute(orgSlug, plugin.id);
  const owner = orgContext?.members.find((member) => member.id === plugin.createdByOrgMembershipId);
  const ownerName = owner?.user.name || owner?.user.email || "前成员";
  const status = orgContext && access.data
    ? managedAccessStatus(draftFromPluginGrants(access.data), orgContext, plugin.createdByOrgMembershipId)
    : "";
  const sharing = status === "仅你自己" ? (plugin.createdByOrgMembershipId === orgContext?.currentMember.id ? "仅你自己" : `仅 ${ownerName}`) : status;

  async function remove() {
    await archive.mutateAsync(plugin.id);
    toast({ title: `${plugin.name} 已移除`, description: "此项已不再可供任何人使用。" });
  }

  function prefetch() {
    void queryClient.prefetchQuery(pluginDetailQueryOptions(plugin.id));
  }

  return (
    <div data-plugin-row={plugin.name} data-plugin-access={sharing} onPointerEnter={prefetch} onFocus={prefetch}>
      <ItemRow compact href={href} logo={<PluginLogo name={plugin.name} />} title={plugin.name} description={plugin.description || "插件"} status={status ? status === "仅你自己" ? "私有" : "已共享" : "未知"} action={<ItemMenu label={`${plugin.name}的更多操作`} entries={[
        { label: "打开", href },
        ...(status === "仅你自己" ? [{ label: "分享", href }] : []),
        removeEntry(plugin.name, remove),
      ]} />} />
    </div>
  );
}

function DirectoryFilter({ label, title, value, options, counts, onChange }: {
  label: string;
  title: string;
  counts?: Record<string, number>;
  value: string | null;
  options: { id: string; name: string }[];
  onChange: (value: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = options.find((option) => option.id === value);
  const matches = options.filter((option) => option.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Popover.Root onOpenChange={(open) => { if (!open) setSearch(""); }}>
      <Popover.Trigger className={`inline-flex h-8 max-w-[210px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-300`}>
        <span className="truncate">{selected ? `${label}: ${selected.name}` : label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Popover.Popup className="w-[280px] rounded-xl border border-gray-200 bg-white p-2 shadow-lg outline-none">
            <Popover.Title className="px-2 pb-2 pt-1 text-[12px] font-medium text-gray-700">{title}</Popover.Title>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-gray-200 px-2 focus-within:ring-2 focus-within:ring-gray-300">
              <Search className="h-4 w-4 text-gray-400" aria-hidden />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={label === "Owner" ? "查找所有者" : "查找团队"} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
            </label>
            <div className="mt-1 max-h-60 overflow-y-auto">
              <Popover.Close render={<button type="button" onClick={() => onChange(null)} className="flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] hover:bg-gray-50" />}>全部 {label.toLowerCase()}s</Popover.Close>
              {matches.map((option) => (
                <Popover.Close key={option.id} render={<button type="button" aria-label={option.name} onClick={() => onChange(option.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-gray-50" />}>
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>{counts ? <span className="text-[12px] tabular-nums text-gray-400" aria-label={`${counts[option.id] ?? 0} 个插件`}>{counts[option.id] ?? 0}</span> : null}{value === option.id ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                </Popover.Close>
              ))}
              {matches.length === 0 ? <p className="px-3 py-3 text-[13px] text-gray-500">没有匹配项。</p> : null}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function pluginDirectoryRange(scrollTop: number, viewportHeight: number, rowHeight: number, count: number) {
  return {
    start: Math.max(0, Math.floor(scrollTop / rowHeight) - 4),
    end: Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 4),
  };
}

function DirectoryResults({ plugins, filtered }: { plugins: ReturnType<typeof usePluginDirectory>; filtered: boolean }) {
  const { orgSlug } = useOrgDashboard();
  const [scrollTop, setScrollTop] = useState(0);
  const rows = plugins.data?.pages.flatMap((page) => page.items) ?? [];
  const rowHeight = 64;
  const viewportHeight = 544;
  const { start, end } = pluginDirectoryRange(scrollTop, viewportHeight, rowHeight, rows.length);

  if (plugins.isPending) return <ItemPanel><ItemRowsSkeleton label="正在加载插件" rows={6} /></ItemPanel>;
  if (plugins.isError && rows.length === 0) return <div role="alert" className="rounded-xl border border-gray-200 bg-white p-5 text-[13px] text-gray-700">列表加载失败，请重试。 <button type="button" onClick={() => void plugins.refetch()} className="font-medium underline">重试</button></div>;
  if (rows.length === 0) return filtered ? <div className="rounded-xl border border-gray-200 bg-white p-6 text-[13px] text-gray-600">没有匹配的插件，请尝试其他名称、团队或所有者。</div> : <PluginsEmpty orgSlug={orgSlug} />;

  return (
    <ItemPanel className="overflow-hidden"><div className="min-w-0">
      <div data-testid="plugin-directory-scroll" className="overflow-y-auto" style={{ height: Math.min(viewportHeight, rows.length * rowHeight + (plugins.hasNextPage ? 48 : 0)) }} onScroll={(event) => {
        const target = event.currentTarget;
        setScrollTop(target.scrollTop);
        if (target.scrollHeight - target.scrollTop - target.clientHeight < 300 && plugins.hasNextPage && !plugins.isFetchingNextPage) void plugins.fetchNextPage();
      }}>
        <div className="relative" style={{ height: rows.length * rowHeight }}>
          {rows.slice(start, end).map((plugin, index) => (
            <div key={plugin.id} className="absolute inset-x-0 overflow-hidden border-b border-gray-100" style={{ top: (start + index) * rowHeight, height: rowHeight }}>
              <PluginRow plugin={plugin} />
            </div>
          ))}
        </div>
        {plugins.hasNextPage ? <button type="button" onClick={() => void plugins.fetchNextPage()} disabled={plugins.isFetchingNextPage} className="h-12 w-full text-[13px] text-gray-600 hover:bg-gray-50 disabled:opacity-50">{plugins.isFetchingNextPage ? "正在加载更多…" : "加载更多插件"}</button> : null}
      </div>
      </div>
      {plugins.isFetchNextPageError ? <div role="alert" className="border-t border-gray-100 px-5 py-3 text-[13px] text-red-600">更多插件加载失败，请选择“加载更多”重试。</div> : null}
    </ItemPanel>
  );
}

export function pluginDirectoryUrlParams(current: string, filters: { name: string; teamId: string | null; memberId: string | null; ownerId?: string | null }) {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params.toString();
}

export function AdminPluginsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { orgSlug, orgId, orgContext } = useOrgDashboard();
  const q = searchParams.get("name") ?? "";
  const [search, setSearch] = useState(q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamParam = searchParams.get("teamId");
  const memberParam = searchParams.get("memberId");
  const teamId = orgContext?.teams.some((team) => team.id === teamParam) ? teamParam : null;
  const memberId = orgContext?.members.some((member) => member.id === memberParam) ? memberParam : null;
  const ownerParam = searchParams.get("ownerId");
  const ownerId = orgContext?.members.some((member) => member.id === ownerParam) ? ownerParam : null;
  const plugins = usePluginDirectory({ q, teamId, memberId, ownerId });
  const firstPage = plugins.data?.pages[0];
  const legacyMember = orgContext?.members.find((member) => member.id === memberId);
  const empty = firstPage?.total === 0 && !q && !teamId && !memberId && !ownerId;
  const createAction = <LinkButton variant="primary" size="sm" href={getNewPluginRoute(orgSlug)}><Plus className="h-4 w-4" aria-hidden />创建插件</LinkButton>;

  function setFilters(next: { name: string; teamId: string | null; memberId: string | null; ownerId?: string | null }) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    const params = pluginDirectoryUrlParams(searchParams.toString(), next);
    router.replace(params ? `?${params}` : "?", { scroll: false });
  }

  useEffect(() => {
    if (search.trim() === q) return;
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      const params = pluginDirectoryUrlParams(searchParams.toString(), { name: search.trim(), teamId, memberId, ownerId });
      router.replace(params ? `?${params}` : "?", { scroll: false });
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, q, teamId, memberId, ownerId, router, searchParams]);

  return (
    <ItemPage testId="admin-plugins">
      <DenPageHeader size="compact" title="插件" />
      {!empty ? <div className="flex flex-wrap items-center gap-2" data-testid="plugin-directory-toolbar">
        <FilterInput value={search} onChange={setSearch} className="w-[200px] max-w-full" />
        <DirectoryFilter label="团队" title="团队可使用的插件" counts={firstPage?.teamCounts} value={teamId} options={orgContext?.teams ?? []} onChange={(id) => setFilters({ name: search.trim(), teamId: id, memberId: null, ownerId })} />
        <DirectoryFilter label="所有者" title="插件创建者" counts={firstPage?.ownerCounts} value={ownerId} options={(orgContext?.members ?? []).map((member) => ({ id: member.id, name: member.user.name || member.user.email }))} onChange={(id) => setFilters({ name: search.trim(), teamId, memberId: null, ownerId: id })} />
        <span className="sm:ml-auto">{createAction}</span>
      </div> : null}
      {search || teamId || memberId || ownerId ? <button type="button" onClick={() => { setSearch(""); setFilters({ name: "", teamId: null, memberId: null, ownerId: null }); }} className="-mt-2 inline-flex w-fit items-center gap-1 text-[12px] text-gray-600 hover:text-gray-900"><X className="h-3.5 w-3.5" aria-hidden />清除筛选</button> : null}
      {legacyMember ? <p className="text-[13px] text-gray-600">可使用人员 {legacyMember.user.name || legacyMember.user.email}</p> : null}
      <DirectoryResults key={`${orgId}:${q}:${teamId}:${memberId}:${ownerId}`} plugins={plugins} filtered={Boolean(q || teamId || memberId || ownerId)} />
    </ItemPage>
  );
}
