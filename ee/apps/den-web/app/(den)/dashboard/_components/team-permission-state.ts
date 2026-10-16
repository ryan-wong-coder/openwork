import { desktopExecutionPolicySchema, desktopPolicyDefaults, desktopPolicyDefinitions, resolveTeamAccessCapabilities, type DesktopExecutionPolicy, type TeamAccess } from "@openwork/types/den/desktop-policies";

export const teamCapabilities = desktopPolicyDefinitions.filter((entry) => entry.restrictedValue !== null);

export type TeamPermissionDraft = { access: TeamAccess; execution: DesktopExecutionPolicy };

export function teamPermissionDraft(policy?: { access?: TeamAccess; execution?: DesktopExecutionPolicy }): TeamPermissionDraft {
  return {
    access: { mode: "custom", capabilities: policy?.access ? resolveTeamAccessCapabilities(policy.access) : { ...desktopPolicyDefaults } },
    execution: policy?.execution ?? desktopExecutionPolicySchema.parse({}),
  };
}

export function teamWebsiteSummary(execution: DesktopExecutionPolicy): string {
  if (execution.browserOrigins === undefined) return "所有网站";
  return execution.browserOrigins.length ? `${execution.browserOrigins.length} 已批准 个网站` : "浏览已被阻止";
}

const executionLabels: Record<keyof DesktopExecutionPolicy, string> = {
  commands: "运行计算机命令",
  blockedCommands: "已阻止的命令模式",
  browserOrigins: "浏览网站",
  blockBrowserUploads: "上传文件与提交表单",
};

function executionChoices(execution: DesktopExecutionPolicy): Record<keyof DesktopExecutionPolicy, string> {
  return {
    commands: execution.commands === "allow" ? "允许" : "已阻止",
    blockedCommands: [...new Set(execution.blockedCommands)].sort().join("\n") || "无",
    browserOrigins: execution.browserOrigins?.length ? [...new Set(execution.browserOrigins)].sort().join("\n") : teamWebsiteSummary(execution),
    blockBrowserUploads: execution.blockBrowserUploads ? "已阻止" : "允许",
  };
}

export function teamPermissionChanges(before: TeamPermissionDraft, after: TeamPermissionDraft) {
  const previous = executionChoices(before.execution);
  const next = executionChoices(after.execution);
  const execution = desktopExecutionPolicySchema.keyof().options.flatMap((key) => previous[key] === next[key] ? [] : [{ label: executionLabels[key], before: previous[key], after: next[key] }]);
  const capabilities = teamCapabilities.flatMap((entry) => before.access.capabilities[entry.id] === after.access.capabilities[entry.id] ? [] : [{
    label: entry.teamLabel,
    before: before.access.capabilities[entry.id] ? "允许" : "已阻止",
    after: after.access.capabilities[entry.id] ? "允许" : "已阻止",
  }]);
  return [...execution, ...capabilities];
}
