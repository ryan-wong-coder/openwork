import { addDays, dateKey, localDateOf, startOfDay, weekdayOf } from '@openwork/calendar/time';
import { dateTimeInZone, expandSchedule, localDateKey } from './calendar.js';
import { eventDataSchema, type EventData, type KindRecord, type RunData } from './schema.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export function trainingOccurrenceId(scheduleId: string, day: string) { return 'training:' + bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([scheduleId, day])))); }
export type TrainingCalendarEntry = { id: string; data: EventData; scheduleId: string; day: string; virtual: boolean; workoutId?: string };
/** Deterministic plan projection; moving it creates an event override with this same id. */
export function projectTrainingSchedule(schedule: KindRecord<'trainingSchedule'>, routines: readonly KindRecord<'routine'>[], start: number, end: number, options: { overrides?: readonly KindRecord<'event'>[]; workouts?: readonly KindRecord<'workout'>[] } = {}): TrainingCalendarEntry[] {
  if (schedule.deletedAt || !schedule.data.enabled) return [];
  const plan = schedule.data; const first = localDateOf(start, plan.timeZone);
  const anchor = plan.anchorDate ?? localDateKey(schedule.createdAt, plan.timeZone);
  const anchorDay = localDateOf(dateTimeInZone(anchor, '00:00', plan.timeZone), plan.timeZone);
  const rows: TrainingCalendarEntry[] = []; const overridden = new Set((options.overrides ?? []).map(value => value.id));
  let rotationOffset = 0;
  // Rotation positions advance on planned non-rest days from an explicit anchor.
  // The anchor and position move together only after an actual completed workout.
  let countDay = anchorDay;
  while (dateKey(countDay) < dateKey(first)) { if (!plan.restDays.includes(weekdayOf(countDay))) rotationOffset++; countDay = addDays(countDay, 1); if (rotationOffset > 366000) throw new Error('训练计划的起始日期过早。'); }
  for (let offset = 0; offset < 370; offset++) {
    const day = addDays(first, offset), dayString = dateKey(day);
    if (startOfDay(day, plan.timeZone) >= end) break;
    if (dayString < anchor || plan.restDays.includes(weekdayOf(day))) continue;
    const routineId = plan.mode === 'weekly' ? plan.week[String(weekdayOf(day))] : plan.rotation[(plan.position + rotationOffset++) % plan.rotation.length];
    if (!routineId || routineId === 'rest') continue;
    const routine = routines.find(value => value.id === routineId && !value.deletedAt); if (!routine) continue;
    const id = trainingOccurrenceId(schedule.id, dayString); if (overridden.has(id)) continue;
    const workout = options.workouts?.find(value => value.data.eventId === id && value.data.finishedAt !== null && !value.deletedAt);
    const startAt = workout?.data.startedAt ?? dateTimeInZone(dayString, plan.time, plan.timeZone);
    const endAt = workout?.data.finishedAt ?? startAt + plan.durationMinutes * 60000;
    rows.push({ id, scheduleId: schedule.id, day: dayString, virtual: true, ...(workout ? { workoutId: workout.id } : {}), data: eventDataSchema.parse({
      title: workout?.data.title ?? routine.data.title, startAt, endAt, timeZone: plan.timeZone, category: 'training',
      linkedId: routineId, trainingScheduleId: schedule.id, occurrenceDate: dayString, status: workout ? 'completed' : 'planned',
    }) });
  }
  return rows;
}
export type TaskCalendarEntry = { id: string; taskId: string; startAt: number; endAt: number; title: string; status: RunData['status'] | 'planned'; runId?: string };
export function projectTaskSchedule(task: KindRecord<'task'>, runs: readonly KindRecord<'run'>[], start: number, end: number): TaskCalendarEntry[] {
  if (task.deletedAt || !task.data.enabled) return [];
  return expandSchedule(task.data.schedule, start, end).map(at => {
    const run = runs.find(value => value.data.taskId === task.id && value.data.scheduledAt === at && !value.deletedAt);
    return { id: ('task:' + task.id + ':' + at).slice(-128), taskId: task.id, startAt: at, endAt: at + task.data.timeoutMinutes * 60000, title: task.data.title, status: run?.data.status ?? 'planned', ...(run ? { runId: run.id } : {}) };
  });
}
