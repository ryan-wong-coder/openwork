"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";
import { TeamAdminCheckbox } from "./team-admin-checkbox";

import Link from "next/link";
import { type ElementType, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Globe,
  Link as LinkIcon,
  Lock,
  MoreHorizontal,
  Plus,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Trash2,
  User,
  Users,
} from "lucide-react";
import {
  canRefreshInvitationRole,
  formatRoleLabel,
  assignableOrgRole,
  getOrgAccessFlags,
  getMembersRoute,
  getEveryoneRoute,
  getNewRoleRoute,
  getPermissionSetRoute,
  getTeamRoute,
  orgFeatureEnabled,
  splitRoleString,
  type DenOrgMember,
  permissionLockReason,
} from "../../_lib/den-org";
import { type OrgLimitError, type OrgPaymentRequiredError, getOrgLimitError, getOrgPaymentRequiredError } from "../../_lib/den-flow";
import { buildDenFeedbackUrl } from "../../_lib/feedback";
import { OrgLimitDialog } from "../../_components/org-limit-dialog";
import { desktopPolicyScreenRemoved } from "../_lib/desktop-policy-screen-rollout";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { UnderlineTabs } from "../../_components/ui/tabs";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { DenSelect } from "../../_components/ui/select";
import { DenSkeleton } from "../../_components/ui/skeleton";
import { installPageUrl } from "../../_lib/install-download";
import { OrgMemberIdentity } from "./org-member-identity";
import { MemberEffectivePermissions, canViewMemberPermissions } from "./member-effective-permissions";
import { RolesTab, canCreateRole } from "./roles-tab";
import { PeopleField } from "./access-rows";
import { ItemMenu } from "./item-list";
import { MemberListToolbar } from "./member-list-toolbar";
import { formatAddedDate } from "./item-dates";
import { TeamsListHeader, TeamsListLane, TeamsListLocked, TeamsListOpenLink, TeamsListRow, teamsListColumns } from "./teams-list-row";
import { teamOverrideSummary, useAgentPermissions } from "./agent-permissions-data";
import { useCustomRoleTeams, useSharedRolesOn, usePermissionSets, useRoleGrantLocks } from "./permissions-data";
import { MemberTeamRoles } from "./member-team-roles";
import { TEAM_ROLE_LABELS, memberRoleOptions, parseRoleChoice, teamRole, teamRoleLabels } from "./team-roles";
import { MemberRoleEditor, MemberRoleSelect } from "./member-role-select";

type MembersTab = "members" | "teams" | "roles";

/**
 * Copies text that is still being fetched. Safari only allows clipboard writes
 * started inside the click, so the pending text is handed to a ClipboardItem;
 * where that is unsupported, write it once it arrives.
 */
async function copyTextWhenReady(text: Promise<string>) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) }),
    ]);
  } catch {
    // Rethrows the fetch error when the text itself failed.
    await navigator.clipboard.writeText(await text);
  }
}

function ActionButton({
  children,
  tone = "default",
  size = "sm",
  icon,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  tone?: "default" | "danger";
  size?: "md" | "sm";
  icon?: ElementType<{ size?: number; className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <DenButton
      variant={tone === "danger" ? "destructive" : "secondary"}
      size={size}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </DenButton>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "dark";
}) {
  return (
    <div
      className={`rounded-[24px] border px-5 py-4 ${tone === "dark" ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-gray-200 bg-white text-gray-900"}`}
    >
      <p
        className={`text-[12px] font-semibold uppercase tracking-[0.16em] ${tone === "dark" ? "text-white/60" : "text-gray-400"}`}
      >
        {label}
      </p>
      <p className="mt-3 text-[24px] font-semibold tracking-[-0.05em]">
        {value}
      </p>
    </div>
  );
}

export function ManageMembersScreen() {
  const {
    activeOrg,
    orgSlug,
    orgContext,
    orgBusy,
    orgError,
    mutationBusy,
    inviteMember,
    startSeatCheckout,
    cancelInvitation,
    getInvitationLink,
    updateMemberRole,
    removeMember,
    transferOwnership,
    createTeam,
    updateTeam,
    deleteTeam,
    runReauthableAction,
  } = useOrgDashboard();
  const [activeTab, setActiveTab] = useState<MembersTab>("members");
  const [memberFilter, setMemberFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const listToolbars = Boolean(orgContext && orgFeatureEnabled(orgContext, "memberListToolbars"));
  const visibleMembers = (orgContext?.members ?? []).filter((member) => !listToolbars || `${member.user.name} ${member.user.email}`.toLocaleLowerCase().includes(memberFilter.trim().toLocaleLowerCase()));
  const visibleTeams = (orgContext?.teams ?? []).filter((team) => !listToolbars || team.name.toLocaleLowerCase().includes(teamFilter.trim().toLocaleLowerCase()));
  const [pageError, setPageError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [openMemberMenuId, setOpenMemberMenuId] = useState<string | null>(null);
  const [memberRoleDraft, setMemberRoleDraft] = useState("member");
  const [editingMemberTeamsId, setEditingMemberTeamsId] = useState<string | null>(null);
  const [permissionsMemberId, setPermissionsMemberId] = useState<string | null>(null);
  const [memberTeamsDraft, setMemberTeamsDraft] = useState<Set<string>>(new Set());
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [teamMemberDraft, setTeamMemberDraft] = useState<string[]>([]);
  const [limitDialogError, setLimitDialogError] = useState<OrgLimitError | null>(null);
  const [seatBillingDialogError, setSeatBillingDialogError] = useState<OrgPaymentRequiredError | null>(null);
  const [installLinkCopied, setInstallLinkCopied] = useState(false);
  const [installLinkShareUrl, setInstallLinkShareUrl] = useState<string | null>(null);
  const [installLinkShareCopied, setInstallLinkShareCopied] = useState(false);

  const access = useMemo(
    () =>
      getOrgAccessFlags(
        orgContext?.currentMember.role ?? "member",
        orgContext?.currentMember.isOwner ?? false,
        orgContext?.currentMember.permissions,
      ),
    [orgContext?.currentMember.isOwner, orgContext?.currentMember.role, orgContext?.currentMember.permissions],
  );
  const canStartSeatCheckout = access.canStartSeatCheckout;

  // teamRoles: Members gets a Roles tab (built-in roles and each team's custom role).
  const teamRoles = orgContext ? orgFeatureEnabled(orgContext, "teamRoles") : false;
  useEffect(() => {
    // ?tab=roles or ?tab=teams opens that tab, e.g. coming back from Create role.
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "roles" || tab === "teams") setActiveTab(tab);
  }, []);
  const shownTab: MembersTab = activeTab === "roles" && !teamRoles ? "members" : activeTab;
  // teamRoles: custom roles show wherever roles do (people's rows, the invite picker, the Teams list).
  const permissionsFeature = orgContext ? orgFeatureEnabled(orgContext, "permissions") : false;
  const customRoles = useCustomRoleTeams(orgContext?.organization.id ?? null, teamRoles && permissionsFeature && access.canViewPermissions);
  const customRoleTeams = teamRoles ? (orgContext?.teams ?? []).filter((team) => customRoles.teamIds.has(team.id)) : [];
  // sharedRoles: list permission sets by name; custom grants still come from teams.
  const sharedRoles = useSharedRolesOn();
  const canChooseInviteRole = access.canManageRoles || sharedRoles && access.canViewPermissions && access.canManageTeams;
  const roleSets = usePermissionSets(orgContext?.organization.id ?? null, sharedRoles && teamRoles && permissionsFeature && access.canViewPermissions);
  const customSets = (sharedRoles && teamRoles && permissionsFeature && access.canViewPermissions ? roleSets.data ?? [] : []).filter((set) => set.kind === "team");
  const grantLocks = useRoleGrantLocks(orgContext?.organization.id ?? null, sharedRoles && teamRoles && permissionsFeature && access.canViewPermissions ? roleSets.data ?? [] : [], orgContext?.currentMember.permissions ?? [], orgContext?.currentMember.isOwner ?? false);
  const roleTeams = (setId: string) => {
    const set = customSets.find((entry) => entry.id === setId);
    const ids = (set?.teams.length ? set.teams : set?.team ? [set.team] : []).map((team) => team.id);
    return (orgContext?.teams ?? []).filter((team) => ids.includes(team.id));
  };
  const roleLocks = new Map(grantLocks);
  for (const set of customSets) {
    const teams = roleTeams(set.id);
    if (teams.length && teams.every((team) => team.managedByScim || team.grantsOrganizationAdmin && !access.canManageAdminTeams)) roleLocks.set(set.id, "This role’s teams are managed by your identity provider or need Manage Admin teams. Ask the organization owner.");
  }
  const memberRoles = memberRoleOptions({ sharedRoles, customRoleTeams, canManageTeams: access.canManageTeams, customRoles: customSets.map((set) => ({ ...set, teams: set.teams.length ? set.teams : set.team ? [set.team] : [] })), lockReasons: roleLocks, adminLockReason: sharedRoles ? !access.canManageRoles ? permissionLockReason("members.update") : grantLocks.get(roleSets.data?.find((set) => set.kind === "admin_default")?.id ?? "") : null });
  const inviteTeamPicker = sharedRoles && access.canManageTeams && (orgContext?.teams.length ?? 0) > 0;
  const [inviteTeamId, setInviteTeamId] = useState("");
  const [memberRoleTeamId, setMemberRoleTeamId] = useState("");
  function chosenRole(value: string, teamId: string) {
    const set = value.startsWith("role:") ? customSets.find((entry) => entry.id === value.slice(5)) : null;
    const teams = set ? roleTeams(set.id) : [];
    const grantable = teams.filter((team) => !team.managedByScim && (!team.grantsOrganizationAdmin || access.canManageAdminTeams));
    const selected = grantable.find((team) => team.id === teamId) ?? (teams.length === 1 ? grantable[0] : undefined);
    return { set, teams, grantable, selected, blocked: value.startsWith("role:") && (!set || !selected || Boolean(roleLocks.get(set.id)) || !access.canManageTeams) };
  }
  const inviteChoice = chosenRole(inviteRole, inviteTeamId);
  const editChoice = chosenRole(memberRoleDraft, memberRoleTeamId);
  function customTeamChoice(value: string, teamId: string, onChange: (id: string) => void) {
    const choice = chosenRole(value, teamId);
    if (!choice.set) return null;
    if (!choice.teams.length) return (
      <p className="col-span-full min-w-0 text-[13px] text-gray-500">
        <Link href={getPermissionSetRoute(orgSlug, choice.set.id)} className="underline" title={choice.set.name}>{choice.set.name}</Link>
        {" 尚未加入团队，请先将其添加到团队。"}
      </p>
    );
    if (choice.teams.length === 1) return (
      <p className="min-w-0 truncate text-[13px] text-gray-500" title={`加入 ${choice.teams[0]?.name}`}>加入 {choice.teams[0]?.name}</p>
    );
    return (
      <label className="grid min-w-0 gap-3">
        <span className="text-[14px] font-medium text-gray-700">团队</span>
        <DenSelect aria-label="团队" value={choice.selected?.id ?? ""} onChange={(event) => onChange(event.target.value)} menuWidth="trigger">
          <option value="">选择团队</option>
          {choice.teams.map((team) => (
            <option key={team.id} value={team.id} disabled={!choice.grantable.includes(team)} title={team.name}>{team.name}</option>
          ))}
        </DenSelect>
      </label>
    );
  }
  // agentPermissions: Teams lists Everyone first, and what each team changes from it.
  const agentPermissionsColumn = Boolean(orgContext && orgFeatureEnabled(orgContext, "agentPermissions") && access.canViewAgentPermissions);
  const agentPolicies = useAgentPermissions(orgContext?.organization.id ?? "", agentPermissionsColumn && Boolean(orgContext?.organization.id));
  const teamListColumns = teamsListColumns({ role: teamRoles, agentPermissions: agentPermissionsColumn });
  const tabCounts: Record<Exclude<MembersTab, "roles">, number> = {
    members: orgContext?.members.length ?? 0,
    teams: orgContext?.teams.length ?? 0,
  };

  const teamMemberNames = useMemo(() => {
    const membersById = new Map(
      (orgContext?.members ?? []).map((member) => [
        member.id,
        member.user.name,
      ]),
    );
    return new Map(
      (orgContext?.teams ?? []).map((team) => [
        team.id,
        team.memberIds
          .map((memberId) => membersById.get(memberId))
          .filter((value): value is string => Boolean(value)),
      ]),
    );
  }, [orgContext?.members, orgContext?.teams]);

  const feedbackHref = useMemo(
    () =>
      buildDenFeedbackUrl({
        pathname: activeOrg ? getMembersRoute(activeOrg.slug) : "/organization",
        orgSlug: activeOrg?.slug ?? null,
        topic: "workspace-limits",
      }),
    [activeOrg],
  );

  function resetInviteForm() {
    setInviteEmail("");
    setInviteRole("member");
    setInviteTeamId("");
    setShowInviteForm(false);
  }

  function resetMemberEditor() {
    setEditingMemberId(null);
    setMemberRoleDraft("member");
    setMemberRoleTeamId("");
  }

  function resetTeamEditor() {
    setEditingTeamId(null);
    setTeamNameDraft("");
    setTeamMemberDraft([]);
    setShowTeamForm(false);
  }

  function selectInstallLinkShareInput() {
    const input = document.getElementById("install-link-share-url");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }

  async function handleInstallLinkShareCopy() {
    if (!installLinkShareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(installLinkShareUrl);
      setInstallLinkShareCopied(true);
      window.setTimeout(() => setInstallLinkShareCopied(false), 1800);
    } catch {
      selectInstallLinkShareInput();
    }
  }

  async function handleCopyInstallLink() {
    const url = installPageUrl();
    setPageError(null);
    setInstallLinkShareUrl(null);
    setInstallLinkShareCopied(false);
    // Some browsers deny programmatic clipboard access entirely; fall back to
    // showing the address for a manual copy instead of a raw browser error.
    try {
      await navigator.clipboard.writeText(url);
      setInstallLinkCopied(true);
      window.setTimeout(() => setInstallLinkCopied(false), 1800);
    } catch {
      setInstallLinkShareUrl(url);
    }
  }

  async function handleTransferOwnership(member: DenOrgMember) {
    const targetName = member.user.name || member.user.email;
    const confirmed = window.confirm(
      `将工作区所有权转让给 ${targetName}？${targetName} 将成为唯一所有者，你的账户将变为管理员。`,
    );
    if (!confirmed) {
      return;
    }

    setPageError(null);
    try {
      await transferOwnership(member.id);
      setOpenMemberMenuId(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "无法转移所有权，请重试。");
    }
  }

  useEffect(() => {
    if (!access.canManageRoles) {
      setInviteRole("member");
      setMemberRoleDraft("member");
    }
  }, [access.canManageRoles]);

  if (orgBusy && !orgContext) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8 md:px-8">
        <div className="rounded-[28px] border border-gray-200 bg-white px-6 py-10 text-[15px] text-gray-500">
          正在加载组织信息…
        </div>
      </div>
    );
  }

  if (!orgContext || !activeOrg) {
    return (
      <div className="mx-auto max-w-[1200px] px-6 py-8 md:px-8">
        <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-4 text-[15px] text-red-700">
          {orgError ?? "组织详情不可用。"}
        </div>
      </div>
    );
  }

  const inviteForm =
    showInviteForm && access.canInviteMembers ? (
      <DenCard className="mb-6">
        <form
          className={`grid gap-4 lg:items-end ${inviteTeamPicker ? "lg:grid-cols-[minmax(0,1fr)_180px_220px]" : access.canManageRoles ? "lg:grid-cols-[minmax(0,1.4fr)_220px_auto]" : "lg:grid-cols-[minmax(0,1fr)_220px_auto]"}`}
          onSubmit={async (event) => {
            event.preventDefault();
            setPageError(null);
            try {
              // Custom roles remain Member and grant access through exactly one chosen team.
              if (inviteChoice.blocked) return;
              const choice = parseRoleChoice(canChooseInviteRole ? inviteRole : "member");
              const teamId = inviteChoice.set ? inviteChoice.selected?.id : inviteTeamPicker ? inviteTeamId || null : choice.teamId ?? undefined;
              await inviteMember({ email: inviteEmail, role: choice.role, teamId });
              resetInviteForm();
            } catch (error) {
              const paymentRequiredError = getOrgPaymentRequiredError(error);
              if (paymentRequiredError) {
                setSeatBillingDialogError(paymentRequiredError);
                return;
              }

              const limitError = getOrgLimitError(error);
              if (limitError) {
                setLimitDialogError(limitError);
                return;
              }

              setPageError(
                error instanceof Error
                  ? error.message
                  : "无法邀请成员，请重试。",
              );
            }
          }}
        >
          <label className="grid gap-3">
            <span className="text-[14px] font-medium text-gray-700">电子邮箱</span>
            <DenInput
              type="email"
              data-testid="invite-email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
            />
          </label>
          {canChooseInviteRole ? (
            <label className="grid gap-3">
              <span className="text-[14px] font-medium text-gray-700">角色</span>
              <MemberRoleSelect value={inviteRole} onChange={(value) => { setInviteRole(value); setInviteTeamId(""); }} options={memberRoles} searchable={sharedRoles} />
            </label>
          ) : (
            <div className="grid gap-3">
              <span className="text-[14px] font-medium text-gray-700">角色</span>
              <DenInput value="Member" readOnly disabled aria-describedby="invite-role-locked" />
            </div>
          )}
          {customTeamChoice(inviteRole, inviteTeamId, setInviteTeamId)}
          {inviteTeamPicker && !inviteChoice.set ? (
            <label className="grid gap-3">
              <span className="text-[14px] font-medium text-gray-700">团队</span>
              {/* sharedRoles: each team shows its role, so picking a team decides the custom role. */}
              <DenSelect aria-label="团队" value={inviteTeamId} onChange={(event) => setInviteTeamId(event.target.value)} menuWidth="trigger">
                <option value="">无团队</option>
                {orgContext.teams.filter((team) => !team.managedByScim && (!team.grantsOrganizationAdmin || access.canManageAdminTeams)).map((team) => (
                  <option key={team.id} value={team.id} title={team.name}>
                    {team.name}
                    <span className="ml-1.5 font-normal text-gray-500">{team.grantsOrganizationAdmin ? "管理员" : access.canViewPermissions ? customRoles.nameByTeam.get(team.id) ?? "成员" : ""}</span>
                  </option>
                ))}
              </DenSelect>
            </label>
          ) : null}
          <div className={`flex gap-2 lg:justify-end ${inviteTeamPicker ? "lg:col-span-3" : ""}`}>
            <ActionButton size="md" onClick={resetInviteForm}>取消</ActionButton>
            <DenButton type="submit" loading={mutationBusy === "invite-member"} disabled={inviteChoice.blocked}>
              发送邀请
            </DenButton>
          </div>
          {canChooseInviteRole ? null : (
            <p id="invite-role-locked" className="flex items-center gap-1.5 text-[13px] text-gray-500 lg:col-span-3">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {`无法邀请新管理员。${permissionLockReason("members.update")}`}
            </p>
          )}
          {access.canManageRoles && !sharedRoles && customRoleTeams.length > 0 && !access.canManageTeams ? (
            <p className="flex items-center gap-1.5 text-[13px] text-gray-500 lg:col-span-3">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {`无法邀请具有自定义角色的成员。${permissionLockReason("teams.manage")}`}
            </p>
          ) : null}
        </form>
      </DenCard>
    ) : null;

  const editingMember = editingMemberId ? orgContext.members.find((member) => member.id === editingMemberId) ?? null : null;
  // sharedRoles: custom roles come from the person's teams, so show those next to their own role.
  const editingMemberTeamRoles = editingMember && sharedRoles
    ? teamRoleLabels({
        memberId: editingMember.id,
        ownRole: getOrgAccessFlags(editingMember.role, false).isAdmin ? "admin" : "member",
        teams: orgContext.teams,
        customTeamIds: customRoles.teamIds,
        customRoleNameByTeam: customRoles.nameByTeam,
      })
    : [];

  async function saveMemberRole(member: DenOrgMember) {
    setPageError(null);
    try {
      // A custom role grants through a team, never through organization Admin.
      // Remove direct Admin first: joining before demoting would temporarily
      // combine the old Admin grant with the new custom permissions.
      if (editChoice.blocked) return;
      const choice = parseRoleChoice(memberRoleDraft);
      const team = editChoice.set ? editChoice.selected : choice.teamId ? orgContext?.teams.find((entry) => entry.id === choice.teamId) : null;
      const demoteFirst = sharedRoles && choice.role === "member" && assignableOrgRole(member.role) === "admin";
      if (demoteFirst) await updateMemberRole(member.id, "member");
      if (team && !team.memberIds.includes(member.id)) {
        await updateTeam(team.id, { memberIds: [...team.memberIds, member.id] });
      }
      if (!demoteFirst && choice.role !== assignableOrgRole(member.role)) {
        await updateMemberRole(member.id, choice.role);
      }
      resetMemberEditor();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "无法更新成员角色，请重试。");
    }
  }

  const editMemberForm =
    editingMember && access.canManageRoles ? (
      <MemberRoleEditor
        memberName={editingMember.user.name || editingMember.user.email}
        value={memberRoleDraft}
        onChange={(value) => { setMemberRoleDraft(value); setMemberRoleTeamId(""); }}
        searchable={sharedRoles}
        teamChoice={customTeamChoice(memberRoleDraft, memberRoleTeamId, setMemberRoleTeamId)}
        blocked={editChoice.blocked}
        options={memberRoles}
        saving={mutationBusy === "update-member-role" || mutationBusy === "update-team"}
        onCancel={resetMemberEditor}
        onSave={() => saveMemberRole(editingMember)}
        teamRoles={sharedRoles ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="member-role-editor-team-roles">
            <span className="min-w-0 truncate" title={editingMemberTeamRoles.join(", ")}>
              {editingMemberTeamRoles.length > 0 ? `来自团队：${editingMemberTeamRoles.join(", ")}` : "没有来自团队的角色"}
            </span>
            {access.canManageTeams ? (
              <button
                type="button"
                onClick={() => {
                  setEditingMemberTeamsId(editingMember.id);
                  setMemberTeamsDraft(new Set(orgContext.teams.filter((team) => team.memberIds.includes(editingMember.id)).map((team) => team.id)));
                  resetMemberEditor();
                }}
                className="shrink-0 rounded font-medium text-gray-700 underline-offset-2 transition hover:text-gray-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
              >
                管理团队
              </button>
            ) : null}
          </span>
        ) : undefined}
      />
    ) : null;

  const teamForm =
    (showTeamForm || editingTeamId) && access.canManageTeams ? (
      <DenCard className="mb-6">
        <form
          className="grid gap-6"
          onSubmit={async (event) => {
            event.preventDefault();
            setPageError(null);
            try {
              if (editingTeamId) {
                await updateTeam(editingTeamId, {
                  name: teamNameDraft,
                  memberIds: teamMemberDraft,
                });
              } else {
                await createTeam({
                  name: teamNameDraft,
                  memberIds: teamMemberDraft,
                });
              }
              resetTeamEditor();
            } catch (error) {
              setPageError(
                error instanceof Error ? error.message : "无法保存团队，请重试。",
              );
            }
          }}
        >
          <label className="grid gap-3 lg:max-w-[420px]">
            <span className="text-[14px] font-medium text-gray-700">
              团队名称
            </span>
            <DenInput
              type="text"
              value={teamNameDraft}
              onChange={(event) => setTeamNameDraft(event.target.value)}
              placeholder="核心研发"
              required
            />
          </label>

          <div>
            <p className="mb-3 text-[14px] font-medium text-gray-700">
              团队成员
            </p>
            {orgContext.members.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-gray-200 bg-gray-50 px-5 py-6 text-[14px] text-gray-500">
                请先邀请成员，再将人员分配到此团队。
              </div>
            ) : teamRoles ? (
              // teamRoles: the same people rows and Add person picker as Create role.
              <PeopleField
                people={orgContext.members.map((member) => ({ id: member.id, name: member.user.name || member.user.email, email: member.user.email }))}
                chosenIds={teamMemberDraft}
                onChange={setTeamMemberDraft}
                rowTestId="team-form-person"
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {orgContext.members.map((member) => {
                  const selected = teamMemberDraft.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        setTeamMemberDraft((current) =>
                          current.includes(member.id)
                            ? current.filter((entry) => entry !== member.id)
                            : [...current, member.id],
                        );
                      }}
                      className={`flex items-start gap-3 rounded-[22px] border px-4 py-4 text-left transition ${
                        selected
                          ? "border-[#0f172a] bg-[#0f172a] text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      {selected ? (
                        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
                      ) : (
                        <Circle className="mt-0.5 h-6 w-6 shrink-0 text-gray-300" />
                      )}
                      <OrgMemberIdentity member={member} inverted={selected} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton size="md" onClick={resetTeamEditor}>取消</ActionButton>
            <DenButton
              type="submit"
              loading={mutationBusy === "create-team" || mutationBusy === "update-team"}
            >
              {editingTeamId ? "保存团队" : "创建团队"}
            </DenButton>
          </div>
        </form>
      </DenCard>
    ) : null;

  const toolbarAction = (() => {
    if (shownTab === "members" && access.canInviteMembers) {
      return {
        label: "添加成员",
        onClick: () => {
          resetMemberEditor();
          setShowInviteForm((current) => !current);
        },
      };
    }
    if (activeTab === "teams" && access.canManageTeams) {
      return {
        label: "创建团队",
        onClick: () => {
          resetTeamEditor();
          setShowTeamForm((current) => !current);
        },
      };
    }
    return null;
  })();

  return (
    <DashboardPageTemplate
      icon={Users}
      title="成员"
      description={listToolbars ? null : "邀请队友、调整角色并管理访问权限。"}
    >
      <OrgLimitDialog
        open={Boolean(limitDialogError)}
        title={limitDialogError?.limitType === "members" ? "已达成员上限" : "已达工作实例上限"}
        message={limitDialogError?.message ?? "此工作区已达到当前套餐上限。"}
        detail={
          limitDialogError
            ? `已有 ${limitDialogError.currentCount} / ${limitDialogError.limit} ${limitDialogError.limitType === "members" ? "个成员席位" : "个工作实例"}正在使用。`
            : null
        }
        feedbackHref={feedbackHref}
        onClose={() => setLimitDialogError(null)}
      />
      <OrgLimitDialog
        open={Boolean(seatBillingDialogError)}
        eyebrow="席位计费"
        title="订阅以添加更多用户"
        message="组织前 5 名用户免费，额外用户按每人每月 10 美元计费。"
        detail={canStartSeatCheckout ? null : permissionLockReason("billing.manage")}
        closeLabel="取消"
        actionLabel="订阅"
        actionLoading={mutationBusy === "seat-checkout"}
        actionDisabled={!canStartSeatCheckout}
        onClose={() => setSeatBillingDialogError(null)}
        onAction={() => {
          if (!canStartSeatCheckout) {
            return;
          }
          void startSeatCheckout().catch((error) => {
            setPageError(error instanceof Error ? error.message : "无法开始席位结账，请重试。");
          });
        }}
      />

      {pageError ? (
        <DenNotice message={pageError} className="mb-6" />
      ) : null}

      <UnderlineTabs
        className="mb-6"
        activeTab={shownTab}
        onChange={setActiveTab}
        tabs={[
          { value: "members", label: "成员", icon: User, count: tabCounts.members },
          { value: "teams", label: "团队", icon: Users, count: tabCounts.teams },
          ...(teamRoles ? [{ value: "roles" as const, label: "角色", icon: ShieldCheck }] : []),
        ]}
      />

      {shownTab === "roles" ? (
        <RolesTab
          action={orgContext && canCreateRole({ permissionsFeature: orgFeatureEnabled(orgContext, "permissions"), canManageTeams: access.canManageTeams, canManagePermissions: access.canManagePermissions })
            ? <DenButton size={listToolbars ? "sm" : "md"} icon={Plus} href={getNewRoleRoute(orgSlug)} data-testid="roles-create">创建角色</DenButton>
            : undefined}
        />
      ) : null}

      {shownTab === "members" ? inviteForm : null}
      {shownTab === "members" ? editMemberForm : null}
      {activeTab === "teams" ? teamForm : null}

      {shownTab === "members" ? (
        <div>
          {listToolbars ? <MemberListToolbar
            collection="members" value={memberFilter} onChange={setMemberFilter}
            action={<DenButton size="sm" icon={access.canInviteMembers ? Plus : Lock} disabled={!access.canInviteMembers} title={!access.canInviteMembers ? permissionLockReason("invitations.manage") : undefined} onClick={() => { resetMemberEditor(); setShowInviteForm((current) => !current); }}>添加成员</DenButton>}
            secondary={access.canInviteMembers && orgContext.capabilities.installLinks ? <ItemMenu label="成员列表操作" entries={[{ label: installLinkCopied ? "已复制" : "复制安装链接", onSelect: handleCopyInstallLink }]} /> : undefined}
          /> : <div className="mb-6 flex flex-wrap items-center justify-end gap-4" data-testid="members-toolbar">
            {toolbarAction ? (
              <div className="flex flex-wrap justify-end gap-2">
                {orgContext.capabilities.installLinks ? (
                  <DenButton
                    data-testid="copy-install-link"
                    variant="secondary"
                    icon={LinkIcon}
                    onClick={() => void handleCopyInstallLink()}
                  >
                    {installLinkCopied ? "已复制" : "复制安装链接"}
                  </DenButton>
                ) : null}
                <DenButton icon={Plus} onClick={toolbarAction.onClick}>
                  {toolbarAction.label}
                </DenButton>
              </div>
            ) : null}
          </div>}

          {installLinkShareUrl ? (
            <div className="mb-6 rounded-[24px] border border-gray-200 bg-white px-5 py-4">
              <p className="text-[13px] text-gray-500">
                浏览器阻止了复制，请手动复制链接：
              </p>
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center">
                <DenInput
                  id="install-link-share-url"
                  data-testid="install-link-share-url"
                  value={installLinkShareUrl}
                  readOnly
                  aria-label="安装链接"
                  className="font-mono text-[12px]"
                  onFocus={(event) => event.currentTarget.select()}
                  onClick={(event) => event.currentTarget.select()}
                />
                <div className="flex shrink-0 gap-2">
                  <DenButton
                    data-testid="install-link-share-copy"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleInstallLinkShareCopy()}
                  >
                    {installLinkShareCopied ? "已复制" : "复制"}
                  </DenButton>
                  <DenButton
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setInstallLinkShareUrl(null);
                      setInstallLinkShareCopied(false);
                    }}
                  >
                    完成
                  </DenButton>
                </div>
              </div>
            </div>
          ) : null}

          <div className="overflow-visible rounded-2xl border border-gray-100 bg-white">
            <div data-testid="members-column-header" className={`grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-gray-100 py-3 text-[12px] font-medium text-gray-500 ${listToolbars ? "px-5 lg:grid-cols-[minmax(0,1fr)_180px_140px_28px]" : "px-4 lg:grid-cols-[minmax(0,1fr)_180px_140px_160px] lg:px-6"}`}>
              <span>成员</span>
              <span className="hidden lg:block">角色</span>
              <span className="hidden lg:block">加入时间</span>
              <span />
            </div>

            {visibleMembers.length === 0 ? <p className="px-5 py-6 text-[13px] text-gray-500" role="status">{memberFilter.trim() ? "没有符合筛选条件的成员。" : "暂无成员。"}</p> : null}
            {visibleMembers.map((member) => {
              const roleLabels = [
                ...splitRoleString(member.role).map(formatRoleLabel),
                ...(teamRoles ? teamRoleLabels({ memberId: member.id, ownRole: member.isOwner ? "owner" : getOrgAccessFlags(member.role, false).isAdmin ? "admin" : "member", teams: orgContext.teams, customTeamIds: customRoles.teamIds, customRoleNameByTeam: sharedRoles ? customRoles.nameByTeam : undefined }) : member.adminTeams.length > 0 ? ["管理员"] : []),
              ];
              const roleLabel = [...new Set(roleLabels)].join(", ");
              const isInvited = !member.joinedAt;
              const inviteId = member.inviteId;
              const memberAccess = getOrgAccessFlags(member.effectiveRole, member.isOwner);
              const canManageMemberGrants = access.canManageAdminTeams || member.adminTeams.length === 0;
              const canResendInvitation = isInvited && canManageMemberGrants && canRefreshInvitationRole(member.role, access);
              const canTransferOwnershipToMember = access.canTransferOwnership && !isInvited && memberAccess.isAdmin;
              const canViewPermissions = !isInvited && canViewMemberPermissions(orgContext, member.id);
              const canOpenActions = member.isOwner
                ? false
                : isInvited
                  ? canResendInvitation || (access.canCancelInvitations && canManageMemberGrants)
                  : access.canManageRoles || access.canManageTeams || access.canRemoveMembers || canTransferOwnershipToMember || canViewPermissions;

              const memberActions = [
                ...(canResendInvitation && inviteId ? [{ label: "复制邀请链接", onSelect: async () => { setPageError(null); try { await copyTextWhenReady(getInvitationLink(inviteId)); } catch (error) { setPageError(error instanceof Error ? error.message : "无法复制邀请链接，请手动复制。"); } } }] : []),
                ...(canResendInvitation ? [{ label: "重新发送邀请", disabled: mutationBusy === "invite-member", onSelect: async () => { try { await inviteMember({ email: member.user.email, role: assignableOrgRole(member.role) }); } catch (error) { setPageError(error instanceof Error ? error.message : "无法重新发送邀请，请重试。"); } } }] : []),
                ...(isInvited && access.canCancelInvitations && canManageMemberGrants && inviteId ? [{ label: "取消邀请", destructive: true, onSelect: async () => { try { await cancelInvitation(inviteId); } catch (error) { setPageError(error instanceof Error ? error.message : "无法取消邀请，请重试。"); } } }] : []),
                ...(canViewPermissions ? [{ label: permissionsMemberId === member.id ? "隐藏权限" : "查看权限", onSelect: () => setPermissionsMemberId((current) => current === member.id ? null : member.id) }] : []),
                ...(!isInvited ? [{ label: "编辑角色", disabled: !access.canManageRoles, onSelect: () => { setEditingMemberId(member.id); setMemberRoleDraft(assignableOrgRole(member.role)); setShowInviteForm(false); } }] : []),
                ...(canTransferOwnershipToMember ? [{ label: "转移所有权", disabled: mutationBusy === "transfer-ownership", onSelect: () => handleTransferOwnership(member) }] : []),
                ...(!isInvited && access.canManageTeams ? [{ label: "管理团队", onSelect: () => { setEditingMemberTeamsId(member.id); setMemberTeamsDraft(new Set(orgContext.teams.filter((team) => team.memberIds.includes(member.id)).map((team) => team.id))); } }] : []),
                ...(!isInvited && access.canRemoveMembers && canManageMemberGrants ? [{ label: "移除成员", destructive: true, confirm: { title: `移除 ${member.user.name || member.user.email}？`, description: "他们将失去此组织的访问权限，之后可重新邀请。", action: "Remove member" }, onSelect: async () => { await removeMember(member.id); if (editingMemberId === member.id) resetMemberEditor(); } }] : []),
              ];
              return (
                <div key={member.id}>
                <div
                  data-testid="member-row"
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-gray-100 transition hover:bg-gray-50/60 last:border-b-0 lg:gap-4 ${listToolbars ? "min-h-16 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_180px_140px_28px]" : "px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_180px_140px_160px] lg:px-6"}`}
                >
                  <OrgMemberIdentity member={member} compact={listToolbars} />
                  <span title={listToolbars ? roleLabel : undefined} className={`col-start-1 row-start-2 min-w-0 pl-11 text-[13px] text-gray-500 lg:col-auto lg:row-auto lg:pl-0 ${listToolbars ? "truncate" : ""}`} data-testid="member-role">
                    {listToolbars ? roleLabel : splitRoleString(member.role).map(formatRoleLabel).join(", ")}
                    {!listToolbars && teamRoles ? (
                      <MemberTeamRoles member={member} teams={orgContext.teams} customTeamIds={customRoles.teamIds} customRoleNameByTeam={sharedRoles ? customRoles.nameByTeam : undefined} />
                    ) : !listToolbars && member.adminTeams.length > 0 ? (
                      <span className="mt-1 block text-[12px] text-cyan-700">管理员权限来自 {member.adminTeams.map((team) => team.name).join(", ")}</span>
                    ) : null}
                  </span>
                  <span data-testid="member-joined" className="col-start-1 row-start-3 pl-11 text-[13px] text-gray-500 lg:col-auto lg:row-auto lg:pl-0">
                    {member.joinedAt ? <span className="lg:hidden">加入时间 </span> : null}
                    {member.joinedAt
                      ? listToolbars ? formatAddedDate(member.joinedAt) : new Date(member.joinedAt).toLocaleDateString(DEFAULT_DEN_LOCALE)
                      : "待处理"}
                  </span>
                  <div data-testid="member-actions" className="relative col-start-2 row-span-3 row-start-1 flex items-center justify-end gap-2 lg:col-auto lg:row-span-1 lg:row-auto">
                    {listToolbars ? (
                      member.isOwner ? <span data-testid="member-owner-locked"><TeamsListLocked reason="无法在此编辑所有者，只有所有者可将所有权转移给管理员。" /></span> : canOpenActions ? <ItemMenu label={`打开 ${member.user.name || member.user.email} 的操作`} entries={memberActions} /> : <TeamsListLocked reason="你无法更改此成员，请联系组织管理员授权。" />
                    ) : member.isOwner ? (
                      <span data-testid="member-owner-locked" className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[12px] text-gray-600">
                        <Lock className="h-3 w-3" />
                        已锁定
                      </span>
                    ) : canOpenActions ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setOpenMemberMenuId((current) => current === member.id ? null : member.id)}
                          className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                          aria-label={`打开 ${member.user.name} 的操作`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMemberMenuId === member.id ? (
                          <div className="absolute right-0 top-9 z-10 w-44 overflow-hidden rounded-2xl border border-gray-100 bg-white p-1.5 text-[13px] shadow-xl shadow-gray-900/10">
                            {canResendInvitation && inviteId ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setPageError(null);
                                  setOpenMemberMenuId(null);
                                  try {
                                    await copyTextWhenReady(getInvitationLink(inviteId));
                                  } catch (error) {
                                    setPageError(error instanceof Error ? error.message : "无法复制邀请链接，请手动复制。");
                                  }
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50"
                              >
                                <LinkIcon className="h-3.5 w-3.5" />
                                复制邀请链接
                              </button>
                            ) : null}
                            {canResendInvitation ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setPageError(null);
                                  try {
                                    await inviteMember({ email: member.user.email, role: assignableOrgRole(member.role) });
                                    setOpenMemberMenuId(null);
                                  } catch (error) {
                                    setPageError(error instanceof Error ? error.message : "无法重新发送邀请，请重试。");
                                  }
                                }}
                                disabled={mutationBusy === "invite-member"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Send className="h-3.5 w-3.5" />
                                重新发送邀请
                              </button>
                            ) : null}
                            {isInvited && access.canCancelInvitations && canManageMemberGrants && inviteId ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setPageError(null);
                                  try {
                                    await cancelInvitation(inviteId);
                                    setOpenMemberMenuId(null);
                                  } catch (error) {
                                    setPageError(error instanceof Error ? error.message : "无法取消邀请，请重试。");
                                  }
                                }}
                                disabled={mutationBusy === "cancel-invitation"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                取消邀请
                              </button>
                            ) : null}
                            {canViewPermissions ? (
                              <button
                                type="button"
                                data-testid="view-member-permissions"
                                onClick={() => {
                                  setPermissionsMemberId((current) => current === member.id ? null : member.id);
                                  setOpenMemberMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                {permissionsMemberId === member.id ? "隐藏权限" : "查看权限"}
                              </button>
                            ) : null}
                            {!isInvited && access.canManageRoles ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMemberId(member.id);
                                  setMemberRoleDraft(assignableOrgRole(member.role));
                                  setShowInviteForm(false);
                                  setOpenMemberMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50"
                              >
                                <Settings className="h-3.5 w-3.5" />
                                编辑角色
                              </button>
                            ) : !isInvited ? (
                              <button
                                type="button"
                                disabled
                                title={permissionLockReason("members.update")}
                                className="flex w-full cursor-not-allowed items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-400"
                              >
                                <Lock className="h-3.5 w-3.5" />
                                编辑角色
                              </button>
                            ) : null}
                            {canTransferOwnershipToMember ? (
                              <button
                                type="button"
                                onClick={() => void handleTransferOwnership(member)}
                                disabled={mutationBusy === "transfer-ownership"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Shield className="h-3.5 w-3.5" />
                                转移所有权
                              </button>
                            ) : null}
                            {!isInvited && access.canManageTeams ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const currentTeamIds = new Set(
                                    (orgContext?.teams ?? [])
                                      .filter((team) => team.memberIds.includes(member.id))
                                      .map((team) => team.id),
                                  );
                                  setEditingMemberTeamsId(member.id);
                                  setMemberTeamsDraft(currentTeamIds);
                                  setOpenMemberMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-gray-600 transition hover:bg-gray-50"
                              >
                                <Users className="h-3.5 w-3.5" />
                                管理团队
                              </button>
                            ) : null}
                            {!isInvited && access.canRemoveMembers && canManageMemberGrants ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setPageError(null);
                                  try {
                                    await removeMember(member.id);
                                    if (editingMemberId === member.id) {
                                      resetMemberEditor();
                                    }
                                    setOpenMemberMenuId(null);
                                  } catch (error) {
                                    setPageError(error instanceof Error ? error.message : "无法移除成员，请重试。");
                                  }
                                }}
                                disabled={mutationBusy === "remove-member"}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                移除成员
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-[13px] text-gray-500">只读</span>
                    )}
                  </div>
                </div>
                {permissionsMemberId === member.id && canViewPermissions ? (
                  <div className="border-b border-gray-100 px-6 py-4" data-testid="member-permissions-panel">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="text-[13px] font-medium text-gray-900">实际权限</h3>
                      <button
                        type="button"
                        onClick={() => setPermissionsMemberId(null)}
                        className="rounded text-[12px] text-gray-500 transition hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                      >
                        隐藏
                      </button>
                    </div>
                    <MemberEffectivePermissions memberId={member.id} memberName={member.user.name} />
                  </div>
                ) : null}
                {editingMemberTeamsId === member.id ? (
                  <div className="col-span-full border-b border-gray-100 bg-gray-50/50 px-6 py-4">
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="flex-1">
                        <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-gray-400">
                          团队所属人员 {member.user.name}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(orgContext?.teams ?? []).map((team) => {
                            const selected = memberTeamsDraft.has(team.id);
                            return (
                              <button
                                key={team.id}
                                type="button"
                                disabled={team.managedByScim || (team.grantsOrganizationAdmin && !access.canManageAdminTeams)}
                                onClick={() => {
                                  setMemberTeamsDraft((current) => {
                                    const next = new Set(current);
                                    if (next.has(team.id)) {
                                      next.delete(team.id);
                                    } else {
                                      next.add(team.id);
                                    }
                                    return next;
                                  });
                                }}
                                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${selected ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}
                              >
                                {selected ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                ) : (
                                  <Circle className="h-3.5 w-3.5" />
                                )}
                                {team.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-5">
                        <button
                          type="button"
                          onClick={() => setEditingMemberTeamsId(null)}
                          className="inline-flex h-8 items-center rounded-full border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-gray-600 transition hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={mutationBusy === "update-team"}
                          onClick={async () => {
                            setPageError(null);
                            try {
                              // For each team, update its member list to add or remove this member.
                              for (const team of orgContext?.teams ?? []) {
                                const wasInTeam = team.memberIds.includes(member.id);
                                const shouldBeInTeam = memberTeamsDraft.has(team.id);
                                if (wasInTeam === shouldBeInTeam) continue;
                                const nextMemberIds = shouldBeInTeam
                                  ? [...team.memberIds, member.id]
                                  : team.memberIds.filter((id) => id !== member.id);
                                await updateTeam(team.id, { memberIds: nextMemberIds });
                              }
                              setEditingMemberTeamsId(null);
                            } catch (error) {
                              setPageError(error instanceof Error ? error.message : "无法更新团队，请重试。");
                            }
                          }}
                          className="inline-flex h-8 items-center rounded-full bg-gray-900 px-3.5 text-[13px] font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          保存团队
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "teams" ? (
        <div>
          {listToolbars ? <MemberListToolbar collection="teams" value={teamFilter} onChange={setTeamFilter} action={<DenButton size="sm" icon={access.canManageTeams ? Plus : Lock} disabled={!access.canManageTeams} title={!access.canManageTeams ? permissionLockReason("teams.manage") : undefined} onClick={() => { resetTeamEditor(); setShowTeamForm((current) => !current); }}>创建团队</DenButton>} /> : <div className="mb-6 flex items-center justify-between gap-4">
            <p className="text-[14px] text-gray-500">管理团队及其成员。</p>
            {toolbarAction ? (
              <DenButton icon={Plus} onClick={toolbarAction.onClick}>
                {toolbarAction.label}
              </DenButton>
            ) : null}
          </div>}

          <div className="rounded-2xl border border-gray-100 bg-white" data-testid="teams-list">
            <TeamsListHeader columns={teamListColumns} role={teamRoles} agentPermissions={agentPermissionsColumn} />

            {(agentPermissionsColumn || desktopPolicyScreenRemoved(orgContext)) && (!listToolbars || "everyone".includes(teamFilter.trim().toLocaleLowerCase())) ? (
              <TeamsListRow
                testId="team-row-everyone"
                columns={teamListColumns}
                icon={Globe}
                name="Everyone"
                href={getEveryoneRoute(orgSlug)}
                subtitle="所有成员，包括未加入团队的人员"
                lanes={(
                  <>
                    {teamRoles ? <TeamsListLane testId="team-row-role">成员</TeamsListLane> : null}
                    {agentPermissionsColumn ? <TeamsListLane testId="team-row-agent-permissions">所有团队的基础设置</TeamsListLane> : null}
                    <TeamsListLane testId="team-row-members" tone="muted">{peopleCount(orgContext.members.length)}</TeamsListLane>
                  </>
                )}
                action={<TeamsListOpenLink href={getEveryoneRoute(orgSlug)} name="Everyone" />}
              />
            ) : null}

            {visibleTeams.length === 0 ? (
              <div className="px-5 py-6 text-[13px] text-gray-500" role="status">
                {listToolbars && teamFilter.trim() ? "没有符合筛选条件的团队。" : "暂无团队。"}
              </div>
            ) : (
              visibleTeams.map((team) => {
                const names = teamMemberNames.get(team.id) ?? [];
                const role = teamRoles
                  // Without permissions.view a custom role can't be told from Member, so only Admin is named.
                  ? team.grantsOrganizationAdmin || !permissionsFeature || access.canViewPermissions
                    ? team.grantsOrganizationAdmin || !sharedRoles || !customRoles.setByTeam.get(team.id)
                      ? TEAM_ROLE_LABELS[teamRole({ admin: team.grantsOrganizationAdmin, customSetId: customRoles.setByTeam.get(team.id)?.id ?? null })]
                      : customRoles.setByTeam.get(team.id)?.name ?? ""
                    : "—"
                  : "";
                const canEdit = !team.managedByScim && access.canManageTeams && (!team.grantsOrganizationAdmin || access.canManageAdminTeams);
                return (
                  <TeamsListRow
                    key={team.id}
                    testId="team-row"
                    columns={teamListColumns}
                    icon={Users}
                    name={team.name}
                    href={access.canViewTeams ? getTeamRoute(orgSlug, team.id) : undefined}
                    badge={team.managedByScim ? (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">由 SCIM 管理</span>
                    ) : null}
                    subtitle={names.length > 0 ? names.join(", ") : team.memberIds.length > 0 ? peopleCount(team.memberIds.length) : "暂无成员"}
                    // teamRoles: Admin is the team's role (Role tab), so the old checkbox goes away.
                    extra={teamRoles ? null : <TeamAdminCheckbox team={team} />}
                    lanes={(
                      <>
                        {teamRoles ? <TeamsListLane testId="team-row-role" title={role}>{role}</TeamsListLane> : null}
                        {agentPermissionsColumn ? <TeamAgentPermissionsCell summary={agentPolicies.isSuccess ? teamOverrideSummary(agentPolicies.data.teams.find((policy) => policy.scopeId === team.id)) : undefined} failed={agentPolicies.isError} /> : null}
                        <TeamsListLane testId="team-row-members" tone="muted">{peopleCount(team.memberIds.length)}</TeamsListLane>
                      </>
                    )}
                    action={canEdit ? (
                      <ItemMenu
                        label={`${team.name} 的操作`}
                        entries={[
                          {
                            label: "编辑",
                            onSelect: () => {
                              setShowTeamForm(false);
                              setEditingTeamId(team.id);
                              setTeamNameDraft(team.name);
                              setTeamMemberDraft(team.memberIds);
                            },
                          },
                          {
                            label: "删除",
                            destructive: true,
                            disabled: mutationBusy === "delete-team",
                            confirm: {
                              title: `删除 ${team.name}？`,
                              description: `${team.memberIds.length > 0 ? `${peopleCount(team.memberIds.length)} 将失去` : "所有人都将保留"}此团队的${teamLosses({ role: teamRoles, agentPermissions: agentPermissionsColumn })}。此操作无法撤销。`,
                              action: "Delete team",
                            },
                            onSelect: async () => {
                              setPageError(null);
                              await deleteTeam(team.id);
                              if (editingTeamId === team.id) resetTeamEditor();
                            },
                          },
                        ]}
                      />
                    ) : (
                      <TeamsListLocked
                        reason={team.managedByScim
                          ? "由身份提供商管理"
                          : access.canManageTeams ? permissionLockReason("teams.manage_admin") : permissionLockReason("teams.manage")}
                      />
                    )}
                  />
                );
              })
            )}
          </div>
        </div>
      ) : null}

    </DashboardPageTemplate>
  );
}

/** A team's agent permissions in the Teams list: its own overrides, or that it follows Everyone. */
function TeamAgentPermissionsCell({ summary, failed }: { summary: string | null | undefined; failed: boolean }) {
  if (failed) return <TeamsListLane testId="team-row-agent-permissions" title="无法加载代理权限" tone="muted">—</TeamsListLane>;
  if (summary === undefined) return <span role="status" aria-label="正在加载代理权限" data-testid="team-row-agent-permissions" className="hidden lg:block"><DenSkeleton className="h-3 w-24" /></span>;
  return summary === null
    ? <TeamsListLane testId="team-row-agent-permissions" tone="muted">使用所有人的设置</TeamsListLane>
    : <TeamsListLane testId="team-row-agent-permissions" title={summary}>{summary}</TeamsListLane>;
}

function peopleCount(count: number): string {
  return `${count} 名成员`;
}

/** What a team's members stop getting when it is deleted, for the confirmation (DESIGN.md P9). */
function teamLosses({ role, agentPermissions }: { role: boolean; agentPermissions: boolean }): string {
  const parts = [role ? "role" : null, "access", agentPermissions ? "代理权限" : null].filter((part): part is string => part !== null);
  return parts.length === 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")}和${parts[parts.length - 1]}`;
}
