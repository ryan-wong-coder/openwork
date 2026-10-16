"use client"

import { t } from "@/i18n";

import { useState } from "react"
import { AlertTriangle, CalendarClock, Check } from "lucide-react"
import type { DynamicToolUIPart } from "ai"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { useQuery } from "@tanstack/react-query"

import { automationProposalSchema, type AutomationProposal } from "@openwork/types/automations"

import { createDenClient, readDenSettings } from "@/app/lib/den"
import { Button } from "@/components/ui/button"
import { Tool } from "@/components/ui/tool"
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider"
import { automationCreationPlacement, useAutomationDeploymentEnabled } from "@/react-app/domains/automations/automation-availability"
import { isLocalGatewayClient } from "@/app/lib/client-profile"
import { formatAutomationSchedule } from "@/react-app/domains/automations/automation-format"
import {
  automationModelOptions,
  automationProviderCatalog,
  describeAutomationModel,
  resolveProposalModel,
} from "@/react-app/domains/automations/automation-model-options"
import { automationsRoute } from "@/react-app/shell/workspace-routes"
import { useWorkspaceMaybe } from "@/react-app/shell/workspace-provider"
import { useDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider"
import { getConnectedProviderItems, useProviderListQuery } from "@/react-app/infra/provider-list-query"

function parseOutputValue(output: unknown): unknown {
  if (typeof output !== "string") return output
  try {
    return JSON.parse(output)
  } catch {
    return null
  }
}

/**
 * Reads an `automation.propose` affordance result out of an openwork_execute
 * tool part. Returns null for every other affordance so the generic capability
 * line keeps rendering them.
 */
export function parseAutomationProposal(output: unknown): AutomationProposal | null {
  const envelope = parseOutputValue(output)
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) return null
  const record = envelope as Record<string, unknown>
  if (record.ok !== true || record.id !== "automation.propose") return null
  const result = record.result
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null
  const parsed = automationProposalSchema.safeParse((result as Record<string, unknown>).proposal)
  return parsed.success ? parsed.data : null
}

export function isAutomationProposalToolPart(part: DynamicToolUIPart): boolean {
  return part.toolName === "openwork_execute"
    && part.state === "output-available"
    && parseAutomationProposal(part.output) !== null
}

export function OpenWorkAutomationProposalTool({ part }: { part: DynamicToolUIPart }) {
  const navigate = useNavigate()
  const denAuth = useDenAuth()
  const automationsEnabled = useAutomationDeploymentEnabled()
  const placement = automationCreationPlacement()
  const workspaceContext = useWorkspaceMaybe()
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const proposal = part.state === "output-available" ? parseAutomationProposal(part.output) : null
  const settings = readDenSettings()
  const token = settings.authToken?.trim() ?? ""
  const organizationId = settings.activeOrgId?.trim() ?? ""
  const signedIn = denAuth.isSignedIn && Boolean(token) && Boolean(organizationId)
  const providersQuery = useQuery({
    queryKey: ["den", "automations", organizationId, "models"],
    queryFn: () => createDenClient({ baseUrl: settings.baseUrl, token }).listOrgLlmProviders(organizationId),
    enabled: automationsEnabled && signedIn && !created,
  })
  const runtimeProviders = useProviderListQuery({
    client: workspaceContext?.client ?? null,
    baseUrl: workspaceContext?.opencodeBaseUrl,
    directory: workspaceContext?.selectedWorkspaceRoot,
    enabled: automationsEnabled && signedIn && !created && placement === "desktop",
  })
  const zenModelRestricted = useDesktopRestriction("allowZenModel")
  const providers = providersQuery.data ?? []
  const availability = {
    includeFreeStarter: placement === "desktop" && !zenModelRestricted,
    catalog: placement === "desktop" && runtimeProviders.data !== undefined
      ? automationProviderCatalog(getConnectedProviderItems(runtimeProviders.data))
      : undefined,
  }
  const modelLookupFailed = providersQuery.isError || (placement === "desktop" && runtimeProviders.isError)
  const modelLookupPending = providersQuery.data === undefined
    || (placement === "desktop" && runtimeProviders.data === undefined)
  const resolved = modelLookupFailed || modelLookupPending || !proposal
    ? null
    : resolveProposalModel(proposal.model, providers, availability)
  const modelLabel = resolved
    ? describeAutomationModel(resolved.model, automationModelOptions(providers, availability))
    : null

  if (!proposal) {
    return <Tool toolPart={part} title={t("ui.proposed_an_automation")} />
  }

  if (isLocalGatewayClient()) {
    return <Tool toolPart={part} title="当前本地客户端不支持自动化调度" />
  }

  // Pin the workspace of the pane this card renders in — renderer-owned state.
  // The proposal's own workspaceId is agent-supplied and deliberately ignored:
  // a manipulated agent must not be able to retarget the Automation.
  const pinnedWorkspaceId = workspaceContext?.workspaceId?.trim() || null

  const blocker = !automationsEnabled
    ? t("ui.automations_are_disabled_for_this_deployment")
    : !signedIn
      ? t("ui.sign_in_to_openwork_cloud_to_create_this_automation")
      : modelLookupFailed
        ? t("ui.model_availability_could_not_be_checked_try_again_before_creating_this_automation")
        : null

  const create = async () => {
    if (!automationsEnabled || blocker || !resolved || resolved.resolution === "unavailable") return
    setBusy(true)
    try {
      const client = createDenClient({ baseUrl: settings.baseUrl, token })
      const model = resolved.model
      const detail = placement === "cloud"
        ? await client.createCloudAutomation(organizationId, {
            name: proposal.name,
            schedule: proposal.schedule,
            action: { kind: "agent", instructions: proposal.instructions, model },
          })
        : await client.createAutomation(organizationId, {
            name: proposal.name,
            instructions: proposal.instructions,
            schedule: proposal.schedule,
            model,
            // Pin the proposal's originating workspace, falling back to the pane
            // this card renders in, so the Automation keeps running there instead
            // of following whichever workspace is active at run time.
            ...(pinnedWorkspaceId ? { workspaceId: pinnedWorkspaceId } : {}),
          })
      setCreated(detail.automation.id)
      toast.success(t("ui.automation_created_and_active"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ui.could_not_create_the_automation"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="not-prose w-full max-w-2xl overflow-hidden rounded-2xl border border-dls-border bg-dls-surface/95 shadow-sm"
      data-openwork-automation-proposal
      data-automation-created={created ?? undefined}
      data-automation-model-resolution={resolved?.resolution}
    >
      <div className="flex items-start gap-3 border-b border-dls-border px-4 py-3">
        <div className={created
          ? "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-green-6/35 bg-green-3/30 text-green-11"
          : "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-dls-border bg-dls-hover text-dls-secondary"
        }>
          {created ? <Check className="size-4" /> : <CalendarClock className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-dls-primary">
            {created ? t("ui.automation_created_and_active") : t("ui.suggested_automation")}
          </h3>
          <p className="mt-0.5 text-xs text-dls-secondary">
            {created
              ? placement === "cloud"
                ? t("ui.it_runs_on_the_schedule_below_in_openwork_cloud")
                : t("ui.it_runs_on_the_schedule_below_while_this_desktop_is_connected")
              : t("ui.nothing_was_created_yet_review_it_then_create_it_if_it_looks_right")}
          </p>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div>
          <p className="truncate text-sm font-medium text-dls-primary" title={proposal.name}>{proposal.name}</p>
          <p className="text-xs text-dls-secondary">{formatAutomationSchedule(proposal.schedule)}</p>
          {modelLabel ? <p className="text-xs text-dls-secondary">{t("ui.runs_with")} {modelLabel}</p> : null}
          {pinnedWorkspaceId && placement === "desktop" ? <p className="text-xs text-dls-secondary" data-automation-pinned-workspace={pinnedWorkspaceId}>{t("ui.runs_in_this_workspace")}</p> : null}
        </div>
        <p className="whitespace-pre-wrap text-sm text-dls-secondary">{proposal.instructions}</p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-dls-border px-4 py-3">
        <p className="min-w-0 flex-1 text-xs text-dls-secondary">
          {blocker ?? (placement === "cloud" ? t("ui.automations_run_headlessly_in_openwork_cloud") : t("ui.automations_run_on_this_desktop_while_it_is_connected"))}
        </p>
        {created ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            data-open-automation={created}
            onClick={() => navigate(automationsRoute())}
          >
            {t("ui.open_automation")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={busy || blocker !== null || !resolved || resolved.resolution === "unavailable"}
            data-create-automation
            onClick={() => void create()}
          >
            {busy ? t("ui.creating_8c4f12") : t("ui.create_automation")}
          </Button>
        )}
      </div>

      {blocker && !created ? (
        <div className="flex items-center gap-2 border-t border-dls-border px-4 py-2 text-xs text-amber-11">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{blocker}</span>
        </div>
      ) : null}
      {resolved?.resolution === "unavailable" && !created ? (
        <div className="flex items-center gap-2 border-t border-dls-border px-4 py-2 text-xs text-amber-11">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {t("ui.the_proposed_model_isn_t_available_for_automations_choose_a_supported_model_in_a_new_propo")}
          </span>
        </div>
      ) : null}
    </div>
  )
}
