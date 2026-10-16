"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LogOut, Settings } from "lucide-react";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import { type DenOrgSummary, formatRoleLabel, getJoinOrgRoute, getOnboardingPeopleRoute, getOrgDashboardRoute, parseOrgListPayload } from "../_lib/den-org";
import { useOrgListWindow } from "../_lib/use-org-list-window";
import { useDenFlow } from "../_providers/den-flow-provider";

import { SetupFrame } from "./setup-frame";
import { DenButton } from "./ui/button";
import { DenInput } from "./ui/input";

type SettingsTab = "profile" | "organizations";

export function OrganizationScreen() {
  const router = useRouter();
  const { user, sessionHydrated, signOut, runtimeConfig, runtimeConfigLoaded, continueSetup } = useDenFlow();
  const [orgs, setOrgs] = useState<DenOrgSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("organizations");
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const [createdOrg, setCreatedOrg] = useState<{ id: string; slug: string } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const userDisplayName = useMemo(() => {
    const trimmedName = user?.name?.trim();
    if (trimmedName) return trimmedName;
    const emailLocalPart = user?.email?.split("@")[0]?.trim() ?? "";
    return emailLocalPart || "OpenWork 用户";
  }, [user?.email, user?.name]);

  const userInitials = useMemo(() => {
    const parts = userDisplayName.split(/\s+/).filter(Boolean);
    return ((parts[0]?.slice(0, 1) ?? "O") + (parts[1]?.slice(0, 1) ?? "")).toUpperCase();
  }, [userDisplayName]);

  const activeOrg = useMemo(() => orgs.find((org) => org.isActive) ?? null, [orgs]);
  const isSingleOrgMode = runtimeConfigLoaded && runtimeConfig.orgMode === "single_org";
  const singleOrgName = runtimeConfig.singleOrgName || "OpenWork";
  const singleOrgSlug = runtimeConfig.singleOrgSlug.trim();
  const showDirectCreateFlow = !isSingleOrgMode && !error && orgs.length === 0;
  const {
    query: orgQuery,
    setQuery: setOrgQuery,
    visible: visibleOrgs,
    filteredCount: orgFilteredCount,
    hasMore: orgHasMore,
    showMore: showMoreOrgs,
    showSearch: showOrgSearch,
  } = useOrgListWindow(orgs);

  useEffect(() => {
    if (!sessionHydrated || !runtimeConfigLoaded) return;
    if (!user) {
      router.replace("/");
      return;
    }

    let isMounted = true;

    async function loadOrgs() {
      try {
        const { response, payload } = await requestJson("/v1/me/orgs", { method: "GET" });
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "加载组织失败。"));
        }

        if (isMounted) {
          if (typeof payload !== "object" || payload === null || !("orgs" in payload) || !Array.isArray(payload.orgs)) {
            throw new Error("组织信息不完整，请重试。");
          }
          const parsed = parseOrgListPayload(payload);
          if (parsed.orgs.length !== payload.orgs.length) throw new Error("组织信息不完整，请重试。");
          const nextOrgs = parsed.orgs.map((org) => ({ ...org, isActive: org.slug === parsed.activeOrgSlug }));
          const targetOrg = nextOrgs.find((org) => org.isActive) ?? nextOrgs[0] ?? null;
          if (isSingleOrgMode && targetOrg) {
            router.replace(getOrgDashboardRoute(targetOrg.slug));
            return;
          }
          setOrgs(nextOrgs);
          if (!isSingleOrgMode && nextOrgs.length === 0) continueSetup(null, "/organization");
          setShowCreate(!isSingleOrgMode && nextOrgs.length === 0);
          setBusy(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "发生错误，请重试。");
          setBusy(false);
        }
      }
    }

    void loadOrgs();

    return () => {
      isMounted = false;
    };
  }, [isSingleOrgMode, runtimeConfigLoaded, sessionHydrated, user, router]);

  function reviewInvitation() {
    try {
      const url = new URL(invitationLink.trim(), window.location.origin);
      const invitationId = url.searchParams.get("invite")?.trim();
      if (url.origin !== window.location.origin || url.pathname !== "/join-org" || !invitationId) {
        throw new Error("粘贴此 OpenWork 云端的邀请链接，若没有链接，请联系团队所有者。");
      }
      router.push(getJoinOrgRoute(invitationId));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "请输入有效的邀请链接。");
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSingleOrgMode) {
      setCreateError("此部署使用单一托管组织。");
      return;
    }

    const trimmed = createName.trim();
    if (trimmed.length < 2) return;

    setCreateBusy(true);
    setCreateError(null);
    try {
      let nextOrg = createdOrg;
      if (!nextOrg) {
        const { response, payload } = await requestJson("/v1/org", {
          method: "POST",
          body: JSON.stringify({ name: trimmed }),
        });

        if (!response.ok) {
          throw new Error(getErrorMessage(payload, "创建组织失败，请重试。"));
        }

        const organization =
          typeof payload === "object" && payload && "organization" in payload && payload.organization && typeof payload.organization === "object"
            ? payload.organization
            : null;
        if (!organization || !("slug" in organization) || typeof organization.slug !== "string" || !organization.slug || !("id" in organization) || typeof organization.id !== "string") {
          throw new Error("组织已创建，但未返回组织标识，请刷新后重试。");
        }

        nextOrg = { id: organization.id, slug: organization.slug };
        setCreatedOrg(nextOrg);
      }
      continueSetup(nextOrg.id, getOnboardingPeopleRoute(nextOrg.slug));
      router.push(getOnboardingPeopleRoute(nextOrg.slug));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "创建组织失败，请重试。");
      setCreateBusy(false);
    }
  }

  const creationForm = <form onSubmit={handleCreate} className="grid gap-5" aria-busy={createBusy}>
    <label className="grid gap-2">
      <span className="text-[13px] font-medium text-gray-900">工作区名称</span>
      <DenInput value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="我的工作区" minLength={2} maxLength={120} disabled={createBusy || Boolean(createdOrg)} required autoFocus />
    </label>
    {createError ? <p role="alert" className="text-[13px] text-red-600">{createError}</p> : null}
    <DenButton type="submit" loading={createBusy} disabled={createName.trim().length < 2} className="w-full">创建工作区</DenButton>
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[13px] font-medium text-gray-500 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none" />
        加入已有工作区
      </summary>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-2">
          <span className="text-[13px] font-medium text-gray-900">团队邀请链接</span>
          <DenInput value={invitationLink} onChange={(event) => setInvitationLink(event.target.value)} placeholder="粘贴邀请链接" disabled={createBusy || Boolean(createdOrg)} />
        </label>
        <DenButton type="button" variant="secondary" disabled={createBusy || Boolean(createdOrg) || !invitationLink.trim()} onClick={reviewInvitation}>查看邀请</DenButton>
      </div>
    </details>
  </form>;

  function handleSwitch(slug: string) {
    router.push(getOrgDashboardRoute(slug));
  }

  if (!sessionHydrated || !runtimeConfigLoaded || busy) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafafa]">
        <p className="text-sm text-gray-500">正在加载组织…</p>
      </div>
    );
  }

  if (!isSingleOrgMode && (showDirectCreateFlow || showCreate)) {
    return <SetupFrame step="space" title="创建工作区" description="">
      {error ? <p role="alert" className="mb-4 text-sm text-rose-600">{error}</p> : null}
      {creationForm}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-5 text-xs text-gray-500">
        <span className="min-w-0 max-w-[260px] truncate" title={user?.email}>{user?.email}</span>
        {!createBusy && !createdOrg && orgs.length > 0 ? <button type="button" className="font-medium text-gray-700" onClick={() => { setShowCreate(false); setCreateName(""); setCreateError(null); }}>取消</button> : <button type="button" disabled={createBusy} onClick={() => void signOut()} className="font-medium text-gray-700">退出登录</button>}
      </div>
    </SetupFrame>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-gray-900">OpenWork Cloud</span>
        </div>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="min-w-0 truncate text-sm text-gray-500">{user?.email}</span>
          <button
            onClick={() => void signOut()}
            className="text-gray-400 transition-colors hover:text-gray-900"
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-12">
        {isSingleOrgMode && orgs.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <section className="rounded-[1.75rem] border border-gray-200 bg-white p-5 shadow-xs sm:p-7 md:rounded-[2rem] md:p-10">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#011627] text-sm font-semibold uppercase tracking-[0.08em] text-white sm:h-14 sm:w-14">
                  {userInitials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-gray-400">OpenWork</p>
                  <h1 className="mt-2 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-gray-950 sm:text-3xl">
                    {singleOrgName}
                  </h1>
                  <p className="mt-3 max-w-xl text-[13px] leading-6 text-gray-500 sm:text-sm">
                    此部署使用单一托管组织，完成配置后将直接进入工作区。
                  </p>
                </div>
              </div>

              {error ? (
                <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                  {error}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {singleOrgSlug ? (
                  <button
                    type="button"
                    className="w-full rounded-2xl bg-gray-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 sm:w-auto"
                    onClick={() => router.push(`/sso/${encodeURIComponent(singleOrgSlug)}`)}
                  >
                    通过 SSO 继续
                  </button>
                ) : null}
                <button
                  type="button"
                  className="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 sm:w-auto"
                  onClick={() => window.location.reload()}
                >
                  重新检查
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {!isSingleOrgMode ? (
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 sm:mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">设置</h1>
              <p className="mt-1 text-sm text-gray-500">管理个人资料与组织成员关系。</p>
            </div>

            <div className="mb-6 flex gap-6 overflow-x-auto border-b border-gray-200 sm:mb-8 sm:gap-8">
              <button
                type="button"
                onClick={() => setActiveTab("profile")}
                className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                  activeTab === "profile"
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                个人资料
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("organizations")}
                className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                  activeTab === "organizations"
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                组织
              </button>
            </div>

            {error ? (
              <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                {error}
              </div>
            ) : null}

            {activeTab === "profile" ? (
              <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs">
                <div className="mb-6 flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#011627] text-sm font-semibold uppercase tracking-[0.08em] text-white">
                    {userInitials}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-medium text-gray-900">{userDisplayName}</h2>
                    <p className="mt-1 text-sm text-gray-500">{user?.email ?? "已登录"}</p>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">姓名</span>
                    <input
                      type="text"
                      value={user?.name ?? ""}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-hidden"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">电子邮箱</span>
                    <input
                      type="email"
                      value={user?.email ?? ""}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-hidden"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">用户 ID</span>
                    <input
                      type="text"
                      value={user?.id ?? ""}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-hidden"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-gray-700">当前组织</span>
                    <input
                      type="text"
                      value={activeOrg?.name ?? "没有当前组织"}
                      readOnly
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 outline-hidden"
                    />
                  </label>
                </div>
              </section>
            ) : (
              <>
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <p className="max-w-2xl text-sm text-gray-500">
                    各组织拥有独立的环境，你可以在组织内与其他成员协作并管理自己的资源。
                  </p>
                  <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[18rem]">
                    {showOrgSearch ? (
                      <input
                        type="search"
                        value={orgQuery}
                        onChange={(event) => setOrgQuery(event.target.value)}
                        placeholder="搜索组织"
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-hidden transition focus:border-gray-400 focus:ring-4 focus:ring-gray-900/5"
                      />
                    ) : null}
                    <button
                      onClick={() => setShowCreate(true)}
                      className="w-full shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 sm:w-auto"
                    >
                      + 创建新组织
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 md:hidden">
                  {visibleOrgs.map((org) => (
                    <section key={org.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-[15px] font-semibold text-gray-950">{org.name}</h2>
                          <p className="mt-1 text-xs text-gray-500">
                            {org.role === "owner" ? "创作者套餐" : "免费套餐"} • {formatRoleLabel(org.role)}
                          </p>
                        </div>
                        {org.isActive ? (
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                            当前
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => handleSwitch(org.slug)}
                          className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-xs transition hover:bg-gray-50"
                        >
                          {org.isActive ? "打开" : "切换"}
                        </button>
                        <button
                          onClick={() => handleSwitch(org.slug)}
                          className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-3 py-2.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
                          aria-label="组织设置"
                        >
                          <Settings className="h-4 w-4" />
                        </button>
                      </div>
                    </section>
                  ))}
                </div>

                <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs md:block">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-gray-200 bg-gray-50/50">
                        <tr>
                          <th className="px-6 py-4 font-medium text-gray-500">组织</th>
                          <th className="px-6 py-4 font-medium text-gray-500">席位类型</th>
                          <th className="px-6 py-4 text-right font-medium text-gray-500">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visibleOrgs.map((org) => (
                          <tr key={org.id} className="transition-colors hover:bg-gray-50/50">
                            <td className="px-6 py-4">
                              <div className="font-medium text-gray-900">{org.name}</div>
                              <div className="mt-1 text-xs text-gray-500">
                                {org.role === "owner" ? "创作者套餐" : "免费套餐"} • 1 名成员
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-gray-700">{formatRoleLabel(org.role)}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {org.isActive ? (
                                <span className="inline-flex cursor-default items-center rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500">
                                  当前组织
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleSwitch(org.slug)}
                                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-xs transition hover:bg-gray-50"
                                >
                                  切换
                                </button>
                              )}
                              <button
                                onClick={() => handleSwitch(org.slug)}
                                className="ml-2 inline-flex items-center justify-center rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                                aria-label="组织设置"
                              >
                                <Settings className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {orgFilteredCount === 0 && orgQuery ? (
                  <p className="mt-4 text-sm text-gray-500">没有符合搜索条件的组织。</p>
                ) : null}

                {orgHasMore ? (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-500">
                      正在显示 {visibleOrgs.length} 个组织，共 {orgFilteredCount} 个
                    </p>
                    <button
                      type="button"
                      onClick={showMoreOrgs}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-xs transition hover:bg-gray-50 sm:w-auto"
                    >
                      显示更多
                    </button>
                  </div>
                ) : null}

                <p className="mt-8 text-center text-sm text-gray-500">暂无待处理的组织邀请。</p>
              </>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
