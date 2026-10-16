"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { getRequestError, isReauthRequiredError, requestJson } from "../../_lib/den-flow";
import {
    getOrgAccessFlags,
    parseOrgApiKeysPayload,
    type DenOrgApiKey,
    permissionLockReason,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

function formatDateTime(value: string | null) {
    if (!value) {
        return "从未";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "从未";
    }

    return date.toLocaleString(DEFAULT_DEN_LOCALE);
}

function formatKeyPreview(apiKey: DenOrgApiKey) {
    if (apiKey.start) {
        return `${apiKey.start}...`;
    }

    if (apiKey.prefix) {
        return `${apiKey.prefix}${apiKey.id.slice(0, 6)}...`;
    }

    return `${apiKey.id.slice(0, 6)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getCreatedKey(payload: unknown) {
    if (!isRecord(payload) || typeof payload.key !== "string") {
        return null;
    }

    return payload.key;
}

export function ApiKeysScreen() {
    const { orgId, orgContext, runReauthableAction } = useOrgDashboard();
    const [apiKeys, setApiKeys] = useState<DenOrgApiKey[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createdKey, setCreatedKey] = useState<string | null>(null);
    const [createdKeyName, setCreatedKeyName] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const access = useMemo(
        () =>
            getOrgAccessFlags(
                orgContext?.currentMember.role ?? "member",
                orgContext?.currentMember.isOwner ?? false,
                orgContext?.currentMember.permissions,
            ),
        [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.currentMember.permissions],
    );

    async function loadApiKeys(isCurrent = () => true) {
        if (!orgId || !access.canViewApiKeys) {
            if (isCurrent()) {
                setApiKeys([]);
            }
            return;
        }

        if (isCurrent()) {
            setBusy(true);
            setError(null);
        }
        try {
            const { response, payload } = await requestJson(
                `/v1/api-keys`,
                { method: "GET" },
                12000,
            );
            if (!response.ok) {
                throw getRequestError(payload, response, `无法加载 API 密钥（${response.status}）。`);
            }

            if (isCurrent()) {
                setApiKeys(parseOrgApiKeysPayload(payload));
            }
        } catch (nextError) {
            if (isReauthRequiredError(nextError)) {
                throw nextError;
            }

            if (isCurrent()) {
                setError(
                    nextError instanceof Error
                        ? nextError.message
                        : "无法加载 API 密钥，请重试。",
                );
            }
        } finally {
            if (isCurrent()) {
                setBusy(false);
            }
        }
    }

    useEffect(() => {
        let active = true;
        void runReauthableAction("load-api-keys", () => loadApiKeys(() => active)).catch((nextError) => {
            if (active) {
                setError(
                    nextError instanceof Error
                        ? nextError.message
                        : "无法加载 API 密钥，请重试。",
                );
            }
        });
        return () => {
            active = false;
        };
    }, [orgId, access.canViewApiKeys]);

    useEffect(() => {
        if (!copied) {
            return;
        }

        const timeout = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timeout);
    }, [copied]);

    async function handleCreate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!orgId) {
            setError("未找到组织。");
            return;
        }
        if (!access.canManageApiKeys) {
            setError("你没有创建 API 密钥的权限。");
            return;
        }

        setError(null);
        setCreatedKey(null);
        setCreatedKeyName(null);
        setCopied(false);
        try {
            await runReauthableAction("create-api-key", async () => {
                setCreating(true);
                try {
                    const { response, payload } = await requestJson(
                        `/v1/api-keys`,
                        {
                            method: "POST",
                            body: JSON.stringify({ name }),
                        },
                        12000,
                    );

                    if (!response.ok) {
                        throw getRequestError(
                            payload,
                            response,
                            `无法创建 API 密钥（${response.status}）。`,
                        );
                    }

                    const nextKey = getCreatedKey(payload);
                    if (!nextKey) {
                        throw new Error(
                            "API 密钥已创建，但未返回密钥内容，请重试。",
                        );
                    }

                    setCreatedKey(nextKey);
                    setCreatedKeyName(name);
                    setName("");
                    setShowCreateForm(false);
                    await loadApiKeys();
                } finally {
                    setCreating(false);
                }
            });
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : "创建 API 密钥失败，请重试。",
            );
        }
    }

    function openCreateForm() {
        if (!access.canManageApiKeys) {
            setError("你没有创建 API 密钥的权限。");
            return;
        }

        setError(null);
        setCopied(false);
        setCreatedKey(null);
        setCreatedKeyName(null);
        setName("");
        setShowCreateForm(true);
    }

    function closeCreateForm() {
        setName("");
        setShowCreateForm(false);
    }

    async function handleDelete(apiKey: DenOrgApiKey) {
        if (!access.canManageApiKeys) {
            setError("你没有删除 API 密钥的权限。");
            return;
        }

        if (
            !orgId ||
            !window.confirm(
                `删除 ${apiKey.name ?? apiKey.start ?? "此 API 密钥"}？此操作无法撤销。`,
            )
        ) {
            return;
        }

        setError(null);
        try {
            await runReauthableAction("delete-api-key", async () => {
                setDeletingId(apiKey.id);
                try {
                    const { response, payload } = await requestJson(
                        `/v1/api-keys/${encodeURIComponent(apiKey.id)}`,
                        { method: "DELETE" },
                        12000,
                    );

                    if (response.status !== 204 && !response.ok) {
                        throw getRequestError(
                            payload,
                            response,
                            `无法删除 API 密钥（${response.status}）。`,
                        );
                    }

                    await loadApiKeys();
                } finally {
                    setDeletingId(null);
                }
            });
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : "删除 API 密钥失败，请重试。",
            );
        }
    }

    async function copyCreatedKey() {
        if (!createdKey) {
            return;
        }

        try {
            await navigator.clipboard.writeText(createdKey);
            setCopied(true);
        } catch {
            setError(
                "无法复制 API 密钥，请在离开页面前手动复制。",
            );
        }
    }

    if (!orgContext) {
        return (
            <DashboardPageTemplate
                icon={KeyRound}
                title="API 密钥"
                description="为自己创建带名称与速率限制的组织 API 密钥，并在需要时撤销工作区中的密钥。"
            >
                <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
                    正在加载组织信息…
                </div>
            </DashboardPageTemplate>
        );
    }

    return (
        <DashboardPageTemplate
            icon={KeyRound}
            title="API 密钥"
            description="管理 OpenWork API 密钥。"
        >
            {!access.canViewApiKeys ? (
                <div className="rounded-[28px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-6 py-5 text-[14px] text-[var(--dls-text-primary)]">
                    {permissionLockReason("api_keys.view")}
                </div>
            ) : (
                <>
                    {error ? (
                        <DenNotice message={error} className="mb-6" />
                    ) : null}

                    {!access.canManageApiKeys ? (
                        <div className="mb-6 rounded-[24px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-5 py-4 text-[14px] text-[var(--dls-text-primary)]">
                            {`只读。${permissionLockReason("api_keys.manage")}`}
                        </div>
                    ) : null}

                    <DenCard className="mb-6">
                        {createdKey && access.canManageApiKeys ? (
                            <div className="rounded-[24px] bg-[#0f172a] p-6 text-white">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[16px] font-semibold tracking-[-0.03em]">
                                            {createdKeyName
                                                ? `${createdKeyName} 已就绪`
                                                : "新的 API 密钥已就绪"}
                                        </p>
                                        <p className="mt-1 text-[14px] leading-6 text-slate-300">
                                            密钥仅显示一次。
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-5 rounded-[20px] border border-white/10 bg-white/5 p-4">
                                    <code className="block break-all text-[13px] leading-6 text-emerald-200">
                                        {createdKey}
                                    </code>
                                </div>

                                <div className="mt-5 flex flex-wrap justify-end gap-3">
                                    <DenButton
                                        variant="secondary"
                                        icon={Copy}
                                        onClick={() => void copyCreatedKey()}
                                    >
                                        {copied ? "已复制" : "复制密钥"}
                                    </DenButton>
                                    <DenButton onClick={openCreateForm}>
                                        创建其他密钥
                                    </DenButton>
                                </div>
                            </div>
                        ) : showCreateForm && access.canManageApiKeys ? (
                            <form onSubmit={handleCreate}>
                                <div className="mb-5 flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                                            签发新密钥
                                        </p>
                                        <p className="mt-1 text-[14px] leading-6 text-gray-500">
                                            密钥仅签发给你本人，并仅用于此组织。
                                        </p>
                                    </div>
                                </div>

                                <label className="grid gap-3">
                                    <span className="text-[14px] font-medium text-gray-700">
                                        密钥名称
                                    </span>
                                    <DenInput
                                        type="text"
                                        value={name}
                                        onChange={(event) =>
                                            setName(event.target.value)
                                        }
                                        placeholder="CI 工作实例"
                                        required
                                    />
                                </label>

                                <div className="mt-5 flex flex-wrap justify-end gap-3">
                                    <DenButton
                                        type="button"
                                        variant="secondary"
                                        onClick={closeCreateForm}
                                    >
                                        取消
                                    </DenButton>
                                    <DenButton type="submit" loading={creating}>
                                        创建 API 密钥
                                    </DenButton>
                                </div>
                            </form>
                        ) : (
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <p className="text-[16px] font-semibold tracking-[-0.03em] text-gray-900">
                                        创建新的 API 密钥
                                    </p>
                                </div>
                                 <DenButton onClick={openCreateForm} disabled={!access.canManageApiKeys}>
                                    新建密钥
                                </DenButton>
                            </div>
                        )}
                    </DenCard>

                    <div className="overflow-hidden rounded-[28px] border border-gray-100 bg-white">
                        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_180px_120px] gap-4 border-b border-gray-100 px-6 py-3 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                            <span>名称</span>
                            <span>所有者</span>
                            <span>上次使用</span>
                            <span />
                        </div>

                        {busy ? (
                            <div className="px-6 py-8 text-center text-[13px] text-gray-400">
                                正在加载 API 密钥…
                            </div>
                        ) : apiKeys.length === 0 ? (
                            <div className="px-6 py-8 text-center text-[13px] text-gray-400">
                                此工作区暂无 API 密钥。
                            </div>
                        ) : (
                            apiKeys.map((apiKey) => (
                                <div
                                    key={apiKey.id}
                                    className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_180px_120px] items-center gap-4 border-b border-gray-100 px-6 py-4 transition hover:bg-gray-50/70 last:border-b-0"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-[14px] font-medium text-gray-900">
                                            {apiKey.name ??
                                                apiKey.start ??
                                                "未命名密钥"}
                                        </p>
                                        <p className="mt-1 truncate text-[12px] text-gray-400">
                                            {formatKeyPreview(apiKey)}{" "}
                                            {formatDateTime(apiKey.createdAt)}
                                        </p>
                                    </div>

                                    <div className="min-w-0">
                                        <p className="truncate text-[13px] font-medium text-gray-900">
                                            {apiKey.owner.name}
                                        </p>
                                        <p className="truncate text-[12px] text-gray-400">
                                            {apiKey.owner.email}
                                        </p>
                                    </div>

                                    <span className="text-[13px] text-gray-500">
                                        {formatDateTime(apiKey.lastRequest)}
                                    </span>

                                    <div className="flex justify-end">
                                        <DenButton
                                            variant="destructive"
                                            size="sm"
                                            icon={Trash2}
                                            onClick={() =>
                                                void handleDelete(apiKey)
                                            }
                                            disabled={!access.canManageApiKeys || deletingId === apiKey.id}
                                        >
                                            {deletingId === apiKey.id
                                                ? "正在删除…"
                                                : "删除"}
                                        </DenButton>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
        </DashboardPageTemplate>
    );
}
