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
  image: "capability.target.image", images: "capability.target.images", file: "capability.target.file", files: "capability.target.files", folder: "capability.target.folder", folders: "capability.target.folders",
  document: "capability.target.document", documents: "capability.target.documents", message: "capability.target.message", messages: "capability.target.messages", email: "capability.target.email", emails: "capability.target.emails",
  meeting: "capability.target.meeting", meetings: "capability.target.meetings", "about meetings": "capability.target.meetings", event: "capability.target.event", events: "capability.target.events",
  "calendar events": "capability.target.calendar_events", calendar: "capability.target.calendar", contacts: "capability.target.contacts", users: "capability.target.users", web: "capability.target.web",
  capabilities: "capability.target.capabilities", tools: "capability.target.tools", spreadsheet: "capability.target.spreadsheet", spreadsheets: "capability.target.spreadsheets",
  presentation: "capability.target.presentation", presentations: "capability.target.presentations", connection: "capability.target.connection", connections: "capability.target.connections",
}
type ActionTense = "present" | "past" | "failure"
const PLUGIN_KIND_KEYS: Record<string, string> = {
  skill: "capability.kind.skill", plugin: "capability.kind.plugin", agent: "capability.kind.agent",
  command: "capability.kind.command", mcp: "capability.kind.mcp",
}
const FALLBACK_ACTION_KEYS = {
  present: "capability.verb.use.present", past: "capability.verb.use.past", failure: "capability.verb.use.failure",
}
const ACTION_MESSAGE_KEYS: Record<string, Record<ActionTense, string>> = {
  ask: { present: "capability.verb.ask.present", past: "capability.verb.ask.past", failure: "capability.verb.ask.failure" },
  search: { present: "capability.verb.search.present", past: "capability.verb.search.past", failure: "capability.verb.search.failure" },
  find: { present: "capability.verb.find.present", past: "capability.verb.find.past", failure: "capability.verb.find.failure" },
  fetch: { present: "capability.verb.fetch.present", past: "capability.verb.fetch.past", failure: "capability.verb.fetch.failure" },
  list: { present: "capability.verb.list.present", past: "capability.verb.list.past", failure: "capability.verb.list.failure" },
  read: { present: "capability.verb.read.present", past: "capability.verb.read.past", failure: "capability.verb.read.failure" },
  check: { present: "capability.verb.check.present", past: "capability.verb.check.past", failure: "capability.verb.check.failure" },
  create: { present: "capability.verb.create.present", past: "capability.verb.create.past", failure: "capability.verb.create.failure" },
  add: { present: "capability.verb.add.present", past: "capability.verb.add.past", failure: "capability.verb.add.failure" },
  send: { present: "capability.verb.send.present", past: "capability.verb.send.past", failure: "capability.verb.send.failure" },
  update: { present: "capability.verb.update.present", past: "capability.verb.update.past", failure: "capability.verb.update.failure" },
  delete: { present: "capability.verb.delete.present", past: "capability.verb.delete.past", failure: "capability.verb.delete.failure" },
  remove: { present: "capability.verb.remove.present", past: "capability.verb.remove.past", failure: "capability.verb.remove.failure" },
  run: { present: "capability.verb.run.present", past: "capability.verb.run.past", failure: "capability.verb.run.failure" },
  open: { present: "capability.verb.open.present", past: "capability.verb.open.past", failure: "capability.verb.open.failure" },
  query: { present: "capability.verb.query.present", past: "capability.verb.query.past", failure: "capability.verb.query.failure" },
  generate: { present: "capability.verb.generate.present", past: "capability.verb.generate.past", failure: "capability.verb.generate.failure" },
  edit: { present: "capability.verb.edit.present", past: "capability.verb.edit.past", failure: "capability.verb.edit.failure" },
  save: { present: "capability.verb.save.present", past: "capability.verb.save.past", failure: "capability.verb.save.failure" },
  write: { present: "capability.verb.write.present", past: "capability.verb.write.past", failure: "capability.verb.write.failure" },
  download: { present: "capability.verb.download.present", past: "capability.verb.download.past", failure: "capability.verb.download.failure" },
  upload: { present: "capability.verb.upload.present", past: "capability.verb.upload.past", failure: "capability.verb.upload.failure" },
  render: { present: "capability.verb.render.present", past: "capability.verb.render.past", failure: "capability.verb.render.failure" },
  analyze: { present: "capability.verb.analyze.present", past: "capability.verb.analyze.past", failure: "capability.verb.analyze.failure" },
  inspect: { present: "capability.verb.inspect.present", past: "capability.verb.inspect.past", failure: "capability.verb.inspect.failure" },
  connect: { present: "capability.verb.connect.present", past: "capability.verb.connect.past", failure: "capability.verb.connect.failure" },
  use: FALLBACK_ACTION_KEYS,
}

export function localizedCapabilityAction(verb: string, target: string, tense: ActionTense): string {
  const keys = ACTION_MESSAGE_KEYS[ACTION_VERBS[verb] ?? "use"] ?? FALLBACK_ACTION_KEYS
  return t(keys[tense], { target }).trim()
}

function localizedTarget(words: string): string {
  const key = words.toLowerCase()
  const target = Object.hasOwn(ACTION_TARGETS, key) ? ACTION_TARGETS[key] : undefined
  return target ? t(target) : words
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
    return localizedCapabilityAction(first, localizedTarget(words.slice(1).join(" ")), tense)
  }
  return localizedCapabilityAction("use", localizedTarget(humanize(action)), tense)
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
      present: `${localizedCapabilityAction("check", target, "present")}…`,
      past: localizedCapabilityAction("check", target, "past"),
      failure: localizedCapabilityAction("check", target, "failure"),
    }
  }
  if (toolName.endsWith("_get_skill")) {
    const name = skillReference(part)
    const target = name ? t("capability.named_skill", { name }) : t("capability.skill")
    return {
      service: null,
      present: `${localizedCapabilityAction("use", target, "present")}…`,
      past: localizedCapabilityAction("use", target, "past"),
      failure: localizedCapabilityAction("use", target, "failure"),
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
            present: `${localizedCapabilityAction(verb, service, "present")}${queryTail}`,
            past: `${localizedCapabilityAction(verb, service, "past")}${queryTail}`,
            failure: localizedCapabilityAction(verb, service, "failure"),
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
      const kindLabel = t(Object.hasOwn(PLUGIN_KIND_KEYS, kind) ? PLUGIN_KIND_KEYS[kind] ?? "capability.kind.plugin" : "capability.kind.plugin")
      const label = pluginName
        ? t("capability.named_plugin", { kind: kindLabel, name: pluginName })
        : t("capability.unnamed_plugin", { kind: kindLabel })
      return {
        service: pluginName,
        present: localizedCapabilityAction("use", label, "present"),
        past: localizedCapabilityAction("use", label, "past"),
        failure: localizedCapabilityAction("use", label, "failure"),
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
          present: `${localizedCapabilityAction(first, phrase, "present")}${suffix}`,
          past: `${localizedCapabilityAction(first, phrase, "past")}${suffix}`,
          failure: `${localizedCapabilityAction(first, phrase, "failure")}${suffix}`,
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
        present: `${localizedCapabilityAction(verb, service, "present")}${queryTail}`,
        past: `${localizedCapabilityAction(verb, service, "past")}${queryTail}`,
        failure: localizedCapabilityAction(verb, service, "failure"),
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

