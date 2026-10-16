import { t } from "@/i18n";
import { connectionActionPayloadSchema } from "@openwork/types/connection-action-app"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { OpenworkMcpAppResource, OpenworkMcpAppToolResult } from "@/app/lib/openwork-server"
import type { ChatConnectionDecisionBinding } from "@/react-app/domains/session/surface/mcp-chat-reconnect"
import type { ChatToolReconnectCallbacks } from "@/components/tools/use-chat-tool-reconnect"
import { chatMcpReconnectKey, respondChatConnectionDecision } from "@/components/tools/mcp-reconnect-state"
import type { createMcpAppActions } from "./mcp-app-origin"

const resourceUri = "ui://openwork/connection-action/v2/view.html"
const claimedDecisions = new Set<string>()
const authenticatedDecisions = new Map<string, {
  request: string | null
  onReconnect: ChatToolReconnectCallbacks["onReconnect"]
}>()

export function hasHostConnectionActions(app: OpenworkMcpAppResource): boolean {
  return app.resourceUri === resourceUri && app.toolName === "connection_action"
    && "hostConnectionActions" in app && app.hostConnectionActions === true
}

export function standardMcpToolResult(result: OpenworkMcpAppToolResult) {
  return CallToolResultSchema.parse({
    content: result.content,
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    ...(result.isError !== undefined ? { isError: result.isError } : {}),
    ...(result._meta ? { _meta: result._meta } : {}),
  })
}

function requestIdentity(binding: ChatConnectionDecisionBinding) {
  const request = binding.request
  return JSON.stringify([request.owner, request.sessionId, request.turnId, request.toolCallId,
    request.connectionId, request.requestId, request.questionToolCallId])
}

export type ConnectionActionHost = {
  scope: string
  sessionId: string | null
  toolCallId: string
  connectionId: string
  current: () => {
    scope: string
    blocked: boolean
    decision: ChatConnectionDecisionBinding | null
    onReconnect: ChatToolReconnectCallbacks["onReconnect"]
  }
}

export function createConnectionActionController(source: ConnectionActionHost) {
  let boundRequest: string | undefined
  const binding = () => {
    const current = source.current()
    if (current.blocked || current.scope !== source.scope) throw new Error(t("ui.this_connection_action_is_no_longer_active"))
    const decision = current.decision
    if (!decision) {
      if (boundRequest) throw new Error(t("ui.the_original_connection_question_is_no_longer_pending"))
      return null
    }
    const request = decision.request
    if (request.owner !== source.scope || request.sessionId !== source.sessionId
      || request.toolCallId !== source.toolCallId || request.connectionId !== source.connectionId
      || !decision.isPending()) throw new Error(t("ui.this_connection_action_does_not_belong_to_the_pending_question"))
    const identity = requestIdentity(decision)
    if (boundRequest && boundRequest !== identity) throw new Error(t("ui.the_original_connection_question_has_changed"))
    boundRequest = identity
    return decision
  }
  const observeBinding = () => {
    try { binding() } catch {}
  }
  const callTool = async (
    actions: ReturnType<typeof createMcpAppActions>,
    app: OpenworkMcpAppResource,
    name: string,
    args: Record<string, unknown> | undefined,
    userInteraction: boolean,
  ) => {
    const initialDecision = (() => {
      try { return { decision: binding(), valid: true } } catch { return { decision: null, valid: false } }
    })()
    const response = await actions.callTool(name, args, userInteraction)
    if (!("hostAction" in response)) return standardMcpToolResult(response)
    actions.assertActive()
    const intent = response.hostAction
    if (!userInteraction || !hasHostConnectionActions(app) || response.isError || !initialDecision.valid
      || name !== "connection_action_intent" || args?.connectionId !== source.connectionId
      || typeof intent !== "object" || intent === null
      || !("schemaVersion" in intent) || intent.schemaVersion !== "1"
      || !("kind" in intent) || intent.kind !== "connection_action_intent"
      || !("action" in intent) || (intent.action !== "authenticate" && intent.action !== "skip")
      || intent.action !== args.action || !("connection" in intent)) {
      throw new Error(t("ui.the_server_did_not_authorize_this_connection_action"))
    }
    const parsed = connectionActionPayloadSchema.safeParse(intent.connection)
    if (!parsed.success || parsed.data.connectionId !== source.connectionId) throw new Error(t("ui.the_connection_identity_changed"))
    const decision = binding()
    if ((decision ? requestIdentity(decision) : null) !== (initialDecision.decision ? requestIdentity(initialDecision.decision) : null)) {
      throw new Error(t("ui.the_pending_connection_question_changed_during_the_action"))
    }
    const key = chatMcpReconnectKey(source.toolCallId, source.connectionId, source.scope)
    if (claimedDecisions.has(key)) throw new Error(t("ui.a_decision_has_already_been_made_for_this_connection_action"))
    claimedDecisions.add(key)
    const onReconnect = source.current().onReconnect
    const isCurrent = () => {
      try {
        actions.assertActive()
        const latest = binding()
        return source.current().onReconnect === onReconnect
          && (latest ? requestIdentity(latest) : null) === (decision ? requestIdentity(decision) : null)
      } catch { return false }
    }
    try {
      const authenticated = authenticatedDecisions.get(key)
      const request = decision ? requestIdentity(decision) : null
      if (authenticated && (authenticated.request !== request || authenticated.onReconnect !== onReconnect)) {
        throw new Error(t("ui.the_connection_action_is_no_longer_current"))
      }
      let questionAnswered = false
      if (intent.action === "authenticate") {
        if (!authenticated) {
          const connection = parsed.data
          if (!onReconnect || connection.actor !== "member" || connection.action?.surface !== "openwork_your_connections"
            || !((connection.state === "needs_connection" && connection.action.type === "connect")
              || (connection.state === "reauth_required" && connection.action.type === "reconnect"))) {
            throw new Error(t("ui.this_connection_requires_setup_in_settings_library"))
          }
          const outcome = await onReconnect({ connectionId: connection.connectionId, connectionName: connection.connectionName,
            label: connection.action.label }, () => {}, isCurrent).catch(() => {
            throw new Error(t("ui.sign_in_could_not_be_completed_check_the_connection_in_settings_library"))
          })
          if (!isCurrent() || outcome !== "connected") throw new Error(t("ui.the_connection_action_is_no_longer_current"))
          authenticatedDecisions.set(key, { request, onReconnect })
        }
        if (!isCurrent()) throw new Error(t("ui.the_connection_action_is_no_longer_current"))
        if (decision) questionAnswered = await respondChatConnectionDecision(key, decision, {
          outcome: "connected", continuation: "review_remaining_work", repeatCompletedWrites: false,
        }).catch(() => { throw new Error(t("ui.connected_but_the_original_question_could_not_be_answered")) })
      } else if (decision) {
        if (!isCurrent()) throw new Error(t("ui.the_connection_action_is_no_longer_current"))
        questionAnswered = await respondChatConnectionDecision(key, decision, {
          outcome: "skipped", continuation: "without_connection", alternativeAuthorization: false,
        }).catch(() => { throw new Error(t("ui.the_original_question_could_not_be_answered")) })
      }
      authenticatedDecisions.delete(key)
      return standardMcpToolResult({ content: [], structuredContent: {
        schemaVersion: "1", kind: "connection_action_intent", action: intent.action,
        connection: { ...parsed.data, action: parsed.data.action ? {
          type: parsed.data.action.type, label: parsed.data.action.label, surface: parsed.data.action.surface,
        } : null },
        outcome: intent.action === "authenticate" ? "connected" : "skipped", questionAnswered,
      } })
    } catch (error) {
      claimedDecisions.delete(key)
      throw error
    }
  }
  return { callTool, observeBinding }
}
