"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { SetupFrame } from "../../_components/setup-frame";
import { OnboardingTexture } from "../../_components/onboarding-texture";
import { normalizeAuthIntentParam, PENDING_AUTH_INTENT_STORAGE_KEY, WORKSPACE_REAUTH_SECURITY_MESSAGE } from "../../_lib/den-flow";
import { getInferenceRoute, getMarketplaceOnboardingRoute } from "../../_lib/den-org";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { IntegrationIcon } from "./integration-icon";
import { useCreateMcpConnection, useMcpConnectionPresets, useMcpConnections } from "./mcp-connections-data";

type ToolState = { status: "adding" | "added" | "error"; error?: string };
const description = "从团队已使用的工具开始，现在选择或在需要时添加。";
const buttonClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-4 disabled:cursor-not-allowed disabled:opacity-40";

export function OnboardingToolsScreen() {
  const { orgId, orgContext, orgError } = useOrgDashboard();
  const { user } = useDenFlow();
  if (!orgId || !orgContext || orgContext.organization.id !== orgId || !user) {
    return <SetupFrame step="tools" title="帮助团队快速开始" description={description}>
      <p role={orgError ? "alert" : "status"} className="text-sm text-neutral-500">{orgError ?? "正在准备工作区…"}</p>
    </SetupFrame>;
  }
  return <ToolsForm key={`${orgId}:${user.id}`} />;
}

function ToolsForm() {
  const router = useRouter();
  const { orgSlug } = useOrgDashboard();
  const { desktopAuthRequested } = useDenFlow();
  const presetsQuery = useMcpConnectionPresets();
  const connectionsQuery = useMcpConnections("manageable");
  const createConnection = useCreateMcpConnection();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, ToolState>>({});
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const addedUrls = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const presets = (presetsQuery.data ?? []).filter((preset, index, all) =>
    (preset.authType === "none" || (preset.authType === "oauth" && !preset.requiresOAuthClient))
    && all.findIndex((entry) => entry.url === preset.url) === index);
  const existingUrls = new Set((connectionsQuery.data ?? []).map((connection) => connection.url));
  const loading = presetsQuery.isPending || connectionsQuery.isPending;
  const loadError = presetsQuery.error ?? connectionsQuery.error;
  const pending = presets.filter((preset) => selected.has(preset.presetId) && !existingUrls.has(preset.url) && !addedUrls.current.has(preset.url));
  const hasAdded = addedUrls.current.size > 0 || presets.some((preset) => existingUrls.has(preset.url));

  function toggle(id: string) {
    if (addingRef.current) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function addTools() {
    if (addingRef.current || loading || loadError || pending.length === 0) return;
    addingRef.current = true;
    setAdding(true);
    try {
      for (const preset of pending) {
        if (!alive.current) break;
        if (addedUrls.current.has(preset.url)) continue;
        setStates((current) => ({ ...current, [preset.presetId]: { status: "adding" } }));
        try {
          await createConnection.mutateAsync({
            name: preset.displayName,
            url: preset.url,
            authType: preset.authType,
            credentialMode: preset.authType === "oauth" ? "per_member" : "shared",
            access: { orgWide: true, memberIds: [], teamIds: [] },
          });
          addedUrls.current.add(preset.url);
          if (alive.current) setStates((current) => ({ ...current, [preset.presetId]: { status: "added" } }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "无法添加此工具，请重试。";
          if (alive.current) setStates((current) => ({ ...current, [preset.presetId]: { status: "error", error: message } }));
          if (message === WORKSPACE_REAUTH_SECURITY_MESSAGE) break;
        }
      }
    } finally {
      addingRef.current = false;
      if (alive.current) setAdding(false);
    }
  }

  function continueSetup() {
    if (addingRef.current) return;
    const intent = normalizeAuthIntentParam(window.sessionStorage.getItem(PENDING_AUTH_INTENT_STORAGE_KEY));
    if (intent === "models" && !desktopAuthRequested) {
      window.sessionStorage.removeItem(PENDING_AUTH_INTENT_STORAGE_KEY);
      router.push(getInferenceRoute(orgSlug));
      return;
    }
    router.push(getMarketplaceOnboardingRoute(orgSlug));
  }

  return <SetupFrame step="tools" title="帮助团队快速开始" description={description} panelVisual={<OnboardingTexture />}>
    <div className="mb-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">可选 · 团队工具</p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-neutral-950">你使用哪些工具？</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-500">添加工具后团队即可使用，每名队友需连接自己的账户才能访问私密信息。</p>
    </div>
    {loading && !loadError ? <p role="status" className="py-6 text-sm text-neutral-500">正在查找团队工具…</p> : null}
    {loadError ? <div role="alert" className="rounded-2xl bg-neutral-100 p-4 text-sm text-neutral-700">
      <p>无法加载工具，请重试或稍后添加。</p>
      <button type="button" className="mt-2 underline underline-offset-4" disabled={adding} onClick={() => { void presetsQuery.refetch(); void connectionsQuery.refetch(); }}>重试</button>
    </div> : null}
    {!loading && !loadError ? <div className="grid gap-2 sm:grid-cols-2" aria-label="可用团队工具">
      {presets.map((preset) => {
        const state = states[preset.presetId];
        const justAdded = addedUrls.current.has(preset.url);
        const existing = existingUrls.has(preset.url);
        const done = justAdded || existing;
        return <div key={preset.presetId} className={`rounded-2xl border p-3 transition-colors ${selected.has(preset.presetId) || done ? "border-transparent bg-neutral-100" : "border-transparent bg-neutral-50 hover:bg-neutral-100"}`}>
          <label className={`flex items-center gap-3 ${adding || done ? "cursor-default" : "cursor-pointer"}`}>
            <IntegrationIcon name={preset.displayName} serviceUrl={preset.url} className="h-9 w-9 shrink-0 rounded-xl" imageClassName="h-5 w-5" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-neutral-900">{preset.displayName}</span><span className="mt-0.5 block text-[11px] text-neutral-500">{preset.authType === "oauth" ? "个人账号" : "无需登录"}</span></span>
            <input type="checkbox" aria-label={`添加 ${preset.displayName}`} checked={selected.has(preset.presetId) || done} disabled={adding || done} onChange={() => toggle(preset.presetId)} className="h-4 w-4 shrink-0 accent-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900" />
          </label>
          <div aria-live="polite">
            {state?.status === "adding" ? <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500"><LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" /> 正在添加…</p> : null}
            {done ? <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-600"><Check size={12} />{justAdded ? "已添加到团队" : "已添加"}</p> : null}
            {state?.status === "error" && !done ? <p role="alert" className="mt-2 text-xs leading-5 text-neutral-700">{state.error}</p> : null}
          </div>
        </div>;
      })}
      {presets.length === 0 ? <p className="text-sm text-neutral-500 sm:col-span-2">之后可在工作区中添加工具。</p> : null}
    </div> : null}
    <div className="mt-6 flex flex-wrap items-center gap-2">
      {(!hasAdded || pending.length > 0) ? <button type="button" className={`${buttonClass} bg-neutral-950 text-white hover:bg-neutral-800`} disabled={adding || loading || Boolean(loadError) || pending.length === 0} onClick={() => void addTools()}>{adding ? <><LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> 正在添加工具…</> : "添加到团队"}</button> : null}
      <button type="button" className={`${buttonClass} ${hasAdded && pending.length === 0 ? "bg-neutral-950 text-white hover:bg-neutral-800" : "text-neutral-600 hover:bg-neutral-100"}`} disabled={adding} onClick={continueSetup}>{hasAdded ? <>继续 <ArrowRight size={15} /></> : "稍后设置"}</button>
    </div>
    <p className="mt-3 text-xs leading-5 text-neutral-400">之后可更改团队访问权限并添加更多工具。</p>
  </SetupFrame>;
}
