"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, KeyRound, Plus, Search } from "lucide-react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenChip } from "../../_components/ui/chip";
import { DenInput } from "../../_components/ui/input";
import { DenList, DenListRow } from "../../_components/ui/list-row";
import { DenNotice } from "../../_components/ui/notice";
import { DenOptionCard } from "../../_components/ui/option-card";
import { DenSectionHeader } from "../../_components/ui/section-header";
import {
  getLlmProviderRoute,
  getNewLlmProviderRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useOrgDesktopPolicies } from "./desktop-policy-data";
import { readModelAccessState, saveModelAccess, type ModelAccessMode } from "./model-access-policy";
import {
  formatProviderTimestamp,
  getProviderDocUrl,
  getProviderIconSlug,
  useOrgLlmProviders,
  type DenLlmProvider,
} from "./llm-provider-data";

function plural(count: number, noun: string) {
  return `${count} ${noun}`;
}

function LlmProviderList({ providers, orgSlug }: { providers: DenLlmProvider[]; orgSlug: string | null }) {
  return (
    <DenList>
      {providers.map((provider) => {
        const members = provider.access.memberCount;
        const teams = provider.access.teams.length;
        const accessText = provider.access.allMembers
          ? "组织中的所有人"
          : `${members} 人 · ${plural(teams, "个团队")}`;
        return (
          <DenListRow
            key={provider.id}
            href={getLlmProviderRoute(orgSlug, provider.id)}
            dataAttributes={{ "data-testid": "llm-provider-card" }}
            leading={
              <DenBrandMark
                name={provider.name}
                simpleIconSlug={getProviderIconSlug(provider.providerId)}
                serviceUrl={getProviderDocUrl(provider.providerConfig)}
              />
            }
            title={provider.name}
            chips={
              <>
                <DenChip>{plural(provider.models.length, "个模型")}</DenChip>
                {!provider.hasApiKey && !provider.configRedacted ? (
                  <DenChip tone="warning" icon={KeyRound}>
                    缺少凭据
                  </DenChip>
                ) : null}
              </>
            }
            meta={`${provider.providerId} · ${accessText} · 更新于 ${formatProviderTimestamp(provider.updatedAt)}`}
            action={<ChevronRight aria-hidden className="h-4 w-4 text-gray-400" />}
          />
        );
      })}
    </DenList>
  );
}

export function LegacyProvidersSection({ orgId, orgSlug }: { orgId: string; orgSlug: string | null }) {
  const { llmProviders, busy, error, reloadProviders } = useOrgLlmProviders(orgId);
  const legacyProviders = llmProviders.filter((provider) => provider.source !== "openwork" && provider.organizationId === orgId);

  return (
    <section aria-label="旧版提供商" data-testid="gateway-legacy-providers" className="mt-10 grid gap-4">
      <DenSectionHeader
        title="旧版提供商"
        description="自有密钥旧版提供商会将 API 密钥直接发送到用户桌面应用，不支持用量跟踪或限额策略。若需跟踪与限制用量，请使用上方的提供商配置。"
      />
      <div>
        <Link
          href={getNewLlmProviderRoute(orgSlug)}
          data-testid="legacy-provider-create"
          className={buttonVariants({ variant: "secondary" })}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          添加旧版提供商
        </Link>
      </div>
      {busy ? (
        <p role="status" className="text-sm text-gray-500">正在加载旧版提供商…</p>
      ) : error ? (
        <div className="flex flex-col items-start gap-4">
          <DenNotice tone="error" message={`无法加载旧版提供商：${error}`} />
          <DenButton variant="secondary" onClick={() => void reloadProviders()}>重新加载旧版提供商</DenButton>
        </div>
      ) : legacyProviders.length > 0 ? (
        <LlmProviderList providers={legacyProviders} orgSlug={orgSlug} />
      ) : null}
    </section>
  );
}

export function LlmProvidersScreen() {
  const { orgId, orgSlug, runReauthableAction } = useOrgDashboard();
  const { llmProviders, busy: providersBusy, error: providersError } = useOrgLlmProviders(orgId);
  const {
    desktopPolicies,
    busy: policiesBusy,
    error: policiesError,
    reloadPolicies,
  } = useOrgDesktopPolicies(orgId);
  const [query, setQuery] = useState("");
  const [accessMode, setAccessMode] = useState<ModelAccessMode>("open");
  const [adminExceptionChecked, setAdminExceptionChecked] = useState(true);
  const [zenAllowed, setZenAllowed] = useState(true);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessSaved, setAccessSaved] = useState<string | null>(null);

  const accessState = useMemo(() => readModelAccessState(desktopPolicies), [desktopPolicies]);
  const defaultPolicy = accessState.defaultPolicy;

  useEffect(() => {
    setAccessMode(accessState.mode);
    setAdminExceptionChecked(accessState.adminException);
    setZenAllowed(accessState.zenAllowed);
  }, [accessState]);

  const customProviders = useMemo(
    () => llmProviders.filter((provider) => provider.source !== "openwork"),
    [llmProviders],
  );

  const filteredProviders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return customProviders;
    }

    return customProviders.filter(
      (provider) =>
        provider.name.toLowerCase().includes(normalizedQuery) ||
        provider.providerId.toLowerCase().includes(normalizedQuery) ||
        provider.models.some((model) => model.name.toLowerCase().includes(normalizedQuery)),
    );
  }, [customProviders, query]);

  const modelCount = customProviders.reduce((total, provider) => total + provider.models.length, 0);
  const providerCount = customProviders.length;
  const hasOpenWorkModels = llmProviders.some((provider) => provider.source === "openwork");

  const accessOutcome = accessMode === "managed"
    ? modelCount > 0
      ? `成员只能看到下方${plural(providerCount, "个提供商")}中的${plural(modelCount, "个模型")}${hasOpenWorkModels ? "，以及 OpenWork 模型" : ""}。`
      : "成员尚无可用模型，请在下方添加提供商。"
    : modelCount > 0
      ? `除下方${plural(modelCount, "个模型")}之外，成员还可以添加自己的提供商。`
      : "成员可添加自己的提供商，组织尚未配置模型。";
  const accessFormDisabled = policiesBusy || accessSaving || !defaultPolicy;

  const saveModelAccessPolicy = async () => {
    setAccessError(null);
    setAccessSaved(null);
    try {
      setAccessSaving(true);
      await runReauthableAction("save-model-access", async () => {
        await saveModelAccess(accessState, { mode: accessMode, adminException: adminExceptionChecked, zenAllowed });
        await reloadPolicies();
      });
      setAccessSaved("模型访问权限已保存。");
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "保存模型访问权限失败，请重试。");
    } finally {
      setAccessSaving(false);
    }
  };

  return (
    <DashboardPageTemplate
      icon={KeyRound}
      title="使用自有密钥"
      description="使用自有凭据连接 Anthropic、OpenAI、Azure 或 models.dev 提供商，选择各提供商提供的模型，并向人员与团队授权。"
    >
      <DenCard data-testid="models-access-card" className="mb-8 grid gap-5">
        <DenSectionHeader
          title="模型使用权限"
          description="选择成员可添加自有提供商，还是仅使用此处管理的模型。"
          action={
            <DenButton
              type="button"
              data-testid="models-access-save"
              onClick={() => void saveModelAccessPolicy()}
              loading={accessSaving}
              disabled={accessFormDisabled}
            >
              保存
            </DenButton>
          }
        />

        {policiesError ? <DenNotice message={policiesError} tone="error" /> : null}
        {accessError ? <DenNotice message={accessError} tone="error" /> : null}
        {accessSaved ? (
          <p className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-700">
            {accessSaved}
          </p>
        ) : null}
        {!policiesBusy && !defaultPolicy ? (
          <p className="rounded-[24px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-5 py-4 text-[14px] text-[var(--dls-text-primary)]">
            未找到默认桌面策略。
          </p>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <DenOptionCard
            type="radio"
            name="models-access-mode"
            testId="models-access-open"
            title="打开"
            description="成员可添加自己的提供商。"
            checked={accessMode === "open"}
            disabled={accessFormDisabled}
            onChange={() => {
              setAccessMode("open");
              setAccessSaved(null);
              setAccessError(null);
            }}
          />
          <DenOptionCard
            type="radio"
            name="models-access-mode"
            testId="models-access-managed"
            title="托管"
            description="成员仅使用下方模型。"
            checked={accessMode === "managed"}
            disabled={accessFormDisabled}
            onChange={() => {
              setAccessMode("managed");
              setAccessSaved(null);
              setAccessError(null);
            }}
          />
        </div>

        {accessMode === "managed" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <DenOptionCard
              type="checkbox"
              testId="models-access-admin-exception"
              title="管理员可添加自己的提供商"
              checked={adminExceptionChecked}
              disabled={accessFormDisabled}
              onChange={(checked) => {
                setAdminExceptionChecked(checked);
                setAccessSaved(null);
                setAccessError(null);
              }}
            />
            <DenOptionCard
              type="checkbox"
              testId="models-access-zen"
              title="允许 OpenCode Zen 模型"
              checked={zenAllowed}
              disabled={accessFormDisabled}
              onChange={(checked) => {
                setZenAllowed(checked);
                setAccessSaved(null);
                setAccessError(null);
              }}
            />
          </div>
        ) : null}

        <p data-testid="models-access-outcome" className="rounded-[20px] bg-gray-50 px-4 py-3 text-[13px] leading-6 text-gray-600">
          {accessOutcome}
        </p>
      </DenCard>

      <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <DenInput
          type="search"
          icon={Search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索提供商或模型…"
        />

        <Link href={getNewLlmProviderRoute(orgSlug)} className={buttonVariants({ variant: "primary" })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          添加提供商
        </Link>
      </div>

      {providersError ? <DenNotice message={providersError} tone="error" className="mb-6" /> : null}

      {providersBusy ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载提供商资源库…
        </div>
      ) : (
      <section className="grid gap-4">
        <DenSectionHeader
          title="你的提供商"
          description="每行显示一组凭据及其提供的模型。"
        />
        {filteredProviders.length === 0 ? (
          <div className="rounded-[32px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
            <p className="text-[16px] font-medium tracking-[-0.03em] text-gray-900">
              {customProviders.length === 0 ? "尚未配置自定义提供商。" : "没有符合搜索条件的提供商。"}
            </p>
            <p className="mx-auto mt-3 max-w-[560px] text-[15px] leading-8 text-gray-500">
              {customProviders.length === 0
                ? "选择 models.dev 提供商与可用模型，添加凭据并授予访问权限。"
                : "请扩大搜索范围，或为组织创建新的提供商。"}
            </p>
          </div>
        ) : (
          <LlmProviderList providers={filteredProviders} orgSlug={orgSlug} />
        )}
      </section>
      )}
    </DashboardPageTemplate>
  );
}
