"use client";

import { useState } from "react";
import { DenNotice } from "../../_components/ui/notice";
import { getOrgAccessFlags, permissionLockReason, type DenOrgTeam } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export function TeamAdminCheckbox({ team }: { team: DenOrgTeam }) {
  const { orgContext, updateTeam, mutationBusy } = useOrgDashboard();
  const [error, setError] = useState<string | null>(null);
  const canManageAdminTeams = orgContext && getOrgAccessFlags(orgContext.currentMember.role, orgContext.currentMember.isOwner, orgContext.currentMember.permissions).canManageAdminTeams;
  return (
    <div className="mt-3 grid gap-2 text-[13px]">
      <label className="flex items-start gap-2 text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={team.grantsOrganizationAdmin}
          disabled={!canManageAdminTeams || mutationBusy === "update-team"}
          onChange={async (event) => {
            setError(null);
            try {
              await updateTeam(team.id, { grantsOrganizationAdmin: event.target.checked });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "无法更新团队管理员访问权限，请重试。");
            }
          }}
        />
        <span>向以下团队的全部成员授予组织管理员权限： {team.name}</span>
      </label>
      <p className="text-[12px] text-gray-500">
        {canManageAdminTeams ? "" : `已锁定。${permissionLockReason("teams.manage_admin")}`}
        成员属于此团队期间继承管理员权限，个人角色保持不变。
        {team.managedByScim ? " 成员关系由身份提供商管理。禁用 SCIM 映射，或移除对应群组或提供商，将清除此授权，并需要重新批准。" : ""}
      </p>
      {error ? <DenNotice tone="error" message={error} /> : null}
    </div>
  );
}
