"use client";

import { useState } from "react";
import { matchingDesktopPolicyAssignmentRoles, onboardingPromptsSchema, onboardingPromptDescriptionsSchema } from "@openwork/types/den/desktop-policies";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenTextarea } from "../../_components/ui/textarea";
import { DenNotice } from "../../_components/ui/notice";
import { getOrgAccessFlags } from "../../_lib/den-org";
import { requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { parseDesktopPolicyList, createDesktopPolicy, updateDesktopPolicy, useOrgDesktopPolicies, type DenDesktopPolicy } from "./desktop-policy-data";
import { ItemMenu, ItemPanel, ItemRow, ItemRowsSkeleton, ItemSection } from "./item-list";

type Suggestion = { prompt: string; description: string };
const emptySuggestions = () => [{ prompt: "", description: "" }, { prompt: "", description: "" }];
const suggestionsFor = (policy: DenDesktopPolicy | undefined): Suggestion[] => (policy?.policy.onboardingPrompts ?? []).map((prompt, index) => ({ prompt, description: policy?.policy.onboardingPromptDescriptions?.[index] ?? "" }));

/** Suggestion fields alone change; assignments, priority and all other policy fields survive. */
export function DesktopSuggestionsPanel({ team }: { team: { id: string; name: string } | null }) {
  const { orgContext, orgId, runReauthableAction } = useOrgDashboard();
  const access = orgContext ? getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions) : null;
  const canView = access?.canViewDesktopPolicies ?? false;
  const { desktopPolicies, busy, error, reloadPolicies } = useOrgDesktopPolicies(canView ? orgId : null);
  const [draft, setDraft] = useState<Suggestion[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const defaults = desktopPolicies.find((policy) => policy.isDefault);
  const teamPolicies = desktopPolicies.filter((policy) => !policy.isDefault && policy.assignments.some((assignment) => assignment.teamId === team?.id));
  const promptPolicies = teamPolicies.filter((policy) => policy.policy.onboardingPrompts !== undefined);
  // A team replacement must not rewrite a shared member, role or multi-team policy.
  // Multiple policies (even disabled ones) need an explicit migration, not a guessed winner.
  const own = team ? promptPolicies.length === 1 ? promptPolicies[0] : undefined : defaults;
  const shared = own && !own.isDefault && own.assignments.some((assignment) => assignment.teamId !== team?.id || assignment.orgMemberId !== null || assignment.role !== null);
  const teamMembers = new Set(orgContext?.teams.find((entry) => entry.id === team?.id)?.memberIds ?? []);
  const matchingRoles = new Set((orgContext?.members ?? []).filter((member) => teamMembers.has(member.id)).flatMap((member) => matchingDesktopPolicyAssignmentRoles(member.role, { adminViaTeam: member.adminTeams.length > 0 })));
  const otherTeams = new Set((orgContext?.teams ?? []).filter((entry) => entry.id !== team?.id && entry.memberIds.some((id) => teamMembers.has(id))).map((entry) => entry.id));
  const retained = desktopPolicies.filter((policy) => !policy.isDefault && policy.id !== own?.id && policy.policy.onboardingPrompts !== undefined && (!team || policy.assignments.some((assignment) => assignment.teamId === team.id || (assignment.role !== null && matchingRoles.has(assignment.role)) || (assignment.orgMemberId !== null && teamMembers.has(assignment.orgMemberId)) || (assignment.teamId !== null && otherTeams.has(assignment.teamId)))));
  const overlaps = team && retained.some((policy) => policy.isEnabled);
  const blocked = Boolean(team && (shared || promptPolicies.length > 1 || overlaps || (own && !own.isEnabled)));
  const canManage = Boolean(access?.canManageDesktopPolicies && orgContext?.entitlements.desktopPolicies && !blocked);
  const inherited = Boolean(team && promptPolicies.length === 0);
  const shown = suggestionsFor(inherited ? defaults : own);

  async function save(suggestions: Suggestion[] | null) {
    if (!canManage) return;
    setSaveError(null);
    if (suggestions) {
      const prompts = onboardingPromptsSchema.safeParse(suggestions.map((entry) => entry.prompt));
      const descriptions = onboardingPromptDescriptionsSchema.safeParse(suggestions.map((entry) => entry.description));
      if (!prompts.success || !descriptions.success) {
        setSaveError("添加 2 至 3 条提示词，每条最多 500 个字符，描述最多 120 个字符。");
        return;
      }
    }
    setSaving(true);
    try {
      await runReauthableAction("save-desktop-suggestions", async () => {
        const latest = await requestJson("/v1/desktop-policies", { method: "GET" }, 12000);
        if (!latest.response.ok) throw new Error("无法验证当前建议，请重新加载后重试。");
        // Do not overwrite policy changes made in AI Gateway or another tab while this editor was open.
        if (JSON.stringify(parseDesktopPolicyList(latest.payload).desktopPolicies) !== JSON.stringify(desktopPolicies)) {
          await reloadPolicies();
          throw new Error("编辑期间策略已更改，请重新加载并检查当前建议后保存。");
        }
        const fields = suggestions ? { onboardingPrompts: suggestions.map((entry) => entry.prompt.trim()), onboardingPromptDescriptions: suggestions.map((entry) => entry.description.trim()) } : { onboardingPrompts: null, onboardingPromptDescriptions: null };
        if (own) {
          await updateDesktopPolicy(own.id, {
            policyName: own.policyName,
            policy: { ...own.policy, ...fields },
            priority: own.priority,
            isEnabled: own.isEnabled,
            memberIds: own.assignments.flatMap((assignment) => assignment.orgMemberId ? [assignment.orgMemberId] : []),
            teamIds: own.assignments.flatMap((assignment) => assignment.teamId ? [assignment.teamId] : []),
            roles: own.roles,
          });
        } else if (team && suggestions) {
          await createDesktopPolicy({ policyName: `${team.name} 条提示词建议`, policy: fields, teamIds: [team.id], priority: 0, isEnabled: true });
        } else {
          throw new Error("所有人的默认策略不可用，请重新加载后重试。");
        }
        await reloadPolicies();
        setDraft(null);
      });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "无法保存建议，请重试。");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <DenNotice tone="neutral" message="查看提示词建议需要桌面策略访问权限，请联系组织所有者或管理员。" />;
  if (busy && desktopPolicies.length === 0) return <ItemPanel><ItemRowsSkeleton label="正在加载提示词建议" rows={2} /></ItemPanel>;
  if (error) return <DenNotice tone="error" message={error} action={<DenButton variant="secondary" onClick={() => void reloadPolicies()}>重试</DenButton>} />;
  return (
    <div className="flex flex-col gap-4" data-testid="desktop-suggestions">
      <ItemSection title="提示词建议" meta={team ? inherited ? "继承所有人的设置" : "已为团队单独设置" : undefined}>
        {blocked ? <DenNotice tone="neutral" message="建议包含共享或重叠的策略分配。为保护其他团队与成员，编辑已锁定。请联系组织所有者拆分这些分配后更改建议。" /> : null}
        {!access?.canManageDesktopPolicies ? <DenNotice tone="neutral" message="当前为只读，请联系组织所有者或管理员申请桌面策略管理权限。" /> : !orgContext?.entitlements.desktopPolicies ? <DenNotice tone="neutral" message="更改提示词建议需要企业版套餐，请联系组织所有者。" /> : null}
        <ItemPanel>
          {shown.length === 0 ? <div className="px-5 py-4 text-[13px] text-gray-500">内置桌面建议</div> : shown.map((entry, index) => (
            <ItemRow key={index} title={entry.prompt} description={entry.description} testId={`desktop-suggestion-${index}`} action={canManage && !inherited ? <ItemMenu label={`建议 ${index + 1} 的操作`} entries={[
              { label: "编辑", disabled: saving, onSelect: () => setDraft(shown) },
              { label: shown.length <= 2 ? "移除（至少保留 2 条建议）" : "移除", destructive: true, disabled: saving || shown.length <= 2, confirm: { title: "移除建议？", description: "此提示词将不再向目标成员显示，其余两条建议保留。", action: "Remove" }, onSelect: () => save(shown.filter((_, position) => position !== index)) },
            ]} /> : undefined} />
          ))}
        </ItemPanel>
      </ItemSection>
      {draft ? (
        <form className="flex flex-col gap-4" aria-label="编辑提示词建议" onSubmit={(event) => { event.preventDefault(); void save(draft); }}>
          {draft.map((entry, index) => (
            <div key={index} className="grid gap-2">
              <label className="grid gap-1 text-[13px] text-gray-700">提示词 {index + 1}<DenTextarea rows={2} disabled={saving} aria-label={`提示词 ${index + 1}`} required maxLength={500} value={entry.prompt} onChange={(event) => setDraft(draft.map((value, position) => position === index ? { ...value, prompt: event.target.value } : value))} className="rounded-lg border border-gray-200 bg-white px-3 py-2" /></label>
              <label className="grid gap-1 text-[13px] text-gray-700">说明 {index + 1}<DenInput disabled={saving} aria-label={`描述 ${index + 1}`} maxLength={120} value={entry.description} onChange={(event) => setDraft(draft.map((value, position) => position === index ? { ...value, description: event.target.value } : value))} className="rounded-lg border border-gray-200 bg-white px-3 py-2" /></label>
            </div>
          ))}
          <div className="flex gap-2">
            {draft.length < 3 ? <DenButton variant="secondary" disabled={saving} onClick={() => setDraft([...draft, { prompt: "", description: "" }])}>添加建议</DenButton> : null}
            <DenButton type="submit" loading={saving}>保存建议</DenButton>
            <DenButton variant="secondary" disabled={saving} onClick={() => setDraft(null)}>取消</DenButton>
          </div>
        </form>
      ) : canManage ? (
        <div className="flex items-center gap-3">
          <DenButton variant="secondary" disabled={saving} onClick={() => setDraft(shown.length > 0 ? shown : emptySuggestions())}>{inherited ? "为团队单独设置" : shown.length === 0 ? "设置建议" : "编辑建议"}</DenButton>
          {!inherited && shown.length === 2 ? <DenButton variant="secondary" disabled={saving} onClick={() => setDraft([...shown, { prompt: "", description: "" }])}>添加建议</DenButton> : null}
          {team && own ? <DenButton variant="secondary" loading={saving} onClick={() => void save(null)}>使用所有人的设置</DenButton> : !team && shown.length > 0 ? <DenButton variant="secondary" loading={saving} onClick={() => void save(null)}>使用内置建议</DenButton> : null}
        </div>
      ) : null}
      {retained.length > 0 ? (
        <details className="text-[13px] text-gray-700">
          <summary className="cursor-pointer py-2">其他定向建议（{retained.length})</summary>
          <div className="flex flex-col gap-4 pt-3">
            {retained.map((policy) => (
              <ItemSection key={policy.id} title={policy.policyName} meta={`${policy.isEnabled ? "已启用" : "已禁用"} · 优先级 ${policy.priority}`}>
                <ItemPanel>{suggestionsFor(policy).map((entry, index) => <ItemRow key={index} title={entry.prompt} description={entry.description} />)}</ItemPanel>
              </ItemSection>
            ))}
          </div>
        </details>
      ) : null}
      {saveError ? <DenNotice tone="error" message={saveError} /> : null}
    </div>
  );
}
