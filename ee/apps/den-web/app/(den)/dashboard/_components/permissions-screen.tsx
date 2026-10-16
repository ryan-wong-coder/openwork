"use client";

import Link from "next/link";
import { ChevronRight, LockKeyhole, Plus } from "lucide-react";
import { PERMISSION_KEYS } from "@openwork/types/den/permissions";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import {
  getNewRoleRoute,
  getNewTeamPermissionsRoute,
  getPermissionKeysRoute,
  getPermissionSetRoute,
  orgFeatureEnabled,
  permissionLockReason,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { LinkButton } from "./item-list";
import { RolesTab, canCreateRole } from "./roles-tab";
import { usePermissionSets, type PermissionSetSummary } from "./permissions-data";
import {
  PermissionAreaSection,
  PermissionRowsSkeleton,
  PermissionsAccessState,
  PermissionsPage,
  usePermissionsAccess,
} from "./permissions-ui";

function plural(count: number, one: string, many = one) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Who a set applies to, as state (DESIGN.md P1). */
export function appliesToSummary(set: PermissionSetSummary): string {
  const appliesTo = set.appliesTo;
  if (appliesTo.kind === "everyone") return `组织中的所有人，${plural(appliesTo.memberCount, "名成员")}`;
  if (appliesTo.kind === "admins") {
    const teams = appliesTo.adminTeams.length;
    if (teams === 0 && appliesTo.directAdminCount === 0) return "管理员与管理员团队，目前暂无";
    return teams > 0
      ? `管理员和管理员团队，${plural(appliesTo.directAdminCount, "名管理员")}和${plural(teams, "管理员团队")}`
      : `管理员和管理员团队，${plural(appliesTo.directAdminCount, "名管理员")}`;
  }
  const teamName = appliesTo.team?.name ?? "已删除的团队";
  return `${teamName} 团队，${plural(appliesTo.memberCount, "名成员")}`;
}

function PermissionSetRow({ set, href }: { set: PermissionSetSummary; href: string }) {
  return (
    <Link
      href={href}
      data-testid="permission-set-row"
      data-permission-set-kind={set.kind}
      className="group flex min-h-12 items-center gap-3 py-2 transition-colors hover:bg-gray-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-gray-900">{set.name}</span>
        <span className="truncate text-[12px] text-gray-500">{appliesToSummary(set)}</span>
      </div>
      <span className="shrink-0 text-[12px] text-gray-700">已允许 {set.allowedCount} / {PERMISSION_KEYS.length} 项</span>
      <ChevronRight className="size-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500" aria-hidden="true" strokeWidth={1.5} />
    </Link>
  );
}

export function PermissionsScreen() {
  const { orgContext } = useOrgDashboard();
  const permissions = usePermissionsAccess();
  const ready = permissions.state === "ready" ? permissions : null;
  // teamRoles: this page is the Roles list, in the same words as Members › Roles.
  const teamRoles = orgContext ? orgFeatureEnabled(orgContext, "teamRoles") : false;
  const setsQuery = usePermissionSets(ready?.orgId ?? null, ready !== null && !teamRoles);

  if (teamRoles) {
    if (!ready) return <PermissionsPage title="角色" testId="permissions-landing"><PermissionsAccessState access={permissions} /></PermissionsPage>;
    const create = canCreateRole({ permissionsFeature: true, canManageTeams: ready.access.canManageTeams, canManagePermissions: ready.access.canManagePermissions })
      ? <DenButton icon={Plus} href={getNewRoleRoute(ready.orgSlug)} data-testid="roles-create">创建角色</DenButton>
      : undefined;
    return <PermissionsPage title="角色" testId="permissions-landing"><RolesTab action={create} /></PermissionsPage>;
  }
  const byPermission = ready ? <LinkButton href={getPermissionKeysRoute(ready.orgSlug)} variant="secondary" size="sm">按权限</LinkButton> : undefined;

  if (!ready) {
    return <PermissionsPage title="权限" testId="permissions-landing"><PermissionsAccessState access={permissions} /></PermissionsPage>;
  }

  const canManage = ready.access.canManagePermissions;
  const sets = setsQuery.data ?? [];
  const defaults = sets.filter((set) => set.kind !== "team");
  const teamSets = sets.filter((set) => set.kind === "team");
  const newButton = canManage ? (
    <LinkButton href={getNewTeamPermissionsRoute(ready.orgSlug)} variant="secondary" size="sm" data-testid="new-team-permissions">
      <Plus className="size-3.5" aria-hidden="true" />
      创建团队权限
    </LinkButton>
  ) : (
    <DenButton variant="secondary" size="sm" icon={LockKeyhole} disabled aria-describedby="permissions-read-only">创建团队权限</DenButton>
  );

  return (
    <PermissionsPage title="权限" action={byPermission} testId="permissions-landing">
      {!canManage ? <DenNotice tone="neutral" icon={LockKeyhole} message={<span id="permissions-read-only">只读。 {permissionLockReason("permissions.manage")}</span>} /> : null}
      {setsQuery.isError ? (
        <div className="flex flex-col items-start gap-2">
          <DenNotice tone="error" message={setsQuery.error instanceof Error ? setsQuery.error.message : "无法加载权限，请重试。"} className="w-full" />
          <DenButton variant="secondary" size="sm" disabled={setsQuery.isFetching} onClick={() => void setsQuery.refetch()}>重试</DenButton>
        </div>
      ) : setsQuery.isPending ? (
        <PermissionRowsSkeleton rows={4} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <PermissionAreaSection label="默认设置" testId="permissions-defaults">
              {defaults.map((set) => <PermissionSetRow key={set.id} set={set} href={getPermissionSetRoute(ready.orgSlug, set.id)} />)}
            </PermissionAreaSection>
            <p className="inline-flex items-center gap-1.5 text-[12px] text-gray-500">
              <LockKeyhole className="size-3.5" aria-hidden="true" strokeWidth={1.5} />
              所有者始终拥有全部权限。
            </p>
          </div>
          <PermissionAreaSection label="团队权限" meta={newButton} testId="permissions-teams">
            {teamSets.length === 0 ? (
              <div className="flex min-h-12 items-center py-3 text-[13px] text-gray-500" data-testid="permissions-teams-empty">
                暂无团队权限。
              </div>
            ) : teamSets.map((set) => <PermissionSetRow key={set.id} set={set} href={getPermissionSetRoute(ready.orgSlug, set.id)} />)}
          </PermissionAreaSection>
        </>
      )}
    </PermissionsPage>
  );
}
