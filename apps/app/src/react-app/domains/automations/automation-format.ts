import { currentLocale, t } from "@/i18n";
import type { AutomationRun, AutomationSchedule } from "@openwork/types/automations";

type RunReceiptState = Pick<AutomationRun, "status" | "error" | "attemptCount" | "startedAt">;

type RunNotice = {
  variant: "default" | "destructive";
  title: string;
  message: string;
};

export function automationRunNotice(run: RunReceiptState): RunNotice | null {
  if (!run.error) return null;
  if (run.status === "skipped" && run.error.code === "runner_unavailable") {
    if (run.attemptCount === 0 && run.startedAt == null) {
      return {
        variant: "default",
        title: t("ui_extra.run_missed"),
        message: t("ui_extra.missed_run_description", { reason: run.error.message.trim() || t("ui_extra.desktop_runner_unavailable") }),
      };
    }
    return {
      variant: "destructive",
      title: t("ui_extra.run_interrupted"),
      message: t("ui_extra.interrupted_run_description", { reason: run.error.message }),
    };
  }
  return {
    variant: "destructive",
    title: run.status === "failed" && run.error.code === "lease_lost" ? t("ui_extra.run_interrupted") : run.error.code,
    message: run.error.message,
  };
}

export function runStatusLabel(run: RunReceiptState) {
  const notice = automationRunNotice(run);
  if (notice && ((run.status === "skipped" && run.error?.code === "runner_unavailable")
    || (run.status === "failed" && run.error?.code === "lease_lost"))) {
    return notice.title;
  }
  if (run.status === "skipped" && (run.error?.code === "model_access_lost" || run.error?.code === "provider_unavailable")) {
    return t("ui_extra.skipped_model_unavailable");
  }
  return automationRunStatusLabel(run.status);
}

const SUNDAY_UTC = Date.UTC(2024, 0, 7);

export function formatAutomationWeekdays(daysOfWeek: number[], locales?: Intl.LocalesArgument) {
  const formatter = new Intl.DateTimeFormat(locales ?? currentLocale(), {
    weekday: "short",
    timeZone: "UTC",
  });

  return daysOfWeek
    .map((day) => formatter.format(new Date(SUNDAY_UTC + day * 24 * 60 * 60 * 1_000)))
    .join(t("ui_extra.list_separator"));
}

export function formatAutomationTime(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toLocaleString(currentLocale()) : "—";
}

export function formatAutomationSchedule(schedule: AutomationSchedule) {
  if (schedule.kind === "once") {
    return t("ui_extra.schedule_once", { time: formatAutomationTime(schedule.at), timezone: schedule.timezone });
  }
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  if (schedule.kind === "daily") return t("ui_extra.schedule_daily", { time, timezone: schedule.timezone });
  return t("ui_extra.schedule_weekly", { days: formatAutomationWeekdays(schedule.daysOfWeek), time, timezone: schedule.timezone });
}

export function automationRunStatusLabel(status: AutomationRun["status"]): string {
  switch (status) {
    case "queued": return t("ui_extra.run_status_queued");
    case "claimed": return t("ui_extra.run_status_claimed");
    case "running": return t("ui_extra.run_status_running");
    case "succeeded": return t("ui_extra.run_status_succeeded");
    case "failed": return t("ui_extra.run_status_failed");
    case "cancelled": return t("ui_extra.run_status_cancelled");
    case "skipped": return t("ui_extra.run_status_skipped");
  }
}
