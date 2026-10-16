"use client";

import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, Layers, Puzzle, Settings, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { DesktopPolicyKey } from "@openwork/types/den/desktop-policies";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getMembersRoute, getOrgAccessFlags } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { createDesktopPolicy, updateDesktopPolicy, useOrgDesktopPolicies, type DenDesktopPolicy } from "./desktop-policy-data";
import { validateExecutionPolicy } from "./execution-policy-fields";
import { TeamExecutionFields } from "./team-execution-fields";
import { TeamPermissionGroup, TeamPermissionSelect } from "./team-permission-fields";
import { teamCapabilities, teamPermissionChanges, teamPermissionDraft, teamWebsiteSummary, type TeamPermissionDraft } from "./team-permission-state";

/**
 * `heading` replaces "What this team can do" and its description; teamRoles
 * passes "In the desktop app" so it doesn't read as the team's role.
 */
export function TeamPermissionsPanel({ teamId, heading }: { teamId: string; heading?: string }) {
  const { orgContext } = useOrgDashboard();
  const [saved, setSaved] = useState(false);
  const access = getOrgAccessFlags(orgContext?.currentMember.role ?? "member", orgContext?.currentMember.isOwner ?? false, orgContext?.currentMember.permissions);
  const { desktopPolicies, definitions, busy, error, reloadPolicies } = useOrgDesktopPolicies(orgContext?.organization.id ?? null);
  const team = orgContext?.teams.find((entry) => entry.id === teamId);
  const policies = desktopPolicies.filter((policy) => policy.policy.access !== undefined && policy.assignments.some((entry) => entry.teamId === teamId));
  const policy = policies[0];
  const exclusivelyAssigned = !policy || (!policy.isDefault && policy.assignments.length === 1 && policy.assignments[0]?.teamId === teamId);

  if (error) return <DenNotice tone="error" message={error} />;
  if (busy || definitions.length === 0) return <p className="py-6 text-sm text-gray-500">正在加载权限…</p>;
  if (!team) return <DenNotice tone="error" message="此团队已不可用。" />;
  if (policies.length > 1 || !exclusivelyAssigned) return <DenNotice tone="error" message="此团队具有共享或重叠的访问配置，请联系组织所有者检查已分配策略，再编辑团队权限。" />;

  return <>{saved ? <DenNotice tone="info" className="mb-4" message="权限已保存，成员的应用刷新后将收到更新。" /> : null}<TeamPermissionsEditor key={`${teamId}-${JSON.stringify(policy)}`} teamId={teamId} teamName={team.name} heading={heading} policy={policy} canManage={access.canManageDesktopPolicies} onSaved={async () => { await reloadPolicies(); setSaved(true); }} /></>;
}


function TeamPermissionsEditor({ teamId, teamName, heading, policy, canManage, onSaved }: {
  teamId: string;
  teamName: string;
  heading?: string;
  policy: DenDesktopPolicy | undefined;
  canManage: boolean;
  onSaved: () => Promise<void>;
}) {
  const { orgSlug } = useOrgDashboard();
  const previewId = useId();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const initial = teamPermissionDraft(policy?.policy);
  const [draft, setDraft] = useState(initial);
  const [review, setReview] = useState<TeamPermissionDraft | null>(null);
  const [preview, setPreview] = useState(false);
  const [pendingSite, setPendingSite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = teamPermissionChanges(initial, review ?? draft);
  const enabling = policy?.isEnabled === false;
  const count = changes.length + (enabling ? 1 : 0);
  const capabilities = draft.access.capabilities;

  function changeCapability(key: DesktopPolicyKey, allowed: boolean) {
    setDraft({ ...draft, access: { mode: "custom", capabilities: { ...capabilities, [key]: allowed } } });
    setError(null);
  }

  function openReview() {
    try {
      setReview({ ...draft, execution: validateExecutionPolicy(draft.execution) });
      setError(null);
      requestAnimationFrame(() => reviewHeading.current?.focus());
    } catch (error) {
      setError(error instanceof Error ? error.message : "请检查权限后再保存。");
    }
  }

  function keepEditing() {
    setReview(null);
    setError(null);
    requestAnimationFrame(() => editorHeading.current?.focus());
  }

  async function save() {
    if (!review || !canManage || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        policyName: policy?.policyName ?? `${teamName}访问权限`,
        policy: { ...policy?.policy, access: review.access, execution: validateExecutionPolicy(review.execution) },
        teamIds: [teamId],
        isEnabled: true,
      };
      if (policy) await updateDesktopPolicy(policy.id, payload);
      else await createDesktopPolicy(payload);
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法保存团队权限，请重试。");
    } finally {
      setSaving(false);
    }
  }

  const capabilityFields = (group: "ai" | "tools" | "app") => teamCapabilities.filter((entry) => entry.group === group).map((entry) => <TeamPermissionSelect key={entry.id} label={entry.teamLabel} allowed={capabilities[entry.id] === true} onChange={(allowed) => changeCapability(entry.id, allowed)} />);
  const groupStatus = (group: "ai" | "app") => {
    const entries = teamCapabilities.filter((entry) => entry.group === group);
    const allowed = entries.filter((entry) => capabilities[entry.id]).length;
    return allowed === 0 ? "由管理员管理" : allowed === entries.length ? "允许" : "自定义";
  };

  if (review) return <section aria-label="检查团队权限更改" className="mb-8 space-y-5">
    <DenButton variant="ghost" size="sm" icon={ArrowLeft} onClick={keepEditing} disabled={saving}>返回团队访问权限</DenButton>
    <div><h2 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold tracking-tight text-gray-950">检查更改</h2><p className="mt-1 text-sm text-gray-500">确认以下团队的更改： {teamName}.</p></div>
    <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4"><Users aria-hidden="true" className="h-5 w-5 shrink-0 text-gray-500" /><div><p className="text-sm font-medium text-gray-900">成员所属团队 {teamName}</p><p className="mt-1 text-xs leading-5 text-gray-500">这些更改仅分配给此团队，其他团队的成员不受影响。</p></div></div>
    <h3 className="text-sm font-medium text-gray-900">{count} 项权限更改</h3>
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      {[...changes, ...(enabling ? [{ label: "团队权限", before: "已禁用", after: "已启用" }] : [])].map((change) => <div key={change.label} className="p-4">
        <h4 className="text-sm font-medium text-gray-800">{change.label}</h4>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] gap-3 text-sm text-gray-700">
          <div><span className="mb-1 block text-xs text-gray-500">变更前</span><span className="whitespace-pre-wrap break-all">{change.before}</span></div><ArrowRight aria-hidden="true" className="mt-6 h-4 w-4 text-gray-400" /><div><span className="mb-1 block text-xs text-gray-500">变更后</span><span className="whitespace-pre-wrap break-all">{change.after}</span></div>
        </div>
      </div>)}
    </div>
    <DenNotice tone="info" message="成员的应用刷新后将收到更新，其他团队和组织限制继续生效。" />
    {error ? <DenNotice tone="error" message={error} /> : null}
    <div className="flex flex-wrap justify-between gap-3 border-t border-gray-200 pt-4"><DenButton variant="secondary" onClick={keepEditing} disabled={saving}>继续编辑</DenButton><DenButton onClick={() => void save()} disabled={!canManage} loading={saving}>保存权限</DenButton></div>
  </section>;

  return <section aria-label="团队权限" className="mb-8 space-y-5">
    <div><div className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="h-5 w-5 text-gray-500" /><h2 ref={editorHeading} tabIndex={-1} className="text-lg font-semibold tracking-tight text-gray-950">{heading ?? "此团队的权限"}</h2></div>{heading ? null : <p className="mt-1 text-sm text-gray-500">选择以下团队成员的权限： {teamName} 在 OpenWork 中可执行的操作。</p>}</div>
    {enabling ? <DenNotice tone="warning" message="这些权限目前已禁用，检查并保存后可为此团队启用。" /> : null}
    {!canManage ? <DenNotice tone="info" message="更改这些权限需要桌面策略管理权限。" /> : null}
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-gray-900">工作权限</h3><DenButton variant="ghost" size="sm" icon={Eye} aria-expanded={preview} aria-controls={previewId} onClick={() => setPreview(!preview)}>预览成员体验</DenButton></div>
    {preview ? <section id={previewId} aria-label="此团队策略下的成员体验" className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-gray-900">这些选项对成员的影响</h3><DenButton variant="ghost" size="xs" aria-label="关闭成员预览" onClick={() => setPreview(false)}><X aria-hidden="true" className="h-4 w-4" /></DenButton></div>
      <p className="mt-1 text-xs leading-5 text-gray-500">下方显示此团队的设置，其他团队与组织限制可能进一步缩小访问范围。 {enabling ? "此策略目前已禁用。" : "成员仍可使用可用模型与连接进行对话。"}</p>
      <dl aria-live="polite" className="mt-3 divide-y divide-gray-100 text-sm">
        {[{ id: "browserOrigins", label: "浏览网站", value: teamWebsiteSummary(draft.execution) }, { id: "commands", label: "运行计算机命令", value: draft.execution.commands === "deny" ? "已阻止" : draft.execution.blockedCommands.length ? "部分命令已阻止" : "允许" }, { id: "blockBrowserUploads", label: "上传文件与提交表单", value: draft.execution.blockBrowserUploads ? "已阻止" : "允许" }, ...teamCapabilities.map((entry) => ({ id: entry.id, label: entry.teamLabel, value: capabilities[entry.id] ? "允许" : "已阻止" }))].map((entry) => <div key={entry.id} data-testid={`team-permission-preview-${entry.id}`} className="flex flex-wrap justify-between gap-2 py-2"><dt className="text-gray-700">{entry.label}</dt><dd className="text-gray-500">{entry.value}</dd></div>)}
      </dl>
      {draft.execution.browserOrigins?.length ? <p className="mt-2 break-all text-xs leading-5 text-gray-500">获批网站： {draft.execution.browserOrigins.join(", ")}</p> : null}
    </section> : null}
    <fieldset disabled={!canManage || saving} className="min-w-0 space-y-3">
      <legend className="sr-only">团队访问设置</legend>
      <TeamExecutionFields value={draft.execution} onChange={(execution) => { setDraft({ ...draft, execution }); setError(null); }} onPendingSiteChange={setPendingSite} />
      <TeamPermissionGroup title="工具与连接" icon={Puzzle} status={capabilities.allowManageExtensions ? "成员可添加工具" : "由管理员管理"} description={capabilities.allowManageExtensions ? "成员可添加本地工具、技能与 MCP 服务器" : "可使用共享工具 · 无法添加本地工具或技能"}>
        {capabilityFields("tools")}<p className="mt-2 text-xs leading-5 text-gray-500">已安装工具不会被移除，共享插件与连接访问权限在下方管理。</p>
      </TeamPermissionGroup>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 pt-4"><h3 className="text-sm font-medium text-gray-900">应用自定义</h3><span className="text-xs text-gray-500">独立于工作权限</span></div>
      <TeamPermissionGroup title="AI 配置" icon={Sparkles} status={groupStatus("ai")} description={groupStatus("ai") === "由管理员管理" ? "成员使用组织提供的模型" : "选择成员是否可使用额外 AI 选项"}>
        {capabilityFields("ai")}<p className="mt-2 text-xs leading-5 text-gray-500">组织的模型选择在“模型”中管理。</p>
      </TeamPermissionGroup>
      <TeamPermissionGroup title="设置、工作区与更新" icon={Settings} status={groupStatus("app")} description={groupStatus("app") === "由管理员管理" ? "不允许应用更改、额外工作区或实验性更新" : "选择成员可更改的应用设置"}>{capabilityFields("app")}</TeamPermissionGroup>
    </fieldset>
    <div className="flex items-start gap-2 text-xs leading-5 text-gray-500"><Layers aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p>其他团队或组织阻止的功能无法在此解除，云端编辑权限由成员角色决定。 <a href={getMembersRoute(orgSlug)} className="underline underline-offset-4">检查成员角色</a></p></div>
    {error ? <DenNotice tone="error" message={error} /> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
      <div><p role="status" className="text-sm text-gray-700">{count ? `${count} 项未保存的项更改` : "没有未保存的更改"}</p><p className="mt-1 text-xs text-gray-500">{pendingSite ? "请先添加或清除网站地址，再检查更改。" : `适用于 ${teamName}`}</p></div>
      <DenButton onClick={openReview} disabled={!canManage || !count || pendingSite}>检查更改<ArrowRight aria-hidden="true" className="h-4 w-4" /></DenButton>
    </div>
  </section>;
}
