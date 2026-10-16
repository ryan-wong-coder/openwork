/** The host passes this reserved process value; workspace configuration cannot set it. */
export function isStandaloneAgentProfile(profile = process.env.OPENWORK_CLIENT_PROFILE): boolean {
  return profile?.trim().toLowerCase() === "local-gateway";
}

export const STANDALONE_SKILL_INSTRUCTION = "Skill creation: Local. Use installed native skills and the user's own plugins and MCP servers. Create or update .opencode/skills/<skill-name>/SKILL.md when requested; validate and re-read it after writing. Use only tools actually exposed in this request. Never invent an unavailable tool or connection.";

export const STANDALONE_DISCOVERY_INSTRUCTION = "This is the user's independent installation. Discover available local extension actions with openwork_query id extension.actions, then invoke an exact returned action with openwork_execute id extension.call when authorized. User-configured MCP servers and their own OAuth flows remain available. Follow the selected server's actual authorization flow; never request credentials in chat or replace it with another account service. No vendor account, subscription, organization Connect catalog, or hosted scheduler is part of this installation.";
