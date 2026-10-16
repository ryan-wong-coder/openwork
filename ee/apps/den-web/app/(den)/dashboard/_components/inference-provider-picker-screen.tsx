"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Plus, Search } from "lucide-react";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenButton } from "../../_components/ui/button";
import { DenChip } from "../../_components/ui/chip";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenSkeleton } from "../../_components/ui/skeleton";
import { getAiGatewayProvidersRoute, getNewAiGatewayProviderRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { isSupportedGatewayNpm } from "./inference-provider-request";
import { getProviderIconSlug, requestLlmProviderCatalog, type DenModelsDevProviderSummary } from "./llm-provider-data";
import { LITELLM_DOC_URL, LITELLM_PROVIDER_ID } from "./litellm-provider-data";

/** Plain-words taglines for the providers most orgs reach for; anything else falls back to its model count. */
const TAGLINES: Record<string, string> = {
  openrouter: "一个密钥，使用多家厂商的数百个模型",
  anthropic: "Claude 模型",
  openai: "GPT 模型",
  google: "Gemini 模型",
  "google-vertex": "Google Cloud 上的 Gemini 和 Claude，团队可使用 Google 账户登录",
  "google-vertex-anthropic": "Google Cloud 上的 Claude",
  azure: "Azure 资源上的 GPT 模型",
  "amazon-bedrock": "AWS 上的 Claude、Llama 等模型",
  "microsoft-foundry": "Microsoft Foundry 资源上的 Claude",
  litellm: "使用自有 LiteLLM 代理，可共用一个密钥或每人使用独立密钥",
  mistral: "Mistral 和 Codestral 模型",
  groq: "快速开放模型：Llama、Qwen、Kimi",
  deepseek: "DeepSeek V3 和 R1",
  xai: "Grok 模型",
};
const FEATURED = Object.keys(TAGLINES);
const INITIAL_ROWS = 10;

export function providerTagline(provider: Pick<DenModelsDevProviderSummary, "id" | "modelCount">) {
  return TAGLINES[provider.id] ?? `${provider.modelCount} 个模型`;
}

/** Featured providers first in a stable order, then the rest alphabetically. */
export function orderCatalog<T extends { id: string; name: string }>(providers: readonly T[]): T[] {
  const rank = (id: string) => { const index = FEATURED.indexOf(id); return index === -1 ? FEATURED.length : index; };
  return [...providers].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

export function InferenceProviderPickerScreen({ embedded = false }: { embedded?: boolean }) {
  const Heading = embedded ? "h2" : "h1";
  const { orgId, orgSlug } = useOrgDashboard();
  const [catalog, setCatalog] = useState<DenModelsDevProviderSummary[]>([]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogAttempt, setCatalogAttempt] = useState(0);

  useEffect(() => {
    setCatalog([]);
    setError(null);
    if (!orgId) { setCatalogBusy(false); return; }
    let cancelled = false;
    setCatalogBusy(true);
    void requestLlmProviderCatalog(orgId)
      .then((result) => { if (!cancelled) setCatalog(result); })
      .catch(() => { if (!cancelled) setError("无法加载提供商目录，请重试。"); })
      .finally(() => { if (!cancelled) setCatalogBusy(false); });
    return () => { cancelled = true; };
  }, [orgId, catalogAttempt]);

  const providers = useMemo(() => {
    const supported = catalog.filter((item) => item.id !== LITELLM_PROVIDER_ID && isSupportedGatewayNpm(item.npm));
    supported.push({ id: LITELLM_PROVIDER_ID, name: "LiteLLM", npm: null, env: [], doc: LITELLM_DOC_URL, api: null, modelCount: 0 });
    const ordered = orderCatalog(supported);
    const normalized = query.trim().toLowerCase();
    return normalized ? ordered.filter((item) => item.name.toLowerCase().includes(normalized) || item.id.toLowerCase().includes(normalized) || providerTagline(item).toLowerCase().includes(normalized)) : ordered;
  }, [catalog, query]);
  const visible = showAll || query.trim() ? providers : providers.slice(0, INITIAL_ROWS);
  const hidden = providers.length - visible.length;
  const compatible = catalog.find((item) => item.npm === "@ai-sdk/openai-compatible");

  return (
    <div className={embedded ? undefined : "mx-auto max-w-[860px] px-6 py-6"}>
      <Link href={getAiGatewayProvidersRoute(orgSlug)} className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        返回 AI 提供商
      </Link>
      <Heading className="mt-2 text-[20px] font-medium tracking-[-0.02em] text-gray-900">添加提供商</Heading>
      <div className="mt-5 rounded-[12px] border border-gray-100 bg-white">
        <div className="p-3">
          <div className="w-[200px]">
            <DenInput type="search" icon={Search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按名称筛选" aria-label="按名称筛选" data-testid="gateway-provider-catalog-filter" className="h-8 text-[12px]" />
          </div>
        </div>
        <ul className="divide-y divide-gray-100 border-t border-gray-100" aria-busy={catalogBusy} aria-label="提供商目录" data-testid="gateway-provider-catalog">
          {catalogBusy ? Array.from({ length: INITIAL_ROWS }, (_, index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-2.5" data-testid="gateway-provider-catalog-loading">
              <DenSkeleton className="size-7 shrink-0 rounded-lg" />
              <span className="flex flex-1 flex-col gap-2"><DenSkeleton className="h-4 w-32" /><DenSkeleton className="h-3 w-60 max-w-full" /></span>
              <DenSkeleton className="size-4 shrink-0" />
            </li>
          )) : null}
          {error ? <li><DenNotice tone="error" presentation="inline" message={error} action={<DenButton size="sm" variant="secondary" data-testid="gateway-provider-catalog-retry" onClick={() => setCatalogAttempt((current) => current + 1)}>重试</DenButton>} /></li> : null}
          {!catalogBusy ? visible.map((item) => (
            <li key={item.id}>
              <Link href={getNewAiGatewayProviderRoute(orgSlug, item.id)} data-testid={`gateway-provider-pick-${item.id}`} aria-label={`添加 ${item.name}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                <DenBrandMark name={item.name} simpleIconSlug={getProviderIconSlug(item.id)} serviceUrl={item.doc} className="h-7 w-7 shrink-0 rounded-[7px]" imageClassName="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-gray-900">{item.name}</span>
                    {item.id === "openrouter" ? <DenChip size="xs">从这里开始</DenChip> : null}
                  </span>
                  <span className="block truncate text-[12px] text-gray-500">{providerTagline(item)}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
              </Link>
            </li>
          )) : null}
          {!catalogBusy && !error && providers.length === 0 ? (
            <li className="px-4 py-4 text-[13px] text-gray-500" data-testid="gateway-provider-catalog-empty">
              {query.trim() ? "没有匹配的提供商，请尝试其他名称。" : "没有可用提供商，请重新加载目录。"}
              {!query.trim() ? <DenButton size="sm" variant="secondary" className="mt-3" onClick={() => setCatalogAttempt((current) => current + 1)}>重试</DenButton> : null}
            </li>
          ) : null}
          {!catalogBusy && hidden > 0 ? (
            <li>
              <button type="button" onClick={() => setShowAll(true)} data-testid="gateway-provider-catalog-more" className="w-full py-2.5 text-center text-[12px] font-medium text-gray-600 hover:bg-gray-50">
                再显示 {hidden} 个提供商
              </button>
            </li>
          ) : null}
          {!catalogBusy && !error && !query.trim() && compatible && !visible.some((item) => item.id === compatible.id) ? (
            <li className="border-t border-gray-100">
              <Link href={getNewAiGatewayProviderRoute(orgSlug, compatible.id)} data-testid="gateway-provider-pick-compatible" className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-dashed border-gray-300 text-gray-400"><Plus className="h-3.5 w-3.5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-gray-900">其他提供商</span>
                  <span className="block text-[12px] text-gray-500">任何兼容 OpenAI API 的服务，包括自托管服务</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
