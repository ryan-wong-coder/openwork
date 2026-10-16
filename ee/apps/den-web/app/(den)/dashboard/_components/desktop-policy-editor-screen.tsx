"use client";

import { ExecutionPolicyFields, validateExecutionPolicy } from "./execution-policy-fields";
import { desktopExecutionPolicySchema, type DesktopExecutionPolicy } from "@openwork/types/den/desktop-policies";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Laptop } from "lucide-react";
import {
  applyRestrictedDesktopPolicy,
  desktopPolicyDefaults,
  desktopPolicyKeys,
  isRestrictedDesktopPolicyValue,
  type DesktopPolicyDocumentWrite,
  type DesktopPolicyValue,
} from "@openwork/types/den/desktop-policies";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenTextarea } from "../../_components/ui/textarea";
import { getDesktopPoliciesRoute, getMembersRoute, getTeamRoute, getOrgAccessFlags, permissionLockReason } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  createDesktopPolicy,
  updateDesktopPolicy,
  useOrgDesktopPolicies,
  type DenDesktopPolicy,
  type DenDesktopPolicyRole,
  type DesktopPolicyPayload,
} from "./desktop-policy-data";
import { EnterprisePlanNotice } from "./enterprise-plan-notice";

type PolicyMode = "custom" | "restricted";

type PolicyDraft = {
  execution: DesktopExecutionPolicy;
  policyName: string;
  mode: PolicyMode;
  policy: Required<DesktopPolicyValue>;
  priority: number;
  onboardingPromptsEnabled: boolean;
  onboardingPromptTexts: string[];
  onboardingPromptDescriptions: string[];
  memberIds: string[];
  teamIds: string[];
  roles: DenDesktopPolicyRole[];
};

const EMPTY_DRAFT: PolicyDraft = {
  execution: desktopExecutionPolicySchema.parse({}),
  policyName: "新建桌面策略",
  mode: "custom",
  policy: { ...desktopPolicyDefaults },
  priority: 0,
  onboardingPromptsEnabled: false,
  onboardingPromptTexts: ["", "", ""],
  onboardingPromptDescriptions: ["", "", ""],
  memberIds: [],
  teamIds: [],
  roles: [],
};

const POLICY_MODES: Array<{ id: PolicyMode; name: string; description: string }> = [
  {
    id: "custom",
    name: "自定义",
    description: "在下方选择各项功能。",
  },
  {
    id: "restricted",
    name: "受限制",
    description:
      "成员无法更改桌面设置、添加提供商或模型、添加工作区，以及安装本地扩展或 MCP 服务器。请在下方设置命令和浏览器限制。",
  },
];
const POLICY_MODE_HELP_ID = "desktop-policy-mode-help";

const ONBOARDING_PROMPT_LABELS = ["第一条提示词", "第二条提示词", "第三条提示词（可选）"];
const ONBOARDING_PROMPT_DESCRIPTION_MAX_LENGTH = 120;
const MAX_POLICY_PRIORITY = 1_000_000;
const PRIORITY_HELP_ID = "desktop-policy-priority-help";
const PRIORITY_ERROR_ID = "desktop-policy-priority-error";

function requiredPolicyValue(value: DesktopPolicyValue): Required<DesktopPolicyValue> {
  return Object.fromEntries(
    desktopPolicyKeys.map((key) => [key, value[key] === true]),
  ) as Required<DesktopPolicyValue>;
}

function draftFromPolicy(policy: DenDesktopPolicy): PolicyDraft {
  const onboardingPrompts = policy.policy.onboardingPrompts ?? [];
  const onboardingPromptDescriptions = policy.policy.onboardingPromptDescriptions ?? [];
  const policyValue = requiredPolicyValue(policy.policy);
  return {
    execution: policy.policy.execution ?? desktopExecutionPolicySchema.parse({}),
    policyName: policy.policyName,
    mode: isRestrictedDesktopPolicyValue(policyValue) ? "restricted" : "custom",
    policy: policyValue,
    priority: policy.priority,
    onboardingPromptsEnabled: onboardingPrompts.length > 0,
    onboardingPromptTexts: [
      onboardingPrompts[0] ?? "",
      onboardingPrompts[1] ?? "",
      onboardingPrompts[2] ?? "",
    ],
    onboardingPromptDescriptions: [
      onboardingPromptDescriptions[0] ?? "",
      onboardingPromptDescriptions[1] ?? "",
      onboardingPromptDescriptions[2] ?? "",
    ],
    memberIds: policy.assignments.flatMap((assignment) => (assignment.orgMemberId ? [assignment.orgMemberId] : [])),
    teamIds: policy.assignments.flatMap((assignment) => (assignment.teamId ? [assignment.teamId] : [])),
    roles: policy.roles,
  };
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

function policyToAssignmentPayload(policy: DenDesktopPolicy) {
  return {
    memberIds: policy.assignments.flatMap((assignment) => (assignment.orgMemberId ? [assignment.orgMemberId] : [])),
    teamIds: policy.assignments.flatMap((assignment) => (assignment.teamId ? [assignment.teamId] : [])),
    roles: policy.roles,
  };
}

function updateOnboardingPromptText(values: string[], index: number, nextValue: string) {
  return values.map((value, valueIndex) => (valueIndex === index ? nextValue : value));
}

function updateOnboardingPromptDescription(values: string[], index: number, nextValue: string) {
  return values.map((value, valueIndex) => (valueIndex === index ? nextValue : value));
}

function getOnboardingPrompts(draft: PolicyDraft): string[] | undefined {
  if (!draft.onboardingPromptsEnabled) return undefined;

  const prompts = draft.onboardingPromptTexts.map((prompt) => prompt.trim());
  const requiredPrompts = prompts.slice(0, 2);
  if (requiredPrompts.some((prompt) => prompt.length === 0)) return undefined;
  if (prompts.some((prompt) => prompt.length > 500)) return undefined;

  return prompts[2] ? [...requiredPrompts, prompts[2]] : requiredPrompts;
}

function getOnboardingPromptDescriptions(draft: PolicyDraft, promptCount: number): string[] | undefined {
  const descriptions = draft.onboardingPromptDescriptions
    .slice(0, promptCount)
    .map((description) => description.trim());
  if (descriptions.some((description) => description.length > ONBOARDING_PROMPT_DESCRIPTION_MAX_LENGTH)) return undefined;
  return descriptions.some((description) => description.length > 0) ? descriptions : undefined;
}

function getPriorityError(draft: PolicyDraft, isDefault: boolean) {
  if (isDefault) return null;
  if (!Number.isInteger(draft.priority) || draft.priority < 0 || draft.priority > MAX_POLICY_PRIORITY) {
    return `优先级必须为 0 到 ${MAX_POLICY_PRIORITY} 之间的整数。`;
  }
  return null;
}

function getPromptError(draft: PolicyDraft, index: number) {
  if (!draft.onboardingPromptsEnabled) return null;
  const label = ONBOARDING_PROMPT_LABELS[index] ?? "提示词";
  const prompt = draft.onboardingPromptTexts[index] ?? "";
  const trimmed = prompt.trim();
  if (index < 2 && trimmed.length === 0) return `${label}为必填项。`;
  if (trimmed.length > 500) return `${label}不能超过 500 个字符。`;
  return null;
}

function getPromptDescriptionError(draft: PolicyDraft, index: number) {
  if (!draft.onboardingPromptsEnabled) return null;
  const description = draft.onboardingPromptDescriptions[index] ?? "";
  const trimmed = description.trim();
  if (trimmed.length > ONBOARDING_PROMPT_DESCRIPTION_MAX_LENGTH) {
    return `描述不能超过 ${ONBOARDING_PROMPT_DESCRIPTION_MAX_LENGTH} 个字符。`;
  }
  return null;
}

function getPromptHelpId(index: number) {
  return `desktop-policy-onboarding-prompt-${index}-help`;
}

function getPromptErrorId(index: number) {
  return `desktop-policy-onboarding-prompt-${index}-error`;
}

function getPromptDescriptionHelpId(index: number) {
  return `desktop-policy-onboarding-prompt-${index}-description-help`;
}

function getPromptDescriptionErrorId(index: number) {
  return `desktop-policy-onboarding-prompt-${index}-description-error`;
}

function getDisabledPromptCopy(isDefault: boolean) {
  return isDefault
    ? "关闭组织提示词后，将使用 OpenWork 默认提示词。"
    : "关闭组织提示词后，成员继承其他匹配策略或默认策略的提示词；没有适用策略时使用 OpenWork 默认提示词。";
}

function policyDocumentFromDraft(draft: PolicyDraft): DesktopPolicyDocumentWrite {
  const onboardingPrompts = getOnboardingPrompts(draft);
  const onboardingPromptDescriptions = onboardingPrompts !== undefined
    ? getOnboardingPromptDescriptions(draft, onboardingPrompts.length)
    : undefined;
  return {
    execution: validateExecutionPolicy(draft.execution),
    ...draft.policy,
    ...(draft.onboardingPromptsEnabled
      ? onboardingPrompts !== undefined
        ? {
            onboardingPrompts,
            ...(onboardingPromptDescriptions !== undefined
              ? { onboardingPromptDescriptions }
              : {}),
          }
        : {}
      : { onboardingPrompts: null, onboardingPromptDescriptions: null }),
  };
}

export function DesktopPolicyEditorScreen({ desktopPolicyId }: { desktopPolicyId?: string }) {
  const router = useRouter();
  const { orgId, orgSlug, orgContext, runReauthableAction } = useOrgDashboard();
  const { definitions, desktopPolicies, busy, error, reloadPolicies } = useOrgDesktopPolicies(orgId);

  const policy = useMemo(() => {
    if (!desktopPolicyId) return null;
    return desktopPolicies.find((entry) => entry.id === desktopPolicyId) ?? null;
  }, [desktopPolicyId, desktopPolicies]);

  const [draft, setDraft] = useState<PolicyDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopPolicyId) {
      setDraft(EMPTY_DRAFT);
      return;
    }
    if (policy) {
      setDraft(draftFromPolicy(policy));
    }
  }, [desktopPolicyId, policy]);

  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.currentMember.permissions,
  );
  const canManage = access.canManageDesktopPolicies;
  const canView = access.canViewDesktopPolicies;
  const isEditing = Boolean(desktopPolicyId);
  const isDefault = policy?.isDefault === true;
  const listRoute = getDesktopPoliciesRoute(orgSlug);

  const initialLoad = busy && (definitions.length === 0 || (isEditing && !policy));
  const notFound = isEditing && !busy && !policy && desktopPolicies.length > 0;
  const priorityError = getPriorityError(draft, isDefault);
  const disabledPromptCopy = getDisabledPromptCopy(isDefault);
  const formDisabled = saving || togglingEnabled || !canManage;
  const restrictedMode = draft.mode === "restricted";

  const handleSelectMode = (mode: PolicyMode) => {
    setDraft({
      ...draft,
      mode,
      policy: mode === "restricted" ? applyRestrictedDesktopPolicy(draft.policy) : draft.policy,
    });
  };

  const handleSave = async () => {
    if (!canManage) {
      setPageError("你没有保存桌面策略的权限。");
      return;
    }

    const policyName = draft.policyName.trim();
    if (!policyName) {
      setPageError("请输入策略名称。");
      return;
    }
    const nextPriorityError = getPriorityError(draft, isDefault);
    if (nextPriorityError) {
      setPageError(nextPriorityError);
      return;
    }
    if (draft.onboardingPromptsEnabled) {
      const promptError = ONBOARDING_PROMPT_LABELS
        .map((_, index) => getPromptError(draft, index) ?? getPromptDescriptionError(draft, index))
        .find((error) => error !== null);
      if (promptError) {
        setPageError(promptError);
        return;
      }
    }
    setPageError(null);
    try {
      await runReauthableAction("save-desktop-policy", async () => {
        setSaving(true);
        const payload: DesktopPolicyPayload = {
          policyName,
          policy: policyDocumentFromDraft(draft),
          priority: isDefault ? 0 : draft.priority,
          memberIds: isDefault ? [] : draft.memberIds,
          teamIds: isDefault ? [] : draft.teamIds,
          roles: isDefault ? [] : draft.roles,
        };
        if (isEditing && desktopPolicyId) {
          // Preserve the current enabled state when saving form edits; the
          // dedicated Enable/Disable button is the only way to flip it.
          payload.isEnabled = policy?.isEnabled ?? true;
          await updateDesktopPolicy(desktopPolicyId, payload);
        } else {
          payload.isEnabled = true;
          await createDesktopPolicy(payload);
        }
        await reloadPolicies();
        router.push(listRoute);
      });
    } catch (saveError) {
      setPageError(saveError instanceof Error ? saveError.message : "保存桌面策略失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!canManage) {
      setPageError("你没有启用或禁用桌面策略的权限。");
      return;
    }
    if (!policy || !desktopPolicyId || isDefault) return;
    setPageError(null);
    try {
      await runReauthableAction("toggle-desktop-policy", async () => {
        setTogglingEnabled(true);
        const { memberIds, teamIds, roles } = policyToAssignmentPayload(policy);
        await updateDesktopPolicy(desktopPolicyId, {
          policyName: policy.policyName,
          policy: policy.policy,
          priority: policy.priority,
          isEnabled: !policy.isEnabled,
          memberIds,
          teamIds,
          roles,
        });
        await reloadPolicies();
      });
    } catch (toggleError) {
      setPageError(toggleError instanceof Error ? toggleError.message : "更新桌面策略失败，请重试。");
    } finally {
      setTogglingEnabled(false);
    }
  };

  return (
    <DashboardPageTemplate
      icon={Laptop}
      title={isEditing ? "编辑桌面策略" : "新建桌面策略"}
      description="管理高级应用默认设置与授权。团队模式和权限在“团队”的“访问权限”中设置。"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={listRoute}
          className="inline-flex items-center gap-2 text-[13px] font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          返回桌面策略
        </Link>
      </div>

      {orgContext && !orgContext.entitlements.desktopPolicies ? <EnterprisePlanNotice feature="桌面策略管理" /> : null}
      {pageError ? (
        <div role="alert" className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">{pageError}</div>
      ) : null}
      {error ? (
        <div role="alert" className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">{error}</div>
      ) : null}

      {initialLoad ? (
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">正在加载桌面策略…</div>
      ) : notFound ? (
        <div className="rounded-[32px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center text-[15px] text-gray-500">
          未找到桌面策略。
        </div>
      ) : policy?.policy.access ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold">在团队访问权限中管理</h2>
          <p className="mt-2 text-sm text-gray-500">此配置表示团队权限，请在团队的“访问权限”页面中更改模式与各项功能。</p>
          {policy.assignments.flatMap((assignment) => assignment.teamId ? [
            <DenButton key={assignment.teamId} className="mt-4" href={getTeamRoute(orgSlug, assignment.teamId)}>打开团队访问权限</DenButton>,
          ] : [])}
        </section>
      ) : !canView ? (
        <div className="rounded-[32px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center text-[15px] text-gray-500">
          {permissionLockReason("desktop_policies.view")}
        </div>
      ) : !isEditing && !canManage ? (
        <div className="rounded-[32px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center text-[15px] text-gray-500">
          {`你可以查看桌面策略，但无法创建。${permissionLockReason("desktop_policies.manage")}`}
        </div>
      ) : (
        <section className="grid gap-5 rounded-[28px] border border-gray-200 bg-white p-6">
          {!canManage ? (
            <div className="rounded-[22px] border border-[var(--dls-border)] bg-[var(--dls-hover)] px-4 py-3 text-[13px] text-[var(--dls-text-primary)]">
              {`只读。${permissionLockReason("desktop_policies.manage")}`}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid flex-1 min-w-[240px] gap-2">
              <span className="text-[13px] font-medium text-gray-700">策略名称</span>
              <DenInput
                value={draft.policyName}
                onChange={(event) => setDraft({ ...draft, policyName: event.target.value })}
                disabled={formDisabled || isDefault}
              />
              {isDefault ? (
                <span className="text-[12px] text-gray-500">默认桌面策略名称不可更改。</span>
              ) : null}
            </label>
            {!isDefault ? (
              <label className="grid w-full gap-2 sm:w-40">
                <span className="text-[13px] font-medium text-gray-700">优先级</span>
                <DenInput
                  type="number"
                  min={0}
                  max={MAX_POLICY_PRIORITY}
                  step={1}
                  value={draft.priority}
                  aria-invalid={priorityError ? true : undefined}
                  aria-describedby={priorityError ? `${PRIORITY_HELP_ID} ${PRIORITY_ERROR_ID}` : PRIORITY_HELP_ID}
                  onChange={(event) => {
                    const nextPriority = event.target.valueAsNumber;
                    setDraft({
                      ...draft,
                      priority: Number.isInteger(nextPriority) ? nextPriority : 0,
                    });
                  }}
                  disabled={formDisabled}
                />
                <span id={PRIORITY_HELP_ID} className="text-[12px] text-gray-500">多个定向策略匹配时，优先级较高的策略生效。</span>
                {priorityError ? (
                  <span id={PRIORITY_ERROR_ID} className="text-[12px] text-red-600">{priorityError}</span>
                ) : null}
              </label>
            ) : null}
            {isEditing && policy && !isDefault ? (
              <DenButton
                type="button"
                variant={policy.isEnabled ? "destructive" : "secondary"}
                onClick={() => void handleToggleEnabled()}
                loading={togglingEnabled}
                disabled={saving || !canManage}
              >
                {policy.isEnabled ? "禁用" : "启用"}
              </DenButton>
            ) : null}
          </div>

          <fieldset className="grid gap-3" aria-describedby={POLICY_MODE_HELP_ID} data-testid="desktop-policy-mode">
            <legend className="text-[13px] font-medium text-gray-700">策略模式</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {POLICY_MODES.map((mode) => (
                <label
                  key={mode.id}
                  className={`flex items-start gap-3 rounded-[22px] border px-5 py-4 ${
                    draft.mode === mode.id ? "border-[var(--dls-border)] bg-[var(--dls-active)]" : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="desktop-policy-mode"
                    className="mt-1 h-5 w-5"
                    value={mode.id}
                    checked={draft.mode === mode.id}
                    onChange={() => handleSelectMode(mode.id)}
                    disabled={formDisabled}
                  />
                  <span>
                    <span className="block text-[14px] font-medium text-gray-950">{mode.name}</span>
                    <span className="mt-1 block text-[13px] leading-6 text-gray-500">{mode.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <p id={POLICY_MODE_HELP_ID} className="text-[12px] text-gray-500">
              {restrictedMode
                ? isDefault
                  ? "切换回自定义模式前，已锁定的功能将保持关闭。"
                  : "定向策略仅授予功能。若需限制成员，请将默认策略设为受限模式。"
                : "切换为受限模式，将各项功能锁定为受限值。"}
            </p>
          </fieldset>

          <div className="grid gap-3">
            {definitions.map((definition) => {
              const locked = restrictedMode && definition.restrictedValue !== null;
              return (
                <label
                  key={definition.id}
                  className="flex items-start justify-between gap-4 rounded-[22px] border border-gray-200 bg-gray-50 px-5 py-4"
                >
                  <span>
                    <span className="block text-[14px] font-medium text-gray-950">{definition.name}</span>
                    <span className="mt-1 block text-[13px] leading-6 text-gray-500">{definition.description}</span>
                    {locked ? (
                      <span className="mt-1 block text-[12px] text-gray-500">已由受限模式锁定。</span>
                    ) : null}
                  </span>
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    data-desktop-policy-key={definition.id}
                    checked={draft.policy[definition.id] === true}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        policy: { ...draft.policy, [definition.id]: event.target.checked },
                      })
                    }
                    disabled={formDisabled || locked}
                  />
                </label>
              );
            })}
          </div>

          <ExecutionPolicyFields value={draft.execution} disabled={formDisabled} onChange={(execution) => setDraft({ ...draft, execution })} />

          <div className="grid gap-4 rounded-[22px] border border-gray-200 bg-gray-50 px-5 py-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={draft.onboardingPromptsEnabled}
                onChange={(event) => setDraft({ ...draft, onboardingPromptsEnabled: event.target.checked })}
                disabled={formDisabled}
              />
              <span>
                <span className="block text-[14px] font-medium text-gray-950">组织提示词建议</span>
                <span className="mt-1 block text-[13px] leading-6 text-gray-500">
                  使用组织提供的提示词替换桌面应用的默认任务建议。
                </span>
              </span>
            </label>

            {draft.onboardingPromptsEnabled ? (
              <div className="grid gap-3">
                {ONBOARDING_PROMPT_LABELS.map((label, index) => {
                  const promptError = getPromptError(draft, index);
                  const promptDescriptionError = getPromptDescriptionError(draft, index);
                  const promptHelpId = getPromptHelpId(index);
                  const promptErrorId = getPromptErrorId(index);
                  const promptDescriptionHelpId = getPromptDescriptionHelpId(index);
                  const promptDescriptionErrorId = getPromptDescriptionErrorId(index);
                  return (
                    <div key={label} className="grid gap-3 rounded-[18px] border border-gray-200 bg-white px-4 py-3">
                      <p className="text-[13px] font-medium text-gray-700">{label}</p>
                      <label className="grid gap-2">
                        <span className="text-[12px] font-medium text-gray-600">说明</span>
                        <DenInput
                          maxLength={ONBOARDING_PROMPT_DESCRIPTION_MAX_LENGTH}
                          value={draft.onboardingPromptDescriptions[index] ?? ""}
                          aria-invalid={promptDescriptionError ? true : undefined}
                          aria-describedby={promptDescriptionError ? `${promptDescriptionHelpId} ${promptDescriptionErrorId}` : promptDescriptionHelpId}
                          onChange={(event) => setDraft({
                            ...draft,
                            onboardingPromptDescriptions: updateOnboardingPromptDescription(draft.onboardingPromptDescriptions, index, event.target.value),
                          })}
                          disabled={formDisabled}
                          placeholder="桌面应用中显示的标题"
                        />
                        <span id={promptDescriptionHelpId} className="text-[12px] text-gray-500">
                          {(draft.onboardingPromptDescriptions[index] ?? "").trim().length}/{ONBOARDING_PROMPT_DESCRIPTION_MAX_LENGTH} 个字符
                        </span>
                        {promptDescriptionError ? (
                          <span id={promptDescriptionErrorId} className="text-[12px] text-red-600">{promptDescriptionError}</span>
                        ) : null}
                      </label>
                      <label className="grid gap-2">
                        <span className="text-[12px] font-medium text-gray-600">提示词</span>
                        <DenTextarea
                          rows={2}
                          maxLength={500}
                          value={draft.onboardingPromptTexts[index] ?? ""}
                          aria-invalid={promptError ? true : undefined}
                          aria-describedby={promptError ? `${promptHelpId} ${promptErrorId}` : promptHelpId}
                          onChange={(event) => setDraft({
                            ...draft,
                            onboardingPromptTexts: updateOnboardingPromptText(draft.onboardingPromptTexts, index, event.target.value),
                          })}
                          disabled={formDisabled}
                          placeholder={index === 2 ? "可选" : "输入建议提示词"}
                        />
                        <span id={promptHelpId} className="text-[12px] text-gray-500">
                          {(draft.onboardingPromptTexts[index] ?? "").trim().length}/500 个字符
                        </span>
                        {promptError ? (
                          <span id={promptErrorId} className="text-[12px] text-red-600">{promptError}</span>
                        ) : null}
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] leading-6 text-gray-500">{disabledPromptCopy}</p>
            )}
          </div>

          {!isDefault ? (
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-medium text-gray-700">成员</p>
                <div className="flex max-h-64 min-h-[160px] flex-col gap-2 overflow-auto rounded-[22px] border border-gray-200 p-3">
                  {(orgContext?.members ?? []).length === 0 ? (
                    <Link
                      href={getMembersRoute(orgSlug)}
                      className="flex flex-1 items-center justify-center rounded-xl px-3 py-6 text-center text-[13px] text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                    >
                      邀请成员后可将其分配到此策略。
                    </Link>
                  ) : (
                    (orgContext?.members ?? []).map((member) => (
                      <label
                        key={member.id}
                        className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={draft.memberIds.includes(member.id)}
                          disabled={formDisabled}
                          onChange={() => setDraft({ ...draft, memberIds: toggleId(draft.memberIds, member.id) })}
                        />
                        <span>{member.user.name || member.user.email}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-medium text-gray-700">团队</p>
                <div className="flex max-h-64 min-h-[160px] flex-col gap-2 overflow-auto rounded-[22px] border border-gray-200 p-3">
                  {(orgContext?.teams ?? []).length === 0 ? (
                    <Link
                      href={getMembersRoute(orgSlug)}
                      className="flex flex-1 items-center justify-center rounded-xl px-3 py-6 text-center text-[13px] text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                    >
                      配置团队
                    </Link>
                  ) : (
                    (orgContext?.teams ?? []).map((team) => (
                      <label
                        key={team.id}
                        className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={draft.teamIds.includes(team.id)}
                          disabled={formDisabled}
                          onChange={() => setDraft({ ...draft, teamIds: toggleId(draft.teamIds, team.id) })}
                        />
                        <span>{team.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <Link
              href={listRoute}
              className="inline-flex h-10 items-center justify-center rounded-full border border-gray-200 bg-white px-5 text-[13px] font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
            >
              取消
            </Link>
            <DenButton type="button" onClick={() => void handleSave()} loading={saving} disabled={!canManage || togglingEnabled}>
              {isEditing ? "保存更改" : "创建策略"}
            </DenButton>
          </div>
        </section>
      )}
    </DashboardPageTemplate>
  );
}
