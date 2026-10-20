import * as rrule from 'rrule';
import { addDays, dateKey, localDateOf, parseDateKey, zonedParts, zonedTimeToInstant } from '@openwork/calendar/time';
import { eventDataSchema, eventExceptionSchema, recurrenceSchema, scheduleSchema, type EventData, type Recurrence, type Schedule } from './schema.js';

const { RRule } = rrule;
const DAY = 86_400_000;
const frequencies = { daily: RRule.DAILY, weekly: RRule.WEEKLY, monthly: RRule.MONTHLY, yearly: RRule.YEARLY };
export function localDateKey(instant: number, timeZone: string) { return dateKey(localDateOf(instant, timeZone)); }
export function timeInZone(instant: number, timeZone: string) { const value = zonedParts(instant, timeZone); return `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`; }
export function dateTimeInZone(date: string, time: string, timeZone: string) {
  const day = parseDateKey(date); const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!day || !match) throw new Error('日期或时间无效。');
  return zonedTimeToInstant({ ...day, hour: Number(match[1]), minute: Number(match[2]) }, timeZone);
}
function floating(instant: number, timeZone: string) { const p = zonedParts(instant, timeZone); return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)); }
function absolute(date: Date, timeZone: string) { return zonedTimeToInstant({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() }, timeZone); }
function ruleFor(schedule: Schedule) {
  if (schedule.frequency === 'once') return null;
  return new RRule({ freq: frequencies[schedule.frequency], dtstart: floating(schedule.startAt, schedule.timeZone), interval: schedule.interval,
    ...(schedule.weekdays.length && schedule.frequency === 'weekly' ? { byweekday: schedule.weekdays.map(day => (day + 6) % 7) } : {}),
    ...(schedule.count ? { count: schedule.count } : {}), ...(schedule.until !== null ? { until: floating(schedule.until, schedule.timeZone) } : {}), wkst: RRule.MO }, true);
}
/** Iterate in wall time, then resolve instants with the shared DST policy. */
export function expandSchedule(input: Schedule, start: number, end: number, limit = 10000): number[] {
  const schedule = scheduleSchema.parse(input);
  if (end <= start || limit < 1) return [];
  const rule = ruleFor(schedule);
  if (!rule) return schedule.startAt >= start && schedule.startAt < end ? [schedule.startAt] : [];
  const values = rule.between(floating(start - DAY, schedule.timeZone), floating(end + DAY, schedule.timeZone), true, (_, index) => index < limit + 4);
  return [...new Set(values.map(value => absolute(value, schedule.timeZone)))].filter(at => at >= start && at < end && at >= schedule.startAt && (schedule.until === null || at <= schedule.until)).slice(0, limit);
}
export function nextScheduleOccurrence(input: Schedule, after: number): number | null {
  const schedule = scheduleSchema.parse(input); const rule = ruleFor(schedule);
  if (!rule) return schedule.startAt > after ? schedule.startAt : null;
  let cursor = floating(after - DAY, schedule.timeZone);
  for (let i = 0; i < 12; i++) {
    const candidate = rule.after(cursor, false); if (!candidate) return null;
    const at = absolute(candidate, schedule.timeZone);
    if (schedule.until !== null && at > schedule.until) return null;
    if (at > after && at >= schedule.startAt) return at;
    cursor = candidate;
  }
  return null;
}
export type EventOccurrence = { key: string; originalStartAt: number; startAt: number; endAt: number; title: string; data: EventData };
export function expandEvent(event: EventData, start: number, end: number): EventOccurrence[] {
  if (event.status === 'cancelled') return [];
  const duration = event.endAt - event.startAt;
  const starts = expandSchedule({ ...event.recurrence, startAt: event.startAt, timeZone: event.timeZone }, start - Math.max(duration, DAY), end);
  // A moved occurrence may originate outside this viewport.
  for (const [key, exception] of Object.entries(event.exceptions)) {
    if (exception.startAt !== undefined && exception.startAt < end && (exception.endAt ?? exception.startAt + duration) > start) {
      const original = dateTimeInZone(key, timeInZone(event.startAt, event.timeZone), event.timeZone);
      if (expandSchedule({ ...event.recurrence, startAt: event.startAt, timeZone: event.timeZone }, original, original + 1000).length && !starts.includes(original)) starts.push(original);
    }
  }
  return starts.flatMap(originalStartAt => {
    const key = localDateKey(originalStartAt, event.timeZone); const exception = event.exceptions[key];
    if (exception?.cancelled || exception?.status === 'cancelled') return [];
    const startAt = exception?.startAt ?? originalStartAt;
    let endAt = exception?.endAt ?? startAt + duration;
    if (event.allDay && !exception?.endAt) {
      const days = Math.max(1, Math.round((Date.parse((event.endDate ?? localDateKey(event.endAt, event.timeZone)) + 'T00:00Z') - Date.parse((event.startDate ?? localDateKey(event.startAt, event.timeZone)) + 'T00:00Z')) / DAY));
      endAt = zonedTimeToInstant(addDays(localDateOf(startAt, event.timeZone), days), event.timeZone);
    }
    if (endAt <= start || startAt >= end) return [];
    return [{ key, originalStartAt, startAt, endAt, title: exception?.title ?? event.title, data: exception?.status ? { ...event, status: exception.status } : event }];
  }).sort((a, b) => a.startAt - b.startAt);
}
/** Splits a series without duplicating its first half or losing COUNT semantics. */
export function splitEventSeries(event: EventData, at: number, change: Partial<EventData>): { previous: EventData; following: EventData } {
  const consumed = expandSchedule({ ...event.recurrence, startAt: event.startAt, timeZone: event.timeZone }, event.startAt, at).length;
  const key = localDateKey(at, event.timeZone);
  const following = eventDataSchema.parse({ ...event, ...change, startAt: change.startAt ?? at, endAt: change.endAt ?? at + event.endAt - event.startAt,
    recurrence: { ...event.recurrence, ...change.recurrence, count: event.recurrence.count === null ? null : Math.max(1, event.recurrence.count - consumed) },
    exceptions: Object.fromEntries(Object.entries(event.exceptions).filter(([date]) => date >= key)) });
  return { previous: eventDataSchema.parse({ ...event, recurrence: { ...event.recurrence, until: at - 1, count: null }, exceptions: Object.fromEntries(Object.entries(event.exceptions).filter(([date]) => date < key)) }), following };
}

function escapeText(text: string) { return text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,'); }
function unescapeText(text: string) { return text.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1'); }
function utc(at: number) { return new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function icsTime(name: string, at: number, event: EventData, explicitDate?: string): string {
  if (event.allDay) return name + ';VALUE=DATE:' + (explicitDate ?? localDateKey(at, event.timeZone)).replace(/-/g, '');
  return name + ';TZID=' + event.timeZone + ':' + floating(at, event.timeZone).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}
const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function recurrenceLine(value: Recurrence) {
  if (value.frequency === 'once') return [];
  return ['RRULE:FREQ=' + value.frequency.toUpperCase() + ';INTERVAL=' + value.interval + ';WKST=MO' + (value.count ? ';COUNT=' + value.count : '') + (value.until !== null ? ';UNTIL=' + utc(value.until) : '') + (value.frequency === 'weekly' && value.weekdays.length ? ';BYDAY=' + value.weekdays.map(day => dayNames[day]).join(',') : '')];
}
function fold(line: string): string {
  const result: string[] = []; let part = ''; let bytes = 0;
  for (const character of line) { const size = new TextEncoder().encode(character).length; if (bytes + size > 73) { result.push(part); part = ' '; bytes = 1; } part += character; bytes += size; }
  result.push(part); return result.join('\r\n');
}
export function exportIcs(events: readonly { id: string; data: EventData }[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Zeno//Personal Calendar//ZH-CN', 'CALSCALE:GREGORIAN'];
  for (const { id, data } of events) {
    const uid = escapeText(id) + '@zeno';
    const start = icsTime('DTSTART', data.startAt, data, data.startDate);
    const end = icsTime('DTEND', data.endAt, data, data.endDate);
    lines.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + utc(Date.now()), start, end, 'X-ZENO-TIMEZONE:' + data.timeZone, 'SUMMARY:' + escapeText(data.title), 'DESCRIPTION:' + escapeText(data.description), 'LOCATION:' + escapeText(data.location), ...recurrenceLine(data.recurrence), 'STATUS:' + (data.status === 'cancelled' ? 'CANCELLED' : data.status === 'completed' ? 'CONFIRMED' : 'TENTATIVE'), 'X-ZENO-STATUS:' + data.status, 'X-ZENO-CATEGORY:' + data.category);
    for (const minutes of data.reminders) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escapeText(data.title), 'TRIGGER:-PT' + minutes + 'M', 'END:VALARM');
    for (const [date, exception] of Object.entries(data.exceptions)) {
      if (exception.cancelled || exception.status === 'cancelled') lines.push(icsTime('EXDATE', dateTimeInZone(date, timeInZone(data.startAt, data.timeZone), data.timeZone), data, date));
    }
    lines.push('END:VEVENT');
    for (const [date, exception] of Object.entries(data.exceptions)) {
      if (exception.cancelled || exception.status === 'cancelled') continue;
      const original = dateTimeInZone(date, timeInZone(data.startAt, data.timeZone), data.timeZone); const moved = exception.startAt ?? original;
      lines.push('BEGIN:VEVENT', 'UID:' + uid, icsTime('RECURRENCE-ID', original, data, date), icsTime('DTSTART', moved, data), icsTime('DTEND', exception.endAt ?? moved + data.endAt - data.startAt, data), 'SUMMARY:' + escapeText(exception.title ?? data.title), ...(exception.status ? ['X-ZENO-STATUS:' + exception.status] : []), 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n';
}
type IcsProperty = { name: string; params: Record<string, string>; value: string };
type IcsItem = { props: IcsProperty[]; alarms: number[] };
function parseIcsTime(prop: IcsProperty, defaultZone: string): { at: number; zone: string; date?: string } {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(prop.value);
  if (!match) throw new Error('不支持的 ICS 时间：' + prop.name);
  const zone = match[7] ? 'UTC' : prop.params.TZID ?? defaultZone;
  const wall = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4] ?? 0), minute: Number(match[5] ?? 0), second: Number(match[6] ?? 0) };
  if (!parseDateKey(`${match[1]}-${match[2]}-${match[3]}`) || wall.hour > 23 || wall.minute > 59 || wall.second > 59) throw new Error('ICS 日期无效。');
  return { at: zonedTimeToInstant(wall, zone), zone, ...(!match[4] ? { date: `${match[1]}-${match[2]}-${match[3]}` } : {}) };
}
export function parseIcs(source: string, defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone): { id: string; data: EventData }[] {
  if (source.length > 8_000_000) throw new Error('日历文件过大。');
  if (!source.includes('BEGIN:VCALENDAR') || !source.includes('END:VCALENDAR')) throw new Error('请选择有效的 ICS 日历文件。');
  const items: IcsItem[] = []; let current: IcsItem | null = null; let alarm = false;
  for (const line of source.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { current = { props: [], alarms: [] }; continue; }
    if (line === 'END:VEVENT') { if (current) items.push(current); current = null; if (items.length > 10000) throw new Error('日程超过 10,000 项。'); continue; }
    if (!current) continue;
    if (line === 'BEGIN:VALARM') { alarm = true; continue; } if (line === 'END:VALARM') { alarm = false; continue; }
    const colon = line.indexOf(':'); if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(';'); const value = line.slice(colon + 1);
    if (alarm) { const minutes = /^-PT(\d+)M$/.exec(value); if (name === 'TRIGGER' && minutes) current.alarms.push(Number(minutes[1])); continue; }
    current.props.push({ name: name.toUpperCase(), params: Object.fromEntries(params.map(param => { const index = param.indexOf('='); return [param.slice(0, index).toUpperCase(), param.slice(index + 1).replace(/^"|"$/g, '')]; })), value });
  }
  const result = new Map<string, { id: string; data: EventData }>();
  const property = (item: IcsItem, name: string) => item.props.find(prop => prop.name === name);
  for (const item of items.filter(value => !property(value, 'RECURRENCE-ID'))) {
    const first = property(item, 'DTSTART'); if (!first) throw new Error('日程缺少 DTSTART。');
    const zone = property(item, 'X-ZENO-TIMEZONE')?.value ?? first.params.TZID ?? defaultZone;
    const start = parseIcsTime(first, zone); const last = property(item, 'DTEND');
    const finish = last ? parseIcsTime(last, zone) : { at: start.at + (start.date ? DAY : 3_600_000), date: start.date ? dateKey(addDays(localDateOf(start.at, zone), 1)) : undefined };
    const rawRule = property(item, 'RRULE')?.value; let recurrence = recurrenceSchema.parse({});
    if (rawRule) {
      const parts: Record<string, string> = Object.fromEntries(rawRule.split(';').map(part => part.split('=')));
      if (Object.keys(parts).some(key => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'].includes(key)) || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ) || (parts.BYDAY && (parts.FREQ !== 'WEEKLY' || parts.BYDAY.split(',').some(day => !dayNames.includes(day))))) throw new Error('此文件包含首版不支持的重复规则，请先在来源日历中展开导出。');
      recurrence = recurrenceSchema.parse({ frequency: parts.FREQ.toLowerCase(), interval: Number(parts.INTERVAL ?? 1), count: parts.COUNT ? Number(parts.COUNT) : null, until: parts.UNTIL ? parseIcsTime({ name: 'UNTIL', params: {}, value: parts.UNTIL }, zone).at : null, weekdays: parts.BYDAY ? parts.BYDAY.split(',').map(day => dayNames.indexOf(day)) : [] });
    }
    const data = eventDataSchema.parse({ title: unescapeText(property(item, 'SUMMARY')?.value ?? '未命名日程'), description: unescapeText(property(item, 'DESCRIPTION')?.value ?? ''), location: unescapeText(property(item, 'LOCATION')?.value ?? ''), startAt: start.at, endAt: finish.at, timeZone: zone, allDay: !!start.date, startDate: start.date, endDate: finish.date, recurrence, reminders: item.alarms, status: property(item, 'STATUS')?.value === 'CANCELLED' ? 'cancelled' : property(item, 'X-ZENO-STATUS')?.value ?? 'planned', category: property(item, 'X-ZENO-CATEGORY')?.value ?? 'plan' });
    for (const prop of item.props.filter(prop => prop.name === 'EXDATE')) for (const value of prop.value.split(',')) data.exceptions[localDateKey(parseIcsTime({ ...prop, value }, zone).at, zone)] = { cancelled: true };
    const uid = property(item, 'UID')?.value ?? crypto.randomUUID(); result.set(uid, { id: crypto.randomUUID(), data });
  }
  for (const item of items.filter(value => property(value, 'RECURRENCE-ID'))) {
    const parent = result.get(property(item, 'UID')?.value ?? ''); const identity = property(item, 'RECURRENCE-ID');
    if (!parent || !identity) throw new Error('重复例外缺少原始系列。');
    const original = parseIcsTime(identity, parent.data.timeZone).at; const first = property(item, 'DTSTART'); const last = property(item, 'DTEND');
    parent.data.exceptions[localDateKey(original, parent.data.timeZone)] = eventExceptionSchema.parse({ cancelled: property(item, 'STATUS')?.value === 'CANCELLED', ...(first ? { startAt: parseIcsTime(first, parent.data.timeZone).at } : {}), ...(last ? { endAt: parseIcsTime(last, parent.data.timeZone).at } : {}), ...(property(item, 'SUMMARY') ? { title: unescapeText(property(item, 'SUMMARY')?.value ?? '') } : {}), ...(property(item, 'X-ZENO-STATUS') ? { status: property(item, 'X-ZENO-STATUS')?.value } : {}) });
  }
  return [...result.values()];
}
