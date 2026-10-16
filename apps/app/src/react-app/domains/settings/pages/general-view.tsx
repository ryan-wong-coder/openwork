/** @jsxImportSource react */
import {
  ArrowRight,
  ArrowUpRight,
  Cloud,
  Cog,
  FolderLock,
  Keyboard,
  LifeBuoy,
  MessageCircle,
  Paintbrush,
  RefreshCcw,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";

import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import { Button } from "@/components/ui/button";

export type GeneralSettingsViewProps = {
  onNavigateTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  onSendFeedback: () => void;
  onJoinDiscord: () => void;
  onReportIssue: () => void;
};

type SettingsCardDefinition = { tab: SettingsTab; icon: typeof Sparkles; titleKey: string; descKey: string };

const workspaceCards: SettingsCardDefinition[] = [
  { tab: "preferences", icon: Cog, titleKey: "settings_extra.preferences", descKey: "settings_extra.default_model_reasoning_and_compaction" },
  { tab: "permissions", icon: FolderLock, titleKey: "settings_extra.permissions", descKey: "settings_extra.authorized_folders_and_file_access" },
  { tab: "advanced", icon: Wrench, titleKey: "mcp.advanced", descKey: "settings_extra.runtime_engine_recovery_and_developer_options" },
];

const globalCards: SettingsCardDefinition[] = [
  { tab: "ai", icon: Sparkles, titleKey: "interface.ai_providers", descKey: "settings_extra.connect_services_that_provide_ai_models" },
  { tab: "cloud-account", icon: Cloud, titleKey: "settings.group_cloud", descKey: "settings_extra.openwork_cloud_account_and_organization" },
  { tab: "appearance", icon: Paintbrush, titleKey: "settings.appearance_title", descKey: "settings_extra.theme_font_size_and_display" },
  { tab: "shortcuts", icon: Keyboard, titleKey: "settings_extra.keyboard_shortcuts", descKey: "settings_extra.keys_that_switch_to_your_saved_models" },
  { tab: "environment", icon: Terminal, titleKey: "settings.provider_source_env", descKey: "settings_extra.environment_variables_and_paths" },
  { tab: "updates", icon: RefreshCcw, titleKey: "settings.tab_updates", descKey: "settings_extra.app_version_and_update_channel" },
];

function cardTitle(card: SettingsCardDefinition) {
  return t(card.titleKey);
}

function cardDescription(card: SettingsCardDefinition) {
  return t(card.descKey);
}

function SettingsCard(props: {
  icon: typeof Sparkles;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex items-center gap-3 rounded-2xl border border-dls-border bg-dls-surface p-4 text-left transition-colors hover:bg-dls-hover"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
        <props.icon size={16} className="text-dls-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-dls-text">{props.title}</div>
        <div className="text-[11px] text-dls-secondary">{props.desc}</div>
      </div>
      <ArrowRight size={14} className="shrink-0 text-dls-secondary" />
    </button>
  );
}

export function GeneralSettingsView(props: GeneralSettingsViewProps) {
  return (
    <div className="w-full max-w-3xl space-y-8">
      {/* Workspace settings */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">{t("session_management.archive_workspace")} </div>
        <div className="grid grid-cols-2 gap-2">
          {workspaceCards.map((card) => (
            <SettingsCard
              key={card.tab}
              icon={card.icon}
              title={cardTitle(card)}
              desc={cardDescription(card)}
              onClick={() => props.onNavigateTab(card.tab)}
            />
          ))}
        </div>
      </div>

      {/* Global settings */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">{t("settings.group_global")} </div>
        <div className="grid grid-cols-2 gap-2">
          {globalCards.map((card) => (
            <SettingsCard
              key={card.tab}
              icon={card.icon}
              title={cardTitle(card)}
              desc={cardDescription(card)}
              onClick={() => props.onNavigateTab(card.tab)}
            />
          ))}
        </div>
      </div>

      {/* Feedback */}
      <div className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">{t("interface.help")} </div>
        <div className="rounded-2xl border border-dls-border bg-dls-surface p-4">
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <LifeBuoy size={14} className="text-dls-secondary" />
                <div className="text-[13px] font-medium text-dls-text">{t("settings.feedback_title")}</div>
              </div>
              <div className="mt-1 max-w-[58ch] text-[11px] text-dls-secondary">{t("settings.feedback_desc")}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={props.onSendFeedback}
              >
                <MessageCircle size={12} />
                {t("settings.send_feedback")}
                <ArrowUpRight size={11} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={props.onJoinDiscord}
              >
                {t("settings.join_discord")}
                <ArrowUpRight size={11} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={props.onReportIssue}
              >
                {t("settings.report_issue")}
                <ArrowUpRight size={11} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
