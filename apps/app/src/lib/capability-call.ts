import type { DynamicToolUIPart } from "ai"
import { t } from "../i18n"

/**
 * Paper rendering rules — "Capability calls → sentences":
 * never render raw JSON. Map connection name → service ("Granola"),
 * tool name → verb ("Asking about…"), body.query → quoted plain text.
 * IDs and schema digests live under "Technical details", collapsed.
 */

export type CapabilityCallSentence = {
  /** Human service name, e.g. "Granola" or "OpenWork Cloud". */
  service: string | null
  /** Present-tense line while the call runs. */
  present: string
  /** Past-tense line once the call completed. */
  past: string
  failure?: string
}

// Keep translation keys, rather than translated strings, so switching locale
// also changes activity already present in a conversation.
const ACTION_VERBS: Record<string, string> = {
  ask: "ask", search: "search", find: "find", get: "fetch", fetch: "fetch", list: "list", read: "read", check: "check",
  create: "create", add: "add", send: "send", update: "update", delete: "delete", remove: "remove", execute: "run",
  run: "run", open: "open", query: "query", generate: "generate", edit: "edit", save: "save", write: "write",
  download: "download", upload: "upload", render: "render", analyze: "analyze", inspect: "inspect", connect: "connect",
}
const ACTION_TARGETS: Record<string, string> = {
  image: "image", images: "images", file: "file", files: "files", folder: "folder", folders: "folders",
  document: "document", documents: "documents", message: "message", messages: "messages", email: "email", emails: "emails",
  meeting: "meeting", meetings: "meetings", "about meetings": "meetings", event: "event", events: "events",
  "calendar events": "calendar_events", calendar: "calendar", contacts: "contacts", users: "users", web: "web",
  capabilities: "capabilities", tools: "tools", spreadsheet: "spreadsheet", spreadsheets: "spreadsheets",
  presentation: "presentation", presentations: "presentations", connection: "connection", connections: "connections",
}
type ActionTense = "present" | "past" | "failure"

function localizedAction(verb: string, target: string, tense: ActionTense): string {
  return t(`capability.verb.${ACTION_VERBS[verb] ?? "use"}.${tense}`, { target }).trim()
}

function localizedTarget(words: string): string {
  const target = ACTION_TARGETS[words.toLowerCase()]
  return target ? t(`capability.target.${target}`) : words
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Tool outputs arrive as objects or JSON strings depending on transport. */
export function parseRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  if (typeof value !== "string") return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Brand names whose casing a plain title case would get wrong. */
const BRAND_WORDS: Record<string, string> = { openwork: "OpenWork", github: "GitHub", gitlab: "GitLab", hubspot: "HubSpot" }

function titleCase(slug: string): string {
  return slug
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => BRAND_WORDS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Connection namespaces carry routing ids ("openwork-direct-slack-c1ca24").
 * People should see the service ("Slack"), never the plumbing around it.
 */
export function serviceNameFromSlug(slug: string): string {
  const cleaned = slug.replace(/^openwork-direct-/i, "").replace(/-[0-9a-f]{6}$/i, "")
  return titleCase(cleaned || slug)
}

/**
 * Tool actions often repeat their service and lead with a qualifier
 * ("web_search_exa"). Drop the repeated service word, and move a known verb
 * to the front so "web_search" reads as "search web".
 */
function normalizeAction(action: string, serviceSlug: string): string {
  const serviceWords = new Set(serviceSlug.toLowerCase().split(/[-_.\s]+/))
  const words = action.split(/[-_.\s]+/).filter(Boolean)
  const withoutService = words.filter((word) => !serviceWords.has(word.toLowerCase()))
  const kept = withoutService.length > 0 ? withoutService : words
  const verbIndex = kept.findIndex((word) => ACTION_VERBS[word.toLowerCase()] !== undefined)
  if (verbIndex > 0) kept.unshift(...kept.splice(verbIndex, 1))
  return kept.join("_")
}

function humanize(slug: string): string {
  return slug.split(/[-_.\s]+/).filter(Boolean).join(" ")
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Pull a short human query out of a capability call input, if one exists. */
function extractQuery(input: unknown, max = 80): string | null {
  if (!isRecord(input)) return null
  const direct = input.query ?? input.q ?? input.search ?? input.prompt
  if (typeof direct === "string" && direct.trim()) return truncate(direct.trim(), max)
  // Bodies arrive as objects or as a JSON string, depending on how the
  // capability was invoked.
  const body = parseRecord(input.body)
  if (body) {
    const nested = body.query ?? body.q ?? body.search ?? body.prompt ?? body.question ?? body.message ?? body.text
    if (typeof nested === "string" && nested.trim()) return truncate(nested.trim(), max)
  }
  return null
}

/**
 * Full natural-language ask behind a capability call, for the failed-call
 * card's quote block (Paper "Failed Call Card" · Query Quote).
 */
export function getCapabilityCallQuote(part: DynamicToolUIPart): string | null {
  return extractQuery(part.input, 280)
}

/** "granola.ask-about-meetings" or "granola/ask_about_meetings" → parts. */
function splitCapabilityName(name: string): { service: string; action: string } | null {
  const separator = name.includes(".") ? "." : name.includes("/") ? "/" : null
  if (!separator) return null
  const index = name.indexOf(separator)
  const service = name.slice(0, index)
  const action = name.slice(index + 1)
  if (!service || !action) return null
  return { service: serviceNameFromSlug(service), action }
}

function verbPhrase(action: string, tense: ActionTense): string {
  const words = normalizeAction(action, "").split(/[-_.\s]+/).filter(Boolean)
  const first = words[0]?.toLowerCase()
  if (first && ACTION_VERBS[first]) {
    return localizedAction(first, localizedTarget(words.slice(1).join(" ")), tense)
  }
  return localizedAction("use", localizedTarget(humanize(action)), tense)
}

/** Skill slug from a get_skill call: the name asked for, else the one returned. */
function skillReference(part: DynamicToolUIPart): string | null {
  const input = parseRecord(part.input)
  const asked = typeof input?.name === "string" ? input.name.trim() : ""
  if (asked && !asked.includes(":")) return asked
  const raw = "output" in part ? part.output : undefined
  const output = parseRecord(raw)
  if (typeof output?.name === "string" && output.name.trim()) return output.name.trim()
  // The text result is the SKILL.md itself; its frontmatter carries the slug.
  const frontmatter = typeof raw === "string" ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] : undefined
  const name = frontmatter ? /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "" : ""
  // Den keeps marketplace skill names unique with an 8-character id suffix.
  return (asked.startsWith("plugin:") ? name.replace(/-[a-z0-9]{8}$/, "") : name) || null
}

export function getConnectionStatusProbeId(part: DynamicToolUIPart): string | null {
  if (part.toolName !== "openwork_execute_capability" && part.toolName !== "openwork-cloud_execute_capability") return null
  const input = parseRecord(part.input)
  return typeof input?.name === "string" ? /^mcp:([^:\s]+):\*$/.exec(input.name)?.[1] ?? null : null
}

export function getCapabilityCallSentence(
  part: DynamicToolUIPart,
  options?: { includeQuery?: boolean; connectionName?: string | null },
): CapabilityCallSentence {
  const toolName = part.toolName
  if (getConnectionStatusProbeId(part)) {
    const service = options?.connectionName?.trim() || null
    const target = service ? t("capability.named_connection", { service }) : t("capability.target.connection")
    return {
      service,
      present: `${localizedAction("check", target, "present")}…`,
      past: localizedAction("check", target, "past"),
      failure: localizedAction("check", target, "failure"),
    }
  }
  if (toolName.endsWith("_get_skill")) {
    const name = skillReference(part)
    const target = name ? t("capability.named_skill", { name }) : t("capability.skill")
    return {
      service: null,
      present: `${localizedAction("use", target, "present")}…`,
      past: localizedAction("use", target, "past"),
      failure: localizedAction("use", target, "failure"),
    }
  }

  if (toolName.endsWith("_list_skills")) {
    return { service: null, present: t("capability.skills.present"), past: t("capability.skills.past"), failure: t("capability.skills.failure") }
  }

  // Code Mode's own catalog lookup is plumbing: say what it did, never echo
  // the internal tool name it searched for.
  if (toolName === "search") {
    return {
      service: null,
      present: t("capability.catalog.present"),
      past: t("capability.catalog.past"),
      failure: t("capability.catalog.failure"),
    }
  }

  const query = options?.includeQuery === false ? null : extractQuery(part.input)
  const queryTail = query ? t("capability.query_suffix", { query }) : ""
  const detailTail = query ? t("capability.detail_suffix", { query }) : ""

  if (toolName.endsWith("search_capabilities")) {
    return {
      service: null,
      present: `${t("capability.connections.present")}${queryTail}`,
      past: `${t("capability.connections.past")}${queryTail}`,
      failure: t("capability.connections.failure"),
    }
  }

  // A Den Code Mode script: the work happens inside the script, so name the
  // place it ran rather than the plumbing tool ("execute capability script").
  if (toolName.endsWith("execute_capability_script")) {
    return {
      service: "OpenWork Cloud",
      present: t("capability.cloud_script.present"),
      past: t("capability.cloud_script.past"),
      failure: t("capability.cloud_script.failure"),
    }
  }

  if (toolName.endsWith("execute_capability")) {
    const name = isRecord(part.input) && typeof part.input.name === "string" ? part.input.name : null
    const split = name ? splitCapabilityName(name) : null
    if (split) {
      const action = normalizeAction(split.action, split.service)
      return {
        service: split.service,
        present: `${verbPhrase(action, "present")} · ${split.service}${detailTail}`,
        past: `${verbPhrase(action, "past")} · ${split.service}${detailTail}`,
        failure: `${verbPhrase(action, "failure")} · ${split.service}`,
      }
    }

    // Org MCP capabilities arrive as "mcp:<connection-id>:<tool_name>". The
    // connection id is opaque, so the trailing tool name carries the meaning
    // ("query_granola_meetings" → "Queried granola meetings").
    if (name?.startsWith("mcp:")) {
      const rawAction = name.split(":").filter(Boolean).at(-1)
      if (rawAction) {
        // The connection id is opaque; the resolved connector names the service.
        const service = options?.connectionName?.trim() || null
        const action = normalizeAction(rawAction, service ?? "")
        if (service && /^(?:search|find|query)(?:_|$)/i.test(action)) {
          const verb = action.split("_")[0]!.toLowerCase()
          return {
            service,
            present: `${localizedAction(verb, service, "present")}${queryTail}`,
            past: `${localizedAction(verb, service, "past")}${queryTail}`,
            failure: localizedAction(verb, service, "failure"),
          }
        }
        const tail = service ? ` · ${service}` : ""
        return {
          service,
          present: `${verbPhrase(action, "present")}${tail}${detailTail}`,
          past: `${verbPhrase(action, "past")}${tail}${detailTail}`,
          // Without a known service there is nothing specific to say.
          ...(service ? { failure: `${verbPhrase(action, "failure")}${tail}` } : {}),
        }
      }
    }

    // "plugin:plg_…:cob_…" refs are opaque; the human name only exists in
    // the output ({ kind: "skill", plugin: "Plan My Day", … }).
    if (name?.startsWith("plugin:")) {
      const output = parseRecord("output" in part ? part.output : undefined)
      const kind = typeof output?.kind === "string" ? output.kind : "plugin"
      const pluginName = typeof output?.plugin === "string"
        ? output.plugin
        : typeof output?.name === "string"
          ? humanize(output.name)
          : null
      const knownKind = ["skill", "plugin", "agent", "command", "mcp"].includes(kind) ? kind : "plugin"
      const label = pluginName
        ? t("capability.named_plugin", { kind: t(`capability.kind.${knownKind}`), name: pluginName })
        : t("capability.unnamed_plugin", { kind: t(`capability.kind.${knownKind}`) })
      return {
        service: pluginName,
        present: localizedAction("use", label, "present"),
        past: localizedAction("use", label, "past"),
        failure: localizedAction("use", label, "failure"),
      }
    }

    // Native camelCase capabilities, e.g.
    // "native:<connection>:getCapabilitiesGoogleWorkspaceCalendarEvents".
    if (name) {
      const nativeName = name.replace(/^native:[^:]+:/, "")
      const words = nativeName.split(/(?=[A-Z])|[-_.\s]+/).filter(Boolean)
      const first = words[0]?.toLowerCase()
      let rest = words.slice(1)
      if (/^capabilit(y|ies)$/i.test(rest[0] ?? "")) rest = rest.slice(1)
      // "GoogleWorkspaceCalendarEvents" → service "Google Workspace", "calendar events".
      const nativeService = /^GoogleWorkspace/.test(rest.join("")) ? "Google Workspace"
        : /^Microsoft365/.test(rest.join("")) ? "Microsoft 365" : null
      if (nativeService) rest = rest.slice(nativeService === "Google Workspace" ? 2 : 1)
      if (first && ACTION_VERBS[first] && rest.length > 0) {
        const phrase = localizedTarget(rest.join(" ").toLowerCase())
        const suffix = nativeService ? ` · ${nativeService}` : ""
        return {
          service: nativeService,
          present: `${localizedAction(first, phrase, "present")}${suffix}`,
          past: `${localizedAction(first, phrase, "past")}${suffix}`,
          failure: `${localizedAction(first, phrase, "failure")}${suffix}`,
        }
      }
    }

    return {
      service: null,
      present: `${t("capability.generic.present")}${queryTail}`,
      past: `${t("capability.generic.past")}${queryTail}`,
      failure: t("capability.generic.failure"),
    }
  }

  // Generic "{connection}_{tool}" MCP tools.
  const underscore = toolName.indexOf("_")
  if (underscore > 0) {
    const serviceSlug = toolName.slice(0, underscore)
    const service = serviceNameFromSlug(serviceSlug)
    const action = normalizeAction(toolName.slice(underscore + 1), serviceSlug)
    // A bare search reads as "Searched Exa", not "Searched · Exa".
    // Search qualifiers ("search_public_and_private", "web_search") add
    // nothing a person needs; the query says what was searched.
    if (/^(?:search|find|query)(?:_|$)/i.test(action)) {
      const verb = action.split("_")[0]!.toLowerCase()
      return {
        service,
        present: `${localizedAction(verb, service, "present")}${queryTail}`,
        past: `${localizedAction(verb, service, "past")}${queryTail}`,
        failure: localizedAction(verb, service, "failure"),
      }
    }
    return {
      service,
      present: `${verbPhrase(action, "present")} · ${service}${detailTail}`,
      past: `${verbPhrase(action, "past")} · ${service}${detailTail}`,
      failure: `${verbPhrase(action, "failure")} · ${service}`,
    }
  }

  return {
    service: null,
    present: `${verbPhrase(toolName, "present")}${detailTail}`,
    past: `${verbPhrase(toolName, "past")}${detailTail}`,
    failure: verbPhrase(toolName, "failure"),
  }
}

