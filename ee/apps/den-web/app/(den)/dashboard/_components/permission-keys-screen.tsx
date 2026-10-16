"use client";

import { getDenPermissionDefinition } from "../../../_lib/permission-copy";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { isPermissionKey } from "@openwork/types/den/permissions";
import { DenButton } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { getMembersRoute, getPermissionKeyRoute, getPermissionKeysRoute, getPermissionSetRoute, getPermissionsRoute, orgFeatureEnabled } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { PermissionsRequestError, usePermissionKeyStatus, useSharedRolesOn } from "./permissions-data";
import { roleKindLabel, roleName } from "./team-roles";
import {
  PermissionAreaSection,
  PermissionRowsSkeleton,
  PermissionStatusLabel,
  PermissionsAccessState,
  PermissionsPage,
  permissionAreas,
  usePermissionsAccess,
} from "./permissions-ui";

const rowClass = "group flex min-h-11 items-center gap-3 py-2 transition-colors hover:bg-gray-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400";

/** teamRoles: these pages sit under Members › Roles and name roles, not permission sets. */
function useTeamRolesOn(): boolean {
  const { orgContext } = useOrgDashboard();
  return orgContext ? orgFeatureEnabled(orgContext, "teamRoles") : false;
}

/** Every permission by area; each opens its status across sets. */
export function PermissionKeysScreen() {
  const permissions = usePermissionsAccess();
  const teamRoles = useTeamRolesOn();
  if (permissions.state !== "ready") {
    return <PermissionsPage title="按权限" testId="permission-keys"><PermissionsAccessState access={permissions} /></PermissionsPage>;
  }
  const back = teamRoles
    ? { href: `${getMembersRoute(permissions.orgSlug)}?tab=roles`, label: "角色" }
    : { href: getPermissionsRoute(permissions.orgSlug), label: "权限" };
  return (
    <PermissionsPage title="按权限" back={back} testId="permission-keys">
      <div className="flex flex-col gap-6">
        {permissionAreas().map((area) => (
          <PermissionAreaSection key={area.key} label={area.label}>
            {area.keys.map((key) => {
              const definition = getDenPermissionDefinition(key);
              return (
                <Link key={key} href={getPermissionKeyRoute(permissions.orgSlug, key)} className={rowClass} data-testid="permission-key-row" data-permission-key={key}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-gray-900">{definition.label}</span>
                    {definition.description ? <span className="mt-0.5 block text-[12px] leading-4 text-gray-500">{definition.description}</span> : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500" aria-hidden="true" strokeWidth={1.5} />
                </Link>
              );
            })}
          </PermissionAreaSection>
        ))}
      </div>
    </PermissionsPage>
  );
}

const SET_KIND_ORDER = { member_default: 0, admin_default: 1, team: 2 } as const;

/** One permission's status in Member, Admin and every team's permissions. */
export function PermissionKeyScreen({ permissionKey }: { permissionKey: string }) {
  const permissions = usePermissionsAccess();
  const teamRoles = useTeamRolesOn();
  const sharedRoles = useSharedRolesOn();
  const ready = permissions.state === "ready" ? permissions : null;
  const query = usePermissionKeyStatus(ready?.orgId ?? null, permissionKey);
  const title = isPermissionKey(permissionKey) ? getDenPermissionDefinition(permissionKey).label : "权限";

  if (!ready) {
    return <PermissionsPage title={title} testId="permission-key"><PermissionsAccessState access={permissions} /></PermissionsPage>;
  }
  const back = { href: getPermissionKeysRoute(ready.orgSlug), label: "按权限" };
  const sets = [...(query.data?.sets ?? [])].sort((a, b) => SET_KIND_ORDER[a.kind] - SET_KIND_ORDER[b.kind]);
  const allowedCount = sets.filter((set) => set.status === "allow").length;

  return (
    <PermissionsPage
      title={title}
      back={back}
      caption={[
        isPermissionKey(permissionKey) ? getDenPermissionDefinition(permissionKey).description : undefined,
        query.data ? `已在 ${allowedCount} / ${sets.length} 项中允许` : undefined,
      ].filter(Boolean).join(" · ") || undefined}
      testId="permission-key"
    >
      {query.isError ? (
        <div className="flex flex-col items-start gap-2">
          <DenNotice
            tone="error"
            className="w-full"
            message={query.error instanceof PermissionsRequestError && query.error.code === "permission_not_found"
              ? "此权限不存在，请返回查看所有权限。"
              : query.error instanceof Error ? query.error.message : "无法加载此权限，请重试。"}
          />
          <DenButton variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>重试</DenButton>
        </div>
      ) : !query.data ? (
        <PermissionRowsSkeleton rows={3} />
      ) : (
        <PermissionAreaSection label={teamRoles ? "角色" : "允许此权限的位置"} testId="permission-key-sets">
          {sets.map((set) => (
            <Link key={set.id} href={getPermissionSetRoute(ready.orgSlug, set.id)} className={rowClass} data-testid="permission-key-set-row" data-status={set.status}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {teamRoles ? (
                  <>
                    <span className="truncate text-[13px] font-medium text-gray-900">{roleName(set, { shared: sharedRoles })}</span>
                    <span className="truncate text-[12px] text-gray-500">{roleKindLabel(set)}</span>
                  </>
                ) : (
                  <>
                    <span className="truncate text-[13px] font-medium text-gray-900">{set.name}</span>
                    {set.kind === "team" ? <span className="truncate text-[12px] text-gray-500">{set.team?.name ?? "已删除的团队"} 团队</span> : null}
                  </>
                )}
              </span>
              <PermissionStatusLabel status={set.status} locked={set.locked} />
              <ChevronRight className="size-4 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500" aria-hidden="true" strokeWidth={1.5} />
            </Link>
          ))}
        </PermissionAreaSection>
      )}
    </PermissionsPage>
  );
}
