import { t } from "@/i18n";
import type { DynamicToolUIPart } from "ai"
import { openworkCloudMcpConnectionActionSchema } from "@openwork/types/den/mcp-connection-action"
import { connectionActionPayloadSchema, type ConnectionActionPayload } from "@openwork/types/connection-action-app"
import { parseMcpAppResourceUri } from "@openwork/types/mcp-app"

export type ToolErrorAttribution = {
  label: string
  confidence: "Confirmed" | "Inferred"
  description: string
}

export type ChatToolReconnectAction = {
  credentialKind?: "personal_key";
  connectionId: string
  connectionName: string
  label: string
}

export type ChatToolReconnectProgress =
  | { phase: "opening" }
  | { phase: "authorization_opened"; authorizeUrl: string }
export type ChatToolReconnectResult = "connected"

const OPENWORK_CLOUD_CAPABILITY_TOOLS = new Set([
  "openwork-cloud_search_capabilities",
  "openwork-cloud_execute_capability",
  "openwork-cloud_list_skills",
  "openwork-cloud_get_skill",
  "openwork-cloud_connection_action",
  "openwork_search_capabilities",
  "openwork_execute_capability",
  "openwork_list_skills",
  "openwork_get_skill",
  "openwork_connection_action",
])

/**
 * The tool name an App's own call result is read as. An App built in OpenWork is
 * served by the desktop's private OpenWork Connect host, and each of its tools
 * runs one OpenWork Cloud capability, so its failures carry the same connection
 * cards as execute_capability. Any other App's results stay its own.
 */
export function appToolResultConnectionToolName(app: { serverName: string; resourceUri: string }, toolName: string): string {
  return parseMcpAppResourceUri(app.resourceUri) && app.serverName.startsWith("openwork-app-host-connect-")
    ? "openwork-cloud_execute_capability"
    : toolName
}

export function isConnectionDiscoveryTool(toolName: string): boolean {
  return toolName === "openwork_search_capabilities" || toolName === "openwork-cloud_search_capabilities"
}

const MAX_PARSED_RESULT_LENGTH = 64 * 1_024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseResultRecord(result: unknown): Record<string, unknown> | null {
  if (isRecord(result)) return result
  if (typeof result !== "string") return null
  if (result.length > MAX_PARSED_RESULT_LENGTH) return null

  const trimmed = result.trim()
  const jsonStart = trimmed.indexOf("{")
  const jsonEnd = trimmed.lastIndexOf("}")
  const candidates = [
    trimmed,
    ...(jsonStart > 0 ? [trimmed.slice(jsonStart)] : []),
    ...(jsonStart >= 0 && jsonEnd > jsonStart ? [trimmed.slice(jsonStart, jsonEnd + 1)] : []),
  ]

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (isRecord(parsed)) return parsed
    } catch {
      // The engine may wrap the MCP JSON in a plain error message.
    }
  }
  return null
}

function diagnosticFromError(errorText: string): Record<string, unknown> | null {
  const parsed = parseResultRecord(errorText)
  if (!parsed) return null
  return isRecord(parsed.diagnostic) ? parsed.diagnostic : parsed
}

function stringValue(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

function numberValue(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function confirmed(label: string, description: string): ToolErrorAttribution {
  return { label, confidence: "Confirmed", description }
}

const connectionActionLabels = () => ({
  connect: t("mcp.org_connection_connect_action"),
  reconnect: t("ui.reconnect_your_account"),
  update_credentials: t("ui.update_credentials"),
  inspect_connection: t("ui.inspect_the_connection"),
  fix_provider: t("ui.fix_provider_access"),
  fix_network: t("ui.fix_network_access"),
  contact_openwork: t("ui.contact_openwork_support"),
})

/** OpenWork Cloud's own capability tools, whose results the host may present natively. */
export function isOpenworkCloudCapabilityTool(toolName: string): boolean {
  return isConnectionTool(toolName)
}

function isConnectionTool(toolName: string): boolean {
  return OPENWORK_CLOUD_CAPABILITY_TOOLS.has(toolName) || /^openwork(?:-cloud)?_run_artifact_[A-Za-z0-9_-]+$/.test(toolName)
}

/**
 * Ordinary discovery (`search_capabilities` without `intent: "connect"`) stays
 * quiet in the transcript. `allowDiscovery` lets a caller that already holds a
 * pending native connection question read the same blocker from such a result.
 */
export type ChatConnectionTargetOptions = { allowDiscovery?: boolean }

function chatConnectionTarget(toolName: string, result: unknown, input?: unknown, options?: ChatConnectionTargetOptions) {
  if (!isConnectionTool(toolName)) return null
  if (isConnectionDiscoveryTool(toolName) && !options?.allowDiscovery && (!isRecord(input) || input.intent !== "connect")) return null
  const parsed = parseResultRecord(result)
  if (!parsed) return null
  const candidates = [
    ...(typeof parsed.connectionId === "string" ? [parsed] : []),
    parsed.connectionAction,
    parsed.connectionStatus,
    ...(Array.isArray(parsed.matches) ? parsed.matches.filter(isRecord).flatMap(match => [match.connectionAction, match.connectionStatus]) : []),
  ].filter(candidate => candidate !== undefined && candidate !== null)
  let target: ConnectionActionPayload | null = null
  let memberOAuth = true
  let authType: unknown
  let credentialMode: unknown
  for (const candidate of candidates) {
    if (!isRecord(candidate)) return null
    if (("source" in candidate && candidate.source !== "openwork-cloud")
      || ("version" in candidate && candidate.version !== 1)
      || ("kind" in candidate && candidate.kind !== "connection_action")) return null
    const legacy = openworkCloudMcpConnectionActionSchema.safeParse(candidate)
    const payload = connectionActionPayloadSchema.safeParse(legacy.success && !("schemaVersion" in candidate)
      ? {
        ...legacy.data,
        schemaVersion: "1",
        message: stringValue(candidate, "message") ?? connectionActionLabels()[legacy.data.action.type],
        action: {
          ...legacy.data.action,
          label: isRecord(candidate.action) ? stringValue(candidate.action, "label") ?? connectionActionLabels()[legacy.data.action.type] : connectionActionLabels()[legacy.data.action.type],
        },
      }
      : candidate)
    if (!payload.success) return null
    if (target && (target.connectionId !== payload.data.connectionId || target.connectionName !== payload.data.connectionName
      || target.state !== payload.data.state || target.actor !== payload.data.actor
      || target.action?.type !== payload.data.action?.type || target.action?.surface !== payload.data.action?.surface)) return null
    target = payload.data
    if ("authType" in candidate) {
      if (authType !== undefined && authType !== candidate.authType) return null
      authType = candidate.authType
    }
    if ("credentialMode" in candidate) {
      if (credentialMode !== undefined && credentialMode !== candidate.credentialMode) return null
      credentialMode = candidate.credentialMode
    }
    if (("authType" in candidate && candidate.authType !== "oauth")
      || ("credentialMode" in candidate && candidate.credentialMode !== "per_member")) memberOAuth = false
  }
  const targetId = target?.connectionId
  if (targetId && Array.isArray(parsed.matches) && parsed.matches.some(match => isRecord(match)
    && typeof match.connectionId === "string" && match.connectionId !== targetId)) return null
  return target ? { connection: target, memberOAuth, memberPersonalKey: authType === "apikey" && credentialMode === "per_member" } : null
}

export function connectionCardPayloadFromChatToolResult(
  toolName: string,
  result: unknown,
  input?: unknown,
  options?: ChatConnectionTargetOptions,
): ConnectionActionPayload | null {
  return chatConnectionTarget(toolName, result, input, options)?.connection ?? null
}

/**
 * The one connection an MCP tool result reports, read from the result itself,
 * its structured content, its metadata, or the JSON in its text parts, with
 * the part it was found in for the card to render.
 */
export function connectionCardFromMcpToolResult(
  toolName: string,
  value: unknown,
  input?: unknown,
): { connection: ConnectionActionPayload; output: unknown } | null {
  const outputs: unknown[] = [value]
  if (isRecord(value)) {
    outputs.push(value.structuredContent, value._meta)
    if (Array.isArray(value.content)) outputs.push(...value.content.filter(isRecord).filter(item => item.type === "text").map(item => item.text))
  }
  const matches = new Map<string, { connection: ConnectionActionPayload; output: unknown }>()
  for (const output of outputs) {
    const connection = connectionCardPayloadFromChatToolResult(toolName, output, input)
    if (connection) matches.set(connection.connectionId, { connection, output })
  }
  return matches.size === 1 ? matches.values().next().value ?? null : null
}

export function reconnectActionFromChatToolResult(
  toolName: string,
  result: unknown,
  input?: unknown,
  options?: ChatConnectionTargetOptions,
): ChatToolReconnectAction | null {
  const target = chatConnectionTarget(toolName, result, input, options)
  if (!target || (!target.memberOAuth && !target.memberPersonalKey)) return null
  const { connection } = target
  if (connection.actor !== "member" || connection.action?.surface !== "openwork_your_connections"
    || !(target.memberPersonalKey
      // A member-held key only ever uses the credential action, never an OAuth connect or reconnect.
      ? connection.action.type === "update_credentials" && (connection.state === "needs_connection" || connection.state === "reauth_required")
      : (connection.state === "needs_connection" && connection.action.type === "connect")
        || (connection.state === "reauth_required" && connection.action.type === "reconnect"))) return null
  return {
    connectionId: connection.connectionId,
    connectionName: connection.connectionName,
    label: target.memberPersonalKey ? connection.state === "reauth_required" ? t("ui.replace_key") : t("ui.add_key") : connection.state === "needs_connection" ? t("composer.plus_connect") : t("mcp.action_reconnect"),
    ...(target.memberPersonalKey ? { credentialKind: "personal_key" } : {}),
  }
}

export function connectionResultFromChatToolPart(part: DynamicToolUIPart, options?: ChatConnectionTargetOptions): unknown {
  if (!isConnectionTool(part.toolName) || (part.state !== "output-error" && part.state !== "output-available")) return undefined
  const raw = part.state === "output-error" ? part.errorText : part.output
  const metadata = part.callProviderMetadata?.openwork
  const preserved = isRecord(metadata) ? [metadata.mcpResult, metadata.mcpApp] : []
  const records = [raw, ...preserved.flatMap(result => isRecord(result) ? [result.structuredContent] : [])]
    .map(parseResultRecord).filter(isRecord)
  const matches: unknown[] = []
  for (const record of records) {
    if ("connectionId" in record || "schemaVersion" in record || record.kind === "connection_action") matches.push({ connectionStatus: record })
    if ("connectionAction" in record) matches.push({ connectionStatus: record.connectionAction })
    if ("connectionStatus" in record) matches.push({ connectionStatus: record.connectionStatus })
    if (Array.isArray(record.matches)) matches.push(...record.matches)
  }
  const combined = { matches }
  return chatConnectionTarget(part.toolName, combined, part.input, options) ? combined : undefined
}

/**
 * The connection a chat tool part reports, if any. Ordinary discovery is
 * excluded unless `allowDiscovery` is set.
 */
export function connectionFromChatToolPart(part: DynamicToolUIPart, options?: ChatConnectionTargetOptions): {
  connection: ConnectionActionPayload
  action: ChatToolReconnectAction | null
} | null {
  const result = connectionResultFromChatToolPart(part, options)
  const connection = connectionCardPayloadFromChatToolResult(part.toolName, result, part.input, options)
  if (!connection) return null
  return { connection, action: reconnectActionFromChatToolResult(part.toolName, result, part.input, options) }
}

export function attributeChatToolError(errorText: string): ToolErrorAttribution | null {
  if (errorText.length > MAX_PARSED_RESULT_LENGTH) return null
  const diagnostic = diagnosticFromError(errorText)
  const code = stringValue(diagnostic, "code")
  const category = stringValue(diagnostic, "category")
  const phase = stringValue(diagnostic, "phase")
  const httpStatus = numberValue(diagnostic, "httpStatus")
  const providerStatus = numberValue(diagnostic, "providerStatus")
  const providerCode = stringValue(diagnostic, "providerCode")

  if (
    errorText.includes("OpenWork stopped waiting after")
    || /The capability call exceeded \d+(?:\.\d+)?s\b/.test(errorText)
    || code === "MCP_LIFECYCLE_DEADLINE"
    || code === "MCP_REQUEST_TIMEOUT"
    || category === "lifecycle_deadline"
  ) {
    return confirmed(
      t("ui.openwork_timeout"),
      t("ui.openwork_created_this_deadline_the_external_operation_may_still_have_completed_so_verify_i"),
    )
  }

  if (
    category === "security_blocked"
    || code === "MCP_URL_BLOCKED"
    || code === "MCP_FETCH_FORBIDDEN_PORT"
  ) {
    return confirmed(t("ui.blocked_by_openwork"), t("ui.openwork_blocked_the_request_before_it_was_sent"))
  }

  if (httpStatus !== undefined && (httpStatus < 200 || httpStatus >= 300)) {
    return confirmed(
      t("ui.remote_mcp_http", { status: httpStatus }),
      t("ui.remote_mcp_http_description", { status: httpStatus }),
    )
  }

  if (
    phase?.startsWith("PROVIDER_")
    || category?.startsWith("provider_")
    || providerStatus !== undefined
    || providerCode !== undefined
  ) {
    return confirmed(
      t("ui.provider_error"),
      providerStatus === undefined
        ? t("ui.the_remote_mcp_responded_but_the_downstream_provider_or_tool_rejected_the_operation")
        : t("ui.provider_status", { status: providerStatus }),
    )
  }

  if (/\b(?:timed out|timeout|deadline exceeded)\b/i.test(errorText)) {
    return {
      label: t("ui.timeout_source_unclear"),
      confidence: "Inferred",
      description: t("ui.a_timeout_was_reported_but_the_client_did_not_receive_structured_evidence_identifying_whic"),
    }
  }

  return null
}

/** End-user copy; attribution and raw provider payloads belong in details. */
export function describeChatToolFailure(errorText: string): string {
  const attribution = attributeChatToolError(errorText)
  if (attribution?.label === t("ui.blocked_by_openwork")) return t("ui.this_action_is_blocked_by_your_workspace_settings")
  if (/timeout|timed out|deadline|\b504\b/i.test(errorText)) return t("ui.the_service_didn_t_respond_in_time_check_whether_the_action_finished_before_trying_again")
  if (/\b401\b|unauthorized|invalid[_ ]token|authentication required/i.test(errorText)) return t("ui.this_connection_needs_attention_check_its_sign_in_settings")
  if (/\b403\b|forbidden|access[_ ]denied|insufficient[_ ]scope/i.test(errorText)) return t("ui.this_connection_doesn_t_have_access_to_the_requested_action")
  if (/\b50[0234]\b|internal[_ ]server[_ ]error|bad gateway|service unavailable|fetch failed|ECONNRESET|ENOTFOUND/i.test(errorText)) return t("ui.the_service_couldn_t_complete_this_action_check_its_status_before_trying_again")
  return t("ui.this_action_couldn_t_finish_check_the_details_before_trying_again")
}
