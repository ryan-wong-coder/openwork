/** @jsxImportSource react */
import { t } from "@/i18n";
import {
  Page,
  PageBackground,
  PageDescription,
  PageHeader,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Button } from "@/components/ui/button";
import { KeyRoundIcon, SkipForwardIcon, SparklesIcon } from "lucide-react";

type ProviderSelectionStepProps = {
  showOpenWorkModels?: boolean;
  onOpenWorkModels: () => void;
  onBringYourOwn: () => void;
  onSkip: () => void;
};

export function ProviderSelectionStep({
  showOpenWorkModels = true,
  onOpenWorkModels,
  onBringYourOwn,
  onSkip,
}: ProviderSelectionStepProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <PageBackground />
      <PageTitlebarRegion />

      <div className="relative z-10 mx-6 w-full max-w-md rounded-3xl border border-border bg-background px-8 py-10">
        <PageHeader className="mb-8 text-center">
          <PageTitle>{t("interface.power_your_first_task")}</PageTitle>
          <PageDescription>{t("interface.connect_a_model_then_try_a_real_task_in_chat_so_you_can_see_openwork_work")} </PageDescription>
        </PageHeader>

        <div className="space-y-3">
          {showOpenWorkModels ? (
            <button
              type="button"
              className="flex w-full items-start gap-4 rounded-xl border border-blue-7/50 bg-blue-2/30 p-4 text-left transition-colors hover:bg-blue-3/40"
              onClick={onOpenWorkModels}
            >
              <SparklesIcon className="mt-0.5 size-5 shrink-0 text-blue-10" />
              <div>
                <div className="text-sm font-medium text-foreground">{t("interface.use_openwork_models")} </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t("interface.pay_through_openwork_cloud_and_skip_api_key_setup")} </div>
              </div>
            </button>
          ) : null}

          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={onBringYourOwn}
          >
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">{t("interface.bring_your_own_api_key")} </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t("interface.connect_openai_anthropic_google_or_another_provider_then_run_your_first_task")} </div>
            </div>
          </button>

          <div className="pt-1 text-center">
            <Button variant="ghost" size="sm" onClick={onSkip}>
              <SkipForwardIcon className="mr-1.5 size-3.5" />{t("interface.skip_and_use_the_free_model")} </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
