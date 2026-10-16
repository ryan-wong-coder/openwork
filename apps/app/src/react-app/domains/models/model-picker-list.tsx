import { currentLocale, t } from "@/i18n";
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Building, Check, Cloud, Laptop, Lock } from "lucide-react";
import type { ModelOption, ModelRef } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionContextMenu } from "@/components/ui/action-context-menu";
import { OpenWorkMark, ProviderIcon } from "@/react-app/design-system/provider-icon";
import { AutoPickerRecovery, useObservedAutoAccessSnapshot } from "@/react-app/domains/cloud/auto-access-ui";
import { autoNotOffered, autoPickerCopy, autoQuietlyUnavailable, freeAutoSwitchedOff, type AutoPickerState } from "@/app/lib/inference-access";
import type { MenuAction } from "@/components/ui/action-menu-model";
import { Command, CommandCollection, CommandGroup, CommandGroupLabel, CommandHeader, CommandInput, CommandItem, CommandList, CommandPanel } from "@/components/ui/command";
import { immutableModelPin, isAutoModel, isPinModelShortcut, markExplicitModelChoice, modelGroups, modelSource, modelSubtitle, modelTitle, orderedModelPins, retainedModelCopy, withAutoDefaultPin, MODEL_SOURCE_LABELS, type ModelGroup, type ModelPickerCatalogState, type RetainedModelSelection } from "./model-catalog";
import { modelRefKey, useModelCollectionsStore } from "@/react-app/domains/session/models/model-collections-store";
import { PickerNotice } from "./picker-notice";
import { useModelShortcutsStore } from "@/react-app/domains/shortcuts/model-shortcuts-store";
import { formatChord, resolveShortcutOs } from "@/react-app/domains/shortcuts/shortcut-keys";

export function ModelSourceIcon({ model }: { model: ModelRef & { source?: ModelOption["source"] } }) {
  const source = modelSource(model);
  const Icon = source === "gateway" ? Cloud : source === "organization" ? Building : Laptop;
  return <Icon role="img" aria-label={MODEL_SOURCE_LABELS[source]} className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />;
}

function ProviderMark({ model, description, retained = false }: { model: ModelRef; description?: string; retained?: boolean }) {
  return <div data-slot="model-provider-mark" className="flex size-4 shrink-0 items-center justify-center">
    {isAutoModel(model) ? <OpenWorkMark className="size-4 text-dls-accent dark:text-foreground" /> : <ProviderIcon providerId={retained ? undefined : model.providerID} providerName={description} size={16} />}
  </div>;
}

function ModelLoadingRows({ rows = 3, label = t("ui.loading_models"), still = false }: { rows?: number; label?: string; still?: boolean }) {
  // `still`: the rest of the list did not load; placeholders hold its place without suggesting it is loading.
  return <div role="status" aria-label={label} data-testid={still ? "model-catalog-unloaded" : "model-catalog-loading"} className={still ? "px-2 pb-2 [&_[data-slot=skeleton]]:animate-none [&_[data-slot=skeleton]]:bg-gray-4" : "px-2 pb-2"}>
    {Array.from({ length: rows }, (_, index) => index).map((index) => <div key={index} className="flex h-11 items-center gap-2 px-2"><Skeleton className="size-4 rounded" /><div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-2.5 w-36 rounded" /><Skeleton className="h-2.5 w-18 rounded" /></div><span className="size-4" /></div>)}
  </div>;
}

export type ModelPickerListProps = {
  options: readonly ModelOption[];
  current: ModelRef;
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (option: ModelOption) => void;
  focusAlternative?: boolean;
  footer?: ReactNode;
  searchInputRef?: Ref<HTMLInputElement>;
  autoFocusSearch?: boolean;
  catalogState?: ModelPickerCatalogState;
  retainedSelection?: RetainedModelSelection;
  onConnectProvider?: () => void;
  onOpenProviderSettings?: () => void;
  onSetWorkspaceDefault?: (model: ModelRef, variant?: string | null) => void | boolean | Promise<void | boolean>;
  /** Effort currently applied to `current`; kept when that model becomes the workspace default. */
  currentBehaviorValue?: string | null;
  openWorkModelsSyncing?: boolean;
  onReloadWorkspace?: () => void | Promise<unknown>;
  onRetryAuto?: () => void | Promise<unknown>;
};

type AutoRowState = { model: ModelRef; state: AutoPickerState; code?: string | null; resetsAt?: string | null };
export function ModelPickerList(props: ModelPickerListProps) {
  return isAutoModel(props.current) || props.options.some(isAutoModel) || props.openWorkModelsSyncing
    ? <AutoStatusModelPickerList {...props} /> : <ModelPickerRows {...props} />;
}

function AutoStatusModelPickerList(props: ModelPickerListProps) {
  const snapshot = useObservedAutoAccessSnapshot();
  const status = snapshot?.data;
  const availableAuto = props.options.find(isAutoModel);
  const auto = isAutoModel(props.current) ? props.current : availableAuto;
  const matches = auto && status && modelRefKey(auto) === modelRefKey(status);
  const state: AutoPickerState = props.openWorkModelsSyncing ? "sync" : snapshot?.status === "error" ? "unavailable" : matches ? (autoQuietlyUnavailable(status) ? "ready" : autoNotOffered(status) ? "not_offered" : status.state) : "ready";
  const switchedOff = freeAutoSwitchedOff(status);
  const blockedByPolicy = props.retainedSelection !== undefined && props.retainedSelection.reason !== "unavailable" && isAutoModel(props.current);
  return <ModelPickerRows {...props} retainedSelection={switchedOff && isAutoModel(props.current) ? undefined : props.retainedSelection} options={withAutoDefaultPin(switchedOff ? props.options.filter((option) => !isAutoModel(option)) : props.options, status)} openWorkModelsSyncing={!switchedOff && !blockedByPolicy && props.openWorkModelsSyncing} autoRow={!switchedOff && !blockedByPolicy && auto ? { model: auto, state, code: status?.code, resetsAt: status?.allowance?.resetsAt } : undefined} />;
}

/** Context-menu rows show the chord that triggers the same command (DESIGN S6). */
function menuChord(label: string, chord: string) {
  return <><span className="min-w-0 flex-1">{label}</span><kbd className="ml-4 font-sans text-xs text-muted-foreground">{chord}</kbd></>;
}

function ModelPickerRows({ options, current, query, onQueryChange, onSelect, focusAlternative = false, footer, searchInputRef, autoFocusSearch = true,
  catalogState, retainedSelection, onConnectProvider, onOpenProviderSettings, onSetWorkspaceDefault, currentBehaviorValue, openWorkModelsSyncing, onReloadWorkspace, onRetryAuto, autoRow,
}: ModelPickerListProps & { autoRow?: AutoRowState }) {
  const favorites = useModelCollectionsStore((state) => state.favorites);
  const recent = useModelCollectionsStore((state) => state.recent);
  // A model bound to a saved shortcut in Settings shows its key on the row.
  const modelShortcuts = useModelShortcutsStore((state) => state.shortcuts);
  const shortcutLabels = useMemo(() => {
    const os = resolveShortcutOs(undefined, typeof navigator === "undefined" ? "" : navigator.platform);
    return new Map(modelShortcuts.map((shortcut) => [modelRefKey({ providerID: shortcut.action.providerID, modelID: shortcut.action.modelID }), formatChord(shortcut.keys, os)]));
  }, [modelShortcuts]);
  const groups = modelGroups(options, favorites, recent, query);
  const pins = orderedModelPins(options, favorites);
  const pinned = new Set(pins.map(modelRefKey));
  const root = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<ModelOption | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const blockedAuto = (option: ModelRef) => autoRow?.state !== undefined && autoRow.state !== "ready" && modelRefKey(option) === modelRefKey(autoRow.model);
  const canSelect = (option: ModelOption) => !option.disabled && !blockedAuto(option) && options.some((item) => modelRefKey(item) === modelRefKey(option) && !item.disabled);
  const select = (option: ModelOption) => { if (canSelect(option)) onSelect(option); };
  const alternative = pins.find((option) => !isAutoModel(option) && modelRefKey(option) !== modelRefKey(current))
    ?? options.find((option) => !option.disabled && !isAutoModel(option) && modelRefKey(option) !== modelRefKey(current));
  const alternativeKey = alternative ? modelRefKey(alternative) : undefined;
  useEffect(() => {
    if (!focusAlternative) return;
    const frame = requestAnimationFrame(() => {
      const row = [...(root.current?.querySelectorAll<HTMLElement>("[data-model-key]") ?? [])].find((item) => item.dataset.modelKey === alternativeKey);
      const target = row ?? root.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]');
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAlternative, alternativeKey]);
  const clearSearch = () => {
    onQueryChange("");
    root.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')?.focus({ preventScroll: true });
  };
  const retry = async () => {
    if (!catalogState?.onRetry || retryBusy) return;
    setRetryBusy(true); setRetryFailed(false);
    try { await catalogState.onRetry(); } catch { setRetryFailed(true); } finally { setRetryBusy(false); }
  };
  const toggle = (option: ModelOption) => {
    if (!immutableModelPin(option) && canSelect(option)) useModelCollectionsStore.getState().toggleFavorite(option);
  };
  const hasOptions = options.some((option) => !option.disabled);
  const loading = catalogState?.state === "loading";
  const failed = catalogState?.state === "error" || retryFailed;
  const empty = !loading && !hasOptions && !query.trim() && !failed;
  const retained = retainedSelection && modelRefKey(retainedSelection.model) === modelRefKey(current)
    && !options.some((option) => modelRefKey(option) === modelRefKey(current) && !option.disabled) ? retainedSelection : undefined;
  const retainedCopy = retained ? retainedModelCopy(retained.reason) : null;
  const retainedName = retained ? (isAutoModel(retained.model) ? t("ui.auto") : retained.title ? modelTitle({ ...retained.model, title: retained.title, description: retained.description }) : t("ui.saved_model")) : "";
  const retainedVisible = retained && (!query.trim() || `${retainedName} ${retained.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const retainedState = retained && isAutoModel(retained.model) && autoRow && autoRow.state !== "ready" ? autoPickerCopy(autoRow.state, false, undefined, autoRow.code, autoRow.resetsAt).subtitle : retainedCopy?.subtitle;
  const retainedSubtitle = [retained && !isAutoModel(retained.model) ? retained.description?.trim() : null, retainedState].filter(Boolean).join(" · ");
  // A saved model that was pinned stays where the person pinned it, at the top of Pinned.
  const retainedPinned = Boolean(retained && favorites.some((favorite) => modelRefKey(favorite) === modelRefKey(retained.model)));
  const retainedLabel = retainedPinned ? t("ui.model_pinned") : t("ui.saved_selection");
  const mergedLabel = retainedVisible && retainedPinned && groups[0]?.value === t("ui.model_pinned") ? t("ui.model_pinned") : null;
  const verifiedDate = catalogState?.lastVerifiedAt ? new Date(catalogState.lastVerifiedAt) : null;
  const verified = verifiedDate && Number.isFinite(verifiedDate.valueOf()) ? verifiedDate : null;
  return <div ref={root} className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={(event) => {
    if (!isPinModelShortcut(event) || event.repeat) return;
    const focusedRow = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-model-key]") : null;
    const row = focusedRow ?? root.current?.querySelector<HTMLElement>("[data-model-key][data-highlighted]");
    const option = options.find((item) => modelRefKey(item) === row?.dataset.modelKey) ?? highlighted;
    if (!option) return;
    event.preventDefault(); event.stopPropagation(); toggle(option);
  }}>
    <Command items={groups} filter={null} value={query} onValueChange={onQueryChange}>
      <CommandHeader><CommandInput ref={searchInputRef} autoFocus={autoFocusSearch} aria-label={t("interface.search_all_models")} placeholder={t("settings.search_models")} className="h-8 text-base sm:text-base md:text-base lg:text-sm" /></CommandHeader>
      {/* The list sizes to its rows so placeholders after it stay in view; this panel does the scrolling. */}
      <CommandPanel className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [&>[data-slot=scroll-area]]:h-auto">
        {retainedVisible ? <div data-testid="retained-selected-model" aria-disabled="true" aria-label={t("ui.model_current_retained", { name: retainedName, subtitle: retainedSubtitle })} className="px-2 pt-2">
          <p className="flex h-7 items-center px-2 text-xs text-muted-foreground">{retainedLabel}</p>
          <div className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1 text-sm opacity-55">
            <ProviderMark model={retained.model} description={retained.description} retained />
            <span className="min-w-0 flex-1 leading-[18px]"><span className="block truncate font-medium">{retainedName}</span><span className="block text-muted-foreground">{retainedSubtitle}</span></span>
            <span className="flex size-4 shrink-0 items-center justify-center">{retained.reason === "policy" ? <Lock aria-label={t("context_panel.permission_action_deny")} strokeWidth={1.5} className="size-4" /> : <Check aria-hidden="true" className="size-4" />}</span>
          </div>
        </div> : null}
        {loading && !hasOptions ? <ModelLoadingRows /> : null}
        {!loading && groups.length === 0 && query.trim() ? <div role="status" className="flex flex-col items-center gap-1 px-4 py-7 text-center text-sm">
          <p>{t("interface.no_models_match")}{query.trim()}”</p><p className="text-muted-foreground">{t("interface.try_a_shorter_name_or_search_by_provider")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={clearSearch}>{t("interface.clear_search")}</Button>
        </div> : null}
        {empty ? <div role="status" className="flex flex-col items-center gap-1 px-4 py-7 text-center text-sm" data-testid="model-catalog-empty">
          <p>{t("interface.no_models_yet")}</p><p className="text-muted-foreground">{onConnectProvider ? <>{t("interface.connect_a_provider_or_turn_auto_back_on_in")} {onOpenProviderSettings ? <button type="button" className="text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none" onClick={onOpenProviderSettings}>{t("interface.ai_providers_2c4aed90")}</button> : t("interface.ai_providers_2c4aed90")}.</> : t("interface.your_organization_manages_model_access_ask_your_workspace_owner_or_admin")}</p>
        </div> : null}
        <CommandList>
          {(group: ModelGroup) => <CommandGroup key={group.value} items={group.items}>
            {group.value === mergedLabel ? null : <CommandGroupLabel className="flex min-h-7 items-center">{group.value}</CommandGroupLabel>}
            <CommandCollection>{(option: ModelOption) => {
              const key = modelRefKey(option);
              const name = modelTitle(option);
              const fixed = immutableModelPin(option);
              const active = modelRefKey(current) === key;
              const autoState = autoRow && modelRefKey(autoRow.model) === key ? autoRow.state : undefined;
              const blocked = !canSelect(option);
              const subtitle = autoState ? autoPickerCopy(autoState, false, undefined, autoRow?.code, autoRow?.resetsAt).subtitle : active && failed ? t("ui.model_unverified", { subtitle: modelSubtitle(option), separator: modelSubtitle(option) ? " · " : "" }) : modelSubtitle(option);
              const pinLabel = pinned.has(key) ? t("ui.model_unpin") : t("ui.model_pin_top");
              const actions: MenuAction[] = [
                { type: "item", id: "pin", label: fixed ? t("ui.model_pinned_org_title") : pinLabel, webContent: fixed ? undefined : menuChord(pinLabel, "⇧P"), disabled: fixed || blocked, onSelect: () => toggle(option) },
                { type: "item", id: "default", label: t("ui.model_workspace_default"), disabled: !onSetWorkspaceDefault || blocked, onSelect: async () => { if (canSelect(option) && onSetWorkspaceDefault) { const saved = await onSetWorkspaceDefault(option, active ? currentBehaviorValue ?? null : null); if (saved !== false) markExplicitModelChoice(); } } },
                { type: "item", id: "select", label: t("ui.model_switch_to"), webContent: menuChord(t("ui.model_switch_to"), "⏎"), disabled: blocked, onSelect: () => select(option) },
                { type: "item", id: "copy", label: t("ui.model_copy_id"), onSelect: () => navigator.clipboard.writeText(`${option.providerID}/${option.modelID}`) },
              ];
              return <ActionContextMenu key={key} actions={actions} render={<CommandItem
                value={`${key} ${name} ${subtitle}`} disabled={blocked}
                data-model-key={key} data-checked={active} data-testid={`model-option-${option.providerID}-${option.modelID}`}
                aria-label={t("ui.model_option_label", { name, subtitle, source: MODEL_SOURCE_LABELS[modelSource(option)], current: active ? t("ui.model_current_marker") : "" })}
                tabIndex={blocked ? -1 : 0} className="group/model min-h-11 gap-2 rounded-md px-2 py-1 text-sm data-disabled:opacity-55"
                onFocus={() => setHighlighted(option)} onClick={() => select(option)}
                onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); select(option); } }}
              />}>
                <ProviderMark model={option} description={option.description} />
                <span data-slot="model-label" className="min-w-0 flex-1 leading-[18px]"><span className={`block truncate${active ? " font-medium" : ""}`} title={name}>{name}</span><span className="block text-sm text-muted-foreground">{subtitle}</span></span>
                {!fixed && !blocked ? <Button type="button" variant="ghost" size="sm" aria-label={`${pinLabel}: ${name}`} className="h-7 px-2 text-xs opacity-0 group-hover/model:opacity-100 group-focus-within/model:opacity-100 group-data-highlighted/model:opacity-100 focus:opacity-100"
                  onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggle(option); }}>{pinned.has(key) ? t("interface.unpin") : t("interface.pin")}</Button> : null}
                {shortcutLabels.get(key) ? <kbd data-testid="model-shortcut-key" className="shrink-0 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">{shortcutLabels.get(key)}</kbd> : null}
                <span data-slot="model-source" className="flex size-4 shrink-0 items-center justify-center"><ModelSourceIcon model={option} /></span>
                <span data-slot="model-selection" className="flex size-4 shrink-0 items-center justify-center">{active ? <Check aria-hidden="true" className="size-4 text-muted-foreground" /> : null}</span>
              </ActionContextMenu>;
            }}</CommandCollection>
          </CommandGroup>}
        </CommandList>
        {loading && hasOptions ? <ModelLoadingRows /> : null}
        {failed && !verified && hasOptions && !query.trim() ? <ModelLoadingRows rows={2} label={t("interface.other_models_not_loaded")} still /> : null}
      </CommandPanel>
      {failed ? <PickerNotice tone={verified ? "neutral" : "error"} role="alert" testId="model-catalog-error" action={<Button size="sm" variant="outline" disabled={!catalogState?.onRetry || retryBusy || catalogState.refreshing} onClick={() => void retry()}>{t("updates.retry")}</Button>}>
        {verified ? <>{t("interface.showing_models_from")} <time dateTime={verified.toISOString()}>{verified.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" })}</time>{t("ui.model_refresh_failed_recent")}</> : hasOptions ? t("interface.couldn_t_load_the_rest_of_your_models_pinned_models_still_work") : t("interface.couldn_t_load_your_models_try_again")}
      </PickerNotice> : null}
      {retainedCopy && !query.trim() && !(isAutoModel(current) && autoRow && autoRow.state !== "ready") ? <PickerNotice action={<>
        {retained?.reason === "unavailable" && catalogState?.onRetry ? <Button size="sm" variant="outline" disabled={retryBusy || catalogState.refreshing} onClick={() => void retry()}>{t("skills.refresh")}</Button> : null}
        {retained?.reason === "disabled" && onOpenProviderSettings ? <Button size="sm" variant="outline" onClick={onOpenProviderSettings}>{t("interface.ai_providers_2c4aed90")}</Button> : null}
      </>}>{retainedCopy.detail}</PickerNotice> : null}
      {autoRow && autoRow.state !== "ready" ? <AutoPickerRecovery state={autoRow.state} code={autoRow.code} resetsAt={autoRow.resetsAt} onRetry={onRetryAuto} onReload={onReloadWorkspace} hasAlternatives={Boolean(alternativeKey)} />
        : openWorkModelsSyncing ? <AutoPickerRecovery state="sync" onReload={onReloadWorkspace} /> : null}
      {empty ? <PickerNotice action={onConnectProvider ? <Button size="sm" onClick={onConnectProvider}>{t("models.connect_provider")}</Button> : null}>{t("interface.nothing_is_connected_in_this_workspace")}</PickerNotice> : null}
      {focusAlternative && !alternativeKey && hasOptions && onConnectProvider ? <PickerNotice action={<Button size="sm" variant="outline" onClick={onConnectProvider}>{t("models.connect_provider")}</Button>}>{t("interface.nothing_else_is_connected_in_this_workspace")}</PickerNotice> : null}
      {footer}
    </Command>
  </div>;
}
