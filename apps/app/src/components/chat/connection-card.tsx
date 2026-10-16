"use client"

import { t } from "@/i18n";

import { useState } from "react"
import type { DynamicToolUIPart } from "ai"
import { Braces, Check, Loader2, Lock } from "lucide-react"
import type { ConnectionActionPayload } from "@openwork/types/connection-action-app"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { connectionFromChatToolPart } from "@/components/tools/error-attribution"
import { useChatToolReconnect, type ChatToolReconnectCallbacks } from "@/components/tools/use-chat-tool-reconnect"
import type { ConnectorToolIdentity } from "@/react-app/domains/connections/connector-tool-identity"
import { useOptionalMessageList } from "./message-list-provider"

type ConnectionActionType = NonNullable<ConnectionActionPayload["action"]>["type"]

const actionOwners = () => ({
  member: t("extensions.share_you"),
  organization_admin: t("ui.your_organization_admin"),
  provider_admin: t("ui.the_provider_admin"),
  network_admin: t("ui.your_network_admin"),
  openwork: t("connect.diagnostics_owner_openwork_support"),
})

const blockedVerbs = (): Partial<Record<ConnectionActionType, string>> => ({
  update_credentials: t("ui.connection_update_credentials"),
  fix_network: t("ui.connection_restore_network"),
  fix_provider: t("ui.connection_restore_provider"),
})

function blockedTitle(connection: ConnectionActionPayload): string {
  const owner = connection.actor ? actionOwners()[connection.actor] : t("ui.the_connection_owner")
  const verb = (connection.action ? blockedVerbs()[connection.action.type] : undefined) ?? t("ui.connection_configure")
  return t("ui.blocked_connection_action", { owner, action: verb, name: connection.connectionName })
}

function ServiceMark({ name, iconUrl }: { name: string; iconUrl: string | null | undefined }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  const showImage = Boolean(iconUrl) && iconUrl !== failedIcon
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md", !showImage && "bg-muted text-xs font-medium text-foreground")}
    >
      {showImage && iconUrl ? <img src={iconUrl} alt="" className="size-4 object-contain" onError={() => setFailedIcon(iconUrl)} /> : name.charAt(0).toUpperCase()}
    </span>
  )
}

/**
 * Native presentation of one OpenWork connection report in the transcript.
 * One state-first line (P1/P2), flat (S1), 40px row (S2), at most two verb
 * labels (C1/T4); blocked states are neutral with a lock (C5); the raw failure
 * lives behind an icon-only disclosure (T2/P3).
 */
export function ConnectionCard({ part, callbacks, reconnectCallbacks, reconnectScope, connectorIdentities, allowDiscovery = false, subject }: {
  callbacks?: ChatToolReconnectCallbacks
  part: DynamicToolUIPart
  reconnectCallbacks?: ChatToolReconnectCallbacks
  reconnectScope?: string
  connectorIdentities?: ConnectorToolIdentity[]
  /** Read the connection from ordinary discovery too; only for a bound native question. */
  allowDiscovery?: boolean
  /** What the sign-in unlocks, such as an App's title: the card then asks to "Sign in to X to use it". */
  subject?: string
}) {
  const messageList = useOptionalMessageList()
  const found = connectionFromChatToolPart(part, { allowDiscovery })
  const connection = found?.connection ?? null
  const action = connection && connection.actor === "member" && (connection.action?.type === "connect" || connection.action?.type === "reconnect" || connection.action?.type === "update_credentials")
    ? found?.action ?? null
    : null
  const {
    reconnectState, reconnectError, reconnectBlocked, decisionAvailable,
    responseSubmitted, handleReconnect, handleSkip, handleContinue, handleDismiss,
  } = useChatToolReconnect(part, reconnectCallbacks ?? {
    ...callbacks,
    onReconnect: callbacks?.onReconnect ?? messageList?.onMcpReconnect,
    onReopenAuthorization: callbacks?.onReopenAuthorization ?? messageList?.onMcpReopenAuthorization,
  }, action, reconnectScope, connection?.connectionId)
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (!connection) return null

  const name = connection.connectionName
  const identity = (connectorIdentities ?? messageList?.connectorIdentities ?? []).find(entry => entry.connectionId === connection.connectionId)
  const iconUrl = identity?.iconUrl
  const readOnly = messageList?.readOnly ?? false
  const skipped = reconnectState === "skipped"
  // The tool result is a snapshot from when the step ran; the live org
  // connection list says whether this member is connected now, so a card
  // signed in earlier stays connected after leaving and reopening the session.
  const connected = connection.state === "connected" || reconnectState === "connected" || identity?.connectedForMe === true
  const settled = connected || skipped
  const opening = !settled && reconnectState === "opening"
  const waiting = !settled && reconnectState === "authorization_opened"
  const failed = !settled && reconnectState === "failed"
  const blocked = !settled && !action
  const verb = action?.label ?? t("composer.plus_connect")
  const again = connection.state === "reauth_required"
  const idleTitle = subject && action ? t(again ? "ui.sign_in_again_for_subject" : "ui.sign_in_for_subject", { name, subject })
    : decisionAvailable ? t("ui.connection_action_continue", { action: verb, name }) : `${verb} ${name}`
  const title = skipped ? t("ui.named_connection_skipped", { name })
    : connected ? action?.credentialKind === "personal_key" ? t("ui.named_key_saved", { name }) : t("ui.named_connection_connected", { name })
    : blocked ? blockedTitle(connection)
    : opening ? action?.credentialKind === "personal_key" ? t("ui.saving_named_key", { name }) : t("ui.signing_in_named", { name })
    : waiting ? t("ui.finish_named_signin", { name })
    : failed ? t("ui.named_connection_sign_in_failed", { name })
    : action?.credentialKind === "personal_key" ? t("ui.key_action_named", { action: verb, name })
    : idleTitle
  const signIn = subject && action?.credentialKind !== "personal_key"
  const primaryLabel = waiting ? t("ui.open_sign_in_again") : failed ? t("engine_migration.try_again") : decisionAvailable ? t("ui.authenticate")
    : signIn ? again ? t("ui.sign_in_again") : t("den.signin_button") : verb
  const actionable = !readOnly && (!settled || decisionAvailable)
  const showDetails = actionable && Boolean(reconnectError)

  return (
    <section data-testid="desktop-connection-card" aria-label={t("ui.named_connection", { name })} aria-live="polite" className="w-full max-w-full self-start text-sm text-foreground">
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-3 px-3 py-1">
        <ServiceMark name={name} iconUrl={iconUrl} />
        <p role={failed ? "alert" : "status"} className="flex min-w-0 flex-1 items-center gap-2 font-medium">
          {connected ? <Check aria-hidden="true" className="size-4 shrink-0 text-foreground" strokeWidth={1.5} /> : null}
          {blocked ? <Lock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} /> : null}
          <span className="min-w-0">{title}</span>
          {waiting ? <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" strokeWidth={1.5} /> : null}
        </p>
        {actionable ? (
          <div className="flex shrink-0 items-center gap-1">
            {showDetails ? (
              <Tooltip>
                <TooltipTrigger render={(
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    aria-label={t("ui.named_technical_details", { name })}
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen(open => !open)}
                  >
                    <Braces aria-hidden="true" className="size-4" strokeWidth={1.5} />
                  </Button>
                )} />
                <TooltipContent>{t("mcp.technical_details")}</TooltipContent>
              </Tooltip>
            ) : null}
            {settled ? (
              <Button size="sm" disabled={responseSubmitted} onClick={() => void handleContinue()}>{t("extensions.add_picker_continue")}</Button>
            ) : action ? (
              <>
                {decisionAvailable ? <Button variant="ghost" size="sm" disabled={responseSubmitted} onClick={() => void handleSkip()}>{t("ui.skip")}</Button> : null}
                <Button variant={waiting ? "ghost" : "default"} size="sm" disabled={reconnectBlocked || opening} onClick={() => void handleReconnect()}>
                  {opening ? <Loader2 data-icon="inline-start" aria-hidden="true" className="animate-spin" strokeWidth={1.5} /> : null}
                  {primaryLabel}
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" disabled={reconnectBlocked} onClick={() => decisionAvailable ? void handleSkip() : handleDismiss()}>{t("ui.dismiss")}</Button>
            )}
          </div>
        ) : null}
      </div>
      {showDetails ? (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleContent className="px-3 pb-2">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-xs text-muted-foreground">{reconnectError}</pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  )
}
