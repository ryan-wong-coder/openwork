/** @jsxImportSource react */
import { formatTime, slotLabel, slotScheduleOptions, timeZoneLabel } from "./calendar-locale"
import { t } from "@/i18n";
import { useMemo, useRef, useState } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { useNavigate } from "react-router"
import {
  automationNameFrom,
  DEFAULT_SLOT_REPEAT,
  type CalendarSlot,
  type SlotRepeat,
} from "@openwork/calendar"
import { AUTOMATION_CLOUD_DEFAULT_MODEL, type AutomationDetail, type AutomationModel } from "@openwork/types/automations"
import { cloudDefaultModelOption } from "@openwork/types/automation-models"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { isDesktopRuntime } from "@/app/lib/runtime-env"
import { automationCreationPlacement } from "@/react-app/domains/automations/automation-availability"
import {
  automationCanUseChoices,
  automationCanUseNote,
  automationPlacementOf,
  initialCanUse,
  type AutomationCanUse,
} from "@/react-app/domains/automations/automation-editor"
import { AutomationModelButton } from "@/react-app/domains/automations/automation-model-button"
import { CalendarModelSummary } from "./calendar-model-summary"
import { automationPickerOptions, type AutomationProviderCatalog } from "@/react-app/domains/automations/automation-model-options"
import type { useAutomationEditorSetup } from "@/react-app/domains/automations/use-automation-editor-setup"
import { describeAutomationError, useAutomationActions, type AutomationsDenContext } from "@/react-app/domains/automations/use-automations"
import { ModelPickerModal } from "@/react-app/domains/session/modals/model-picker-modal"

/**
 * "New automation" from an empty slot or the toolbar (Paper: "4c · Calendar — add an automation from an empty
 * slot"). The person says what to do, how it repeats from the slot, what it can use (which decides where it
 * runs, as in the Automations editor) and the model. "More options" opens the full editor with everything filled in.
 */

/** Short names for the editor's "What it can use" choices, to fit the card. */
const CAN_USE_SHORT: Record<AutomationCanUse, string> = {
  computer: "ui_extra.this_computer",
  "cloud-computer": "ui_extra.cloud_computer",
  accounts: "ui_extra.accounts_only",
}

export type CreateAnchor = { slot: CalendarSlot; x: number; y: number }

export function CreateAutomationCard(props: {
  organizationDefaultName?: string | null
  anchor: CreateAnchor
  context: AutomationsDenContext
  setup: ReturnType<typeof useAutomationEditorSetup>
  providerCatalog?: AutomationProviderCatalog
  workspaceId: string | null
  onOpenProviderSettings?: () => void
  onClose: () => void
  onCreated: (detail: AutomationDetail) => void
}) {
  const navigate = useNavigate()
  const [instructions, setInstructions] = useState("")
  const [repeat, setRepeat] = useState<SlotRepeat>(DEFAULT_SLOT_REPEAT)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState("")
  const { busyAction, setBusyAction, refresh } = useAutomationActions(props.context)
  const field = useRef<HTMLTextAreaElement | null>(null)

  const choices = automationCanUseChoices(props.setup.placementChoices, props.setup.cloudOptions)
  const [chosenCanUse, setChosenCanUse] = useState<AutomationCanUse | null>(null)
  const canUse = chosenCanUse && choices.includes(chosenCanUse) ? chosenCanUse : initialCanUse(automationCreationPlacement(), undefined, choices)
  const placement = automationPlacementOf(canUse)
  const usesCloudDefault = canUse === "accounts"
  const modelOptions = props.setup.modelsFor(placement)
  const [pickedModel, setPickedModel] = useState<AutomationModel | null>(null)
  // Keep the picked model while this place offers it; otherwise the place's first model, as the editor does.
  const model: AutomationModel | null = usesCloudDefault
    ? { ...AUTOMATION_CLOUD_DEFAULT_MODEL, variant: null }
    : pickedModel && modelOptions.some((option) => option.providerId === pickedModel.providerId && option.modelId === pickedModel.modelId)
      ? pickedModel
      : modelOptions[0] ? { providerId: modelOptions[0].providerId, modelId: modelOptions[0].modelId, variant: null } : null
  const pickerOptions = useMemo(
    () => model ? automationPickerOptions({ options: modelOptions, catalog: props.providerCatalog ?? {}, selected: model }) : [],
    [model, modelOptions, props.providerCatalog],
  )

  const options = slotScheduleOptions(props.anchor.slot)
  const chosen = options.find((option) => option.id === repeat) ?? options[0]
  const busy = busyAction === "create"

  // Keep the slot placement while letting the installed positioner shift the actual card on resize.
  // The positioner keeps the card touching its anchor, so a slot point left outside a rotated or resized window is pulled back inside the same 12px inset.
  const positionAnchor = useMemo(() => ({
    getBoundingClientRect: () => new DOMRect(
      Math.max(12, Math.min(props.anchor.x, window.innerWidth - 12)),
      Math.max(12, Math.min(props.anchor.y, window.innerHeight - 12)),
      0,
      0,
    ),
  }), [props.anchor.x, props.anchor.y])
  const ready = instructions.trim().length > 0 && Boolean(model) && !busy

  const submit = async () => {
    const { client, organizationId } = props.context
    if (!ready || !chosen || !model || !client || !organizationId) return
    setBusyAction("create")
    setError(null)
    try {
      const name = automationNameFrom(instructions)
      const detail = placement === "cloud"
        ? await client.createCloudAutomation(organizationId, { name, schedule: chosen.schedule, action: { kind: "agent", instructions: instructions.trim(), model } })
        : await client.createAutomation(organizationId, {
            name, instructions: instructions.trim(), schedule: chosen.schedule, model,
            // Pinned to the workspace it was created from, as the Automations editor does.
            ...(isDesktopRuntime() && props.workspaceId ? { workspaceId: props.workspaceId } : {}),
          })
      await refresh()
      props.onCreated(detail)
    } catch (caught) {
      setError(describeAutomationError(caught))
    } finally {
      setBusyAction(null)
    }
  }

  const moreOptions = () => {
    const params = new URLSearchParams({ create: "1", name: automationNameFrom(instructions), instructions: instructions.trim() })
    if (chosen) params.set("schedule", JSON.stringify(chosen.schedule))
    navigate(`/automations?${params.toString()}`)
  }

  return (
    <PopoverPrimitive.Root open modal onOpenChange={(open) => { if (!open) props.onClose() }}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Backdrop className="fixed inset-0 z-40" />
        {/* The shared PopoverContent does not expose a virtual slot anchor; compose its installed primitive. */}
        <PopoverPrimitive.Positioner anchor={positionAnchor} positionMethod="fixed" side="bottom" align="start" collisionPadding={12} collisionAvoidance={{ side: "shift", align: "shift" }} className="z-50">
          <PopoverPrimitive.Popup initialFocus={field} data-calendar-create className="flex max-h-[min(calc(100dvh-24px),var(--available-height,calc(100dvh-24px)))] w-[min(24rem,calc(100vw-24px))] flex-col rounded-xl bg-popover text-popover-foreground shadow-[var(--dls-card-shadow)] ring-1 ring-border outline-hidden">
            <form className="flex min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <div className="shrink-0 px-4 pb-3 pt-4">
                <p className="text-xs text-muted-foreground">{slotLabel(props.anchor.slot)}</p>
                <PopoverPrimitive.Title render={<h2 />} className="text-[15px] font-semibold tracking-[-0.2px]">{t("interface.new_automation_db87a63d")}</PopoverPrimitive.Title>
              </div>
              <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-4 pb-1" data-calendar-form-body>
                <label className="flex flex-col gap-1.5 text-xs font-medium">{t("extensions.add_skill_what_label")} <Textarea
                    ref={field}
                    value={instructions}
                    rows={3}
                    maxLength={100_000}
                    placeholder={t("interface.pull_this_week_s_press_kit_comments_from_notion_and_draft_a_reply_list")}
                    className="min-h-18 resize-none text-sm font-normal"
                    onChange={(event) => setInstructions(event.currentTarget.value)}
                    onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() } }}
                  />
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">{t("interface.repeats")}</span>
                  <ToggleGroup
                    aria-label={t("interface.repeats")}
                    variant="outline"
                    spacing={1}
                    size="sm"
                    className="w-full"
                    value={[repeat]}
                    onValueChange={(values) => {
                      const next = options.find((option) => option.id === values[0])
                      if (next) setRepeat(next.id)
                    }}
                  >
                    {options.map((option) => (
                      <ToggleGroupItem key={option.id} value={option.id} className="flex-1 basis-0 whitespace-nowrap px-1 text-xs data-[pressed]:bg-primary data-[pressed]:text-primary-foreground">{option.label}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <p className="text-xs text-muted-foreground">{t("interface.at")} {formatTime(props.anchor.slot.at, props.anchor.slot.timeZone)} {timeZoneLabel(props.anchor.slot.timeZone, props.anchor.slot.at)}.</p>
                </div>
                {choices.length > 1 ? (
                  <div className="flex flex-col gap-1.5" data-calendar-create-runs-on={placement}>
                    <span className="text-xs font-medium">{t("interface.what_it_can_use")}</span>
                    <ToggleGroup
                      aria-label={t("interface.what_it_can_use")}
                      variant="outline"
                      spacing={1}
                      size="sm"
                      className="w-full"
                      value={[canUse]}
                      onValueChange={(values) => {
                        const next = choices.find((choice) => choice === values[0])
                        if (next) setChosenCanUse(next)
                      }}
                    >
                      {choices.map((choice) => (
                        <ToggleGroupItem key={choice} value={choice} className="flex-1 basis-0 whitespace-nowrap px-1 text-xs data-[pressed]:bg-primary data-[pressed]:text-primary-foreground">{t(CAN_USE_SHORT[choice])}</ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <p className="text-xs text-muted-foreground">{automationCanUseNote(canUse)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{automationCanUseNote(canUse)}</p>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">{t("settings.model_title")}</span>
                  {usesCloudDefault && model ? (
                    <div className="flex h-8 items-center rounded-md border border-border px-2 text-sm"><CalendarModelSummary model={model} options={[cloudDefaultModelOption]} organizationDefaultName={props.organizationDefaultName} /></div>
                  ) : model ? (
                    <AutomationModelButton model={model} options={modelOptions} size="sm" onClick={() => setPickerOpen(true)} />
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("interface.add_a_model_in_settings_ai_before_creating_an_automation")}</p>
                  )}
                </div>
                {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 p-4" data-calendar-form-actions>
                <Button type="button" variant="link" size="xs" className="mr-auto px-0 max-sm:w-full max-sm:justify-start" onClick={moreOptions}>{t("share_skill_destination.more_options")}</Button>
                <PopoverPrimitive.Close render={<Button variant="outline" size="sm" />}>{t("settings.environment.cancel")}</PopoverPrimitive.Close>
                <Button type="submit" size="sm" disabled={!ready}>{busy ? t("interface.creating") : t("interface.create_automation_77947194")}</Button>
              </div>
            </form>
            {model && !usesCloudDefault ? (
              <ModelPickerModal
                open={pickerOpen}
                options={pickerOptions}
                query={modelQuery}
                setQuery={setModelQuery}
                subtitle={placement === "cloud" ? t("ui_extra.cloud_model_scope") : t("ui_extra.desktop_model_scope")}
                target="default"
                current={{ providerID: model.providerId, modelID: model.modelId }}
                onSelect={(next) => {
                  setPickedModel({ providerId: next.providerID, modelId: next.modelID, variant: null })
                  setPickerOpen(false)
                }}
                onBehaviorChange={(next, variant) => setPickedModel({ providerId: next.providerID, modelId: next.modelID, variant })}
                onOpenSettings={() => { setPickerOpen(false); props.onOpenProviderSettings?.() }}
                onOpenProviderSettings={props.onOpenProviderSettings}
                onClose={() => setPickerOpen(false)}
              />
            ) : null}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
