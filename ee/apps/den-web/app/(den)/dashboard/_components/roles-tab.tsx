"use client";

import { LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { DenButton } from "../../_components/ui/button";
import { MemberListToolbar } from "./member-list-toolbar";
import { DenNotice } from "../../_components/ui/notice";
import {
  getOrgAccessFlags,
  getPermissionKeysRoute,
  getPermissionSetRoute,
  getTeamRoute,
  orgFeatureEnabled,
  permissionLockReason,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { IconTile } from "./access-rows";
import { ItemMenu, ItemPanel, ItemRow, ItemRowsSkeleton, ItemSection, LinkButton } from "./item-list";
import { usePermissionSets, useSharedRolesOn } from "./permissions-data";
import { ADMIN_ROLE_SUMMARY } from "./team-roles";


function peopleLabel(count: number): string {
  return `${count} 人`;
}

/**
 * Members › Roles (teamRoles). The built-in roles, and each team's custom
 * role, read from what Den already stores: member roles, Admin teams, and team
 * permission sets. Creating a role makes a team and its permission set.
 */
export function RolesTab({ action }: { action?: ReactNode }) {
  const { orgContext, orgId, orgSlug } = useOrgDashboard();
  if (!orgContext) return null;
  const access = getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions);
  const permissionsFeature = orgFeatureEnabled(orgContext, "permissions");
  return <RolesTabContent orgId={orgId} orgSlug={orgSlug} permissionsFeature={permissionsFeature} canViewSets={permissionsFeature && access.canViewPermissions} action={action} />;
}

/** Whether the signed-in person can create a role (a team and its permission set). */
export function canCreateRole(input: { permissionsFeature: boolean; canManageTeams: boolean; canManagePermissions: boolean }): boolean {
  return input.permissionsFeature && input.canManageTeams && input.canManagePermissions;
}

function RolesTabContent({ orgId, orgSlug, permissionsFeature, canViewSets, action }: {
  orgId: string | null;
  orgSlug: string | null;
  permissionsFeature: boolean;
  canViewSets: boolean;
  action?: ReactNode;
}) {
  const { orgContext } = useOrgDashboard();
  const setsQuery = usePermissionSets(orgId, canViewSets);
  // sharedRoles: a custom role has its own name and can be on several teams.
  const sharedRoles = useSharedRolesOn();
  const [filter, setFilter] = useState("");
  if (!orgContext) return null;
  const listToolbars = orgFeatureEnabled(orgContext, "memberListToolbars");
  const matches = (name: string) => !listToolbars || name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const sets = setsQuery.data ?? [];
  const memberSet = sets.find((set) => set.kind === "member_default");
  const adminSet = sets.find((set) => set.kind === "admin_default");
  const teamSets = sets.filter((set) => set.kind === "team" && (set.team || set.teams.length > 0 || sharedRoles) && matches(set.name));

  const owner = orgContext.members.find((member) => member.isOwner);
  const directAdmins = orgContext.members.filter((member) => !member.isOwner && member.userId !== null && member.role === "admin").length;
  const adminTeams = orgContext.teams.filter((team) => team.grantsOrganizationAdmin);
  const adminWho = [directAdmins > 0 ? peopleLabel(directAdmins) : null, ...adminTeams.map((team) => team.name)].filter(Boolean).join(", ") || "暂无人员";

  const byPermission = canViewSets ? <LinkButton href={getPermissionKeysRoute(orgSlug)} variant="secondary" data-testid="roles-by-permission">按权限</LinkButton> : null;

  return (
    <div data-testid="roles-tab">
      {listToolbars ? <MemberListToolbar collection="roles" value={filter} onChange={setFilter}
        action={action ?? <DenButton size="sm" icon={LockKeyhole} disabled title={permissionLockReason("permissions.manage")}>创建角色</DenButton>}
        secondary={canViewSets ? <ItemMenu label="角色列表操作" entries={[{ label: "按权限", href: getPermissionKeysRoute(orgSlug) }]} /> : undefined}
      /> : action || byPermission ? <div className="mb-6 flex justify-end gap-2">{byPermission}{action}</div> : null}
      <div className="flex flex-col gap-6">
      <ItemSection title="内置角色" testId="roles-built-in">
        <ItemPanel>
          {!["成员", "管理员", "所有者"].some(matches) ? <p className="px-5 py-6 text-[13px] text-gray-500">没有符合筛选条件的内置角色。</p> : null}
          {matches("成员") ? (
          <ItemRow
            logo={<IconTile icon={ShieldCheck} />}
            title="成员"
            description="所有人的权限"
            status="所有人"
            href={memberSet ? getPermissionSetRoute(orgSlug, memberSet.id) : undefined}
            testId="role-row-member"
          />
          ) : null}
          {matches("管理员") ? (
          <ItemRow
            logo={<IconTile icon={ShieldCheck} />}
            title="管理员"
            description={ADMIN_ROLE_SUMMARY}
            status={adminWho}
            href={adminSet ? getPermissionSetRoute(orgSlug, adminSet.id) : undefined}
            testId="role-row-admin"
          />
          ) : null}
          {matches("所有者") ? (
          <ItemRow
            logo={<IconTile icon={ShieldCheck} />}
            title="所有者"
            description="拥有全部权限"
            status={owner ? (owner.user.name || owner.user.email) : undefined}
            testId="role-row-owner"
          />
          ) : null}
        </ItemPanel>
      </ItemSection>

      <ItemSection title="自定义角色" testId="roles-custom">
        {!permissionsFeature ? (
          <DenNotice tone="neutral" icon={LockKeyhole} message="自定义角色需要企业版的权限管理功能。" />
        ) : !canViewSets ? (
          <DenNotice tone="neutral" icon={LockKeyhole} message={permissionLockReason("permissions.view")} />
        ) : setsQuery.isPending ? (
          <ItemPanel><ItemRowsSkeleton label="正在加载自定义角色" rows={2} /></ItemPanel>
        ) : setsQuery.isError ? (
          <DenNotice tone="error" message={setsQuery.error instanceof Error ? setsQuery.error.message : "无法加载自定义角色，请重试。"} />
        ) : teamSets.length === 0 ? (
          <ItemPanel>
            <div className="px-5 py-6 text-[13px] text-gray-500" data-testid="roles-custom-empty">{listToolbars && filter.trim() ? "没有符合筛选条件的自定义角色。" : "暂无自定义角色。"}</div>
          </ItemPanel>
        ) : (
          <ItemPanel>
            {teamSets.map((set) => {
              if (sharedRoles) {
                const teams = (set.teams.length > 0 ? set.teams : set.team ? [set.team] : []).filter((entry) => orgContext.teams.some((team) => team.id === entry.id));
                return (
                  <ItemRow
                    key={set.id}
                    logo={<IconTile icon={Users} />}
                    title={set.name}
                    description={`${set.allowedCount} 项权限`}
                    status={teams.length > 0 ? teams.map((entry) => entry.name).join(", ") : "暂无团队"}
                    href={getPermissionSetRoute(orgSlug, set.id)}
                    testId="role-row-custom"
                  />
                );
              }
              const team = orgContext.teams.find((entry) => entry.id === set.team?.id);
              const memberCount = team?.memberIds.length ?? (set.appliesTo.kind === "team" ? set.appliesTo.memberCount : 0);
              return (
                <ItemRow
                  key={set.id}
                  logo={<IconTile icon={Users} />}
                  title={team?.name ?? set.team?.name ?? set.name}
                  description={`${set.allowedCount} 项权限`}
                  status={peopleLabel(memberCount)}
                  href={team ? getTeamRoute(orgSlug, team.id) : getPermissionSetRoute(orgSlug, set.id)}
                  testId="role-row-custom"
                />
              );
            })}
          </ItemPanel>
        )}
      </ItemSection>
      </div>
    </div>
  );
}
