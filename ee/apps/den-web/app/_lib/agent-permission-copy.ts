import { agentPermissionDefinitions, type AgentPermissionDecision, type AgentPermissionDefinition, type AgentPermissionKey, type AgentPermissionPatternKind } from "@openwork/types/den/agent-permissions";

const COPY: Record<AgentPermissionKey, { label: string; description: string; patternNoun: string | null }> = {
  commands: { label: "运行命令", description: "代理在成员计算机的终端中运行的命令。", patternNoun: "命令" },
  fileEdits: { label: "编辑文件", description: "在成员工作区中创建、修改和删除文件。阻止此项也会阻止运行命令，因为命令可更改文件。", patternNoun: null },
  websites: { label: "打开网站", description: "代理获取的网页，以及桌面应用内置浏览器打开的网页。", patternNoun: "网站" },
  webSearch: { label: "搜索网络", description: "代理执行的网络搜索。", patternNoun: null },
  localSkills: { label: "使用本地技能", description: "安装在成员计算机上的技能，不影响组织在 OpenWork 云端提供的技能。", patternNoun: null },
  localMcpServers: { label: "使用本地 MCP 服务器", description: "成员在计算机上添加的 MCP 服务器，不影响组织在 OpenWork 云端提供的连接。", patternNoun: null },
};

export const denAgentPermissionDefinitions: readonly AgentPermissionDefinition[] = agentPermissionDefinitions.map((definition) => ({ ...definition, ...COPY[definition.key] }));
export const denAgentPermissionDecisionLabels: Record<AgentPermissionDecision, string> = { allow: "允许", ask: "先询问", deny: "阻止" };
export const denAgentPermissionPatternErrors: Record<AgentPermissionPatternKind, string> = {
  command: "请输入命令，使用 * 匹配任意文本。",
  website: "请输入网站，例如 docs.example.com、*.example.com 或 example.com/docs。",
};
