/** @jsxImportSource react */
import { t } from "@/i18n";
import { isLocalGatewayClient } from "@/app/lib/client-profile";
import { isZenoInterfaceEnabled } from "@/app/lib/zeno-identity";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Settings2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

import { DEFAULT_MODEL } from "@/app/constants";
import { useIsMobile } from "@/hooks/use-mobile";
import { DescriptiveButton, DescriptiveButtonTitle } from "@/components/descriptive-button";
import type { ComposerAttachment } from "@/app/types";
import { resolveOrganizationPromptCardContent } from "@/components/chat/task-suggestions";
import { useCheckDesktopRestriction, useOrgRestrictions } from "@/react-app/domains/cloud/desktop-config-provider";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import {
  getOpenWorkModelsActionUrl,
  hideOpenWorkModelsPromo,
  isOpenWorkModelsPromoHidden,
  openWorkModelsPromoChangedEvent,
  useOpenWorkModelsPromoEligibility,
} from "@/react-app/domains/cloud/openwork-models-promo";
import { usePlatform } from "@/react-app/kernel/platform";
import { persistableComposerDraftText, useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { useNewTaskDraftState } from "@/react-app/domains/session/sync/draft-store";
import {
  NewTaskComposer,
  type NewTaskComposerContext,
  type NewTaskComposerHandoff,
} from "./new-task-composer";
import { consumePendingChatSeed, pendingChatSeedEvent } from "./pending-chat-seed";
import { hideEmptyHeroIntroduction } from "./empty-hero-introduction";
import { insertZenoIntent, ZenoGreeting, ZenoQuickIntents } from "./zeno-quick-intents";
import "./zeno-chat.css";

type HeroSuggestion = {
  title: string;
  description: string;
  prompt: string;
};

function defaultSuggestions(): HeroSuggestion[] { return [
  {
    title: t("session_copy.summarize_my_week"),
    description: t("session_copy.pull_highlights_from_email_and_calendar"),
    prompt: t("session_copy.summarize_my_week_pull_the_highlights_from_my_connected_email_and_calendar_and_give_me_a_short_digest_of_"),
  },
  {
    title: t("session_copy.clean_up_a_spreadsheet"),
    description: t("session_copy.drop_in_a_csv_and_describe_the_result_you_want"),
    prompt: t("session_copy.create_a_sample_csv_file_with_20_rows_of_fake_customer_data_name_email_company_revenue_then_show_me_a_sum"),
  },
  {
    title: t("session_copy.draft_a_document"),
    description: t("session_copy.reports_emails_or_briefs_from_a_few_bullet_points"),
    prompt: t("session_copy.draft_a_one_page_project_brief_ask_me_for_the_bullet_points_you_need_then_turn_them_into_a_clear_well_str"),
  },
  {
    title: t("session_copy.automate_a_web_task"),
    description: t("session_copy.use_the_built_in_browser_for_repetitive_steps"),
    prompt: t("session_copy.open_craigslist_org_in_the_browser_and_search_for_couches_for_sale_show_me_the_top_5_results_with_prices"),
  },
]; }

export type SessionEmptyHeroProps = {
  providerCount: number;
  /** Disable submission while a default workspace is being prepared. */
  busy?: boolean;
  /** Called with the task prompt and attachments; the caller creates the session (and workspace if needed). */
  onRunTask: (
    prompt: string,
    attachments: ComposerAttachment[],
    handoff?: NewTaskComposerHandoff,
  ) => void | Promise<void>;
  onOpenProviderAuth?: () => void;
  /** Workspace-scoped wiring for the full composer (skills, agents, models). */
  composer?: NewTaskComposerContext | null;
};

/**
 * Paper "first chat" empty state: the real session composer front and
 * center with suggestion cards below. Suggestions come from desktop
 * policies (organization onboarding prompts) when configured, with
 * built-in defaults otherwise.
 */
export function SessionEmptyHero(props: SessionEmptyHeroProps) {
  const zeno = isZenoInterfaceEnabled();
  // The session is created on submit, so until then the prompt has no
  // conversation to live in. Persist it under the workspace's reserved slot so
  // opening another session (or restarting) does not lose it; the sidebar
  // offers a Draft row for the same slot. The parent keys this component by
  // draft owner, so the initial read is the only hydration needed.
  const persistedDraft = useNewTaskDraftState(props.composer?.draftScope, props.composer?.workspaceId, props.composer?.draftSessionId);
  const [prompt, setPromptState] = useState(() => (
    props.composer?.draftOwnerKey ? useComposerStateStore.getState().sessions[props.composer.draftOwnerKey]?.draft : undefined
  ) ?? persistedDraft.snapshot?.text ?? "");
  const promptRef = useRef(prompt);
  // Once a send is in flight the composer has cleared the slot, and anything
  // typed until its route lands is carried into the created session as the
  // continuation. Persisting it here would pre-fill the next new task. On
  // success this hero unmounts, so the flag only resets when the send fails.
  const sendInFlightRef = useRef(false);
  const [sendInFlight, setSendInFlight] = useState(false);
  const [composing, setComposing] = useState(false);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const hideIntroduction = hideEmptyHeroIntroduction(isMobile, composing, prompt, sendInFlight || Boolean(props.busy));

  useEffect(() => {
    // A null blur target can be keyboard dismissal or a touch send. Only a
    // deliberate interaction outside the dock ends composition, never blur.
    const leaveComposer = (event: Event) => {
      if (event.target instanceof Node && !composerDockRef.current?.contains(event.target)) {
        setComposing(false);
      }
    };
    document.addEventListener("pointerdown", leaveComposer);
    document.addEventListener("focusin", leaveComposer);
    return () => {
      document.removeEventListener("pointerdown", leaveComposer);
      document.removeEventListener("focusin", leaveComposer);
    };
  }, []);
  const persistPrompt = persistedDraft.save;
  const setPrompt = useCallback((value: string) => {
    setPromptState(value);
    promptRef.current = value;
    if (sendInFlightRef.current) return;
    // Attachment chips only exist in memory (File objects); the stored text drops their tokens.
    persistPrompt({ text: persistableComposerDraftText(value), mode: "prompt" });
  }, [persistPrompt]);
  const orgRestrictions = useOrgRestrictions();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const canAddProviders = !checkDesktopRestriction({ restriction: "allowCustomProviders" });
  const platform = usePlatform();
  const denAuth = useDenAuth();
  const openWorkModelsPromoEligible = useOpenWorkModelsPromoEligibility();
  const [modelsPromoHidden, setModelsPromoHidden] = useState(isOpenWorkModelsPromoHidden);

  useEffect(() => {
    const handlePromoChanged = () => setModelsPromoHidden(isOpenWorkModelsPromoHidden());
    window.addEventListener(openWorkModelsPromoChangedEvent, handlePromoChanged);
    return () => window.removeEventListener(openWorkModelsPromoChangedEvent, handlePromoChanged);
  }, []);

  // A chat deep link (Den's connector "Chat" action) seeds the composer with
  // the connector chip and its starter prompt; the person reviews and sends.
  useEffect(() => {
    const seed = () => {
      const draft = consumePendingChatSeed();
      if (draft === null) return;
      setPrompt(draft);
      window.dispatchEvent(new Event("openwork:focusPrompt"));
    };
    seed();
    window.addEventListener(pendingChatSeedEvent, seed);
    return () => window.removeEventListener(pendingChatSeedEvent, seed);
  }, []);

  // Quiet inline lead to OpenWork Models: replaces the old startup dialog
  // interrupt. Shown only while the session runs on the free starter model
  // (the built-in `opencode` provider) and the hosted offering applies.
  const onFreeStarterModel = props.composer?.selectedModel.providerID === DEFAULT_MODEL.providerID;
  const showModelsHint =
    !isLocalGatewayClient() &&
    openWorkModelsPromoEligible &&
    !modelsPromoHidden &&
    !props.composer?.openWorkModelsEntitled &&
    onFreeStarterModel;

  const organizationPrompts = orgRestrictions.onboardingPrompts;
  const suggestions: HeroSuggestion[] = organizationPrompts !== undefined
    ? organizationPrompts.map((orgPrompt, index) => {
      const card = resolveOrganizationPromptCardContent({
        prompt: orgPrompt,
        description: orgRestrictions.onboardingPromptDescriptions?.[index],
        index,
      });
      return { title: card.title, description: card.description, prompt: card.selectionPrompt };
    })
    : defaultSuggestions();

  const submit = async (
    resolvedPrompt: string,
    attachments: ComposerAttachment[],
    handoff?: NewTaskComposerHandoff,
  ) => {
    const trimmedPrompt = resolvedPrompt.trim();
    if ((!trimmedPrompt && !attachments.length) || props.busy) return;
    sendInFlightRef.current = true;
    setSendInFlight(true);
    // Legacy callers may not establish a pending conversation. Clear only after
    // their submit starts; the synchronous consume callback owns the new pipeline.
    try {
      const work = props.onRunTask(trimmedPrompt, attachments, handoff);
      persistedDraft.clear();
      await work;
    } catch (error) {
      // The composer stays on this route, so whatever it holds now is once
      // again the unsent new-task prompt and must stay reachable.
      sendInFlightRef.current = false;
      setSendInFlight(false);
      persistPrompt({ text: persistableComposerDraftText(promptRef.current), mode: "prompt" });
      throw error;
    }
  };

  const fillPrompt = (value: string) => {
    setPrompt(value);
    window.dispatchEvent(new Event("openwork:focusPrompt"));
  };

  const pickZenoIntent = (value: string) => fillPrompt(insertZenoIntent(promptRef.current, value));
  const gatewaySetupAvailable = canAddProviders && props.providerCount === 0 && Boolean(props.onOpenProviderAuth);

  return (
    <div data-chat-empty-hero data-zeno-empty-hero={zeno || undefined} className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 max-lg:h-full max-lg:min-h-0 max-lg:gap-4 max-lg:overflow-y-auto max-lg:px-3 max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
      <div data-empty-greeting hidden={hideIntroduction} className="text-center max-lg:pt-6">
        {zeno ? <ZenoGreeting pose={prompt.trim() ? "thinking" : "welcome"} /> : <h2 className="text-lg font-medium tracking-tight text-foreground">{t("interface.what_do_you_need_done")} </h2>}
      </div>

      <div ref={composerDockRef} onFocusCapture={() => setComposing(true)} data-empty-composer-dock className="max-lg:sticky max-lg:bottom-0 max-lg:order-last max-lg:mt-auto max-lg:shrink-0 max-lg:bg-dls-surface">
      <NewTaskComposer
        draft={prompt}
        onDraftChange={setPrompt}
        onRunTask={submit}
        busy={props.busy ?? false}
        gatewaySetupAvailable={zeno && gatewaySetupAvailable}
        context={props.composer ?? null}
      />
      </div>

      {showModelsHint ? (
        <div
          className="flex items-center justify-center gap-2 text-[12px] text-muted-foreground"
          data-testid="openwork-models-hint"
        >
          <span>{t("interface.using_the_free_starter_model")}</span>
          <button
            type="button"
            className="flex items-center gap-1 font-medium text-blue-10 transition-colors hover:text-blue-11"
            onClick={() => platform.openLink(getOpenWorkModelsActionUrl(denAuth.isSignedIn, "sign-up"))}
          >{t("interface.get_frontier_models_with_no_api_keys")} <ArrowRight className="size-3" />
          </button>
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={hideOpenWorkModelsPromo}
            aria-label={t("interface.hide_openwork_models_hint")}
          >
            <X className="size-3" />
          </button>
        </div>
      ) : null}

      {zeno && gatewaySetupAvailable ? <Button
        type="button"
        variant="outline"
        data-zeno-gateway-setup
        onClick={props.onOpenProviderAuth}
      ><Settings2 className="size-4" strokeWidth={1.5} aria-hidden="true" />{t("zeno.gateway_setup")}</Button> : !showModelsHint && canAddProviders && props.providerCount === 0 && props.onOpenProviderAuth ? (
        <button
          type="button"
          className="flex w-full items-start gap-3 rounded-xl border border-blue-7/50 bg-blue-2/40 p-3.5 text-left transition-colors hover:bg-blue-3/50"
          onClick={props.onOpenProviderAuth}
        >
          <Zap className="mt-0.5 size-4 shrink-0 text-blue-10" />
          <div>
            <div className="text-[13px] font-medium text-foreground">{isLocalGatewayClient() ? "配置模型网关" : t("interface.connect_a_model_provider")}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">{isLocalGatewayClient() ? "填写网关密钥，同步对话与图片模型。" : t("interface.add_an_api_key_for_anthropic_openai_google_or_other_providers_so_tasks_can_run")} </div>
          </div>
        </button>
      ) : null}

      <div data-empty-suggestions hidden={hideIntroduction} className={hideIntroduction ? "hidden" : zeno && organizationPrompts === undefined ? "" : "grid gap-2 sm:grid-cols-2"}>
        {zeno && organizationPrompts === undefined ? <ZenoQuickIntents disabled={sendInFlight || Boolean(props.busy)} onPick={pickZenoIntent} /> : suggestions.map((suggestion) => (
          <DescriptiveButton
            key={suggestion.title}
            className="min-h-10 items-center rounded-xl bg-background px-3 py-2 text-foreground hover:border-foreground/20 hover:bg-muted/60 max-lg:min-h-11"
            aria-label={`${suggestion.title}: ${suggestion.description}`}
            onClick={() => fillPrompt(suggestion.prompt)}
          >
            <DescriptiveButtonTitle>{suggestion.title}</DescriptiveButtonTitle>
          </DescriptiveButton>
        ))}
      </div>
    </div>
  );
}
