import type { ExternalMcpConnection, ExternalMcpPreset } from "./mcp-connections-data";

/** Native provider connections keep fixed ids in Den. */
export const GOOGLE_WORKSPACE_QUICK_ADD_ID = "google-workspace";
export const MICROSOFT_365_QUICK_ADD_ID = "microsoft-365";

export type NativeProviderKey = typeof GOOGLE_WORKSPACE_QUICK_ADD_ID | typeof MICROSOFT_365_QUICK_ADD_ID;

/** Google Workspace and Microsoft 365 set up with an org OAuth app instead of a server address. */
export function isNativeProviderCatalogId(id: string): id is NativeProviderKey {
  return id === GOOGLE_WORKSPACE_QUICK_ADD_ID || id === MICROSOFT_365_QUICK_ADD_ID;
}

/**
 * Where a popular connector row lands when someone adds it. Gmail, Drive, and
 * Calendar are one Google Workspace connection in Den; Outlook is Microsoft
 * 365; everything else is a curated MCP preset.
 */
export type PopularConnectorTarget =
  | { kind: "google-workspace" }
  | { kind: "microsoft-365" }
  | { kind: "preset"; presetId: string };

export type PopularConnector = {
  id: string;
  displayName: string;
  description: string;
  icon: { iconUrl?: string; simpleIconSlug?: string; serviceUrl?: string };
  target: PopularConnectorTarget;
  /** Starter prompt seeded after the connector chip when someone picks Chat. */
  chatPrompt: string;
};

export const POPULAR_CONNECTORS: PopularConnector[] = [
  {
    id: "gmail",
    displayName: "Gmail",
    description: "阅读、发送和管理 Gmail",
    icon: { simpleIconSlug: "gmail" },
    target: { kind: "google-workspace" },
    chatPrompt: "说明如何整理我的 Gmail 收件箱。若有访问权限，请搜索并总结未读会话，建议回复优先级；否则在不访问收件箱的情况下帮助我制定整理流程。",
  },
  {
    id: "github",
    displayName: "GitHub",
    description: "PR、Issue、代码和 CI，通过 OAuth 应用或个人访问令牌连接",
    icon: { simpleIconSlug: "github", serviceUrl: "https://api.githubcopilot.com/mcp/" },
    target: { kind: "preset", presetId: "github" },
    chatPrompt: "说明如何审查 GitHub 仓库的身份验证。先询问使用哪个仓库；若有访问权限，请检查代码与文档，否则在不访问仓库的情况下列出审查清单。",
  },
  {
    id: "google-drive",
    displayName: "Google Drive",
    description: "整理文件、阅读文档和演示文稿，以及编辑表格",
    icon: { simpleIconSlug: "googledrive" },
    target: { kind: "google-workspace" },
    chatPrompt: "说明本周 Google 云端硬盘的变化。若有访问权限，请列出过去 7 天修改的文件、处理分页，并在总结前说明任何不完整的搜索；否则在不访问云端硬盘的情况下帮助我制定文件检查计划。",
  },
  {
    id: "google-calendar",
    displayName: "Google Calendar",
    description: "创建、改期与管理 Google 日历事件",
    icon: { simpleIconSlug: "googlecalendar" },
    target: { kind: "google-workspace" },
    chatPrompt: "说明如何使用 Google 日历安排一周。若有访问权限，请列出会议、指出冲突并建议专注时间，不要更改事件；否则在不访问日历的情况下帮助我制定每周安排。",
  },
  {
    id: "notion",
    displayName: "Notion",
    description: "Notion 文档与工作流",
    icon: { serviceUrl: "https://mcp.notion.com/mcp" },
    target: { kind: "preset", presetId: "notion" },
    chatPrompt: "说明如何整理 Notion 工作区。若有访问权限，请先询问要检查哪些页面并总结其结构；否则在不访问 Notion 的情况下建议工作区大纲。",
  },
  {
    id: "slack",
    displayName: "Slack",
    description: "消息与搜索，需要内部或已发布到市场的 Slack 应用",
    icon: { simpleIconSlug: "slack", serviceUrl: "https://mcp.slack.com/mcp" },
    target: { kind: "preset", presetId: "slack" },
    chatPrompt: "请介绍如何在 Slack 中跟进消息。如果可以访问，请先询问需要搜索的频道或主题，再总结找到的消息；如果无法访问，请先帮我规划消息跟进流程，无需访问 Slack。",
  },
];

export const MORE_CONNECTORS_TEASER = "查看 Outlook 邮件、Granola 等更多服务";

/** Starter prompt for connectors without a curated one. */
export function connectorChatPrompt(displayName: string): string {
  const popular = POPULAR_CONNECTORS.find((connector) => connector.displayName === displayName);
  return popular?.chatPrompt
    ?? `请介绍如何使用 ${displayName}：提出三个实用任务，并区分通用建议与此处可用的工具。如果无法访问，请先帮我规划，无需连接。`;
}

/**
 * Deep link that opens the desktop app on a new chat with the connector chip
 * and starter prompt already in the composer. The app parses this in
 * apps/app/src/app/lib/openwork-links.ts (parseChatDeepLink).
 */
export function connectorChatDeepLink(input: { connector: string; prompt: string }): string {
  const params = new URLSearchParams({ connector: input.connector, prompt: input.prompt });
  return `openwork://chat?${params.toString()}`;
}

function comparableMcpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    return `${url.host.toLowerCase()}${pathname}`;
  } catch {
    return null;
  }
}

export function connectionForPresetUrl(
  connections: readonly ExternalMcpConnection[],
  presetUrl: string,
): ExternalMcpConnection | undefined {
  const target = comparableMcpUrl(presetUrl);
  if (!target) return undefined;
  return connections.find((connection) => comparableMcpUrl(connection.url) === target);
}

/** Curated presets that are not already represented by a popular row. */
export function remainingPresets(presets: readonly ExternalMcpPreset[]): ExternalMcpPreset[] {
  const popularPresetIds = new Set(
    POPULAR_CONNECTORS.flatMap((connector) => connector.target.kind === "preset" ? [connector.target.presetId] : []),
  );
  return presets.filter((preset) => !popularPresetIds.has(preset.presetId));
}

export function connectorMatchesFilter(filter: string, ...haystack: string[]): boolean {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return true;
  return haystack.some((value) => value.toLowerCase().includes(normalized));
}
