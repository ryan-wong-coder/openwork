import type { SettingsTab } from "@/app/types";
import { isLocalGatewayClient } from "@/app/lib/client-profile";
import { isZenoAboutEnabled } from "@/app/lib/zeno-about";
import type { ExtensionsSection } from "@/react-app/domains/settings/pages/extensions-view";

export function parseSettingsPath(pathname: string): {
  tab: SettingsTab;
  redirectPath: string | null;
  advancedSection?: string;
  extensionsSection?: ExtensionsSection;
  extensionDetailId?: string;
} {
  const trimmed = pathname
    .replace(/^\/workspace\/[^/]+\/settings\/?/, "")
    .replace(/^\/settings\/?/, "")
    .replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    return { tab: "general", redirectPath: "general" };
  }

  const [head, tail] = trimmed.split("/");
  switch (head) {
    case "general":
    case "ai":
    case "preferences":
    case "permissions":
    case "appearance":
    case "shortcuts":
    case "environment":
    case "debug":
      return { tab: head, redirectPath: null };
    case "about":
      return isZenoAboutEnabled() ? { tab: "about", redirectPath: null } : { tab: "general", redirectPath: "general" };
    case "updates":
      return isLocalGatewayClient() ? { tab: "general", redirectPath: "general" } : { tab: "updates", redirectPath: null };
    case "ollama":
      return isLocalGatewayClient() ? { tab: "ai", redirectPath: "ai" } : { tab: "ollama", redirectPath: null };
    case "advanced":
      return { tab: "advanced", redirectPath: null, advancedSection: tail };
    case "cloud-account":
    case "cloud-providers":
    case "usage":
      return isLocalGatewayClient() ? { tab: "general", redirectPath: "general" } : { tab: head, redirectPath: null };
    case "connect":
      return { tab: "extensions", redirectPath: "extensions", extensionsSection: "all" };
    case "recovery":
      return { tab: "advanced", redirectPath: "advanced" };
    case "skills":
      return { tab: "extensions", redirectPath: "extensions/skills", extensionsSection: "skills" };
    case "mcp":
      return { tab: "extensions", redirectPath: "extensions/mcps", extensionsSection: "mcps" };
    case "cloud-marketplaces":
      return { tab: "extensions", redirectPath: "extensions", extensionsSection: "all" };
    case "den":
    case "cloud-workers":
      return isLocalGatewayClient() ? { tab: "general", redirectPath: "general" } : { tab: "cloud-account", redirectPath: "cloud-account" };
    case "extensions":
      if (tail === "mcp") return { tab: "extensions", redirectPath: "extensions/mcps", extensionsSection: "mcps" };
      if (
        tail === "apps"
        || tail === "connections"
        || tail === "mcps"
        || tail === "skills"
        || tail === "commands"
        || tail === "agents"
        || tail === "plugins"
        || tail === "needs-sign-in"
        || tail === "needs-admin-setup"
        || tail === "ready"
      ) {
        return { tab: "extensions", redirectPath: null, extensionsSection: tail };
      }
      if (tail) {
        return {
          tab: "extensions",
          redirectPath: null,
          extensionsSection: "all",
          extensionDetailId: decodeURIComponent(tail),
        };
      }
      return { tab: "extensions", redirectPath: null, extensionsSection: "all" };
    default:
      return { tab: "general", redirectPath: "general" };
  }
}
