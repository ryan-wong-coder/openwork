"use client"

import { t } from "@/i18n";

import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { useMessageList } from "@/components/chat/message-list-provider"
import { cn } from "@/lib/utils"
import { useOrgRestrictions } from "@/react-app/domains/cloud/desktop-config-provider"
import { BoltIcon, CubeIcon, DocumentChartBarIcon, GlobeAltIcon, SparklesIcon } from "@heroicons/react/24/solid"

const csvPrompt = () => t("ui.create_a_sample_csv_file_with_20_rows_of_fake_customer_data_name_email_company_revenue_the")

const browserPrompt = () => t("ui.open_craigslist_org_in_the_browser_and_search_for_couches_for_sale_show_me_the_top_5_resul")

const organizationPromptTitles = () => [t("ui.organization_prompt_1"), t("ui.organization_prompt_2"), t("ui.organization_prompt_3")]

export function resolveOrganizationPromptCardContent(input: {
  prompt: string
  description?: string
  index: number
}) {
  const title = input.description?.trim()
  return {
    title: title || organizationPromptTitles()[input.index] || t("ui.organization_prompt"),
    description: input.prompt,
    selectionPrompt: input.prompt,
  }
}

interface TaskSuggestionsProps {
  className?: string
}

export function TaskSuggestions({ className }: TaskSuggestionsProps) {
  const { displaySuggestions, providerConnectedCount, dispatchAction, setPrompt } = useMessageList()
  const orgRestrictions = useOrgRestrictions()
  const organizationPrompts = orgRestrictions.onboardingPrompts
  const organizationPromptDescriptions = orgRestrictions.onboardingPromptDescriptions

  if (!displaySuggestions) {
    return null
  }

  const noProviders = providerConnectedCount === 0
  const hasOrganizationPrompts = organizationPrompts !== undefined

  return (
    <div className={cn("@container flex flex-col gap-4 pt-1", className)}>
      <p className="text-muted-foreground font-medium select-none">
        {noProviders
          ? t("ui.connect_a_model_provider_to_get_started")
          : hasOrganizationPrompts
            ? t("ui.try_one_of_your_organization_s_prompts")
            : t("ui.try_one_of_these")}
      </p>
      <div className="grid min-w-0 gap-2 @lg:grid-cols-2 @2xl:grid-cols-3">
        {noProviders ? (
          <DescriptiveButton
            orientation="vertical"
            className="border-blue-7/50 bg-blue-2/30 hover:bg-blue-3/40 @lg:col-span-2 @2xl:col-span-3"
            onClick={() =>
              dispatchAction({
                target: "settings",
                action: "open",
                section: "providers",
              })
            }
          >
            <DescriptiveButtonIcon>
              <BoltIcon className="size-6 text-blue-10" aria-hidden />
            </DescriptiveButtonIcon>
            <DescriptiveButtonContent>
              <DescriptiveButtonTitle>{t("ui.connect_a_model_provider")}</DescriptiveButtonTitle>
              <DescriptiveButtonDescription>
                {t("ui.add_an_api_key_for_anthropic_openai_google_or_others")}
              </DescriptiveButtonDescription>
            </DescriptiveButtonContent>
          </DescriptiveButton>
        ) : null}

        {hasOrganizationPrompts ? (
          organizationPrompts.map((prompt, index) => {
            const card = resolveOrganizationPromptCardContent({
              prompt,
              description: organizationPromptDescriptions?.[index],
              index,
            })
            return (
              <DescriptiveButton key={`${index}-${prompt}`} orientation="vertical" onClick={() => setPrompt(card.selectionPrompt)}>
                <DescriptiveButtonIcon>
                  <SparklesIcon className="size-6 text-purple-10" aria-hidden />
                </DescriptiveButtonIcon>
                <DescriptiveButtonContent>
                  <DescriptiveButtonTitle>{card.title}</DescriptiveButtonTitle>
                  <DescriptiveButtonDescription>{card.description}</DescriptiveButtonDescription>
                </DescriptiveButtonContent>
              </DescriptiveButton>
            )
          })
        ) : (
          <>
            <DescriptiveButton orientation="vertical" onClick={() => setPrompt(csvPrompt())}>
              <DescriptiveButtonIcon>
                <DocumentChartBarIcon className="size-6 text-green-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>{t("ui.edit_a_csv")}</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>{t("ui.create_a_sample_spreadsheet")}</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton orientation="vertical" onClick={() => setPrompt(browserPrompt())}>
              <DescriptiveButtonIcon>
                <GlobeAltIcon className="size-6 text-blue-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>{t("ui.browse_the_web")}</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>{t("ui.search_craigslist_for_couches")}</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>

            <DescriptiveButton
              orientation="vertical"
              onClick={() =>
                dispatchAction({
                  target: "settings",
                  action: "open",
                  section: "mcps",
                })
              }
            >
              <DescriptiveButtonIcon>
                <CubeIcon className="size-6 text-amber-10" aria-hidden />
              </DescriptiveButtonIcon>
              <DescriptiveButtonContent>
                <DescriptiveButtonTitle>{t("ui.connect_an_extension")}</DescriptiveButtonTitle>
                <DescriptiveButtonDescription>{t("ui.add_mcps_and_integrations")}</DescriptiveButtonDescription>
              </DescriptiveButtonContent>
            </DescriptiveButton>
          </>
        )}
      </div>
    </div>
  )
}
