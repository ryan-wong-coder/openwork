"use client";

import { getDenPermissionDefinition } from "../../../_lib/permission-copy";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { ChevronRight, History, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { PERMISSION_KEYS, isPermissionKey, type PermissionKey } from "@openwork/types/den/permissions";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenNotice } from "../../_components/ui/notice";
import { DenStickyActionBar } from "../../_components/ui/sticky-action-bar";
import { type TabItem, UnderlineTabs } from "../../_components/ui/tabs";
import { getMembersRoute, getPermissionsRoute, getTeamRoute, orgFeatureEnabled, permissionLockReason } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useDenToast } from "./den-toast";
import {
  PermissionsRequestError,
  usePermissionSet,
  usePermissionSetHistory,
  useRemoveTeamPermissions,
  useSharedRolesOn,
  useUpdatePermissionSet,
  type PermissionChange,
  type PermissionHistoryItem,
  type PermissionSetDetail,
  type PermissionStatus,
} from "./permissions-data";
import {
  PermissionEditor,
  PermissionRowsSkeleton,
  PermissionsAccessState,
  PermissionsPage,
  RelativeTime,
  usePermissionsAccess,
  type PermissionEditorRow,
  type PermissionsAccess,
} from "./permissions-ui";
import { TEAM_ROLE_LABELS, roleKindLabel, roleName } from "./team-roles";
import { RoleNameField, SharedRoleTeams } from "./shared-role-teams";

type ReadyAccess = Extract<PermissionsAccess, { state: "ready" }>;
type SetTab = "teams" | "permissions" | "history";

function plural(count: number, one: string, many = one) {
  return `${count} ${count === 1 ? one : many}`;
}

/** teamRoles: a permission set's page is its role's page, named and linked like one. */
function useTeamRolesOn(): boolean {
  const { orgContext } = useOrgDashboard();
  return orgContext ? orgFeatureEnabled(orgContext, "teamRoles") : false;
}

export function PermissionSetScreen({ permissionSetId }: { permissionSetId: string }) {
  const permissions = usePermissionsAccess();
  const teamRoles = useTeamRolesOn();
  if (permissions.state !== "ready") {
    return <PermissionsPage title={teamRoles ? "角色" : "权限"} testId="permission-set"><PermissionsAccessState access={permissions} /></PermissionsPage>;
  }
  return <PermissionSetContent key={permissionSetId} ready={permissions} permissionSetId={permissionSetId} teamRoles={teamRoles} />;
}

function PermissionSetContent({ ready, permissionSetId, teamRoles }: { ready: ReadyAccess; permissionSetId: string; teamRoles: boolean }) {
  const query = usePermissionSet(ready.orgId, permissionSetId);
  // Lives above the editor, which remounts after each save, so Undo and errors survive it.
  const update = useUpdatePermissionSet(ready.orgId, permissionSetId);
  // sharedRoles: a custom role's page opens on its teams, and the role has its own name.
  const sharedRoles = useSharedRolesOn();
  const [chosenTab, setTab] = useState<SetTab | null>(null);
  const rolesBack = { href: `${getMembersRoute(ready.orgSlug)}?tab=roles`, label: "角色" };
  const listBack = teamRoles ? rolesBack : { href: getPermissionsRoute(ready.orgSlug), label: "权限" };
  const loadingTitle = teamRoles ? "角色" : "权限";

  if (query.isError) {
    const notFound = query.error instanceof PermissionsRequestError && query.error.status === 404;
    const gone = teamRoles ? "此角色已不存在，请返回“角色”查看当前内容。" : "这些权限已不存在，请返回“权限”查看当前内容。";
    return (
      <PermissionsPage title={loadingTitle} back={listBack} testId="permission-set">
        <div className="flex flex-col items-start gap-2">
          <DenNotice tone="error" className="w-full" message={notFound ? gone : query.error instanceof Error ? query.error.message : "无法加载这些权限，请重试。"} />
          {notFound ? null : <DenButton variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>重试</DenButton>}
        </div>
      </PermissionsPage>
    );
  }
  if (!query.data) {
    return <PermissionsPage title={loadingTitle} back={listBack} testId="permission-set"><PermissionRowsSkeleton /></PermissionsPage>;
  }

  const set = query.data;
  const sharedCustom = sharedRoles && set.kind === "team";
  // A custom role goes back to its team, where it is shown and changed (with sharedRoles, to Roles).
  const back = teamRoles && !sharedCustom && set.kind === "team" && set.team?.name
    ? { href: getTeamRoute(ready.orgSlug, set.team.id), label: set.team.name }
    : listBack;
  const allowedLabel = `已允许 ${set.allowedCount} / ${PERMISSION_KEYS.length} 项`;
  const tabs: readonly TabItem<SetTab>[] = [
    ...(sharedCustom && set.archivedAt === null ? [{ value: "teams" as const, label: "团队", icon: Users }] : []),
    { value: "permissions", label: "权限", icon: ShieldCheck },
    { value: "history", label: "历史记录", icon: History },
  ];
  const tab: SetTab = chosenTab && tabs.some((entry) => entry.value === chosenTab) ? chosenTab : tabs[0].value;
  const setTeamNames = set.teams.map((team) => team.name ?? "已删除的团队");
  const impact = sharedCustom && setTeamNames.length > 0
    ? `更新 ${setTeamNames.length > 2 ? `${setTeamNames.slice(0, -1).join(", ")}和${setTeamNames[setTeamNames.length - 1]}` : setTeamNames.join("和")}，${plural(set.appliesTo.kind === "team" ? set.appliesTo.memberCount : 0, "人", "人")}`
    : undefined;
  const removable = set.kind === "team" && set.archivedAt === null && ready.access.canManagePermissions;

  return (
    <PermissionsPage
      title={teamRoles ? roleName(set, { shared: sharedRoles }) : set.name}
      back={back}
      caption={teamRoles ? `${roleKindLabel(set)}, ${allowedLabel}` : allowedLabel}
      action={removable ? <RemoveTeamPermissions ready={ready} set={set} teamRoles={teamRoles} sharedRoles={sharedRoles} /> : undefined}
      testId="permission-set"
    >
      {sharedCustom && set.archivedAt === null ? null : <AppliesTo ready={ready} set={set} teamRoles={teamRoles} />}
      <UnderlineTabs tabs={tabs} activeTab={tab} onChange={setTab} />
      {tab === "teams" ? (
        <div role="tabpanel" aria-label="团队">
          <SharedRoleTeams ready={ready} set={set} />
        </div>
      ) : tab === "permissions" ? (
        <div role="tabpanel" aria-label="权限" className="flex flex-col gap-6">
          {sharedCustom && set.archivedAt === null ? <RoleNameField ready={ready} set={set} /> : null}
          {/* Remount when the saved state changes so the draft starts from it. */}
          <PermissionSetEditor key={set.permissions.map((state) => state.status).join("")} ready={ready} set={set} update={update} impact={impact} />
        </div>
      ) : (
        <div role="tabpanel" aria-label="历史记录">
          <PermissionSetHistory ready={ready} setId={set.id} />
        </div>
      )}
    </PermissionsPage>
  );
}

function AppliesTo({ ready, set, teamRoles }: { ready: ReadyAccess; set: PermissionSetDetail; teamRoles: boolean }) {
  // teamRoles: Admin comes from a person's own role or from a team with the Admin role.
  const adminTeamsLabel = (count: number) => teamRoles ? plural(count, "个拥有管理员角色的团队", "个拥有管理员角色的团队") : plural(count, "管理员团队");
  const appliesTo = set.appliesTo;
  if (set.archivedAt) {
    return <DenNotice tone="neutral" icon={LockKeyhole} message={`已移除 ${new Date(set.archivedAt).toLocaleDateString(DEFAULT_DEN_LOCALE)}，这些权限不再适用于任何人，且无法更改。`} />;
  }
  if (appliesTo.kind === "everyone") {
    return <p className="text-[13px] text-gray-600" data-testid="permission-set-applies-to">适用于组织中的所有人， {plural(appliesTo.memberCount, "名成员")}.</p>;
  }
  if (appliesTo.kind === "admins") {
    const people = appliesTo.directAdmins;
    if (!people && appliesTo.adminTeams.length === 0) {
      return <p className="text-[13px] text-gray-600" data-testid="permission-set-applies-to">适用范围 {plural(appliesTo.directAdminCount, "名管理员")}，以及 {teamRoles ? "没有拥有管理员角色的团队" : "没有管理员团队"}.</p>;
    }
    return (
      <details className="group text-[13px] text-gray-600" data-testid="permission-set-applies-to">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">
          <ChevronRight className="size-3.5 text-gray-400 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
          适用范围 {plural(appliesTo.directAdminCount, "名管理员")}，以及 {adminTeamsLabel(appliesTo.adminTeams.length)}
        </summary>
        <ul className="mt-2 flex flex-col gap-1 pl-5">
          {people?.map((person) => <li key={person.memberId}>{person.name} <span className="text-gray-500">{person.email}</span></li>)}
          {appliesTo.adminTeams.map((team) => (
            <li key={team.id}>
              {ready.access.canViewTeams ? <Link className="underline-offset-2 hover:underline" href={getTeamRoute(ready.orgSlug, team.id)}>{team.name}</Link> : team.name} 团队 <span className="text-gray-500">{plural(team.memberCount, "名成员")}</span>
            </li>
          ))}
        </ul>
      </details>
    );
  }
  const team = appliesTo.team;
  const teamName = team?.name ?? "已删除的团队";
  const members = appliesTo.members;
  if (!members) {
    return <p className="text-[13px] text-gray-600" data-testid="permission-set-applies-to">适用于 {teamName} 团队， {plural(appliesTo.memberCount, "名成员")}.</p>;
  }
  return (
    <details className="group text-[13px] text-gray-600" data-testid="permission-set-applies-to">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400">
        <ChevronRight className="size-3.5 text-gray-400 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        适用于 {teamName} 团队， {plural(appliesTo.memberCount, "名成员")}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 pl-5">
        {members.length === 0 ? <li className="text-gray-500">此团队暂无成员。</li> : null}
        {members.map((person) => <li key={person.memberId}>{person.name} <span className="text-gray-500">{person.email}</span></li>)}
        {team && ready.access.canViewTeams ? <li><Link className="underline-offset-2 hover:underline" href={getTeamRoute(ready.orgSlug, team.id)}>打开 {teamName} 团队</Link></li> : null}
      </ul>
    </details>
  );
}

/** Why a key can't be changed in this set by this person, or null. */
function keyLockReason(ready: ReadyAccess, set: PermissionSetDetail, key: PermissionKey, saved: PermissionStatus, locked: boolean): string | null {
  if (locked) return "对管理员始终启用";
  if (saved === "allow" || ready.held.has(key)) return null;
  const defaultKey = set.kind === "member_default" ? "member" : set.kind === "admin_default" ? "admin" : null;
  // Re-allowing a key that is on by default in this default set is always allowed.
  if (defaultKey && getDenPermissionDefinition(key).defaultOn.includes(defaultKey)) return null;
  return "你没有此权限";
}

function setReadOnlyReason(ready: ReadyAccess, set: PermissionSetDetail): string | null {
  if (set.archivedAt) return "这些权限已移除，无法更改。";
  if (!ready.access.canManagePermissions) return `只读。${permissionLockReason("permissions.manage")}`;
  if (set.kind === "admin_default" && !ready.access.isAdmin) return "只读，仅所有者与管理员可更改管理员权限。";
  return null;
}

function PermissionSetEditor({ ready, set, update, impact }: {
  ready: ReadyAccess;
  set: PermissionSetDetail;
  update: ReturnType<typeof useUpdatePermissionSet>;
  /** sharedRoles: who a save changes, e.g. "Updates Sales and Engineering, 9 people". */
  impact?: string;
}) {
  const [draft, setDraft] = useState<ReadonlyMap<string, PermissionStatus>>(new Map());
  const toast = useDenToast();
  const readOnlyReason = setReadOnlyReason(ready, set);

  const rows: PermissionEditorRow[] = set.permissions.flatMap((state) => {
    if (!isPermissionKey(state.key)) return [];
    return [{
      key: state.key,
      status: state.status,
      draft: draft.get(state.key) ?? state.status,
      lockedReason: keyLockReason(ready, set, state.key, state.status, state.locked),
    }];
  });
  const changes: PermissionChange[] = rows.filter((row) => row.draft !== row.status).map((row) => ({ key: row.key, status: row.draft }));

  function toggle(key: PermissionKey, next: PermissionStatus) {
    update.reset();
    setDraft((current) => {
      const saved = set.permissions.find((state) => state.key === key)?.status;
      const copy = new Map(current);
      if (next === saved) copy.delete(key);
      else copy.set(key, next);
      return copy;
    });
  }

  async function save(toSave: PermissionChange[], undoable: boolean) {
    await update.mutateAsync(toSave);
    const count = plural(toSave.length, "项更改");
    toast({
      title: undoable ? `已保存 ${count}` : `已撤销 ${count}`,
      action: undoable
        ? {
            label: "撤销",
            onClick: async () => {
              const inverse = toSave.map((change): PermissionChange => ({ key: change.key, status: change.status === "allow" ? "deny" : "allow" }));
              try {
                await save(inverse, false);
              } catch {
                return;
              }
            },
          }
        : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PermissionEditor
        rows={rows}
        onToggle={toggle}
        readOnlyReasonId={readOnlyReason ? "permission-set-read-only" : undefined}
        beforeList={readOnlyReason ? <DenNotice tone="neutral" icon={LockKeyhole} message={<span id="permission-set-read-only">{readOnlyReason}</span>} /> : null}
      />
      {update.error ? <DenNotice tone="error" message={update.error.message} /> : null}
      {changes.length > 0 ? (
        <DenStickyActionBar
          testId="permission-set-save-bar"
          summary={impact ? <span className="flex flex-col"><span className="font-medium text-gray-900">{impact}</span><span>{plural(changes.length, "项未保存更改")}</span></span> : <span>{plural(changes.length, "项未保存更改")}</span>}
        >
          <DenButton variant="secondary" disabled={update.isPending} onClick={() => { update.reset(); setDraft(new Map()); }}>放弃</DenButton>
          <DenButton loading={update.isPending} onClick={() => void save(changes, true).catch(() => undefined)}>保存更改</DenButton>
        </DenStickyActionBar>
      ) : null}
    </div>
  );
}

const SOURCE_LABELS: Record<Exclude<PermissionHistoryItem["source"], "user">, { allow: string; deny: string }> = {
  seed: { allow: "默认允许", deny: "默认不允许" },
  reconcile: { allow: "由更新添加", deny: "由更新保持关闭" },
  migration: { allow: "由迁移允许", deny: "由迁移移除" },
};

function HistorySentence({ item }: { item: PermissionHistoryItem }) {
  const label = item.label ?? "已不存在的权限";
  if (item.source === "user") {
    const who = item.changedBy?.name ?? item.changedBy?.email ?? "前成员";
    return <><span className="font-medium text-gray-900">{who}</span> {item.status === "allow" ? "已允许" : "已移除"} <span className="font-medium text-gray-900">{label}</span></>;
  }
  return <><span className="font-medium text-gray-900">{label}</span> {SOURCE_LABELS[item.source][item.status]}</>;
}

function PermissionSetHistory({ ready, setId }: { ready: ReadyAccess; setId: string }) {
  const history = usePermissionSetHistory(ready.orgId, setId, true);
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];

  if (history.isPending) return <PermissionRowsSkeleton rows={5} label="正在加载历史" />;
  return (
    <div className="flex flex-col gap-3" data-testid="permission-set-history">
      {history.isError ? (
        <div className="flex flex-col items-start gap-2">
          <DenNotice tone="error" className="w-full" message={items.length > 0 ? "无法加载更多历史，当前显示已加载的记录。" : history.error instanceof Error ? history.error.message : "无法加载历史，请重试。"} />
          <DenButton variant="secondary" size="sm" disabled={history.isFetching} onClick={() => void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch())}>重试</DenButton>
        </div>
      ) : null}
      {items.length === 0 && !history.isError ? <p className="py-3 text-[13px] text-gray-500">暂无更改。</p> : null}
      <ol className="flex flex-col [&>*]:border-b [&>*]:border-gray-100">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-3 py-2" data-testid="permission-history-row" data-source={item.source} data-status={item.status}>
            <p className="min-w-0 flex-1 truncate text-[13px] text-gray-600"><HistorySentence item={item} /></p>
            <RelativeTime value={item.createdAt} />
          </li>
        ))}
      </ol>
      {history.hasNextPage ? (
        <DenButton variant="secondary" size="sm" className="w-fit" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>显示更早的更改</DenButton>
      ) : null}
    </div>
  );
}

function RemoveTeamPermissions({ ready, set, teamRoles, sharedRoles }: { ready: ReadyAccess; set: PermissionSetDetail; teamRoles: boolean; sharedRoles: boolean }) {
  const router = useRouter();
  const toast = useDenToast();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const remove = useRemoveTeamPermissions(ready.orgId, set.id);
  const teamName = set.team?.name ?? "此团队";
  const sharedTeams = set.teams.map((team) => team.name ?? "已删除的团队");
  // sharedRoles: deleting a role takes it off every team; teamRoles: removing it leaves the team with Member.
  const words = sharedRoles
    ? {
        trigger: "删除角色",
        title: `删除 ${set.name}？`,
        description: sharedTeams.length > 0
          ? `${sharedTeams.join(", ")} 将立即失去这些权限。历史记录会保留，此操作无法撤销。`
          : "没有人员拥有此角色，历史记录将保留。此操作无法撤销。",
        confirm: "删除角色",
        done: `已删除 ${set.name}`,
      }
    : teamRoles
    ? {
        trigger: "移除角色",
        title: `移除 ${teamName} 角色？`,
        description: `${teamName} 中的成员将立即失去这些权限，${teamName} 将保留并使用${TEAM_ROLE_LABELS.member}角色。历史记录会保留，此操作无法撤销。`,
        confirm: "移除角色",
        done: `${teamName} 现在为${TEAM_ROLE_LABELS.member}`,
      }
    : {
        trigger: "移除",
        title: `移除 ${set.name}？`,
        description: `${teamName} 中的成员将立即失去这些权限，除非另有权限集授予。历史记录会保留，此操作无法撤销。`,
        confirm: "移除权限",
        done: `已移除 ${set.name}`,
      };

  async function confirm() {
    try {
      await remove.mutateAsync();
      setOpen(false);
      toast({ title: words.done });
      router.push(sharedRoles ? `${getMembersRoute(ready.orgSlug)}?tab=roles` : teamRoles && set.team ? getTeamRoute(ready.orgSlug, set.team.id) : getPermissionsRoute(ready.orgSlug));
    } catch {
      return;
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!remove.isPending) { remove.reset(); setOpen(next); } }}>
      <AlertDialog.Trigger className={buttonVariants({ variant: "secondary", size: "sm" })} data-testid="remove-team-permissions">{words.trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-gray-950/45" />
        <AlertDialog.Popup data-testid="remove-team-permissions-dialog" initialFocus={cancelRef} className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-gray-200 bg-white p-5 outline-none">
          <AlertDialog.Title className="text-[15px] font-medium text-gray-950">{words.title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13px] leading-5 text-gray-600">
            {words.description}
          </AlertDialog.Description>
          {remove.error ? <DenNotice tone="error" className="mt-3" message={remove.error.message} /> : null}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close ref={cancelRef} disabled={remove.isPending} className={buttonVariants({ variant: "secondary" })}>取消</AlertDialog.Close>
            <DenButton data-testid="remove-team-permissions-confirm" variant="destructive" loading={remove.isPending} onClick={() => void confirm()}>{words.confirm}</DenButton>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
