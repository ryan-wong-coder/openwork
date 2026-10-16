import type { DenOrgMember, DenOrgTeam } from "../../_lib/den-org";
import type { DenPlugin } from "./plugin-data";

/** Who can use a connector or plugin, as edited in the Who can use it block. */
export type AccessDraft = {
  orgWide: boolean;
  memberIds: string[];
  teamIds: string[];
};

export const EMPTY_ACCESS: AccessDraft = { orgWide: false, memberIds: [], teamIds: [] };

type Directory = {
  members: readonly Pick<DenOrgMember, "id" | "user">[];
  teams: readonly Pick<DenOrgTeam, "id" | "name" | "memberIds">[];
};

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function joinNames(names: readonly string[], max = 2): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length <= max) return `${names.slice(0, -1).join(", ")}和${names[names.length - 1]}`;
  const rest = names.length - max;
  return `${names.slice(0, max).join(", ")}等另外 ${rest} 项`;
}

/** Everyone the draft reaches besides the owner, counting each person once. */
export function accessPeopleIds(draft: AccessDraft, directory: Directory, ownerId: string | null): string[] {
  const ids = new Set<string>();
  if (draft.orgWide) {
    for (const member of directory.members) ids.add(member.id);
  } else {
    for (const id of draft.memberIds) ids.add(id);
    for (const teamId of draft.teamIds) {
      const team = directory.teams.find((entry) => entry.id === teamId);
      for (const id of team?.memberIds ?? []) ids.add(id);
    }
  }
  if (ownerId) ids.delete(ownerId);
  return [...ids];
}

export function peopleLabel(count: number): string {
  return count === 1 ? "1 人" : `${count} 人`;
}

/** Names of the people and teams in a draft, people first, without the owner. */
export function accessNames(draft: AccessDraft, directory: Directory, ownerId: string | null): string[] {
  const people = draft.memberIds
    .filter((id) => id !== ownerId)
    .map((id) => directory.members.find((member) => member.id === id))
    .flatMap((member) => member ? [firstName(member.user.name || member.user.email)] : []);
  const teams = draft.teamIds
    .map((id) => directory.teams.find((team) => team.id === id)?.name)
    .flatMap((name) => name ? [name] : []);
  return [...people, ...teams];
}

/** The status lane text for something the viewer owns. */
export function ownedAccessStatus(draft: AccessDraft | null, directory: Directory, ownerId: string | null): string {
  if (!draft) return "仅你自己";
  if (draft.orgWide) return "所有人";
  const names = accessNames(draft, directory, ownerId);
  return names.length === 0 ? "仅你自己" : `已分享给${joinNames(names)}`;
}

/** Who-has-it text in Manage, where the admin is not the audience. */
export function managedAccessStatus(draft: AccessDraft | null, directory: Directory, ownerId: string | null): string {
  if (!draft) return "仅你自己";
  if (draft.orgWide) return "所有人";
  const names = accessNames(draft, directory, ownerId);
  return names.length === 0 ? "仅你自己" : joinNames(names);
}

/** "Maya and Support will find it in My Library." */
export function shareConsequence(draft: AccessDraft, directory: Directory, ownerId: string | null): string {
  if (draft.orgWide) return "组织中的所有人都可在“我的资源库”中找到此项。";
  const names = accessNames(draft, directory, ownerId);
  if (names.length === 0) return "仅你自己可使用。";
  return `${joinNames(names)}可在“我的资源库”中找到它。`;
}

export function sameAccess(left: AccessDraft, right: AccessDraft): boolean {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));
  return left.orgWide === right.orgWide && same(left.memberIds, right.memberIds) && same(left.teamIds, right.teamIds);
}

/** Toast body after sharing: "6 people can use it now." */
export function sharedToastDescription(draft: AccessDraft, org: Directory, ownerId: string | null): string {
  if (draft.orgWide) return "组织中的所有人现在都可使用。";
  const count = accessPeopleIds(draft, org, ownerId).length;
  const onlyTeam = draft.memberIds.filter((id) => id !== ownerId).length === 0 && draft.teamIds.length === 1
    ? org.teams.find((team) => team.id === draft.teamIds[0])?.name
    : undefined;
  if (count === 0) return "现在仅你自己可使用。";
  return onlyTeam ? `${onlyTeam}中的${peopleLabel(count)}现在可以使用它。` : `${peopleLabel(count)}现在可以使用它。`;
}

/** "They get the skill, the command and HubSpot. Each person uses their own HubSpot account." */
export function pluginShareSubtitle(plugin: Pick<DenPlugin, "skills" | "commands" | "mcps">): string {
  const parts = [
    ...(plugin.skills.length === 1 ? ["此技能"] : plugin.skills.length > 1 ? [`${plugin.skills.length} 项技能`] : []),
    ...(plugin.commands.length === 1 ? ["此命令"] : plugin.commands.length > 1 ? [`${plugin.commands.length} 条命令`] : []),
    ...plugin.mcps.map((mcp) => mcp.name),
  ];
  if (parts.length === 0) return "他们将获得其中的全部内容。";
  const connectors = plugin.mcps.map((mcp) => mcp.name);
  const accounts = connectors.length > 0 ? `每个人使用自己的 ${joinNames(connectors)} 账户。` : "";
  return `他们将获得${joinNames(parts, parts.length)}。${accounts}`;
}

/** "Sales can use it now / 8 people will find it in My Library.", or null when nobody was added. */
export function accessAddedToast(previous: AccessDraft, next: AccessDraft, org: Directory, ownerId: string | null): { title: string; description: string } | null {
  const added: AccessDraft = {
    orgWide: next.orgWide && !previous.orgWide,
    memberIds: next.memberIds.filter((id) => !previous.memberIds.includes(id)),
    teamIds: next.teamIds.filter((id) => !previous.teamIds.includes(id)),
  };
  if (added.orgWide) return { title: "现在所有人都可使用", description: "他们可在“我的资源库”中找到此项。" };
  if (added.memberIds.length === 0 && added.teamIds.length === 0) return null;
  const names = accessNames(added, org, null);
  const reached = accessPeopleIds(added, org, ownerId).length;
  return {
    title: `${joinNames(names) || "他们"}现在可以使用它`,
    description: `${peopleLabel(reached)}可在“我的资源库”中找到它。`,
  };
}
