import { addDays, dateKey, localDateOf, parseDateKey } from "@openwork/calendar";
import { dateTimeInZone, eventDataSchema, localDateKey, timeInZone, type EventData, type EventOccurrence } from "@zeno/core";

function dayDistance(from: string, to: string) { return Math.round((Date.parse(to + "T12:00Z") - Date.parse(from + "T12:00Z")) / 86400000); }
export function rescheduleCalendarEvent(event: EventData, startAt: number, endAt: number): EventData {
  if (!event.allDay) return eventDataSchema.parse({ ...event, startAt, endAt });
  const days = Math.max(1, dayDistance(event.startDate ?? localDateKey(event.startAt, event.timeZone), event.endDate ?? localDateKey(event.endAt, event.timeZone)));
  const startDate = localDateKey(startAt, event.timeZone), parsed = parseDateKey(startDate); if (!parsed) throw new Error("日期格式不正确。");
  const endDate = dateKey(addDays(parsed, days));
  return eventDataSchema.parse({ ...event, startDate, endDate, startAt: dateTimeInZone(startDate, "00:00", event.timeZone), endAt: dateTimeInZone(endDate, "00:00", event.timeZone) });
}

/** Whole-series edits move the wall date/time; a 23/25-hour DST day is still one day. */
export function updateEntireEventSeries(event: EventData, occurrence: EventOccurrence, change: EventData): EventData {
  const days = dayDistance(localDateKey(occurrence.originalStartAt, event.timeZone), localDateKey(change.startAt, change.timeZone));
  const baseDate = dateKey(addDays(localDateOf(event.startAt, event.timeZone), days));
  const startAt = dateTimeInZone(baseDate, change.allDay ? "00:00" : timeInZone(change.startAt, change.timeZone), change.timeZone);
  const weekdays = JSON.stringify(change.recurrence.weekdays) === JSON.stringify(event.recurrence.weekdays) && days ? change.recurrence.weekdays.map(day => ((day + days) % 7 + 7) % 7) : change.recurrence.weekdays;
  const exceptions = Object.fromEntries(Object.entries(event.exceptions).map(([key, value]) => { const date = parseDateKey(key); return [days && date ? dateKey(addDays(date, days)) : key, value]; }));
  let result = eventDataSchema.parse({ ...change, startAt, endAt: startAt + change.endAt - change.startAt, recurrence: { ...change.recurrence, weekdays }, exceptions });
  if (change.allDay) {
    const duration = Math.max(1, dayDistance(change.startDate ?? localDateKey(change.startAt, change.timeZone), change.endDate ?? localDateKey(change.endAt, change.timeZone)));
    const parsed = parseDateKey(baseDate); if (!parsed) throw new Error("日期格式不正确。");
    const endDate = dateKey(addDays(parsed, duration));
    result = eventDataSchema.parse({ ...result, startDate: baseDate, endDate, endAt: dateTimeInZone(endDate, "00:00", change.timeZone) });
  }
  return result;
}
