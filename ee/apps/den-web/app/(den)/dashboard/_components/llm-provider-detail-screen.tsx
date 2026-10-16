"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, ExternalLink, KeyRound, Trash2, Users } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import {
    getEditLlmProviderRoute,
    getAiGatewayProviderRoute,
    getLlmProvidersRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { migrateLlmProviderToGateway } from "./inference-provider-data";
import { useGatewayDashboardAccess } from "./gateway-dashboard-capability-guard";
import {
    formatProviderTimestamp,
    getProviderApiBase,
    getProviderDocUrl,
    getProviderEnvNames,
    getProviderNpmPackage,
    LLM_PROVIDER_DETAILS_HIDDEN_MESSAGE,
    LLM_PROVIDER_MEMBERS_HIDDEN_MESSAGE,
    useOrgLlmProviders,
} from "./llm-provider-data";
import { RuntimeEnvKeyChip, resolveRuntimeEnvKeys } from "./runtime-env-key";

function formatCountLabel(count: number, singular: string, plural: string) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function getLimitLabel(config: Record<string, unknown>) {
    const limit =
        typeof config.limit === "object" && config.limit !== null
            ? (config.limit as Record<string, unknown>)
            : null;
    const context = typeof limit?.context === "number" ? limit.context : null;
    return context ? `${context.toLocaleString(DEFAULT_DEN_LOCALE)} 上下文` : null;
}

export function LlmProviderDetailScreen({
    llmProviderId,
}: {
    llmProviderId: string;
}) {
    const router = useRouter();
    const gatewayEnabled = useGatewayDashboardAccess("manage-providers") === "enabled";
    const { orgId, orgSlug, runReauthableAction } = useOrgDashboard();
    const { llmProviders, busy, error, reloadProviders } =
        useOrgLlmProviders(orgId);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [confirmingMigrate, setConfirmingMigrate] = useState(false);
    const [migrateBusy, setMigrateBusy] = useState(false);
    const [migrateError, setMigrateError] = useState<string | null>(null);

    useEffect(() => {
        setConfirmingMigrate(false);
        setMigrateError(null);
    }, [orgId, gatewayEnabled]);

    const provider = useMemo(
        () => llmProviders.find((entry) => entry.id === llmProviderId) ?? null,
        [llmProviderId, llmProviders],
    );

    async function deleteProvider() {
        if (!orgId || !provider) {
            return;
        }

        if (
            !window.confirm(
                `删除 ${provider.name}？将移除已保存的模型列表和访问规则。`,
            )
        ) {
            return;
        }

        setDeleteError(null);
        try {
            await runReauthableAction("delete-llm-provider", async () => {
                setDeleteBusy(true);
                const { response, payload } = await requestJson(
                    `/v1/llm-providers/${encodeURIComponent(provider.id)}`,
                    { method: "DELETE" },
                    12000,
                );

                if (response.status !== 204 && !response.ok) {
                    throw getRequestError(payload, response, `无法删除提供商（${response.status}）。`);
                }

                await reloadProviders();
                router.push(getLlmProvidersRoute(orgSlug));
                router.refresh();
            });
        } catch (nextError) {
            setDeleteError(
                nextError instanceof Error
                    ? nextError.message
                    : "无法删除提供商，请重试。",
            );
        } finally {
            setDeleteBusy(false);
        }
    }

    async function moveToGateway() {
        if (!gatewayEnabled || !provider || !provider.canManage || provider.credentialMode === "per_member") {
            return;
        }
        setMigrateError(null);
        setMigrateBusy(true);
        try {
            await runReauthableAction("migrate-llm-provider", async () => {
                const gatewayProvider = await migrateLlmProviderToGateway(provider.id);
                router.push(getAiGatewayProviderRoute(orgSlug, gatewayProvider.id));
                router.refresh();
            });
        } catch (nextError) {
            setMigrateError(
                nextError instanceof Error
                    ? nextError.message
                    : "无法将提供商迁移到网关，请重试。",
            );
        } finally {
            setMigrateBusy(false);
        }
    }

    if (busy && !provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
                    正在加载提供商详情…
                </div>
            </div>
        );
    }

    if (!provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[15px] text-red-700">
                    {error ?? "未找到此提供商。"}
                </div>
            </div>
        );
    }

    const envKeys = resolveRuntimeEnvKeys({
        declaredEnvNames: getProviderEnvNames(provider.providerConfig),
        scoped: provider.source === "models_dev",
        saved: true,
        runtimeEnvKeys: provider.runtimeEnvKeys,
    });
    const npmPackage = getProviderNpmPackage(provider.providerConfig);
    const apiBase = getProviderApiBase(provider.providerConfig);
    const docUrl = getProviderDocUrl(provider.providerConfig);

    return (
        <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
            <div className="mb-8 flex flex-col gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                    模型提供商
                </p>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                        <h1 className="text-[34px] font-semibold tracking-[-0.07em] text-gray-950">
                            {provider.name}
                        </h1>
                    </div>
                </div>
            </div>

            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
                <Link
                    href={getLlmProvidersRoute(orgSlug)}
                    className="inline-flex items-center gap-2 text-[15px] font-medium text-gray-500 transition hover:text-gray-900"
                >
                    <ArrowLeft className="h-5 w-5" />
                    返回提供商
                </Link>

                <div className="flex flex-wrap gap-3">
                    {gatewayEnabled && provider.canManage && provider.source === "models_dev" && provider.credentialMode !== "per_member" ? (
                        <DenButton
                            variant="secondary"
                            data-testid="llm-provider-move-to-gateway"
                            onClick={() => {
                                setMigrateError(null);
                                setConfirmingMigrate(true);
                            }}
                        >
                            <ArrowRightLeft className="h-4 w-4" />
                            迁移到网关
                        </DenButton>
                    ) : null}
                    {provider.canManage && provider.source !== "openwork" ? (
                        <>
                            <Link
                                href={getEditLlmProviderRoute(
                                    orgSlug,
                                    provider.id,
                                )}
                            >
                                <DenButton variant="secondary">
                                    编辑提供商
                                </DenButton>
                            </Link>
                            <DenButton
                                variant="destructive"
                                loading={deleteBusy}
                                onClick={() => void deleteProvider()}
                            >
                                <Trash2 className="h-4 w-4" />
                                删除
                            </DenButton>
                        </>
                    ) : null}
                </div>
            </div>

            {gatewayEnabled && provider.source === "models_dev" && provider.credentialMode === "per_member" ? (
                <DenNotice className="mb-6" tone="info" message="每人独立密钥的提供商无法迁移到网关，个人凭据保持不变。请单独创建网关提供商；目前仅 Google Vertex 支持成员登录。" />
            ) : null}
            {deleteError ? (
                <div className="mb-6 rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[14px] text-red-700">
                    {deleteError}
                </div>
            ) : null}
            {gatewayEnabled && migrateError ? (
                <div className="mb-6 rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[14px] text-red-700">
                    {migrateError}
                </div>
            ) : null}

            {gatewayEnabled && confirmingMigrate ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/30 px-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="move-to-gateway-title"
                >
                    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
                        <h2 id="move-to-gateway-title" className="text-[18px] font-semibold text-gray-950">
                            将“{provider.name}”迁移到 OpenWork 网关？
                        </h2>
                        <p className="mt-2 text-[13px] leading-5 text-gray-500">
                            已保存凭据将迁移到 OpenWork 服务器，不再发送至设备。成员保留相同模型与访问权限，使用自己的 OpenWork 密钥通过网关调用。桌面应用会自动同步，此提供商将从“使用自有密钥”中移除。若设置或凭据无法安全转换，迁移将被拒绝，原提供商保持不变。
                        </p>
                        {migrateError ? (
                            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                                {migrateError}
                            </p>
                        ) : null}
                        <div className="mt-6 flex justify-end gap-2">
                            <DenButton variant="secondary" onClick={() => setConfirmingMigrate(false)}>
                                取消
                            </DenButton>
                            <DenButton
                                data-testid="llm-provider-move-to-gateway-confirm"
                                loading={migrateBusy}
                                onClick={() => void moveToGateway()}
                            >
                                迁移到网关
                            </DenButton>
                        </div>
                    </div>
                </div>
            ) : null}

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                            提供商配置
                        </h2>
                    </div>

                    {provider.configRedacted ? null : (
                        <div
                            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium ${provider.hasApiKey ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                        >
                            <KeyRound className="h-4 w-4" />
                            {provider.hasApiKey
                                ? "凭据已保存"
                                : "缺少凭据"}
                        </div>
                    )}
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            提供商 ID
                        </p>
                        <p className="mt-3 text-[16px] font-medium text-gray-900">
                            {provider.providerId}
                        </p>
                    </div>
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            NPM 软件包
                        </p>
                        <p className="mt-3 text-[16px] font-medium text-gray-900">
                            {npmPackage ?? "未设置"}
                        </p>
                    </div>
                    {provider.configRedacted ? null : (
                        <div className="rounded-[24px] bg-gray-50 p-5">
                            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                                API 基础地址
                            </p>
                            <p className="mt-3 break-all text-[16px] font-medium text-gray-900">
                                {apiBase ?? "未设置"}
                            </p>
                        </div>
                    )}
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            已更新
                        </p>
                        <p className="mt-3 text-[16px] font-medium text-gray-900">
                            {formatProviderTimestamp(provider.updatedAt)}
                        </p>
                    </div>
                </div>

                {provider.configRedacted ? (
                    <p data-testid="llm-provider-details-hidden" className="mt-6 rounded-[20px] bg-gray-50 px-5 py-4 text-[14px] text-gray-600">
                        {LLM_PROVIDER_DETAILS_HIDDEN_MESSAGE}
                    </p>
                ) : (
                    <div className="mt-6 flex flex-wrap gap-2">
                        {envKeys.map((envKey) => (
                            <RuntimeEnvKeyChip
                                key={envKey.declared}
                                envKey={envKey}
                                className="rounded-full bg-gray-100 px-3 py-1 font-mono text-[12px] font-medium text-gray-600"
                            />
                        ))}
                        {docUrl ? (
                            <a
                                href={docUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-600 transition hover:bg-gray-200"
                            >
                                文档
                                <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        ) : null}
                    </div>
                )}
            </section>

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                            已选模型
                        </h2>
                    </div>
                    <div className="rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600">
                        {formatCountLabel(
                            provider.models.length,
                            "个模型",
                            "个模型",
                        )}
                    </div>
                </div>

                <div className="mt-8 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                    {provider.models.map((model) => {
                        const limitLabel = getLimitLabel(model.config);
                        return (
                            <div
                                key={model.id}
                                className="rounded-[24px] border border-gray-200 bg-gray-50 p-5"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[17px] font-semibold tracking-[-0.03em] text-gray-950">
                                            {model.name}
                                        </p>
                                        <p className="mt-1 text-[13px] text-gray-500">
                                            {model.id}
                                        </p>
                                    </div>
                                    {limitLabel ? (
                                        <span className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-gray-600">
                                            {limitLabel}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                            访问权限
                        </h2>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-600">
                        <Users className="h-4 w-4" />
                        {provider.access.allMembers
                            ? "所有人"
                            : `${provider.access.memberCount + provider.access.teams.length} 项授权`}
                    </div>
                </div>

                {provider.access.allMembers ? (
                    <p className="mt-6 rounded-[20px] bg-gray-50 px-5 py-4 text-[14px] text-gray-600">
                        组织中的所有人均可使用此提供商，包括之后加入的成员。
                    </p>
                ) : null}

                <div className="mt-8 grid gap-6 xl:grid-cols-2">
                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            人员
                        </p>
                        <div className="mt-4 grid gap-3">
                            {provider.access.membersHidden ? (
                                <p data-testid="llm-provider-members-hidden" className="text-[14px] text-gray-500">
                                    {`${provider.access.memberCount} 人. ${LLM_PROVIDER_MEMBERS_HIDDEN_MESSAGE}`}
                                </p>
                            ) : provider.access.members.length === 0 ? (
                                <p className="text-[14px] text-gray-500">
                                    尚未向人员直接授予访问权限。
                                </p>
                            ) : (
                                provider.access.members.map((member) => (
                                    <div
                                        key={member.id}
                                        className="rounded-[18px] border border-gray-200 bg-white px-4 py-3"
                                    >
                                        <p className="text-[15px] font-medium text-gray-900">
                                            {member.user.name}
                                        </p>
                                        <p className="mt-1 text-[13px] text-gray-500">
                                            {member.user.email}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="rounded-[24px] bg-gray-50 p-5">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            团队
                        </p>
                        <div className="mt-4 grid gap-3">
                            {provider.access.teams.length === 0 ? (
                                <p className="text-[14px] text-gray-500">
                                    尚未向团队授予访问权限。
                                </p>
                            ) : (
                                provider.access.teams.map((team) => (
                                    <div
                                        key={team.id}
                                        className="rounded-[18px] border border-gray-200 bg-white px-4 py-3"
                                    >
                                        <p className="text-[15px] font-medium text-gray-900">
                                            {team.name}
                                        </p>
                                        <p className="mt-1 text-[13px] text-gray-500">
                                            已更新{" "}
                                            {formatProviderTimestamp(
                                                team.updatedAt,
                                            )}
                                        </p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {provider.source === "custom" && !provider.configRedacted ? (
                <section className="rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                    <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                        自定义提供商配置
                    </h2>
                    <p className="mt-2 text-[15px] text-gray-500">
                        为此自定义来源保存的原始提供商配置。
                    </p>
                    <pre className="mt-6 overflow-x-auto rounded-[24px] bg-[#0f172a] p-5 text-[13px] leading-6 text-slate-100">
                        {JSON.stringify(provider.providerConfig, null, 2)}
                    </pre>
                </section>
            ) : null}
        </div>
    );
}
