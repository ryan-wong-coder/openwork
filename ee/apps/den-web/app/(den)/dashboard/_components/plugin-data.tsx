"use client";

import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";

import { queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { mcpAppProjectionSchema } from "@openwork/types/mcp-app";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  type ConnectedIntegration,
  integrationQueryKeys,
} from "./integration-data";
import { parsePluginAccessGrants, pluginAccessQueryKeys } from "./plugin-access-data";

/**
 * Plugin primitives — mirror OpenCode / Claude Code's plugin surface:
 *
 *  A plugin is a *bundle* of reusable pieces that extend an agent runtime:
 *   - skills      natural-language playbooks/instructions agents can load on demand
 *   - hooks       lifecycle callbacks (PreToolUse / PostToolUse / SessionStart, etc.)
 *   - mcps        Model Context Protocol servers that expose external tools/resources
 *   - agents      custom sub-agents with their own system prompt and tool set
 *   - commands    slash-commands that shortcut common workflows
 *
 * This file models the frontend shape only. Mock data is served through
 * React Query so we can swap the queryFn for a real API call later without
 * touching any consumers.
 *
 * Gating: the catalog is empty until the user has connected at least one
 * integration (GitHub or Bitbucket) on the Integrations page. The queryFn
 * reads the integrations cache and derives which plugins are visible from
 * the set of connected repositories. Integration mutations invalidate
 * `["plugins"]`, so connections and disconnections propagate automatically.
 */

// ── Primitive types ────────────────────────────────────────────────────────

export type PluginCategory =
  | "integrations"
  | "workflows"
  | "code-intelligence"
  | "output-styles"
  | "infrastructure";

export type PluginSkill = {
  id: string;
  name: string;
  description: string;
};

export type PluginHookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "Notification"
  | "Stop";

export type PluginHook = {
  id: string;
  event: PluginHookEvent;
  description: string;
  matcher?: string | null;
};

export type PluginMcpTransport = "stdio" | "http" | "sse";

export type PluginMcp = {
  configObjectId?: string;
  connectionId?: string | null;
  id: string;
  name: string;
  description: string;
  transport: PluginMcpTransport;
  toolCount: number;
  serverName?: string;
  url?: string | null;
};

export type PluginAgent = {
  id: string;
  name: string;
  description: string;
};

export type PluginCommand = {
  id: string;
  name: string;
  description: string;
};

export type PluginWorkflow = {
  id: string;
  name: string;
  description: string;
  versionId: string | null;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  requiredCapabilityCount: number;
};

export type PluginAuthoredApp = {
  id: string;
  name: string;
  description: string;
  revisionId: string;
};

export type PluginRemoteMcpApp = {
  id: string;
  name: string;
  description: string;
  version: string | null;
  sourceUrl: string | null;
};

export type PluginSource =
  | { type: "marketplace"; marketplace: string }
  | { type: "github"; repo: string }
  | { type: "local"; path: string };

export type PluginMarketplaceRef = {
  id: string;
  name: string;
};

export type DenPlugin = {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string | null;
  author: string;
  category: PluginCategory;
  installed: boolean;
  source: PluginSource;
  status?: "active" | "archived";
  marketplaces?: PluginMarketplaceRef[];
  skills: PluginSkill[];
  hooks: PluginHook[];
  mcps: PluginMcp[];
  agents: PluginAgent[];
  commands: PluginCommand[];
  workflows: PluginWorkflow[];
  apps: PluginRemoteMcpApp[];
  authoredApps: PluginAuthoredApp[];
  createdAt: string;
  createdByOrgMembershipId: string | null;
  updatedAt: string;
  /**
   * Opt-in gating: which connected integration provider exposes this plugin.
   * - "any"      → visible once ANY integration is connected (e.g. marketplace output styles)
   * - "github"   → only visible after a GitHub account is connected
   * - "bitbucket"→ only visible after a Bitbucket account is connected
   */
  requiresProvider: "any" | "github" | "bitbucket";
};

// ── Display helpers ────────────────────────────────────────────────────────

export function getPluginCategoryLabel(category: PluginCategory): string {
  switch (category) {
    case "integrations":
      return "外部集成";
    case "workflows":
      return "工作流";
    case "code-intelligence":
      return "代码智能";
    case "output-styles":
      return "输出风格";
    case "infrastructure":
      return "基础设施";
  }
}
export function formatPluginTimestamp(value: string | null): string {
  if (!value) {
    return "最近更新";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "最近更新";
  }

  return new Intl.DateTimeFormat(DEFAULT_DEN_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getPluginComponentCount(plugin: DenPlugin): number {
  return (
    plugin.apps.length +
    plugin.authoredApps.length +
    plugin.skills.length +
    plugin.hooks.length +
    plugin.mcps.length +
    plugin.agents.length +
    plugin.commands.length
    + plugin.workflows.length
  );
}

export function getPluginPartsSummary(plugin: DenPlugin): string {
  const parts: string[] = [];
  const appCount = plugin.apps.length + plugin.authoredApps.length;
  if (appCount > 0) {
    parts.push(`${appCount} 个应用`);
  }
  if (plugin.skills.length > 0) {
    parts.push(`${plugin.skills.length} 项技能`);
  }
  if (plugin.hooks.length > 0) {
    parts.push(`${plugin.hooks.length} 个钩子`);
  }
  if (plugin.mcps.length > 0) {
    parts.push(`${plugin.mcps.length} ${plugin.mcps.length === 1 ? "MCP" : "MCPs"}`);
  }
  if (plugin.agents.length > 0) {
    parts.push(`${plugin.agents.length} 个智能体`);
  }
  if (plugin.commands.length > 0) {
    parts.push(`${plugin.commands.length} 条命令`);
  }
  if (plugin.workflows.length > 0) {
    parts.push(`${plugin.workflows.length} 个工作流`);
  }
  return parts.length > 0 ? parts.join(" · ") : "空插件包";
}

// ── Mock data ──────────────────────────────────────────────────────────────
//
// These are shaped to mirror real marketplaces (Anthropic's official catalog,
// internal team bundles, etc.) so the UI exercises realistic content.

const MOCK_PLUGINS: DenPlugin[] = [
  {
    id: "plg_github",
    name: "GitHub",
    slug: "github",
    description:
      "直接在对话中操作 GitHub 仓库、PR、Issue 与 Actions，包含 MCP 服务器与审查工作流。",
    version: "1.4.2",
    author: "Anthropic",
    category: "integrations",
    installed: true,
    source: { type: "marketplace", marketplace: "claude-plugins-official" },
    skills: [
      { id: "sk_gh_pr", name: "创建合并请求", description: "根据代码差异起草 PR 标题与描述。" },
      { id: "sk_gh_review", name: "审查合并请求", description: "总结代码差异并提出阻止合并的问题。" },
    ],
    hooks: [
      {
        id: "hk_gh_pre",
        event: "PreToolUse",
        description: "工具执行前隐藏日志中的 GitHub 令牌。",
        matcher: "Bash",
      },
    ],
    mcps: [
      {
        id: "mcp_gh",
        name: "github-mcp",
        description: "官方 GitHub MCP 服务器，支持 Issue、PR、版本与 Actions。",
        transport: "http",
        toolCount: 42,
      },
    ],
    agents: [
      {
        id: "ag_gh_reviewer",
        name: "pr-reviewer",
        description: "结合上下文提出建议的合并请求审查助手。",
      },
    ],
    commands: [
      { id: "cmd_gh_pr", name: "/gh:pr", description: "根据当前分支创建合并请求。" },
    ],
    workflows: [],
    apps: [],
    authoredApps: [],
    createdAt: "2026-04-10T12:00:00Z",
    createdByOrgMembershipId: null,
    updatedAt: "2026-04-10T12:00:00Z",
    requiresProvider: "github",
  },
  {
    id: "plg_commit_commands",
    name: "提交命令",
    slug: "commit-commands",
    description:
      "Git 提交、推送与 PR 创建工作流，遵循约定式提交规则及仓库提交风格。",
    version: "0.9.0",
    author: "Anthropic",
    category: "workflows",
    installed: true,
    source: { type: "marketplace", marketplace: "claude-plugins-official" },
    skills: [
      { id: "sk_cc_commit", name: "智能提交", description: "暂存、分组并使用生成的消息提交。" },
      { id: "sk_cc_push", name: "推送并创建 PR", description: "推送当前分支，并使用自动生成的描述创建 PR。" },
    ],
    hooks: [],
    mcps: [],
    agents: [],
    commands: [
      { id: "cmd_cc_commit", name: "/commit", description: "为已暂存更改创建提交。" },
      { id: "cmd_cc_push", name: "/push", description: "推送当前分支并设置上游跟踪。" },
      { id: "cmd_cc_pr", name: "/pr", description: "创建合并请求。" },
    ],
    workflows: [],
    apps: [],
    authoredApps: [],
    createdAt: "2026-04-07T09:00:00Z",
    createdByOrgMembershipId: null,
    updatedAt: "2026-04-07T09:00:00Z",
    requiresProvider: "any",
  },
  {
    id: "plg_typescript_lsp",
    name: "TypeScript 语言服务器",
    slug: "typescript-lsp",
    description:
      "将 Claude 连接到 TypeScript 语言服务器，支持跳转定义、查找引用，并在编辑后立即报告类型错误。",
    version: "1.1.0",
    author: "Anthropic",
    category: "code-intelligence",
    installed: false,
    source: { type: "marketplace", marketplace: "claude-plugins-official" },
    skills: [],
    hooks: [
      {
        id: "hk_ts_diag",
        event: "PostToolUse",
        description: "每次文件编辑后运行语言服务器诊断并报告类型错误。",
        matcher: "Edit|Write",
      },
    ],
    mcps: [
      {
        id: "mcp_ts",
        name: "typescript-language-server",
        description: "用于 .ts/.tsx 诊断与导航的语言服务器桥接。",
        transport: "stdio",
        toolCount: 9,
      },
    ],
    agents: [],
    commands: [],
    workflows: [],
    apps: [],
    authoredApps: [],
    createdAt: "2026-03-28T16:45:00Z",
    createdByOrgMembershipId: null,
    updatedAt: "2026-03-28T16:45:00Z",
    requiresProvider: "any",
  },
  {
    id: "plg_linear",
    name: "Linear",
    slug: "linear",
    description:
      "直接在会话中创建、更新与分拣 Linear Issue，包含 Linear MCP 与问题整理代理。",
    version: "0.6.3",
    author: "Anthropic",
    category: "integrations",
    installed: false,
    source: { type: "marketplace", marketplace: "claude-plugins-official" },
    skills: [
      { id: "sk_lin_triage", name: "整理收件箱", description: "检查收件箱并将问题归入对应项目。" },
    ],
    hooks: [],
    mcps: [
      {
        id: "mcp_linear",
        name: "linear-mcp",
        description: "Linear MCP，支持问题、周期、项目与评论。",
        transport: "http",
        toolCount: 24,
      },
    ],
    agents: [
      { id: "ag_lin_groomer", name: "linear-groomer", description: "整理待办列表并标记长期未更新的问题。" },
    ],
    commands: [
      { id: "cmd_lin_new", name: "/linear:new", description: "根据当前上下文创建新问题。" },
    ],
    workflows: [],
    apps: [],
    authoredApps: [],
    createdAt: "2026-04-02T18:12:00Z",
    createdByOrgMembershipId: null,
    updatedAt: "2026-04-02T18:12:00Z",
    requiresProvider: "any",
  },
  {
    id: "plg_openwork_release",
    name: "OpenWork 发布工具包",
    slug: "openwork-release-kit",
    description:
      "自动执行 OpenWork 发布准备、服务器软件包检查与更新日志生成的内部插件，由 OpenWork 基础设施团队提供。",
    version: "2.3.1",
    author: "OpenWork",
    category: "workflows",
    installed: true,
    source: { type: "github", repo: "different-ai/openwork-plugins" },
    skills: [
      { id: "sk_ow_release_prep", name: "发布准备", description: "同步更新 app、desktop 与 openwork-server 的版本号。" },
      { id: "sk_ow_changelog", name: "更新日志起草", description: "根据已合并 PR 生成 Markdown 发布说明。" },
    ],
    hooks: [
      {
        id: "hk_ow_sessionstart",
        event: "SessionStart",
        description: "会话开始时将发布操作手册载入上下文。",
        matcher: null,
      },
    ],
    mcps: [],
    agents: [
      { id: "ag_ow_release", name: "release-captain", description: "执行完整发布流程。" },
    ],
    commands: [
      { id: "cmd_ow_release", name: "/release", description: "运行标准发布工作流。" },
    ],
    workflows: [],
    apps: [],
    authoredApps: [],
    createdAt: "2026-04-14T08:30:00Z",
    createdByOrgMembershipId: null,
    updatedAt: "2026-04-14T08:30:00Z",
    requiresProvider: "github",
  },
  {
    id: "plg_sentry",
    name: "Sentry",
    slug: "sentry",
    description:
      "连接 Sentry，将近期错误引入会话。包含 MCP 服务器与可聚合重复问题的分拣技能。",
    version: "0.4.0",
    author: "Anthropic",
    category: "infrastructure",
    installed: false,
    source: { type: "marketplace", marketplace: "claude-plugins-official" },
    skills: [
      { id: "sk_sentry_triage", name: "分拣错误", description: "聚合 Sentry 问题并推荐负责人。" },
    ],
    hooks: [],
    mcps: [
      {
        id: "mcp_sentry",
        name: "sentry-mcp",
        description: "Sentry MCP，支持项目、问题、版本与性能。",
        transport: "http",
        toolCount: 18,
      },
    ],
    agents: [],
    commands: [],
    workflows: [],
    apps: [],
    authoredApps: [],
    createdAt: "2026-03-20T11:00:00Z",
    createdByOrgMembershipId: null,
    updatedAt: "2026-03-20T11:00:00Z",
    requiresProvider: "any",
  },
  {
    id: "plg_explanatory_style",
    name: "解释型输出风格",
    slug: "explanatory-output-style",
    description:
      "在回复中解释实现选择、取舍与替代方案。",
    version: "1.0.0",
    author: "Anthropic",
    category: "output-styles",
    installed: false,
    source: { type: "marketplace", marketplace: "claude-plugins-official" },
    skills: [],
    hooks: [
      {
        id: "hk_explain_post",
        event: "Stop",
        description: "结束前追加“实现说明”部分。",
        matcher: null,
      },
    ],
    mcps: [],
    agents: [],
    commands: [],
    workflows: [],
    apps: [],
    authoredApps: [],
    createdAt: "2026-03-12T14:22:00Z",
    createdByOrgMembershipId: null,
    updatedAt: "2026-03-12T14:22:00Z",
    requiresProvider: "any",
  },
];

function readConnectedProviders(client: QueryClient): Set<"github" | "bitbucket"> {
  const connections = client.getQueryData<ConnectedIntegration[]>(integrationQueryKeys.list()) ?? [];
  return new Set(connections.map((connection) => connection.provider));
}

function filterByConnectedProviders(
  plugins: DenPlugin[],
  connectedProviders: Set<"github" | "bitbucket">,
): DenPlugin[] {
  if (connectedProviders.size === 0) {
    return [];
  }
  return plugins.filter((plugin) => {
    if (plugin.requiresProvider === "any") return true;
    return connectedProviders.has(plugin.requiresProvider);
  });
}

// ── Query hooks ────────────────────────────────────────────────────────────
//
// Keep the surface identical to what a real API-backed version would return,
// so swapping `queryFn` for `requestJson(...)` later is a one-line change.

export const pluginQueryKeys = {
  all: ["plugins"] as const,
  list: () => [...pluginQueryKeys.all, "list"] as const,
  summaries: () => [...pluginQueryKeys.list(), "summaries"] as const,
  detail: (id: string) => [...pluginQueryKeys.all, "detail", id] as const,
};

function slugifyPluginName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "plugin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pluginMcpTransport(config: Record<string, unknown>): PluginMcpTransport {
  const type = asString(config.type)?.toLowerCase();
  if (type === "sse") return "sse";
  return asString(config.url) ? "http" : "stdio";
}

/**
 * Marketplace syncs used to title an MCP config object after its file, so a
 * `.mcp.json` showed up as ".mcp". Such a title says nothing about the server.
 */
function isFileDerivedMcpTitle(title: string, currentRelativePath: string | null | undefined) {
  const normalized = title.trim().toLowerCase();
  if (normalized === ".mcp" || normalized === "mcp") return true;
  const fileName = currentRelativePath?.split("/").filter(Boolean).at(-1);
  if (!fileName) return false;
  return normalized === fileName.replace(/\.[^.]+$/, "").toLowerCase();
}

export function pluginMcpEntries(item: {
  currentRelativePath?: string | null;
  description: string;
  id: string;
  normalizedPayload: Record<string, unknown> | null;
  title: string;
}): PluginMcp[] {
  const payload = item.normalizedPayload ?? {};
  const entries = [payload.mcpServers, payload.mcp].flatMap((container) => (
    isRecord(container)
      ? Object.entries(container).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      : []
  ));
  const servers = entries.length > 0
    ? entries
    : [[item.title, payload] satisfies [string, Record<string, unknown>]];
  const useTitle = servers.length === 1 && !isFileDerivedMcpTitle(item.title, item.currentRelativePath);
  // Old syncs stored the second line of the JSON file (`"mcpServers": {`) as the description.
  const description = /^"?(mcpServers|mcp)"?\s*:\s*\{?$/.test(item.description.trim()) ? "" : item.description;

  return servers.map(([serverName, config], index) => ({
    configObjectId: item.id,
    connectionId: asString(config.externalMcpConnectionId),
    description,
    id: servers.length === 1 ? item.id : `${item.id}:${index}`,
    name: useTitle ? item.title : serverName,
    serverName,
    toolCount: typeof config.toolCount === "number" ? config.toolCount : 0,
    transport: pluginMcpTransport(config),
    url: asString(config.url),
  }));
}

function parseMembershipConfigObject(entry: unknown) {
  if (!isRecord(entry) || !isRecord(entry.configObject)) {
    return null;
  }

  const configObject = entry.configObject;
  const id = asString(configObject.id);
  const title = asString(configObject.title);
  const description = asString(configObject.description) ?? "";
  const objectType = asString(configObject.objectType);
  const currentRelativePath = asString(configObject.currentRelativePath);
  const latestVersion = isRecord(configObject.latestVersion) ? configObject.latestVersion : null;
  const latestVersionId = latestVersion ? asString(latestVersion.id) : null;
  const normalizedPayload = latestVersion && isRecord(latestVersion.normalizedPayloadJson)
    ? latestVersion.normalizedPayloadJson
    : null;

  if (!id || !title || !objectType) {
    return null;
  }

  return {
    currentRelativePath,
    description,
    id,
    latestVersionId,
    normalizedPayload,
    objectType,
    title,
  };
}

export function parsePluginAuthoredApps(payload: unknown): PluginAuthoredApp[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  return payload.items.flatMap((entry): PluginAuthoredApp[] => {
    const item = parseMembershipConfigObject(entry);
    if (!item || item.objectType !== "app") return [];
    const app = mcpAppProjectionSchema.strip().safeParse(item.normalizedPayload);
    if (!app.success || app.data.appId !== item.id || app.data.revisionId !== item.latestVersionId) return [];
    return [{
      id: app.data.appId,
      name: app.data.title,
      description: app.data.description ?? "",
      revisionId: app.data.revisionId,
    }];
  });
}

function derivePluginCategory(input: { agents: PluginAgent[]; apps: PluginRemoteMcpApp[]; authoredApps: PluginAuthoredApp[]; commands: PluginCommand[]; hooks: PluginHook[]; mcps: PluginMcp[]; skills: PluginSkill[]; workflows: PluginWorkflow[] }): PluginCategory {
  if (input.mcps.length > 0 || input.hooks.length > 0) {
    return "integrations";
  }
  if (input.agents.length > 0 || input.apps.length > 0 || input.authoredApps.length > 0 || input.commands.length > 0 || input.workflows.length > 0 || input.skills.length > 0) {
    return "workflows";
  }
  return "output-styles";
}

function parsePluginHookEvent(value: string | null): PluginHookEvent {
  switch (value) {
    case "PreToolUse":
    case "PostToolUse":
    case "SessionStart":
    case "SessionEnd":
    case "UserPromptSubmit":
    case "Notification":
    case "Stop":
      return value;
    default:
      return "Notification";
  }
}

function requestPluginContents(id: string) {
  return requestJson(`/v1/plugins/${encodeURIComponent(id)}/resolved`, { method: "GET" }, 15000);
}

function pluginContentsPayload({ response, payload }: Awaited<ReturnType<typeof requestPluginContents>>) {
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `无法加载插件内容（${response.status}）。`));
  }
  return payload;
}

async function fetchResolvedPlugin(id: string): Promise<DenPlugin | null> {
  const [pluginResult, membershipsResult] = await Promise.all([
    requestJson(`/v1/plugins/${encodeURIComponent(id)}`, { method: "GET" }, 15000),
    requestPluginContents(id),
  ]);

  if (!pluginResult.response.ok) {
    throw new Error(getErrorMessage(pluginResult.payload, `无法加载插件（${pluginResult.response.status}）。`));
  }
  const contents = pluginContentsPayload(membershipsResult);

  const pluginItem = isRecord(pluginResult.payload) && isRecord(pluginResult.payload.item) ? pluginResult.payload.item : null;
  return pluginItem ? buildDenPlugin(pluginItem, contents) : null;
}

/** List items and plugin detail share one shape, so either can be combined with `/resolved`. */
function buildDenPlugin(pluginItem: Record<string, unknown>, contents: unknown): DenPlugin | null {
  const pluginId = asString(pluginItem.id);
  const name = asString(pluginItem.name);
  if (!pluginId || !name) {
    return null;
  }

  const membershipItems = isRecord(contents) && Array.isArray(contents.items)
    ? contents.items.map(parseMembershipConfigObject).filter((value): value is NonNullable<typeof value> => Boolean(value))
    : [];

  const skills = membershipItems
    .filter((item) => item.objectType === "skill")
    .map((item) => ({ id: item.id, name: item.title, description: item.description } satisfies PluginSkill));
  const agents = membershipItems
    .filter((item) => item.objectType === "agent")
    .map((item) => ({ id: item.id, name: item.title, description: item.description } satisfies PluginAgent));
  const commands = membershipItems
    .filter((item) => item.objectType === "command")
    .map((item) => ({ id: item.id, name: item.currentRelativePath?.split("/").pop()?.replace(/\.md$/i, "") ?? item.title, description: item.description } satisfies PluginCommand));
  const workflows = membershipItems
    .filter((item) => item.objectType === "workflow")
    .map((item) => ({
      id: item.id,
      name: item.title,
      description: item.description,
      versionId: item.latestVersionId,
      inputSchema: isRecord(item.normalizedPayload?.inputSchema) ? item.normalizedPayload.inputSchema : null,
      outputSchema: isRecord(item.normalizedPayload?.outputSchema) ? item.normalizedPayload.outputSchema : null,
      requiredCapabilityCount: Array.isArray(item.normalizedPayload?.requiredCapabilities)
        ? item.normalizedPayload.requiredCapabilities.length
        : 0,
    } satisfies PluginWorkflow));
  // Standalone URL-imported Apps are retained in storage for a future unit of
  // value, but intentionally stay out of the current Plugin and Library UI.
  const apps: PluginRemoteMcpApp[] = [];
  const authoredApps = parsePluginAuthoredApps(contents);
  const hooks = membershipItems
    .filter((item) => item.objectType === "hook")
    .map((item) => ({
      description: item.description,
      event: parsePluginHookEvent(asString(item.normalizedPayload?.event) ?? item.title),
      id: item.id,
      matcher: asString(item.normalizedPayload?.matcher),
    } satisfies PluginHook));
  const mcps = membershipItems
    .filter((item) => item.objectType === "mcp")
    .flatMap((item) => pluginMcpEntries(item));

  const marketplaces = Array.isArray(pluginItem.marketplaces)
    ? pluginItem.marketplaces.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const id = asString(entry.id);
        const marketplaceName = asString(entry.name);
        if (!id || !marketplaceName) return [];
        return [{ id, name: marketplaceName } satisfies PluginMarketplaceRef];
      })
    : [];

  return {
    agents,
    apps,
    authoredApps,
    author: "已连接的仓库",
    category: derivePluginCategory({ agents, apps, authoredApps, commands, hooks, mcps, skills, workflows }),
    commands,
    createdAt: asString(pluginItem.createdAt) ?? new Date().toISOString(),
    createdByOrgMembershipId: asString(pluginItem.createdByOrgMembershipId),
    description: asString(pluginItem.description) ?? "",
    hooks,
    id: pluginId,
    installed: true,
    marketplaces,
    mcps,
    name,
    requiresProvider: "github",
    workflows,
    skills,
    slug: slugifyPluginName(name),
    source: marketplaces[0]
      ? { type: "marketplace", marketplace: marketplaces[0].name }
      : { type: "github", repo: "已连接的仓库" },
    status: asString(pluginItem.status) === "archived" ? "archived" : "active",
    updatedAt: asString(pluginItem.updatedAt) ?? new Date().toISOString(),
    version: null,
  } satisfies DenPlugin;
}

function listItems(payload: unknown) {
  return (isRecord(payload) && Array.isArray(payload.items) ? payload.items : []).filter(isRecord);
}

/**
 * Each plugin's `/resolved` body, keyed by id, from one request (at most 100
 * ids). A Den without `/v1/resolved-plugins` gets one request per plugin.
 */
async function requestPluginsContents(ids: string[]): Promise<Map<string, unknown>> {
  if (ids.length === 0) return new Map();
  const { response, payload } = await requestJson(
    `/v1/resolved-plugins?pluginIds=${ids.map((id) => encodeURIComponent(id)).join(",")}`,
    { method: "GET" },
    20000,
  );
  if (response.status === 404) {
    return new Map(await Promise.all(ids.map(async (id) => [id, pluginContentsPayload(await requestPluginContents(id))] as const)));
  }
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `无法加载插件内容（${response.status}）。`));
  }
  const plugins = isRecord(payload) && isRecord(payload.plugins) ? payload.plugins : {};
  const failures = isRecord(payload) && isRecord(payload.failures) ? payload.failures : {};
  return new Map(ids.map((id) => {
    const failure = failures[id];
    if (isRecord(failure)) {
      throw new Error(getErrorMessage(failure, `无法加载插件内容（${String(failure.status)}）。`));
    }
    return [id, plugins[id]];
  }));
}

/** Every plugin with its contents: one list request plus one `/v1/resolved-plugins` request. */
export function usePlugins({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    enabled,
    queryKey: pluginQueryKeys.list(),
    queryFn: async () => {
      const { response, payload } = await requestJson("/v1/plugins?status=active&limit=100", { method: "GET" }, 20000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `无法加载插件（${response.status}）。`));
      }

      const items = listItems(payload);
      const contents = await requestPluginsContents(items.flatMap((item) => asString(item.id) ?? []));
      return items.flatMap((item) => {
        const id = asString(item.id);
        const plugin = id ? buildDenPlugin(item, contents.get(id)) : null;
        return plugin ? [plugin] : [];
      });
    },
  });
}

/** What a plugin list row shows, straight from the list response. */
export type DenPluginSummary = Pick<DenPlugin, "id" | "name" | "slug" | "description" | "status" | "createdByOrgMembershipId"> & {
  /** False when the server did not include access, so callers load it per plugin. */
  accessIncluded: boolean;
  updatedAt?: string;
};

function parsePluginSummary(item: Record<string, unknown>): DenPluginSummary | null {
  const id = asString(item.id);
  const name = asString(item.name);
  if (!id || !name) return null;
  return {
    accessIncluded: Array.isArray(item.access),
    updatedAt: asString(item.updatedAt) ?? undefined,
    createdByOrgMembershipId: asString(item.createdByOrgMembershipId),
    description: asString(item.description) ?? "",
    id,
    name,
    slug: slugifyPluginName(name),
    status: asString(item.status) === "archived" ? "archived" : "active",
  };
}

/**
 * Plugins without their contents, in one request. Access for plugins the
 * caller manages is written to each plugin's access query.
 */
export function pluginSummariesQueryOptions() {
  return queryOptions({
    queryKey: pluginQueryKeys.summaries(),
    queryFn: async ({ client }): Promise<DenPluginSummary[]> => {
      const { response, payload } = await requestJson("/v1/plugins?status=active&limit=100&includeAccess=true", { method: "GET" }, 20000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `无法加载插件（${response.status}）。`));
      }

      return listItems(payload).flatMap((item) => {
        const summary = parsePluginSummary(item);
        if (!summary) return [];
        if (summary.accessIncluded) {
          client.setQueryData(pluginAccessQueryKeys.detail(summary.id), parsePluginAccessGrants(item.access));
        }
        return [summary];
      });
    },
  });
}

export function usePluginSummaries({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ ...pluginSummariesQueryOptions(), enabled });
}

export function pluginDirectoryParams(filters: { q: string; teamId: string | null; memberId: string | null; ownerId?: string | null }, cursor: string) {
  const params = new URLSearchParams({ status: "active", limit: "50", includeAccess: "true" });
  if (!cursor) { params.set("includeTotal", "true"); params.set("includeFacets", "true"); }
  if (filters.q) params.set("name", filters.q);
  if (filters.teamId) params.set("teamId", filters.teamId);
  if (filters.memberId) params.set("memberId", filters.memberId);
  if (filters.ownerId) params.set("ownerId", filters.ownerId);
  if (cursor) params.set("cursor", cursor);
  return params;
}

export function pluginDirectoryQueryKey(orgId: string | null, viewerId: string | null, filters: { q: string; teamId: string | null; memberId: string | null; ownerId?: string | null }) {
  return [...pluginQueryKeys.summaries(), "directory", orgId, viewerId, filters.q, filters.teamId, filters.memberId, filters.ownerId ?? null];
}

function parseDirectoryCounts(value: unknown): Record<string, number> | undefined {
  if (!Array.isArray(value)) return undefined;
  return Object.fromEntries(value.flatMap((entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.count === "number" ? [[entry.id, entry.count]] : []));
}

export function usePluginDirectory(filters: { q: string; teamId: string | null; memberId: string | null; ownerId?: string | null }) {
  const client = useQueryClient();
  const { orgId, orgContext } = useOrgDashboard();
  return useInfiniteQuery({
    queryKey: pluginDirectoryQueryKey(orgId, orgContext?.currentMember.id ?? null, filters),
    enabled: Boolean(orgId && orgContext?.organization.id === orgId),
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const params = pluginDirectoryParams(filters, pageParam);
      const { response, payload } = await requestJson(`/v1/plugins?${params}`, { method: "GET" }, 20000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `无法加载插件（${response.status}）。`));
      const items = listItems(payload).flatMap((item) => {
        const summary = parsePluginSummary(item);
        if (!summary) return [];
        if (summary.accessIncluded) client.setQueryData(pluginAccessQueryKeys.detail(summary.id), parsePluginAccessGrants(item.access));
        return [summary];
      });
      return {
        items,
        nextCursor: isRecord(payload) ? asString(payload.nextCursor) : null,
        total: isRecord(payload) && typeof payload.total === "number" ? payload.total : null,
        teamCounts: parseDirectoryCounts(isRecord(payload) ? payload.teamCounts : null),
        ownerCounts: parseDirectoryCounts(isRecord(payload) ? payload.ownerCounts : null),
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function pluginDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: pluginQueryKeys.detail(id),
    queryFn: async () => fetchResolvedPlugin(id),
    enabled: Boolean(id),
  });
}

export function usePlugin(id: string) {
  return useQuery(pluginDetailQueryOptions(id));
}

export function useUpdatePlugin() {
  const queryClient = useQueryClient();
  const { runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (input: { pluginId: string; name: string; description: string | null }) => {
      await runReauthableAction("update-plugin", async () => {
        const { response, payload } = await requestJson(
          `/v1/plugins/${encodeURIComponent(input.pluginId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name: input.name, description: input.description }),
          },
          15000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `无法更新插件（${response.status}）。`);
        }
      });
      return input.pluginId;
    },
    onSuccess: (pluginId) => {
      queryClient.invalidateQueries({ queryKey: pluginQueryKeys.detail(pluginId) });
      queryClient.invalidateQueries({ queryKey: pluginQueryKeys.list() });
    },
  });
}

export function useArchivePlugin() {
  const queryClient = useQueryClient();
  const { runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (pluginId: string) => {
      await runReauthableAction("archive-plugin", async () => {
        const { response, payload } = await requestJson(
          `/v1/plugins/${encodeURIComponent(pluginId)}/archive`,
          { method: "POST" },
          15000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `无法归档插件（${response.status}）。`);
        }
      });
      return pluginId;
    },
    onSuccess: (pluginId) => {
      queryClient.removeQueries({ queryKey: pluginQueryKeys.detail(pluginId) });
      queryClient.invalidateQueries({ queryKey: pluginQueryKeys.list() });
    },
  });
}

export function useAttachWorkflowToPlugin(pluginId: string) {
  const queryClient = useQueryClient();
  const { runReauthableAction } = useOrgDashboard();

  return useMutation({
    mutationFn: async (workflowId: string) => {
      await runReauthableAction("attach-workflow-to-plugin", async () => {
        const { response, payload } = await requestJson(
          `/v1/plugins/${encodeURIComponent(pluginId)}/config-objects`,
          {
            method: "POST",
            body: JSON.stringify({ configObjectId: workflowId, membershipSource: "manual" }),
          },
          15000,
        );
        if (!response.ok) {
          throw getRequestError(payload, response, `无法添加工作流（${response.status}）。`);
        }
      });
      return workflowId;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pluginQueryKeys.detail(pluginId) }),
        queryClient.invalidateQueries({ queryKey: pluginQueryKeys.list() }),
        queryClient.invalidateQueries({ queryKey: ["me", "library"] }),
      ]);
    },
  });
}
