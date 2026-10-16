"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Cable, Loader2, LockKeyhole, Plus, Search } from "lucide-react";
import { DenInput } from "../../_components/ui/input";
import { buttonVariants, DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getMarketplaceRoute, getOrgAccessFlags, getPluginSourcesRoute, permissionLockReason } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useHasAnyIntegration } from "./integration-data";
import {
  type DenMarketplace,
  formatMarketplaceTimestamp,
  useCreateMarketplace,
  useMarketplaces,
} from "./marketplace-data";
import { DenCatalogList, DenCatalogRow } from "../../_components/ui/catalog-row";
import { CatalogIdentityTile } from "./catalog-identity-tile";
import { AdvancedPageTemplate } from "./advanced-page-template";

export function MarketplacesScreen() {
  const { orgContext, orgSlug } = useOrgDashboard();
  const router = useRouter();
  const { data: marketplaces = [], isLoading, error } = useMarketplaces();
  const { hasAny: hasAnyIntegration, isLoading: integrationsLoading } = useHasAnyIntegration();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.currentMember.permissions,
  );

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matches = normalizedQuery
      ? marketplaces.filter((marketplace) =>
          `${marketplace.name}\n${marketplace.description ?? ""}`.toLowerCase().includes(normalizedQuery),
        )
      : marketplaces;

    // The API returns newest first, which buries a stocked catalogue under an
    // empty one somebody just created. Lead with the marketplaces that have
    // something in them.
    return [...matches].sort(
      (a, b) => b.pluginCount - a.pluginCount || a.name.localeCompare(b.name),
    );
  }, [marketplaces, normalizedQuery]);

  return (
    <AdvancedPageTemplate tab="collections">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <DenInput
            type="search"
            icon={Search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索集合…"
          />
        </div>
        {access.canManageMarketplaces ? (
          <DenButton icon={Plus} onClick={() => setCreateOpen(true)}>
            新建集合
          </DenButton>
        ) : (
          <span title={permissionLockReason("marketplaces.manage")}>
            <DenButton icon={LockKeyhole} variant="secondary" disabled aria-label={`新集合。${permissionLockReason("marketplaces.manage")}`}>
              新建集合
            </DenButton>
          </span>
        )}
      </div>

      {error ? (
        <DenNotice
          message={error instanceof Error ? error.message : "无法加载集合，请重试。"}
          className="mb-6"
        />
      ) : null}

      {isLoading || integrationsLoading ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-10 text-[14px] text-gray-500">
          正在加载集合…
        </div>
      ) : !hasAnyIntegration && marketplaces.length === 0 ? (
        <ConnectIntegrationEmptyState integrationsHref={getPluginSourcesRoute(orgSlug)} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={marketplaces.length === 0 ? "暂无集合" : "没有符合搜索条件的集合"}
          description={
            marketplaces.length === 0
              ? "创建或连接集合，再分配给组织所有人或指定用户与团队。"
              : "请尝试其他关键词，或打开插件标签。"
          }
          action={
            marketplaces.length === 0
              ? { href: getPluginSourcesRoute(orgSlug), label: "开源项目", icon: Cable }
              : undefined
          }
        />
      ) : (
        <DenCatalogList
          label={`${filtered.length} 个集合`}
          valueLabel="Plugins"
        >
          {filtered.map((marketplace) => (
            <DenCatalogRow
              key={marketplace.id}
              href={getMarketplaceRoute(orgSlug, marketplace.id)}
              leading={
                <CatalogIdentityTile name={marketplace.name} logoUrl={marketplace.logoUrl} />
              }
              title={marketplace.name}
              description={
                marketplace.description ?? <span className="text-gray-400">暂无描述</span>
              }
              value={String(marketplace.pluginCount)}
              valueMuted={marketplace.pluginCount === 0}
              valueCaption={`添加于 ${formatMarketplaceTimestamp(marketplace.createdAt)}`}
            />
          ))}
        </DenCatalogList>
      )}
      {access.canManageMarketplaces ? (
        <CreateMarketplaceDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(marketplace) => {
            setCreateOpen(false);
            router.push(getMarketplaceRoute(orgSlug, marketplace.id));
          }}
        />
      ) : null}
    </AdvancedPageTemplate>
  );
}

function CreateMarketplaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (marketplace: DenMarketplace) => void;
}) {
  const createMutation = useCreateMarketplace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!open) return null;

  const trimmedName = name.trim();

  async function submit() {
    try {
      const created = await createMutation.mutateAsync({
        name: trimmedName,
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      onCreated(created);
    } catch {
      // The mutation error is rendered in the dialog.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-marketplace-title"
        className="w-full max-w-[440px] rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-marketplace-title" className="text-[16px] font-semibold tracking-[-0.01em] text-gray-950">
          新建集合
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-500">
          为组织创建目录，创建后可添加插件并设置受众。
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[12px] font-medium text-gray-700">名称</span>
          <DenInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="研发工具"
            autoFocus
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-medium text-gray-700">描述（可选）</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="此集合包含什么内容？"
            rows={2}
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-hidden transition placeholder:text-gray-300 focus:border-gray-400"
          />
        </label>

        {createMutation.error ? (
          <p className="mt-3 text-[12.5px] text-red-600">
            {createMutation.error instanceof Error ? createMutation.error.message : "创建集合失败，请重试。"}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <DenButton variant="secondary" onClick={onClose} disabled={createMutation.isPending}>
            取消
          </DenButton>
          <DenButton disabled={!trimmedName || createMutation.isPending} onClick={() => void submit()}>
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            创建集合
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
}) {
  const ActionIcon = action?.icon;
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
      <p className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">{title}</p>
      <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-6 text-gray-500">{description}</p>
      {action ? (
        <div className="mt-5 flex justify-center">
          <Link href={action.href} className={buttonVariants({ variant: "primary", size: "sm" })}>
            {ActionIcon ? <ActionIcon className="h-4 w-4" aria-hidden="true" /> : null}
            {action.label}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ConnectIntegrationEmptyState({ integrationsHref }: { integrationsHref: string }) {
  return (
    <EmptyState
      title="连接来源以发现集合"
      description="OpenWork 在已连接仓库中发现插件时会创建集合，可分配给组织所有人或指定用户与团队。"
      action={{ href: integrationsHref, label: "开源项目", icon: Cable }}
    />
  );
}
