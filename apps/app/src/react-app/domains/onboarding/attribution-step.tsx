/** @jsxImportSource react */
import { t } from "@/i18n";
import { useState } from "react";

import {
  PageBackground,
  PageDescription,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  BotIcon,
  GithubIcon,
  MessageCircleIcon,
  SearchIcon,
  SkipForwardIcon,
  UsersIcon,
} from "lucide-react";

export type AttributionSource =
  | "ai_assistant"
  | "search"
  | "social"
  | "github"
  | "friend_or_colleague";

type AttributionOption = {
  source: AttributionSource;
  label: string;
  description: string;
  icon: typeof BotIcon;
};

function attributionOptions(): AttributionOption[] { return [
  {
    source: "ai_assistant",
    label: t("ui_extra.attribution_ai"),
    description: "ChatGPT, Claude, Gemini, Perplexity...",
    icon: BotIcon,
  },
  {
    source: "search",
    label: t("ui_extra.attribution_search"),
    description: "Google, Bing, DuckDuckGo...",
    icon: SearchIcon,
  },
  {
    source: "social",
    label: t("ui_extra.attribution_social"),
    description: "X, LinkedIn, YouTube, Reddit...",
    icon: MessageCircleIcon,
  },
  {
    source: "github",
    label: t("ui_extra.attribution_github"),
    description: t("ui_extra.attribution_github_description"),
    icon: GithubIcon,
  },
  {
    source: "friend_or_colleague",
    label: t("ui_extra.attribution_friend"),
    description: t("ui_extra.attribution_friend_description"),
    icon: UsersIcon,
  },
]; }

type AttributionStepProps = {
  onSubmit: (source: AttributionSource, aiPrompt?: string) => void;
  onSkip: () => void;
};

/**
 * Self-reported attribution survey shown once during onboarding.
 * When the user picks "AI assistant" we ask which prompt led them
 * here — first-party data on how answer engines describe OpenWork.
 */
export function AttributionStep({ onSubmit, onSkip }: AttributionStepProps) {
  const [aiSelected, setAiSelected] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <PageBackground />
      <PageTitlebarRegion />

      <div className="relative z-10 mx-6 w-full max-w-md rounded-3xl border border-border bg-background px-8 py-10">
        <PageHeader className="mb-8 text-center">
          <PageTitle>{t("interface.how_did_you_hear_about_openwork")}</PageTitle>
          <PageDescription>{t("interface.one_quick_question_it_helps_us_know_where_to_show_up")} </PageDescription>
        </PageHeader>

        {aiSelected ? (
          <div className="space-y-3">
            <div className="text-sm font-medium text-foreground">{t("interface.what_did_you_ask_the_ai")} </div>
            <Textarea
              autoFocus
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder={t("interface.e_g_best_open_source_alternative_to_claude_cowork")}
              rows={3}
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSubmit("ai_assistant")}
              >{t("interface.skip_this_part")} </Button>
              <Button size="sm" onClick={() => onSubmit("ai_assistant", aiPrompt)}>{t("extensions.mcp_check_continue")} </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {attributionOptions().map((option) => (
              <button
                key={option.source}
                type="button"
                className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
                onClick={() => {
                  if (option.source === "ai_assistant") {
                    setAiSelected(true);
                    return;
                  }
                  onSubmit(option.source);
                }}
              >
                <option.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {option.label}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {option.description}
                  </div>
                </div>
              </button>
            ))}

            <div className="pt-1 text-center">
              <Button variant="ghost" size="sm" onClick={onSkip}>
                <SkipForwardIcon className="mr-1.5 size-3.5" />{t("interface.skip")} </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
