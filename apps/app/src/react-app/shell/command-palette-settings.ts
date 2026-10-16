import { t } from "@/i18n";
import { isLocalGatewayClient } from "@/app/lib/client-profile";
import type { PlatformCapabilities } from "@/app/lib/platform-capabilities";
import { isSettingsTabAllowed, type DesktopAppRestrictionChecker } from "@/app/cloud/desktop-app-restrictions";
import type { SettingsTab } from "@/app/types";
import {
  CLOUD_SETTINGS_TABS,
  getGlobalSettingsTabs,
  getSettingsTabDescription,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
} from "@/react-app/domains/settings/shell/settings-page";

import { ADVANCED_SETTINGS_SECTIONS } from "@/react-app/domains/settings/advanced-sections";

import type { PaletteItem } from "./command-palette-search";

const SETTINGS_KEYWORDS: Partial<Record<SettingsTab, string[]>> = {
  ai: ["provider", "providers", "api key", "anthropic", "openai", "openrouter", "google", "gemini", "claude", "gpt", "connect model", "models"],
  preferences: ["default model", "reasoning", "thinking", "compaction", "effort"],
  permissions: ["authorized folders", "folder access", "file access", "allow", "permission denied", "sandbox", "approvals"],
  extensions: ["library", "skills", "plugins", "mcp", "connections", "tools", "apps"],
  environment: ["env", "environment variables", "secrets", "tokens", "api keys"],
  advanced: ["advanced settings", "runtime", "developer", "connection", "server", "port", "reset", "fix", "repair", "clean up", "troubleshoot", "recovery"],
  shortcuts: ["shortcut", "shortcuts", "keyboard", "keys", "hotkey", "keybinding", "switch model", "fast"],
  appearance: ["theme", "dark mode", "light mode", "color", "font", "look"],
  updates: ["version", "upgrade", "check for updates", "release"],
  debug: ["logs", "diagnostics", "developer mode"],
  usage: ["usage", "limit", "spend", "budget", "quota", "increase"],
  "cloud-account": ["sign in", "log in", "login", "account", "organization", "org", "den", "cloud", "openwork cloud"],
  general: ["settings", "preferences", "options", "configure"],
};

const LIBRARY_SECTIONS = [
  { slug: "skills", titleKey: "composer.plus_skills", detailKey: "settings_extra.instructions_that_teach_agents_specialized_workflows", keywords: ["skill", "instructions", "workflows"] },
  { slug: "mcps", titleKey: "settings_extra.mcp_servers", detailKey: "settings_extra.tools_and_services_connected_through_mcp", keywords: ["mcp", "servers", "tools"] },
  { slug: "connections", titleKey: "activity.filter_connections", detailKey: "settings_extra.connected_organization_apps_and_services", keywords: ["apps", "services", "sign in"] },
  { slug: "plugins", titleKey: "composer.plus_plugins", detailKey: "settings_extra.extensions_that_add_tools_and_behavior", keywords: ["extensions", "tools", "hooks"] },
  { slug: "agents", titleKey: "composer.agents_label", detailKey: "settings_extra.specialized_agents_available_in_conversations", keywords: ["agent", "assistants", "modes"] },
  { slug: "commands", titleKey: "composer.plus_commands", detailKey: "settings_extra.slash_commands_available_in_the_composer", keywords: ["command", "slash", "prompts"] },
] satisfies Array<{ slug: string; titleKey: string; detailKey: string; keywords: string[] }>;

export function buildCommandPaletteSettingsItems(input: {
  developerMode: boolean;
  capabilities: Pick<PlatformCapabilities, "autoUpdate">;
  /** Desktop policy checker; when `allowControlSettings` is blocked only the Cloud tabs remain. */
  checkRestriction?: DesktopAppRestrictionChecker;
  onOpenSettings: (route: string) => void;
  onOpenExtensions: (section?: string) => void;
}): PaletteItem[] {
  const checkRestriction = input.checkRestriction ?? (() => false);
  const tabs = ([
    "general",
    ...getWorkspaceSettingsTabs(),
    ...getGlobalSettingsTabs(input.developerMode, input.capabilities),
    ...(isLocalGatewayClient() ? [] : CLOUD_SETTINGS_TABS),
  ] satisfies SettingsTab[]).filter((tab) => isSettingsTabAllowed({ tab, checkRestriction }));

  const tabItems = tabs.map((tab): PaletteItem => ({
    id: `settings:${tab}`,
    title: tab === "advanced" ? t("mcp.advanced_settings") : getSettingsTabLabel(tab),
    detail: getSettingsTabDescription(tab),
    keywords: SETTINGS_KEYWORDS[tab],
    breadcrumb: t("settings.tab_general"),
    group: "settings",
    action: () => {
      if (tab === "extensions") {
        input.onOpenExtensions();
        return;
      }
      input.onOpenSettings(`/settings/${tab}`);
    },
  }));

  const libraryItems = LIBRARY_SECTIONS.map((section): PaletteItem => ({
    id: `settings:extensions/${section.slug}`,
    title: t(section.titleKey),
    detail: t(section.detailKey),
    keywords: section.keywords,
    breadcrumb: t("settings_extra.settings_library"),
    group: "settings",
    action: () => input.onOpenExtensions(section.slug),
  }));

  const advancedItems: PaletteItem[] = tabs.includes("advanced")
    ? ADVANCED_SETTINGS_SECTIONS.filter((section) => !isLocalGatewayClient() || (section.id !== "organization-server" && section.id !== "agent-access")).map((section) => ({
        id: `settings:advanced/${section.id}`,
        title: t(section.titleKey),
        keywords: section.keywords,
        breadcrumb: t("settings_extra.settings_advanced"),
        group: "settings",
        action: () => input.onOpenSettings(`/settings/advanced/${section.id}`),
      }))
    : [];

  return input.developerMode
    ? [...advancedItems, ...tabItems, ...libraryItems]
    : [...tabItems, ...advancedItems, ...libraryItems];
}
