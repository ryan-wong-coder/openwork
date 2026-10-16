import { currentLocale, t } from "@/i18n"
import { automationRunStatusLabel } from "../automations/automation-format"
import * as calendar from "@openwork/calendar"
import type { AutomationRun, AutomationSchedule } from "@openwork/types/automations"

export function formatTime(instant: number, timeZone: string) {
  return calendar.formatTime(instant, timeZone, currentLocale())
}

export function formatInstant(instant: number, timeZone: string) {
  return calendar.formatInstant(instant, timeZone, currentLocale())
}

export function formatDate(date: calendar.LocalDate) {
  return calendar.formatDate(date, currentLocale())
}

export function formatHourLabel(hour: number) {
  return calendar.formatHourLabel(hour, currentLocale())
}

export function formatDayHeader(date: calendar.LocalDate) {
  return calendar.formatDayHeader(date, currentLocale())
}

export function formatRangeLabel(range: calendar.CalendarRange, anchor: calendar.LocalDate) {
  if (range.view !== "week") return calendar.formatRangeLabel(range, anchor, currentLocale())
  const first = range.days[0]
  const last = range.days.at(-1)
  if (!first || !last) return calendar.formatRangeLabel(range, anchor, currentLocale())
  const date = (value: calendar.LocalDate) => new Date(Date.UTC(value.year, value.month - 1, value.day, 12))
  return new Intl.DateTimeFormat(currentLocale(), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).formatRange(date(first), date(last))
}

export function timeZoneLabel(timeZone: string, at = Date.now()) {
  return calendar.timeZoneLabel(timeZone, at, currentLocale())
}

function weekday(day: number, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat(currentLocale(), { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + day)))
}

export function describeSchedule(schedule: AutomationSchedule, displayTimeZone: string) {
  const zone = schedule.timezone === displayTimeZone ? "" : ` ${timeZoneLabel(schedule.timezone)}`
  if (schedule.kind === "once") return t("ui_extra.once_on", { time: `${formatInstant(schedule.at, schedule.timezone)}${zone}` })
  const time = new Intl.DateTimeFormat(currentLocale(), { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1, schedule.hour, schedule.minute))) + zone
  if (schedule.kind === "daily") return t("ui_extra.every_day_at", { time })
  const days = [...schedule.daysOfWeek].sort((left, right) => left - right)
  if (days.length === 7) return t("ui_extra.every_day_at", { time })
  if (days.join(",") === "1,2,3,4,5") return t("ui_extra.every_weekday_at", { time })
  if (days.join(",") === "0,6") return t("ui_extra.every_weekend_at", { time })
  return t("ui_extra.every_days_at", { days: days.map((day) => weekday(day, days.length === 1 ? "long" : "short")).join(t("ui_extra.list_separator")), time })
}

function runDuration(run: Pick<AutomationRun, "startedAt" | "finishedAt">) {
  if (run.startedAt === null || run.finishedAt === null || run.finishedAt < run.startedAt) return null
  const seconds = Math.round((run.finishedAt - run.startedAt) / 1000)
  if (seconds < 60) return t("ui_extra.duration_seconds", { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return [t("ui_extra.duration_minutes", { count: minutes }), seconds % 60 ? t("ui_extra.duration_seconds", { count: seconds % 60 }) : null].filter(Boolean).join(" ")
  return `${t("ui_extra.duration_hours", { count: Math.floor(minutes / 60) })} ${t("ui_extra.duration_minutes", { count: minutes % 60 })}`
}

export function describeRunOutcome(run: AutomationRun) {
  const duration = runDuration(run)
  if (run.status === "succeeded") return duration ? t("ui_extra.completed_in", { duration }) : t("ui_extra.run_status_succeeded")
  if (run.status === "queued" || run.status === "claimed") return t("ui_extra.waiting_start")
  if (run.status === "skipped" && run.error?.code === "runner_unavailable") return t("ui_extra.missed_no_computer")
  if (run.status === "failed" || run.status === "skipped") return run.error?.message ?? automationRunStatusLabel(run.status)
  return automationRunStatusLabel(run.status)
}

export function slotLabel(slot: calendar.CalendarSlot) {
  const day = new Intl.DateTimeFormat(currentLocale(), { weekday: "short", month: "short", day: "numeric", timeZone: slot.timeZone }).format(new Date(slot.at))
  return t("ui_extra.slot_at", { day, time: formatTime(slot.at, slot.timeZone) })
}

export function slotScheduleOptions(slot: calendar.CalendarSlot) {
  return calendar.slotScheduleOptions(slot).map((option) => ({
    ...option,
    label: option.id === "once" ? t("interface.once")
      : option.id === "weekdays" ? t("ui_extra.slot_weekdays")
        : option.id === "daily" ? t("ui_extra.slot_daily")
          : t("ui_extra.slot_weekly", { day: weekday(calendar.weekdayOf(slot.date), "long") }),
  }))
}
