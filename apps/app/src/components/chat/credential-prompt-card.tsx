"use client"

import { t } from "@/i18n";

import { useId, useRef, useState, useSyncExternalStore } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { DynamicToolUIPart } from "ai"
import { Check, KeyRound, Loader2, Lock } from "lucide-react"
import type { CredentialPrompt } from "@openwork/types/den/credential-prompt"
import { DenApiError, createDenClient, readDenSettings } from "@/app/lib/den"
import { DEN_DASHBOARD_LINKS } from "@/app/lib/den-dashboard-links"
import { SecretField, type SecretFieldHandle } from "@/components/secret-field"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { gatewayCredentialBody, promptFields, promptFieldsProblem } from "./credential-prompt-fields"
import { Button, buttonVariants } from "@/components/ui/button"
import { DenReauthNotice } from "@/react-app/domains/cloud/den-reauth-notice"
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider"
import { useOptionalMessageList } from "./message-list-provider"
import { credentialPromptFromToolPart } from "./credential-prompt"

export const CREDENTIAL_SAVED_CONTINUE_PROMPT = "I've saved the key. Go ahead."

/** Keys saved in this window, so a remounting card stays saved before Den answers; never the value. */
const savedHere = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function markSaved(key: string) { savedHere.add(key); for (const listener of listeners) listener() }

type Phase = "entry" | "saving" | "reauth" | "denied" | "gone"

function targetKey(prompt: CredentialPrompt) {
  return JSON.stringify(prompt.target)
}

function denDashboardUrl(baseUrl: string, prompt: CredentialPrompt): string | null {
  try {
    const path = prompt.target.type === "mcp_connection_key" || prompt.target.type === "plugin_connection_key"
      ? `/dashboard/mcp-connections/${encodeURIComponent(prompt.target.connectionId)}`
      : DEN_DASHBOARD_LINKS.gatewayProviders
    const url = new URL(path, baseUrl)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    return null
  }
}

/** Plain, value-free direction for each failure; the key is never repeated back. */
function failureState(error: unknown, name: string): { phase: Phase; message: string | null } {
  if (error instanceof DenApiError) {
    if (error.status === 403 && error.code === "reauth") return { phase: "reauth", message: t("ui.confirm_it_s_you_then_enter_the_key_again") }
    if (error.status === 403) return { phase: "denied", message: null }
    if (error.status === 404) return { phase: "gone", message: null }
    if (error.code === "credential_rejected") return { phase: "entry", message: t("ui.key_rejected", { name }) }
    if (error.status === 400) return { phase: "entry", message: t("ui.enter_only_the_key_without_spaces_or_a_prefix") }
    if (error.status === 409) return { phase: "entry", message: t("ui.key_target_changed", { name }) }
    if (error.status === 502) return { phase: "entry", message: t("ui.key_check_unreachable", { name }) }
  }
  return { phase: "entry", message: t("ui.openwork_couldn_t_confirm_the_key_was_saved_try_again") }
}

/**
 * The private field an agent asks for, shown where the conversation is. The
 * key goes straight from this field to Den with the signed-in person's
 * session; the transcript, tool results and model only learn it was saved.
 */
export function CredentialPromptCard({ part, continueToolCallId = part.toolCallId }: {
  part: DynamicToolUIPart
  /** The transcript's own tool call; a Code Mode script's inner call is not a turn part. */
  continueToolCallId?: string
}) {
  const prompt = credentialPromptFromToolPart(part)
  const messageList = useOptionalMessageList()
  const auth = useDenAuth()
  const queryClient = useQueryClient()
  const fieldId = useId()
  // One handle per field; values are read once at save and never kept.
  const fields = useRef(new Map<string, SecretFieldHandle>())
  const identifiers = useRef(new Map<string, HTMLInputElement>())
  const filled = useRef(new Set<string>())
  const verifiedClient = useRef<ReturnType<typeof createDenClient> | null>(null)
  const [phase, setPhase] = useState<Phase>("entry")
  const [error, setError] = useState<string | null>(null)
  const [hasValue, setHasValue] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const settings = readDenSettings()
  const organizationId = settings.activeOrgId?.trim() ?? ""
  const token = settings.authToken?.trim() ?? ""
  const signedIn = auth.isSignedIn && Boolean(token && organizationId)
  const key = prompt ? targetKey(prompt) : ""
  const local = useSyncExternalStore(subscribe, () => savedHere.has(key), () => false)
  const enabled = useQuery({
    queryKey: ["den", "org-features", organizationId],
    queryFn: () => createDenClient({ baseUrl: settings.baseUrl, token }).getOrgFeatures(organizationId),
    enabled: signedIn,
    staleTime: 30_000,
    retry: false,
    select: (features: Record<string, boolean>) => features.secureSecretFields === true,
  })
  // Den's own answer, so a reopened conversation shows what is true now.
  const stored = useQuery({
    queryKey: ["den", "credential-prompt", organizationId, key],
    queryFn: async () => {
      if (!prompt) return false
      const client = createDenClient({ baseUrl: settings.baseUrl, token })
      if (prompt.target.type === "gateway_provider_key" || prompt.target.type === "gateway_provider_credential") {
        return client.gatewayCredentialSetReady(organizationId, prompt.target.inferenceProviderId, prompt.target.credentialSetId)
      }
      const connectionId = prompt.target.connectionId
      return (await client.listMcpConnections(organizationId, "usable")).some((connection) => connection.id === connectionId && connection.connected)
    },
    enabled: signedIn && Boolean(prompt),
    staleTime: 30_000,
    retry: false,
  })
  if (!prompt) return null

  const name = prompt.name
  const readOnly = messageList?.readOnly === true
  const saved = local || stored.data === true
  const dashboardUrl = denDashboardUrl(settings.baseUrl, prompt)
  // The field, and its show control, appear only once the rollout is confirmed on.
  const confirmed = enabled.data === true
  const blocked = !signedIn ? "signed_out" : readOnly ? "read_only" : enabled.data === false ? "off" : enabled.isError ? "unverified" : phase === "denied" ? "denied" : phase === "gone" ? "gone" : null
  const showField = confirmed && !blocked && phase !== "reauth" && (!saved || replacing)

  const specs = promptFields(prompt.target)
  const clearAll = () => {
    for (const handle of fields.current.values()) handle.clear()
    for (const input of identifiers.current.values()) input.value = ""
    filled.current.clear()
    setHasValue(false)
  }
  const save = async () => {
    if (phase === "saving") return
    const run = readDenSettings()
    let values: Record<string, string> = {}
    for (const spec of specs) {
      values[spec.id] = spec.kind === "identifier" ? identifiers.current.get(spec.id)?.value.trim() ?? "" : fields.current.get(spec.id)?.take() ?? ""
    }
    clearAll()
    for (const input of identifiers.current.values()) input.value = ""
    const problem = promptFieldsProblem(prompt.target, values)
    if (problem) {
      values = {}
      setError(problem)
      return
    }
    const value = values.apiKey ?? ""
    setPhase("saving")
    setError(null)
    try {
      const client = verifiedClient.current ?? createDenClient({ baseUrl: run.baseUrl, token: run.authToken?.trim() ?? "" })
      if (prompt.target.type === "gateway_provider_credential") {
        await client.saveGatewayProviderCredential(organizationId, prompt.target.inferenceProviderId, prompt.target.credentialSetId, gatewayCredentialBody(prompt.target, values))
      } else if (prompt.target.type === "mcp_connection_key") {
        await client.saveMcpConnectionSharedKey(organizationId, prompt.target.connectionId, value)
      } else if (prompt.target.type === "plugin_connection_key") {
        const { pluginId, configObjectId, serverName } = prompt.target
        await client.savePluginConnectionKey(organizationId, { pluginId, configObjectId, serverName, apiKey: value })
      } else {
        await client.saveGatewayProviderKey(organizationId, prompt.target.inferenceProviderId, prompt.target.credentialSetId, value)
      }
      values = {}
      const current = readDenSettings()
      if (current.authToken !== run.authToken || current.activeOrgId !== run.activeOrgId) throw new Error("account_changed")
      setReplacing(false)
      setPhase("entry")
      markSaved(key)
      void queryClient.invalidateQueries({ queryKey: ["den", "credential-prompt", organizationId, key] })
      // Picks the task up as if the person said so; the message carries no key.
      messageList?.continueAfterConnection?.(continueToolCallId, t("ui.i_ve_saved_the_key_go_ahead"))
    } catch (cause) {
      values = {}
      const next = failureState(cause, name)
      setPhase(next.phase)
      setError(next.message)
    }
  }

  const track = (id: string, has: boolean) => {
    if (has) filled.current.add(id)
    else filled.current.delete(id)
    setHasValue(filled.current.size > 0)
  }
  const plural = specs.length > 1 || prompt.target.type === "gateway_provider_credential"
  const settled = saved && !replacing
  const what = plural ? t("ui.credentials") : t("extensions.add_mcp_api_key_label")
  const title = settled ? t("ui.credentials_saved", { name, what })
    : blocked === "denied" ? t("ui.credentials_admin_required", { what, name })
    : blocked === "gone" ? t("ui.named_unavailable", { name })
    : blocked ? t("ui.credentials_for", { what, name })
    : replacing ? t("ui.credentials_replace", { what, name })
    : t("ui.credentials_add", { what, name })
  const blockedLine = blocked === "read_only" ? t("ui.this_conversation_is_read_only")
    : blocked === "signed_out" ? t("ui.sign_in_to_openwork_cloud_to_add_this_key_here")
    : blocked === "off" ? t("ui.adding_keys_in_chat_is_off_for_your_organization_use_openwork_cloud_instead")
    : blocked === "denied" ? t("ui.you_can_t_change_this_key_ask_an_organization_admin")
    : blocked === "gone" ? t("ui.ask_the_agent_to_set_it_up_again")
    : blocked === "unverified" ? t("ui.openwork_couldn_t_check_whether_keys_can_be_added_here_use_openwork_cloud_instead")
    : null
  // One state line: who uses the key and where it goes (P9).
  const consent = t("ui.credentials_consent", { name, destination: prompt.destination ? t("ui.credentials_destination", { destination: prompt.destination }) : "" })
  const Icon = settled ? Check : blocked ? Lock : KeyRound

  return (
    <section data-testid="credential-prompt-card" data-credential-prompt={prompt.target.type} aria-label={t("ui.named_api_key", { name })}
      className="w-full max-w-full self-start text-sm text-foreground">
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-3 px-3 py-1">
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" strokeWidth={1.5} />
        </span>
        <p role="status" className="min-w-0 flex-1 font-medium">{title}</p>
        {settled ? <span aria-label={t("ui.saved_key_hidden")} className="shrink-0 font-mono text-muted-foreground">••••••••</span> : null}
        {settled && !blocked ? <Button variant="ghost" size="sm" onClick={() => { setReplacing(true); setError(null) }}>{plural ? t("ui.replace") : t("ui.replace_key")}</Button> : null}
        {blocked && blocked !== "read_only" && blocked !== "gone" && dashboardUrl ? (
          <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={dashboardUrl} target="_blank" rel="noopener noreferrer">{t("ui.open_in_openwork_cloud")}</a>
        ) : null}
      </div>
      {blockedLine && !settled ? <p className="px-3 pb-2 text-muted-foreground">{blockedLine}</p> : null}
      {phase === "reauth" && !blocked ? (
        <div className="flex flex-col gap-2 px-3 pb-2">
          <p className="text-muted-foreground">{error}</p>
          <DenReauthNotice
            onVerified={async (client, commit) => {
              verifiedClient.current = client
              commit()
              setPhase("entry")
              setError(null)
            }}
            onCancel={() => { setPhase("entry"); setError(null) }}
          />
        </div>
      ) : null}
      {showField ? (
        <form className="flex flex-col gap-2 px-3 pb-2" autoComplete="off" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <p className="text-muted-foreground">{consent}</p>
          {specs.length > 1 || specs[0]?.kind !== "secret" ? (
            <div className="flex flex-col gap-3">
              {specs.map((spec, index) => spec.kind === "identifier" ? (
                <Field key={spec.id}>
                  <FieldLabel htmlFor={`${fieldId}-${spec.id}`}>{spec.label}</FieldLabel>
                  <Input id={`${fieldId}-${spec.id}`} autoComplete="off" spellCheck={false} disabled={phase === "saving"} autoFocus={index === 0}
                    ref={(input) => { if (input) identifiers.current.set(spec.id, input); else identifiers.current.delete(spec.id) }}
                    onChange={(event) => track(spec.id, event.currentTarget.value.length > 0)} />
                </Field>
              ) : (
                <SecretField key={spec.id} id={`${fieldId}-${spec.id}`} label={spec.label} revealable={confirmed} multiline={spec.kind === "json"}
                  disabled={phase === "saving"} onSubmit={() => void save()}
                  handleRef={(handle) => { if (handle) fields.current.set(spec.id, handle); else fields.current.delete(spec.id) }}
                  onValueChange={(has) => track(spec.id, has)} />
              ))}
              {error ? <p role="alert" className="text-destructive">{error}</p> : null}
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            {specs.length === 1 && specs[0]?.kind === "secret" ? (
              <div className="min-w-0 flex-1">
                <SecretField id={fieldId} label={t("extensions.add_mcp_api_key_label")} labelHidden revealable={confirmed} error={error} disabled={phase === "saving"}
                  handleRef={(handle) => { if (handle) fields.current.set("apiKey", handle); else fields.current.delete("apiKey") }}
                  onSubmit={() => void save()} onValueChange={(has) => track("apiKey", has)} />
              </div>
            ) : <div className="flex-1" />}
            <Button type="submit" size="sm" disabled={phase === "saving" || !hasValue}>
              {phase === "saving" ? <Loader2 data-icon="inline-start" aria-hidden="true" className="animate-spin" strokeWidth={1.5} /> : null}
              {phase === "saving" ? (plural ? t("settings.environment.saving") : t("ui.checking_key")) : plural ? t("ui.save_credentials") : t("ui.save_key")}
            </Button>
            {replacing ? <Button type="button" variant="ghost" size="sm" disabled={phase === "saving"}
              onClick={() => { clearAll(); setReplacing(false); setError(null) }}>{t("common.cancel")}</Button> : null}
          </div>
        </form>
      ) : null}
    </section>
  )
}
