import { describe, expect, test } from 'bun:test';
import { dateTimeInZone, expandEvent, expandSchedule, exportIcs, nextScheduleOccurrence, parseIcs, splitEventSeries } from '../src/calendar.ts';
import { eventDataSchema, recordMutationSchema, scheduleSchema } from '../src/schema.ts';
describe('personal calendar', () => {
  test('wall time stays fixed across spring and autumn DST', () => {
    for (const date of ['2026-03-07', '2026-10-31']) {
      const first = dateTimeInZone(date, '09:00', 'America/New_York');
      const schedule = scheduleSchema.parse({ startAt: first, timeZone: 'America/New_York', frequency: 'daily', count: 3 });
      const occurrences = expandSchedule(schedule, first, first + 4 * 86400000);
      expect(occurrences).toHaveLength(3);
      expect(occurrences.map(at => new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone, hour: 'numeric' }).format(at))).toEqual(['9 AM', '9 AM', '9 AM']);
      expect(new Set(occurrences.slice(1).map((at, i) => at - occurrences[i]))).not.toEqual(new Set([86400000]));
      expect(nextScheduleOccurrence(schedule, first)).toBe(occurrences[1]);
    }
  });
  test('monthly skips absent days; leap day yearly skips absent years', () => {
    const monthly = scheduleSchema.parse({ startAt: Date.parse('2026-01-31T08:00Z'), timeZone: 'UTC', frequency: 'monthly', count: 3 });
    expect(expandSchedule(monthly, monthly.startAt, Date.parse('2027-01-01')).map(at => new Date(at).toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    const yearly = scheduleSchema.parse({ startAt: Date.parse('2024-02-29T08:00Z'), timeZone: 'UTC', frequency: 'yearly', count: 2 });
    expect(nextScheduleOccurrence(yearly, yearly.startAt)).toBe(Date.parse('2028-02-29T08:00Z'));
  });
  test('moving an exception into range retains original identity', () => {
    const start = Date.parse('2026-01-01T08:00Z'); const moved = Date.parse('2026-02-01T10:00Z');
    const event = eventDataSchema.parse({ title: '训练', startAt: start, endAt: start + 3600000, timeZone: 'UTC', recurrence: { frequency: 'daily', count: 3 }, exceptions: { '2026-01-02': { startAt: moved, endAt: moved + 3600000 } } });
    const result = expandEvent(event, moved - 1, moved + 86400000); expect(result).toHaveLength(1); expect(result[0].key).toBe('2026-01-02');
  });
  test('all day occupies calendar days across DST', () => {
    const start = dateTimeInZone('2026-03-07', '00:00', 'America/New_York'); const end = dateTimeInZone('2026-03-08', '00:00', 'America/New_York');
    const event = eventDataSchema.parse({ title: '全天', startAt: start, endAt: end, allDay: true, startDate: '2026-03-07', endDate: '2026-03-08', timeZone: 'America/New_York', recurrence: { frequency: 'daily', count: 3 } });
    const occurrences = expandEvent(event, start, start + 4 * 86400000); expect(occurrences[1].endAt - occurrences[1].startAt).toBe(23 * 3600000);
  });
  test('ICS round trips Chinese, alarms, exceptions and count', () => {
    const start = Date.parse('2026-10-20T08:00Z');
    const event = eventDataSchema.parse({ title: '训练，胸背; 一起', description: '第一行\n第二行', startAt: start, endAt: start + 3600000, timeZone: 'Asia/Shanghai', recurrence: { frequency: 'weekly', count: 8, weekdays: [2,4] }, exceptions: { '2026-10-22': { cancelled: true }, '2026-10-27': { startAt: start + 7 * 86400000 + 3600000, title: '晚一小时' } }, reminders: [10,60] });
    const parsed = parseIcs(exportIcs([{ id: 'sample', data: event }]))[0].data;
    expect(parsed.title).toBe(event.title); expect(parsed.description).toBe(event.description); expect(parsed.recurrence).toEqual(event.recurrence); expect(parsed.exceptions['2026-10-22']).toEqual(event.exceptions['2026-10-22']); expect(parsed.exceptions['2026-10-27']).toMatchObject(event.exceptions['2026-10-27']); expect(expandEvent(parsed,start,start+30*86400000)).toEqual(expandEvent(event,start,start+30*86400000).map(item=>({...item,data:parsed}))); expect(parsed.reminders).toEqual([10,60]);
  });
  test('series split preserves remaining count', () => {
    const start = Date.parse('2026-10-20T08:00Z'); const event = eventDataSchema.parse({ title: '计划', startAt: start, endAt: start + 3600000, timeZone: 'UTC', recurrence: { frequency: 'daily', count: 8 } });
    const split = splitEventSeries(event, start + 3 * 86400000, { title: '后续' });
    expect(expandEvent(split.previous, start, start + 20 * 86400000)).toHaveLength(3); expect(expandEvent(split.following, start, start + 20 * 86400000)).toHaveLength(5);
  });
  test('a recurring todo completes only the chosen occurrence and survives ICS export', () => {
    const start = Date.parse('2026-10-20T08:00Z');
    const event = eventDataSchema.parse({ title: '每日待办', category: 'todo', startAt: start, endAt: start + 3600000, timeZone: 'UTC', recurrence: { frequency: 'daily', count: 3 }, exceptions: { '2026-10-21': { status: 'completed' } } });
    const occurrences = expandEvent(event, start, start + 4 * 86400000);
    expect(occurrences.map(item => item.data.status)).toEqual(['planned', 'completed', 'planned']);
    expect(event.status).toBe('planned');
    const parsed = parseIcs(exportIcs([{ id: 'todo', data: event }]))[0].data;
    expect(parsed.exceptions['2026-10-21'].status).toBe('completed');
    expect(expandEvent(parsed, start, start + 4 * 86400000).map(item => item.data.status)).toEqual(['planned', 'completed', 'planned']);
  });
  test('strict mutations reject credentials and undeclared payload fields', () => {
    expect(recordMutationSchema.safeParse({ kind: 'settings', id: 'profile', baseVersion: 0, operationId: 'op', data: { timeZone: 'UTC', modelKey: 'not-a-real-key' } }).success).toBe(false);
  });
});
