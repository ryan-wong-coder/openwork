"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, KeyRound, ArrowUpRight, ArrowRight } from "lucide-react";
import { DenBadge } from "../../_components/ui/badge";
import { DesktopHandoffAction } from "../../_components/auth-panel";
import { SetupFrame } from "../../_components/setup-frame";
import { getCustomLlmProvidersRoute, getInferenceRoute, getOrgDashboardRoute } from "../../_lib/den-org";
import { getErrorMessage, normalizeAuthIntentParam, PENDING_AUTH_INTENT_STORAGE_KEY, requestJson } from "../../_lib/den-flow";
import { getDesktopGrant } from "../../_lib/desktop-handoff";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export function MarketplaceOnboardingScreen() {
  const router = useRouter();
  const { orgId, orgSlug, activeOrg } = useOrgDashboard();
  const { desktopAuthRequested, desktopRedirectUrl, authError, completeSetup } = useDenFlow();
  const [completing, setCompleting] = useState(false);
  const modelsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (desktopAuthRequested && normalizeAuthIntentParam(window.sessionStorage.getItem(PENDING_AUTH_INTENT_STORAGE_KEY)) === "models") {
      modelsHeading.current?.focus();
    }
  }, [desktopAuthRequested]);
  const { data: modelsEnabled, isPending: modelsLoading, error: modelsError } = useQuery({
    queryKey: ["onboarding", "inference", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      if (!orgId) throw new Error("选择工作区以检查 OpenWork 模型。");
      const { response, payload } = await requestJson("/v1/inference", { method: "GET", headers: { "x-openwork-org-id": orgId } }, 12000);
      if (!response.ok) throw new Error(getErrorMessage(payload, "无法检查 OpenWork 模型，请重试。"));
      return typeof payload === "object" && payload !== null && "inference" in payload
        && typeof payload.inference === "object" && payload.inference !== null
        && "enabled" in payload.inference && payload.inference.enabled === true;
    },
    staleTime: 0,
  });

  async function finish() {
    if (!orgId || completing) return;
    setCompleting(true);
    try {
      if (await completeSetup(orgId) && !desktopAuthRequested) router.push(getOrgDashboardRoute(orgSlug));
    } finally {
      setCompleting(false);
    }
  }

  return (
    <SetupFrame step="ready" title="选择工作使用的模型" description="使用 OpenWork 模型或自有提供商，可现在选择或稍后配置。">
      <div className="grid gap-6" data-testid="marketplace-onboarding">
        <section aria-labelledby="setup-models-heading" className="grid gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-400">可选 · 模型</p>
            <h2 id="setup-models-heading" ref={modelsHeading} tabIndex={-1} className="mt-2 text-xl font-semibold tracking-[-0.03em]">自由选择模型</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--dls-text-secondary)]" role="status">
              {modelsLoading ? "正在检查 OpenWork 模型…" : modelsError ? "模型状态不可用，仍可完成配置。" : modelsEnabled ? "此工作区已启用 OpenWork 模型。" : "登录不会自动启用模型，可保留现有提供商或在准备好后选择。"}
            </p>
            {modelsEnabled ? <DenBadge icon={Check}>模型已开启</DenBadge> : null}
          </div>
          <div className="divide-y divide-[var(--dls-border)] overflow-hidden rounded-2xl border border-[var(--dls-border)]">
            <div className="flex items-start gap-3 p-4 sm:p-5" data-testid="onboarding-choice-openwork-models">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--dls-hover)]">
                <img src="/openwork-mark.svg" alt="" aria-hidden className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">OpenWork 模型</h3>
                <p className="mt-1 text-[13px] leading-5 text-[var(--dls-text-secondary)]">托管模型按成员计费，无需管理 API 密钥。</p>
                <Link href={getInferenceRoute(orgSlug)} className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-neutral-950">
                  {modelsEnabled ? "管理模型" : "浏览模型"}<ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 sm:p-5" data-testid="onboarding-choice-byok">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--dls-hover)]"><KeyRound className="size-[18px] text-[var(--dls-text-secondary)]" aria-hidden /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">使用自有密钥</h3>
                <p className="mt-1 text-[13px] leading-5 text-[var(--dls-text-secondary)]">连接自有提供商或网关，保留自己的计费与模型选择。</p>
                <Link href={getCustomLlmProvidersRoute(orgSlug)} className="mt-3 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-neutral-950">
                  添加提供商<ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </div>
          </div>
        </section>
        <section aria-labelledby="setup-finish-heading" className="grid gap-4 border-t border-[var(--dls-border)] pt-6" data-testid="onboarding-finish">
          <div>
            <h2 id="setup-finish-heading" className="text-base font-semibold tracking-tight">工作区已就绪</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--dls-text-secondary)]">无需选择模型即可完成配置。</p>
          </div>
          {authError ? <p role="alert" className="text-sm text-rose-600">{authError}</p> : null}
          {desktopRedirectUrl ? <DesktopHandoffAction openworkUrl={desktopRedirectUrl} grant={getDesktopGrant(desktopRedirectUrl)} organizationName={activeOrg?.name ?? null} showCopyLinkByDefault /> : (
            <button type="button" onClick={() => void finish()} disabled={!orgId || completing} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2">
              {completing ? "正在完成…" : desktopAuthRequested ? "完成并打开应用" : "完成配置"}<ArrowRight className="size-4" aria-hidden />
            </button>
          )}
        </section>
      </div>
    </SetupFrame>
  );
}
