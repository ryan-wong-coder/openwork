"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowLeft,
    CodeXml,
    Cpu,
    Search,
} from "lucide-react";
import { DenAutoNameField } from "../../_components/ui/auto-name-field";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenButton } from "../../_components/ui/button";
import { DenCombobox } from "../../_components/ui/combobox";
import { DenInput } from "../../_components/ui/input";
import { DenSecretInput } from "../../_components/ui/secret-input";
import { DenSelectableRow } from "../../_components/ui/selectable-row";
import { DenStickyActionBar } from "../../_components/ui/sticky-action-bar";
import { UnderlineTabs } from "../../_components/ui/tabs";
import { DenTextarea } from "../../_components/ui/textarea";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import {
    getLlmProviderRoute,
    getLlmProvidersRoute,
    orgFeatureEnabled,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
    buildGuidedCustomProviderConfig,
    buildGuidedProviderEnvName,
    normalizeAzureResourceNameInput,
    parseGuidedModelIds,
    readEnvNamesFromCustomProviderText,
    readGuidedCustomProviderFields,
    readGuidedCustomProviderFieldsFromText,
    slugifyProviderId,
    validateGuidedCustomProvider,
} from "./llm-provider-guided";
import {
    buildCustomProviderTemplate,
    buildEditableCustomProviderText,
    getProviderApiBase,
    requestLlmProviderTestConnection,
    type LlmProviderModelVerification,
    type LlmProviderProbeResult,
    getProviderDocUrl,
    getProviderEnvNames,
    getProviderIconSlug,
    getProviderNpmPackage,
    requestLlmProviderCatalog,
    requestLlmProviderCatalogDetail,
    useOrgLlmProviders,
    type DenLlmProvider,
    type DenModelsDevProviderDetail,
    type DenModelsDevProviderSummary,
} from "./llm-provider-data";
import { isGatewayOnlyNpm } from "./inference-provider-request";
import { StructuredConfigEditor } from "./structured-config-editor";
import { structuredProviderModelCount } from "./structured-config-value";
import { RuntimeEnvKeyChip, RuntimeEnvKeyNote, resolveRuntimeEnvKeys } from "./runtime-env-key";
import {
    buildCatalogProviderOptions,
    ProviderAccessPicker,
    ProviderModelPicker,
} from "./llm-provider-pickers";

const SOURCE_TABS = [
    { value: "models_dev" as const, label: "目录提供商", icon: Cpu },
    { value: "custom" as const, label: "自定义提供商", icon: CodeXml },
];

type EditableLlmProviderSource = (typeof SOURCE_TABS)[number]["value"];

function getLockMemberId(
    provider: DenLlmProvider | null,
    currentMemberId: string | null,
) {
    return provider?.createdByOrgMembershipId ?? currentMemberId;
}

export function LlmProviderEditorScreen({
    llmProviderId,
}: {
    llmProviderId?: string;
}) {
    const router = useRouter();
    const { orgId, orgSlug, orgContext, runReauthableAction } = useOrgDashboard();
    const visualConfiguration = orgFeatureEnabled(orgContext, "visualConfiguration");
    const { llmProviders, busy, error, reloadProviders } =
        useOrgLlmProviders(orgId);
    const provider = useMemo(
        () =>
            llmProviderId
                ? (llmProviders.find((entry) => entry.id === llmProviderId) ??
                  null)
                : null,
        [llmProviderId, llmProviders],
    );
    const [source, setSource] = useState<EditableLlmProviderSource>("models_dev");
    const [catalogProviders, setCatalogProviders] = useState<
        DenModelsDevProviderSummary[]
    >([]);
    const [catalogBusy, setCatalogBusy] = useState(false);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [catalogDetail, setCatalogDetail] =
        useState<DenModelsDevProviderDetail | null>(null);
    const [detailBusy, setDetailBusy] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [providerName, setProviderName] = useState("");
    // False while the name still tracks the automatic "<Provider> — key N"
    // value; any manual rename flips it permanently (clearing reverts).
    const [nameTouched, setNameTouched] = useState(false);
    const [allMembers, setAllMembers] = useState(false);
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [customConfigText, setCustomConfigText] = useState(
        buildCustomProviderTemplate(),
    );
    const [customMode, setCustomMode] = useState<"form" | "json">("form");
    const [customProviderId, setCustomProviderId] = useState("");
    const [customProviderIdTouched, setCustomProviderIdTouched] = useState(false);
    const [customBaseUrl, setCustomBaseUrl] = useState("");
    const [customModelsText, setCustomModelsText] = useState("");
    const [customEnvNames, setCustomEnvNames] = useState<string[]>([]);
    const [customJsonHint, setCustomJsonHint] = useState<string | null>(null);
    const [structuredConfigValid, setStructuredConfigValid] = useState(true);
    const [probeState, setProbeState] = useState<"idle" | "probing" | "ok" | "failed">("idle");
    const [probeResult, setProbeResult] = useState<LlmProviderProbeResult | null>(null);
    const [selectedCustomModelIds, setSelectedCustomModelIds] = useState<string[]>([]);
    const [customModelQuery, setCustomModelQuery] = useState("");
    const [customManualModels, setCustomManualModels] = useState(false);
    const lastProbeKeyRef = useRef("");
    // Azure catalog providers: once resource name + key are present, the
    // resource is asked for its deployments and those become the only
    // pickable models (the models.dev list is ignored).
    const [azureProbeState, setAzureProbeState] = useState<"idle" | "probing" | "ok" | "failed">("idle");
    const [azureProbeResult, setAzureProbeResult] = useState<LlmProviderProbeResult | null>(null);
    const lastAzureProbeKeyRef = useRef("");
    const [apiKey, setApiKey] = useState("");
    const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
    const [saveBusy, setSaveBusy] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [verifyBusy, setVerifyBusy] = useState(false);
    const [verifyFailures, setVerifyFailures] = useState<LlmProviderModelVerification[]>([]);
    // Verification outcome for the exact inputs it ran against, so a second
    // click ("仍然保存") does not re-run completions.
    const verifiedRef = useRef<{ key: string; npm: string } | null>(null);

    useEffect(() => {
        if (!orgId) {
            setCatalogProviders([]);
            return;
        }

        let canceled = false;
        setCatalogBusy(true);
        setCatalogError(null);
        void requestLlmProviderCatalog(orgId)
            .then((providers) => {
                if (!canceled) {
                    setCatalogProviders(providers.filter((provider) => !isGatewayOnlyNpm(provider.npm, provider.id)));
                }
            })
            .catch((loadError) => {
                if (!canceled) {
                    setCatalogError(
                        loadError instanceof Error
                            ? loadError.message
                            : "无法加载提供商目录，请重试。",
                    );
                }
            })
            .finally(() => {
                if (!canceled) {
                    setCatalogBusy(false);
                }
            });

        return () => {
            canceled = true;
        };
    }, [orgId]);

    useEffect(() => {
        if (provider) {
            setSource(provider.source === "custom" ? "custom" : "models_dev");
            setSelectedProviderId(provider.providerId);
            setProviderName(provider.name);
            setNameTouched(true);
            setAllMembers(provider.access.allMembers);
            setSelectedModelIds(provider.models.map((entry) => entry.id));
            setSelectedMemberIds(
                provider.access.members.map((entry) => entry.orgMembershipId),
            );
            setSelectedTeamIds(
                provider.access.teams.map((entry) => entry.teamId),
            );
            setCustomConfigText(
                provider.source === "custom"
                    ? buildEditableCustomProviderText(provider)
                    : buildCustomProviderTemplate(),
            );
            if (provider.source === "custom") {
                // Reopen simple configs in the guided form; anything richer
                // (per-model metadata, custom npm, provider options) opens in
                // the JSON editor so no data is dropped.
                const guided = readGuidedCustomProviderFields({
                    ...provider.providerConfig,
                    models: provider.models.map((entry) => entry.config),
                });
                if (guided) {
                    setCustomMode("form");
                    setCustomProviderId(guided.providerId);
                    setCustomProviderIdTouched(true);
                    setCustomBaseUrl(guided.baseUrl);
                    setCustomModelsText(guided.modelIds.join("\n"));
                    setCustomEnvNames(guided.envNames);
                } else {
                    setCustomMode("json");
                }
            }
            setCustomJsonHint(null);
            setApiKey("");
            setApiKeyValues({});
            return;
        }

        setSource("models_dev");
        setSelectedProviderId("");
        setProviderName("");
        setNameTouched(false);
        setAllMembers(false);
        setSelectedModelIds([]);
        setSelectedMemberIds(
            orgContext?.currentMember.id ? [orgContext.currentMember.id] : [],
        );
        setSelectedTeamIds([]);
        setCustomConfigText(buildCustomProviderTemplate());
        setCustomMode("form");
        setCustomProviderId("");
        setCustomProviderIdTouched(false);
        setCustomBaseUrl("");
        setCustomModelsText("");
        setCustomEnvNames([]);
        setCustomJsonHint(null);
        setApiKey("");
        setApiKeyValues({});
    }, [orgContext?.currentMember.id, provider]);

    useEffect(() => {
        if (source !== "models_dev" || !orgId || !selectedProviderId) {
            setCatalogDetail(null);
            setDetailError(null);
            setDetailBusy(false);
            return;
        }

        let canceled = false;
        setDetailBusy(true);
        setDetailError(null);
        void requestLlmProviderCatalogDetail(orgId, selectedProviderId)
            .then((detail) => {
                if (!canceled) {
                    setCatalogDetail(detail);
                    setSelectedModelIds((current) =>
                        current.filter((entry) =>
                            detail.models.some((model) => model.id === entry),
                        ),
                    );
                }
            })
            .catch((loadError) => {
                if (!canceled) {
                    setCatalogDetail(null);
                    setDetailError(
                        loadError instanceof Error
                            ? loadError.message
                            : "无法加载提供商详情，请重试。",
                    );
                }
            })
            .finally(() => {
                if (!canceled) {
                    setDetailBusy(false);
                }
            });

        return () => {
            canceled = true;
        };
    }, [orgId, selectedProviderId, source]);

    const currentMemberId = orgContext?.currentMember.id ?? null;
    const lockedMemberId = getLockMemberId(provider, currentMemberId);

    // Azure catalog providers: models.dev lists the whole Azure catalog, but
    // chat/completions only accepts the *deployments* on the admin's
    // resource. Read resource name + key from the credential inputs and ask
    // the resource what it serves.
    const isAzureCatalog =
        source === "models_dev" &&
        catalogDetail !== null &&
        getProviderNpmPackage(catalogDetail.config) === "@ai-sdk/azure";
    const azureCatalogEnvNames = isAzureCatalog
        ? getProviderEnvNames(catalogDetail.config)
        : [];
    const azureResourceEnv =
        azureCatalogEnvNames.find((name) => name.includes("RESOURCE_NAME")) ?? null;
    const azureKeyEnv =
        azureCatalogEnvNames.find((name) => name !== azureResourceEnv) ?? null;
    const azureResourceName = azureResourceEnv
        ? (apiKeyValues[azureResourceEnv] ?? "").trim()
        : "";
    const azureApiKey = azureKeyEnv ? (apiKeyValues[azureKeyEnv] ?? "").trim() : "";

    useEffect(() => {
        if (!isAzureCatalog) {
            setAzureProbeState("idle");
            setAzureProbeResult(null);
            lastAzureProbeKeyRef.current = "";
            return;
        }
        if (
            !azureResourceName ||
            !azureApiKey ||
            !/^[a-z0-9][a-z0-9.-]*$/i.test(azureResourceName)
        ) {
            setAzureProbeState("idle");
            setAzureProbeResult(null);
            return;
        }
        const probeKey = `${azureResourceName}::${azureApiKey}`;
        if (lastAzureProbeKeyRef.current === probeKey) return;
        const timer = window.setTimeout(() => {
            lastAzureProbeKeyRef.current = probeKey;
            setAzureProbeState("probing");
            requestLlmProviderTestConnection({
                api: `https://${azureResourceName}.openai.azure.com`,
                apiKey: azureApiKey,
            })
                .then((result) => {
                    if (lastAzureProbeKeyRef.current !== probeKey) return;
                    setAzureProbeResult(result);
                    setAzureProbeState(result.ok ? "ok" : "failed");
                    if (result.ok) {
                        // Drop selections the resource does not actually serve.
                        setSelectedModelIds((current) =>
                            current.filter((id) =>
                                result.models.some((model) => model.id === id),
                            ),
                        );
                    }
                })
                .catch(() => {
                    if (lastAzureProbeKeyRef.current !== probeKey) return;
                    setAzureProbeResult(null);
                    setAzureProbeState("failed");
                });
        }, 700);
        return () => window.clearTimeout(timer);
    }, [isAzureCatalog, azureResourceName, azureApiKey]);

    // The models offered for a catalog provider: the resource's real
    // deployments when the Azure probe succeeded, models.dev otherwise.
    const catalogModelOptions = useMemo(() => {
        if (isAzureCatalog && azureProbeState === "ok" && azureProbeResult) {
            return azureProbeResult.models.map((model) => ({
                id: model.id,
                name: model.id,
                config: {},
            }));
        }
        return catalogDetail?.models ?? [];
    }, [isAzureCatalog, azureProbeState, azureProbeResult, catalogDetail?.models]);

    const catalogProviderOptions = useMemo(
        () => buildCatalogProviderOptions(catalogProviders),
        [catalogProviders],
    );

    // The provider id only derives from the name once the admin actually
    // typed a name — the automatic "<Provider> — key N" value is not a slug
    // source, otherwise the two fields would derive from each other.
    const resolvedCustomProviderId = customProviderIdTouched
        ? customProviderId.trim()
        : nameTouched
          ? slugifyProviderId(providerName)
          : "";

    // Automatic name: "<Provider> — key N", where N counts this org's other
    // keys for the same provider. Manual renames win until cleared.
    const customHostName = (() => {
        try {
            return new URL(customBaseUrl.trim()).hostname;
        } catch {
            return "";
        }
    })();
    const autoNameBasis =
        source === "models_dev"
            ? selectedProviderId
                ? (catalogProviders.find((entry) => entry.id === selectedProviderId)?.name ??
                  catalogDetail?.name ??
                  provider?.name ??
                  selectedProviderId)
                : ""
            : customProviderId.trim() || customHostName;
    const autoNameProviderId = source === "models_dev" ? selectedProviderId : resolvedCustomProviderId;
    const keyNumber =
        llmProviders.filter(
            (entry) => entry.id !== provider?.id && entry.providerId === autoNameProviderId,
        ).length + 1;
    const autoName = autoNameBasis ? `${autoNameBasis} — key ${keyNumber}` : "";
    const effectiveName = nameTouched && providerName.trim() ? providerName.trim() : autoName;

    // The env var names the selected provider reads. More than one name means
    // the credential section renders one input per env key and saves them as
    // an `apiKeys` map instead of the single legacy `apiKey` string.
    const credentialEnvNames =
        source === "models_dev"
            ? catalogDetail
                ? getProviderEnvNames(catalogDetail.config)
                : provider && provider.source === "models_dev"
                  ? getProviderEnvNames(provider.providerConfig)
                  : []
            : customMode === "form"
              ? customEnvNames.length > 0
                  ? customEnvNames
                  : resolvedCustomProviderId
                    ? [buildGuidedProviderEnvName(resolvedCustomProviderId)]
                    : []
              : readEnvNamesFromCustomProviderText(customConfigText);

    // The credential used to probe/verify the endpoint. Multi-env providers
    // follow the models.dev env[0] convention (same as the desktop client).
    const probeCredential =
        credentialEnvNames.length > 1
            ? (apiKeyValues[credentialEnvNames[0]] ?? "").trim()
            : apiKey.trim();

    // Models used for save/validation: picked from the probed endpoint list
    // when available, or parsed from the manual text fallback.
    const resolvedCustomModelIds =
        probeState === "ok" && !customManualModels
            ? selectedCustomModelIds
            : parseGuidedModelIds(customModelsText);

    const summaryModelCount =
        source === "models_dev" ? selectedModelIds.length : customMode === "json" ? structuredProviderModelCount(customConfigText) : resolvedCustomModelIds.length;

    // "仍然保存" stays armed only while the inputs still match the run
    // that produced the failures; any edit re-verifies on the next save.
    const currentVerifyKey = [
        customBaseUrl.trim(),
        probeCredential,
        resolvedCustomModelIds.join(","),
    ].join("::");
    const saveAnywayArmed =
        verifyFailures.length > 0 && verifiedRef.current?.key === currentVerifyKey;

    // Probe the endpoint as soon as base URL + key are present (debounced):
    // heals common URL mistakes and loads the models the endpoint actually
    // serves, so users pick deployments instead of guessing ids.
    useEffect(() => {
        if (source !== "custom" || customMode !== "form") return;
        const api = customBaseUrl.trim();
        const key = probeCredential;
        if (!api || !key) {
            setProbeState("idle");
            setProbeResult(null);
            return;
        }
        const probeKey = `${api}::${key}`;
        if (lastProbeKeyRef.current === probeKey) return;
        const timer = window.setTimeout(() => {
            lastProbeKeyRef.current = probeKey;
            setProbeState("probing");
            requestLlmProviderTestConnection({ api, apiKey: key })
                .then((result) => {
                    if (lastProbeKeyRef.current !== probeKey) return;
                    setProbeResult(result);
                    setProbeState(result.ok ? "ok" : "failed");
                    if (result.ok) {
                        if (result.normalizedApi && result.normalizedApi !== api) {
                            // Pre-mark the healed URL as probed so updating the
                            // field does not schedule a redundant probe.
                            lastProbeKeyRef.current = `${result.normalizedApi}::${key}`;
                            setCustomBaseUrl(result.normalizedApi);
                        }
                        // Keep previously chosen/stored ids selected when they
                        // still exist on the endpoint.
                        setSelectedCustomModelIds((current) => {
                            const base = current.length
                                ? current
                                : parseGuidedModelIds(customModelsText);
                            return base.filter((id) =>
                                result.models.some((model) => model.id === id),
                            );
                        });
                    }
                })
                .catch(() => {
                    if (lastProbeKeyRef.current !== probeKey) return;
                    setProbeResult(null);
                    setProbeState("failed");
                });
        }, 700);
        return () => window.clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- probe on endpoint/key edits only
    }, [source, customMode, customBaseUrl, probeCredential]);

    const filteredProbeModels = useMemo(() => {
        const models = probeResult?.models ?? [];
        const query = customModelQuery.trim().toLowerCase();
        if (!query) return models;
        return models.filter((model) => model.id.toLowerCase().includes(query));
    }, [customModelQuery, probeResult?.models]);

    function switchCustomModeToJson() {
        const modelIds = resolvedCustomModelIds;
        if (visualConfiguration || !validateGuidedCustomProvider({
            providerId: resolvedCustomProviderId,
            baseUrl: customBaseUrl,
            modelIds,
        })) {
            setCustomConfigText(
                JSON.stringify(
                    buildGuidedCustomProviderConfig({
                        providerId: resolvedCustomProviderId,
                        name: effectiveName,
                        baseUrl: customBaseUrl,
                        modelIds,
                        envNames: customEnvNames,
                    }),
                    null,
                    2,
                ),
            );
        }
        setCustomJsonHint(null);
        setCustomMode("json");
    }

    function switchCustomModeToForm() {
        const guided = readGuidedCustomProviderFieldsFromText(customConfigText);
        if (!guided) {
            setCustomJsonHint(
                visualConfiguration ? "此提供商包含额外参数，请继续使用高级选项以保留全部设置。" : "此配置包含表单暂不支持的高级字段，请继续编辑 JSON。",
            );
            return;
        }
        setCustomProviderId(guided.providerId);
        setCustomProviderIdTouched(true);
        setCustomBaseUrl(guided.baseUrl);
        setCustomModelsText(guided.modelIds.join("\n"));
        setCustomEnvNames(guided.envNames);
        setCustomJsonHint(null);
        setCustomMode("form");
    }

    async function saveProvider() {
        if (!orgId) {
            setSaveError("未找到组织。");
            return;
        }

        if (provider?.source === "openwork") {
            setSaveError("OpenWork 托管提供商由“OpenWork 模型”设置管理。");
            return;
        }

        if (!effectiveName) {
            setSaveError("选择提供商以自动命名密钥，也可自行重命名。");
            return;
        }

        if (source === "models_dev") {
            if (!selectedProviderId) {
                setSaveError("请选择提供商。");
                return;
            }
            if (!selectedModelIds.length) {
                setSaveError("请至少选择一个模型。");
                return;
            }
        }

        if (source === "custom" && customMode === "form") {
            const validationError = validateGuidedCustomProvider({
                providerId: resolvedCustomProviderId,
                baseUrl: customBaseUrl,
                modelIds: resolvedCustomModelIds,
            });
            if (validationError) {
                setSaveError(validationError);
                return;
            }
        }

        if (source === "custom" && customMode === "json" && !customConfigText.trim()) {
            setSaveError("请填写提供商选项。");
            return;
        }
        if (source === "custom" && customMode === "json" && visualConfiguration && !structuredConfigValid) {
            setSaveError("请先修正提供商选项中标出的内容。");
            return;
        }

        // Verify-on-save: run one real completion per picked model. Models
        // that reject max_tokens (GPT-5/o-series on Azure) silently switch
        // the provider to the OpenAI request shape; models that fail both
        // shapes surface a per-model message and require "仍然保存".
        let guidedNpm: string | null = null;
        if (source === "custom" && customMode === "form" && probeCredential) {
            const verifyKey = [
                customBaseUrl.trim(),
                probeCredential,
                resolvedCustomModelIds.join(","),
            ].join("::");
            if (verifiedRef.current?.key === verifyKey) {
                guidedNpm = verifiedRef.current.npm;
            } else {
                setSaveError(null);
                setVerifyBusy(true);
                setSaveBusy(true);
                try {
                    const result = await requestLlmProviderTestConnection({
                        api: customBaseUrl.trim(),
                        apiKey: probeCredential,
                        modelIds: resolvedCustomModelIds,
                    });
                    const verifications = result.verifications;
                    const npm = verifications.some(
                        (entry) => entry.status === "adjusted",
                    )
                        ? "@ai-sdk/openai"
                        : "@ai-sdk/openai-compatible";
                    verifiedRef.current = { key: verifyKey, npm };
                    guidedNpm = npm;
                    const failures = verifications.filter(
                        (entry) => entry.status === "failed",
                    );
                    setVerifyFailures(failures);
                    if (failures.length > 0) {
                        setSaveError(
                            "部分模型未响应测试请求。请修复模型列表，或选择“仍然保存”以保留。",
                        );
                        return;
                    }
                } catch {
                    // Verification is a safety net, not a gate: if the check
                    // itself errors (network, timeout), fall through to save.
                    verifiedRef.current = { key: verifyKey, npm: "@ai-sdk/openai-compatible" };
                    setVerifyFailures([]);
                } finally {
                    setVerifyBusy(false);
                    setSaveBusy(false);
                }
            }
        }

        setSaveError(null);
        try {
            await runReauthableAction("save-llm-provider", async () => {
            setSaveBusy(true);
            const body: Record<string, unknown> = {
                name: effectiveName,
                source,
                allMembers,
                memberIds: allMembers ? [] : [...new Set(selectedMemberIds)],
                teamIds: allMembers ? [] : [...new Set(selectedTeamIds)],
            };

            if (source === "models_dev") {
                body.providerId = selectedProviderId;
                body.modelIds = selectedModelIds;
            } else if (customMode === "form") {
                body.customConfig = buildGuidedCustomProviderConfig({
                    providerId: resolvedCustomProviderId,
                    name: effectiveName,
                    baseUrl: customBaseUrl,
                    modelIds: resolvedCustomModelIds,
                    envNames: customEnvNames,
                    npm: guidedNpm,
                });
            } else {
                body.customConfigText = customConfigText;
            }

            if (credentialEnvNames.length > 1) {
                // Per-env values. Blank inputs are omitted so the server keeps
                // whatever is already stored for those env keys.
                const entries = credentialEnvNames
                    .map((envName) => [envName, (apiKeyValues[envName] ?? "").trim()] as const)
                    .filter(([, value]) => value.length > 0);
                if (entries.length > 0) {
                    body.apiKeys = Object.fromEntries(entries);
                }
            } else if (apiKey.trim() || !provider) {
                body.apiKey = apiKey.trim();
            }

            const path = provider
                ? `/v1/llm-providers/${encodeURIComponent(provider.id)}`
                : `/v1/llm-providers`;
            const method = provider ? "PATCH" : "POST";

            const { response, payload } = await requestJson(
                path,
                {
                    method,
                    body: JSON.stringify(body),
                },
                20000,
            );

            if (!response.ok) {
                throw getRequestError(payload, response, `保存提供商失败（HTTP ${response.status}），请重试。`);
            }

            const nextProvider =
                payload &&
                typeof payload === "object" &&
                payload &&
                "llmProvider" in payload &&
                payload.llmProvider &&
                typeof payload.llmProvider === "object"
                    ? (payload.llmProvider as { id?: unknown })
                    : null;
            const nextProviderId =
                typeof nextProvider?.id === "string"
                    ? nextProvider.id
                    : (provider?.id ?? null);
            if (!nextProviderId) {
                throw new Error(
                    "提供商已保存，但未返回提供商 ID，请刷新后重试。",
                );
            }

            await reloadProviders();
            router.push(getLlmProviderRoute(orgSlug, nextProviderId));
            router.refresh();
            });
        } catch (nextError) {
            setSaveError(
                nextError instanceof Error
                    ? nextError.message
                    : "无法保存提供商，请重试。",
            );
        } finally {
            setSaveBusy(false);
        }
    }

    if (busy && llmProviderId && !provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
                    正在加载提供商详情…
                </div>
            </div>
        );
    }

    if (llmProviderId && !provider) {
        return (
            <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
                <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[15px] text-red-700">
                    {error ?? "未找到此提供商。"}
                </div>
            </div>
        );
    }

    const providerDoc = catalogDetail
        ? getProviderDocUrl(catalogDetail.config)
        : null;
    const providerNpm = catalogDetail
        ? getProviderNpmPackage(catalogDetail.config)
        : null;
    const providerApiBase = catalogDetail
        ? getProviderApiBase(catalogDetail.config)
        : null;
    const providerEnv = catalogDetail
        ? getProviderEnvNames(catalogDetail.config)
        : [];
    // What members' machines will actually read: catalog providers get a
    // provider-specific tag once the row exists; until then it is a placeholder.
    const runtimeEnvKeys = resolveRuntimeEnvKeys({
        declaredEnvNames: providerEnv,
        scoped: source === "models_dev",
        saved: provider !== null && provider.source === "models_dev",
        runtimeEnvKeys: provider?.runtimeEnvKeys ?? [],
    });

    // Credential inputs shared by the standalone Credential section and the
    // guided custom form (where they render inline, before the endpoint).
    const credentialFields = credentialEnvNames.length > 1 ? (
                    <div className="grid gap-6">
                        <p className="text-[14px] text-gray-500">
                            此提供商需要多个环境变量。请分别填写，留空将保留已保存的值。
                        </p>
                        {credentialEnvNames.includes("AZURE_RESOURCE_NAME") ? (
                            <div className="rounded-[22px] border border-sky-100 bg-sky-50 px-5 py-4 text-[13px] leading-6 text-sky-900">
                                <p className="font-semibold">Azure 资源名称</p>
                                <p className="mt-1 text-sky-800">
                                    Azure Foundry 可能显示项目地址，例如{" "}
                                    <code className="rounded-sm bg-white/70 px-1.5 py-0.5 font-mono text-[12px]">
                                        https://yourFoundryResourceName.services.ai.azure.com/api/projects/your-project
                                    </code>
                                    。粘贴完整地址后将仅保存资源名称，例如{" "}
                                    <code className="rounded-sm bg-white/70 px-1.5 py-0.5 font-mono text-[12px]">
                                        yourFoundryResourceName
                                    </code>
                                    .
                                </p>
                            </div>
                        ) : null}
                        {credentialEnvNames.map((envName) => {
                            const configured =
                                provider?.configuredEnvKeys.includes(envName) ??
                                false;
                            const isAzureResourceName = envName === "AZURE_RESOURCE_NAME";
                            return (
                                <label key={envName} className="grid gap-3">
                                    <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-gray-700">
                                        <code className="rounded-sm bg-gray-100 px-2 py-0.5 font-mono text-[12px]">
                                            {envName}
                                        </code>
                                        {configured ? (
                                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                                                已保存
                                            </span>
                                        ) : null}
                                     </span>
                                     {isAzureResourceName ? (
                                        <DenInput
                                            type="text"
                                            value={apiKeyValues[envName] ?? ""}
                                            onChange={(event) =>
                                                setApiKeyValues((current) => ({
                                                    ...current,
                                                    [envName]: normalizeAzureResourceNameInput(event.target.value),
                                                }))
                                            }
                                            placeholder={
                                                configured
                                                    ? "留空以保留当前值"
                                                    : "粘贴资源名称或 Azure Foundry 项目地址"
                                            }
                                        />
                                    ) : (
                                        <DenSecretInput
                                            autoComplete="new-password"
                                            value={apiKeyValues[envName] ?? ""}
                                            onChange={(value) =>
                                                setApiKeyValues((current) => ({
                                                    ...current,
                                                    [envName]: value,
                                                }))
                                            }
                                            saved={configured}
                                            placeholder={`粘贴 ${envName} 的值`}
                                            savedPlaceholder="留空以保留当前值"
                                        />
                                    )}
                                </label>
                            );
                        })}
                    </div>
                ) : (
                    <label className="grid gap-3">
                        <span className="text-[14px] font-medium text-gray-700">
                            API 密钥 / 凭据
                        </span>
                        <DenSecretInput
                            autoComplete="new-password"
                            value={apiKey}
                            onChange={setApiKey}
                            saved={provider?.hasApiKey === true}
                            placeholder="粘贴提供商凭据"
                            savedPlaceholder="留空以保留当前凭据"
                        />
                    </label>
                );

    return (
        <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
            <div className="mb-8 flex flex-col gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                    {provider ? "编辑提供商" : "添加提供商"}
                </p>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                        <h1 className="text-[34px] font-semibold tracking-[-0.07em] text-gray-950">
                            {provider
                                ? (effectiveName || provider.name)
                                : "添加新的模型提供商"}
                        </h1>
                        <p className="mt-3 max-w-[720px] text-[16px] leading-8 text-gray-500">
                            选择提供商、填写凭据，并设置可用模型与使用权限。名称将自动生成。
                        </p>
                    </div>
                </div>
            </div>

            <div className="mb-8 flex items-center justify-between gap-4">
                <Link
                    href={
                        provider
                            ? getLlmProviderRoute(orgSlug, provider.id)
                            : getLlmProvidersRoute(orgSlug)
                    }
                    className="inline-flex items-center gap-2 text-[15px] font-medium text-gray-500 transition hover:text-gray-900"
                >
                    <ArrowLeft className="h-5 w-5" />
                    返回
                </Link>
            </div>

            {saveError ? (
                <div className="mb-6 rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[14px] text-red-700">
                    <p>{saveError}</p>
                    {saveAnywayArmed ? (
                        <ul className="mt-2 grid gap-1">
                            {verifyFailures.map((failure) => (
                                <li key={failure.id}>
                                    <span className="font-medium">{failure.id}</span>
                                    {failure.message ? ` — ${failure.message}` : null}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}

            <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <h2 className="mb-6 text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                    提供商
                </h2>
                <UnderlineTabs
                    tabs={SOURCE_TABS}
                    activeTab={source}
                    onChange={setSource}
                />

                {source === "models_dev" ? (
                    <div className="mt-8 grid gap-6">
                        <div className="grid gap-3">
                            <span className="text-[14px] font-medium text-gray-700">
                                提供商
                            </span>
                            <DenCombobox
                                value={selectedProviderId}
                                options={catalogProviderOptions}
                                onChange={setSelectedProviderId}
                                ariaLabel="提供商"
                                placeholder="选择提供商…"
                                searchPlaceholder="搜索提供商…"
                                emptyLabel="没有匹配的提供商"
                            />
                        </div>

                        {catalogBusy ? (
                            <p className="text-[14px] text-gray-500">
                                正在加载提供商目录…
                            </p>
                        ) : null}
                        {catalogError ? (
                            <p className="text-[14px] text-red-600">
                                {catalogError}
                            </p>
                        ) : null}

                        {detailBusy ? (
                            <p className="text-[14px] text-gray-500">
                                正在加载提供商详情…
                            </p>
                        ) : null}
                        {detailError ? (
                            <p className="text-[14px] text-red-600">
                                {detailError}
                            </p>
                        ) : null}

                        {catalogDetail ? (
                            <div className="rounded-[28px] bg-gray-50 p-6">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <p className="text-[12px] font-semibold uppercase text-gray-400">
                                            NPM 软件包
                                        </p>
                                        <p className="mt-2">
                                            <span className="inline-flex max-w-full rounded-md bg-white px-3 py-1.5 font-mono text-[11px] leading-5 text-gray-700 ring-1 ring-inset ring-gray-200">
                                                {providerNpm ?? "未设置"}
                                            </span>
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[12px] font-semibold uppercase text-gray-400">
                                            API 基础地址
                                        </p>
                                        <p className="mt-2">
                                            <span className="inline-flex max-w-full break-all rounded-md bg-white px-3 py-1.5 font-mono text-[11px] leading-5 text-gray-700 ring-1 ring-inset ring-gray-200">
                                                {providerApiBase ?? "未设置"}
                                            </span>
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[12px] font-semibold uppercase text-gray-400">
                                            环境变量密钥
                                        </p>
                                        {runtimeEnvKeys.length > 0 ? (
                                            <>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {runtimeEnvKeys.map((envKey) => (
                                                        <RuntimeEnvKeyChip
                                                            key={envKey.declared}
                                                            envKey={envKey}
                                                            className="inline-flex max-w-full break-all rounded-md bg-white px-3 py-1.5 font-mono text-[11px] leading-5 text-gray-700 ring-1 ring-inset ring-gray-200"
                                                        />
                                                    ))}
                                                </div>
                                                <RuntimeEnvKeyNote keys={runtimeEnvKeys} />
                                            </>
                                        ) : (
                                            <p className="mt-2">
                                                <span className="inline-flex max-w-full rounded-md bg-white px-3 py-1.5 font-mono text-[11px] leading-5 text-gray-700 ring-1 ring-inset ring-gray-200">
                                                    未列出
                                                </span>
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-[12px] font-semibold uppercase text-gray-400">
                                            文档
                                        </p>
                                        <p className="mt-2">
                                            <span className="inline-flex max-w-full break-all rounded-md bg-white px-3 py-1.5 font-mono text-[11px] leading-5 text-gray-700 ring-1 ring-inset ring-gray-200">
                                                {providerDoc ?? "未设置"}
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : customMode === "form" ? (
                    <div className="mt-8 grid gap-6">
                        <p className="text-[15px] text-gray-500">
                            填写下方选项即可连接兼容 OpenAI API 的端点，包括 Azure AI Foundry、LiteLLM、vLLM 或内部网关。
                        </p>

                        <label className="grid gap-3">
                            <span className="text-[14px] font-medium text-gray-700">
                                提供商 ID
                            </span>
                            <DenInput
                                value={resolvedCustomProviderId}
                                onChange={(event) => {
                                    setCustomProviderId(event.target.value);
                                    setCustomProviderIdTouched(true);
                                }}
                                placeholder="azure-foundry"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </label>
                        <p className="-mt-3 text-[13px] text-gray-500">
                            此提供商的简短标识，将根据名称自动填写。
                        </p>

                        {credentialFields}
                        <p className="-mt-3 text-[13px] text-gray-500">
                            用于立即检查端点，并列出其提供的模型。
                        </p>

                        <label className="grid gap-3">
                            <span className="text-[14px] font-medium text-gray-700">
                                基础地址
                            </span>
                            <DenInput
                                value={customBaseUrl}
                                onChange={(event) =>
                                    setCustomBaseUrl(event.target.value)
                                }
                                placeholder="https://my-resource.openai.azure.com/openai/v1"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </label>
                        <p className="-mt-3 text-[13px] text-gray-500">
                            提供商兼容 OpenAI API 的端点（通常以{" "}
                            <code className="rounded-sm bg-gray-100 px-1 py-0.5">
                                /v1
                            </code>
                            结束）。
                        </p>

                        {probeState === "probing" ? (
                            <p className="-mt-2 text-[13px] text-gray-500">
                                正在检查端点…
                            </p>
                        ) : null}
                        {probeState === "ok" && probeResult ? (
                            <p className="-mt-2 text-[13px] text-emerald-700">
                                端点可访问，提供 {probeResult.models.length} 个模型。
                            </p>
                        ) : null}
                        {probeState === "failed" ? (
                            <p className="-mt-2 text-[13px] text-red-600">
                                {probeResult?.hint ?? "无法使用此地址与密钥连接端点，请检查后重试。"}
                            </p>
                        ) : null}
                        {probeState === "idle" && customBaseUrl.trim() && !probeCredential ? (
                            <p className="-mt-2 text-[13px] text-gray-500">
                                在上方输入 API 密钥，以加载此端点提供的模型。
                            </p>
                        ) : null}

                        {probeState === "ok" && probeResult && !customManualModels ? (
                            <div className="grid gap-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-[14px] font-medium text-gray-700">
                                        模型
                                    </span>
                                    <span className="rounded-full bg-gray-200 px-3 py-1 text-[12px] font-medium text-gray-700">
                                        {resolvedCustomModelIds.length}{" "}
                                        {resolvedCustomModelIds.length === 1 ? "个模型已选择" : "个模型已选择"}
                                    </span>
                                </div>
                                <DenInput
                                    type="search"
                                    icon={Search}
                                    value={customModelQuery}
                                    onChange={(event) => setCustomModelQuery(event.target.value)}
                                    placeholder="搜索模型…"
                                />
                                {filteredProbeModels.length ? (
                                    <div className="max-h-72 overflow-y-auto overflow-hidden rounded-[16px] border border-gray-200 bg-white divide-y divide-gray-200">
                                        {filteredProbeModels.map((model) => {
                                            const selected = selectedCustomModelIds.includes(model.id);
                                            return (
                                                <DenSelectableRow
                                                    key={model.id}
                                                    selected={selected}
                                                    title={model.id}
                                                    description={
                                                        probeResult.vendor === "azure"
                                                            ? "部署"
                                                            : "模型"
                                                    }
                                                    onClick={() =>
                                                        setSelectedCustomModelIds((current) =>
                                                            current.includes(model.id)
                                                                ? current.filter((entry) => entry !== model.id)
                                                                : [...current, model.id],
                                                        )
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-[13px] text-gray-500">
                                        没有与“{customModelQuery}”匹配的模型。
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setCustomManualModels(true)}
                                    className="justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                                >
                                    未列出我的模型，手动输入 ID
                                </button>
                            </div>
                        ) : (
                            <>
                                <label className="grid gap-3">
                                    <span className="text-[14px] font-medium text-gray-700">
                                        模型 ID
                                    </span>
                                    <DenTextarea
                                        value={customModelsText}
                                        onChange={(event) =>
                                            setCustomModelsText(event.target.value)
                                        }
                                        rows={4}
                                        placeholder={"gpt-5.2\nmy-deployment-name"}
                                    />
                                </label>
                                <p className="-mt-3 text-[13px] text-gray-500">
                                    每行一个模型 ID，或用逗号分隔。请使用端点实际提供的模型 ID；在 Azure AI Foundry 中即部署名称。
                                </p>
                                {probeState === "ok" && probeResult ? (
                                    <button
                                        type="button"
                                        onClick={() => setCustomManualModels(false)}
                                        className="-mt-2 justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                                    >
                                        改为从端点模型列表中选择
                                    </button>
                                ) : null}
                            </>
                        )}

                        <button
                            type="button"
                            onClick={switchCustomModeToJson}
                            className="justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                        >
                            {visualConfiguration ? "高级选项" : "高级：编辑 JSON"}
                        </button>
                    </div>
                ) : (
                    <div className="mt-8 grid gap-3">
                        <span className="text-[14px] font-medium text-gray-700">
                            {visualConfiguration ? "提供商选项" : "自定义提供商 JSON / JSONC"}
                        </span>
                        {visualConfiguration ? <StructuredConfigEditor
                            text={customConfigText}
                            onChange={setCustomConfigText}
                            onValidChange={setStructuredConfigValid}
                            disabled={saveBusy}
                        /> : <><DenTextarea
                            value={customConfigText}
                            onChange={(event) =>
                                setCustomConfigText(event.target.value)
                            }
                            rows={18}
                        />
                        <p className="text-[13px] text-gray-500">
                            可粘贴 models.dev 提供商、单个提供商配置，或完整的{" "}
                            <code className="rounded-sm bg-gray-100 px-1 py-0.5">
                                opencode.jsonc
                            </code>
                            。模型列表会自动导入。
                        </p></>}
                        {customJsonHint ? (
                            <p className="text-[13px] text-amber-700">
                                {customJsonHint}
                            </p>
                        ) : null}
                        <button
                            type="button"
                            onClick={switchCustomModeToForm}
                            className="justify-self-start text-[13px] font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-900"
                        >
                            返回基本设置
                        </button>
                    </div>
                )}

                <div className="mt-8">
                    <DenAutoNameField
                        value={effectiveName}
                        auto={!nameTouched || !providerName.trim()}
                        placeholder="请先选择提供商"
                        testId="llm-provider-name"
                        onChange={(nextName) => {
                            if (nextName === null) {
                                setProviderName("");
                                setNameTouched(false);
                                return;
                            }
                            setProviderName(nextName);
                            setNameTouched(true);
                        }}
                    />
                </div>
            </section>

            {/* The guided custom form collects the credential inline (before
                the endpoint, so the probe can run as the admin types). */}
            {source === "custom" && customMode === "form" ? null : (
                <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                                凭据
                            </h2>
                        </div>
                        {provider?.hasApiKey ? (
                            <span className="rounded-full bg-emerald-50 px-4 py-2 text-[13px] font-medium text-emerald-700">
                                已有凭据已保存
                            </span>
                        ) : null}
                    </div>

                    {credentialFields}
                    {runtimeEnvKeys.some((envKey) => envKey.tag !== null) ? (
                        <p className="mt-6 text-[13px] leading-6 text-gray-500">
                            在成员计算机和云端工作实例上，此提供商读取{" "}
                            {runtimeEnvKeys.map((envKey, index) => (
                                <span key={envKey.declared}>
                                    {index > 0 ? ", " : null}
                                    <RuntimeEnvKeyChip
                                        envKey={envKey}
                                        className="rounded-sm bg-gray-100 px-1.5 py-0.5 font-mono text-[12px]"
                                    />
                                </span>
                            ))}
                            {runtimeEnvKeys.some((envKey) => envKey.pending)
                                ? "。五字符标签在创建提供商时分配，之后保持不变。"
                                : "，因此不会与成员自行设置的密钥或同类其他提供商冲突。"}
                        </p>
                    ) : null}
                </section>
            )}

            {source === "models_dev" ? (
                <section className="mb-8 rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                    <div>
                        <div>
                            <div className="flex flex-wrap items-center gap-3">
                                <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                                    模型
                                </h2>
                                {catalogDetail ? (
                                    <span className="rounded-full bg-gray-200 px-3 py-1 text-[12px] font-medium text-gray-700">
                                        {selectedModelIds.length}{" "}
                                        {selectedModelIds.length === 1
                                            ? "个模型已选择"
                                            : "个模型已选择"}
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-2 text-[15px] text-gray-500">
                                选择此提供商允许使用的模型。
                            </p>
                            {isAzureCatalog ? (
                                azureProbeState === "ok" && azureProbeResult ? (
                                    <p className="mt-2 text-[13px] text-emerald-700">
                                        显示此 Azure 资源可用的 {azureProbeResult.models.length} 个部署。
                                    </p>
                                ) : azureProbeState === "probing" ? (
                                    <p className="mt-2 text-[13px] text-gray-500">
                                        正在检查 Azure 资源中的部署…
                                    </p>
                                ) : azureProbeState === "failed" ? (
                                    <p className="mt-2 text-[13px] text-red-600">
                                        {azureProbeResult?.hint ??
                                            "无法列出此资源中的部署，请检查资源名称与密钥。"}
                                    </p>
                                ) : (
                                    <p className="mt-2 text-[13px] text-gray-500">
                                        在上方输入资源名称与 API 密钥，以列出该资源实际提供的部署。
                                    </p>
                                )
                            ) : null}
                        </div>

                    </div>

                    <ProviderModelPicker
                        models={catalogDetail ? catalogModelOptions : null}
                        selectedModelIds={selectedModelIds}
                        onChange={setSelectedModelIds}
                    />
                </section>
            ) : null}

            <section className="rounded-[36px] border border-gray-200 bg-white p-8 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.24)]">
                <div>
                    <h2 className="text-[24px] font-semibold tracking-[-0.05em] text-gray-950">
                        谁可以使用
                    </h2>
                    <p className="mt-2 text-[15px] text-gray-500">
                        向所有人授予访问权限，或选择团队与人员。
                    </p>
                </div>

                <ProviderAccessPicker
                    orgContext={orgContext}
                    value={{
                        allMembers,
                        memberIds: selectedMemberIds,
                        teamIds: selectedTeamIds,
                    }}
                    onChange={(next) => {
                        setAllMembers(next.allMembers);
                        setSelectedMemberIds(next.memberIds);
                        setSelectedTeamIds(next.teamIds);
                    }}
                    lockedMemberId={lockedMemberId}
                    testIdPrefix="llm-provider"
                />
            </section>

            <DenStickyActionBar
                testId="llm-provider-save-bar"
                summary={
                    <>
                        {autoNameProviderId ? (
                            <DenBrandMark
                                name={effectiveName || "提供商"}
                                simpleIconSlug={getProviderIconSlug(autoNameProviderId)}
                                serviceUrl={providerDoc}
                                className="h-6 w-6 rounded-[8px]"
                                imageClassName="h-3.5 w-3.5"
                            />
                        ) : null}
                        <span className="truncate font-medium text-gray-950">
                            {effectiveName || "新提供商"}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="whitespace-nowrap">
                            {summaryModelCount} 个模型
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="truncate">
                            {allMembers
                                ? `${orgContext?.organization.name ?? "组织"} 中的所有人`
                                : `${selectedTeamIds.length} 个团队 · ${selectedMemberIds.length} 人`}
                        </span>
                    </>
                }
            >
                <Link
                    href={
                        provider
                            ? getLlmProviderRoute(orgSlug, provider.id)
                            : getLlmProvidersRoute(orgSlug)
                    }
                    className="px-2 text-[13px] font-medium text-gray-500 transition hover:text-gray-900"
                >
                    取消
                </Link>
                <DenButton
                    data-testid="llm-provider-save"
                    loading={saveBusy}
                    disabled={source === "custom" && customMode === "json" && visualConfiguration && !structuredConfigValid}
                    onClick={() => void saveProvider()}
                >
                    {verifyBusy
                        ? "正在验证模型…"
                        : saveAnywayArmed
                          ? "仍然保存"
                          : provider
                            ? "保存提供商"
                            : "创建提供商"}
                </DenButton>
            </DenStickyActionBar>
        </div>
    );
}
