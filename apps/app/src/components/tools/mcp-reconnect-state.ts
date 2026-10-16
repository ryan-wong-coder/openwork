import { t } from "@/i18n";
import { create } from "zustand"

import type { ChatToolReconnectAction } from "./error-attribution"
import type { ChatConnectionDecisionBinding, ChatConnectionDecisionResponse } from "@/react-app/domains/session/surface/mcp-chat-reconnect"

export type ChatMcpReconnectPhase =
  | "ready"
  | "opening"
  | "authorization_opened"
  | "connected"
  | "failed"
  | "skipped"

export type ChatMcpReconnectRecord = {
  phase: ChatMcpReconnectPhase
  error: string | null
  authorizeUrl: string | null
  responseSubmitted?: boolean
}

type ChatMcpReconnectStore = {
  records: Record<string, ChatMcpReconnectRecord>
  setRecord: (key: string, record: ChatMcpReconnectRecord) => void
  reset: () => void
}

const READY_RECORD: ChatMcpReconnectRecord = { phase: "ready", error: null, authorizeUrl: null }

export function chatMcpReconnectKey(toolCallId: string, connectionId: string, scope = ""): string {
  return JSON.stringify([scope, toolCallId, connectionId])
}

export const useChatMcpReconnectStore = create<ChatMcpReconnectStore>((set) => ({
  records: {},
  setRecord: (key, record) => set((state) => ({
    records: { ...state.records, [key]: { ...state.records[key], ...record } },
  })),
  reset: () => set({ records: {} }),
}))

export function chatMcpReconnectRecord(key: string): ChatMcpReconnectRecord {
  return useChatMcpReconnectStore.getState().records[key] ?? READY_RECORD
}

export async function respondChatConnectionDecision(
  key: string,
  binding: ChatConnectionDecisionBinding,
  response: ChatConnectionDecisionResponse,
): Promise<boolean> {
  const request = binding.request
  if (key !== chatMcpReconnectKey(request.toolCallId, request.connectionId, request.owner)) return false
  const record = chatMcpReconnectRecord(key)
  if (record.responseSubmitted || !binding.isPending()) return false
  useChatMcpReconnectStore.getState().setRecord(key, { ...record, responseSubmitted: true })
  try {
    await binding.respond(response)
    return true
  } catch (error) {
    useChatMcpReconnectStore.getState().setRecord(key, { ...chatMcpReconnectRecord(key), responseSubmitted: false })
    throw error
  }
}

export type ChatMcpReconnectPresentation = {
  badgeLabel: string
  buttonLabel: string
  disabled: boolean
}

export function chatMcpReconnectPresentation(
  action: ChatToolReconnectAction,
  phase: ChatMcpReconnectPhase,
): ChatMcpReconnectPresentation {
  switch (phase) {
    case "opening":
      return { badgeLabel: t("ui.opening_sign_in"), buttonLabel: t("ui.opening"), disabled: true }
    case "authorization_opened":
      return { badgeLabel: t("ui.finish_sign_in_in_your_browser"), buttonLabel: t("ui.open_sign_in_again"), disabled: false }
    case "connected":
      return { badgeLabel: t("ui.named_connection_connected", { name: action.connectionName }), buttonLabel: t("connect.diagnostics_sync_status_connected"), disabled: true }
    case "skipped":
      return { badgeLabel: t("ui.named_connection_skipped", { name: action.connectionName }), buttonLabel: t("connect.diagnostics_probe_status_skipped"), disabled: true }
    case "failed":
      return { badgeLabel: t("ui.named_connection_sign_in_failed", { name: action.connectionName }), buttonLabel: t("ui.authenticate"), disabled: false }
    default:
      return { badgeLabel: t("ui.authenticate_connection_continue", { name: action.connectionName }), buttonLabel: t("ui.authenticate"), disabled: false }
  }
}
