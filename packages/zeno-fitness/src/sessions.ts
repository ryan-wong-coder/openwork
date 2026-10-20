import { dateTimeInZone, localDateKey } from "@zeno/core/calendar";
import { workoutDataSchema, routineDataSchema, fitnessDayNoteSchema } from "@zeno/core/schema";
import { swapActiveExercise } from "../upstream/lib/active-exercise-swap.js";
import { moveActiveWorkoutUnit } from "../upstream/lib/active-workout-order.js";
import { repeatSessionEntries } from "../upstream/lib/session-repeat.js";
import { buildCombinedEntries } from "../upstream/lib/session-merge.js";
import { routineFromSession } from "../upstream/lib/session-routines.js";
import { historyAsOf } from "../upstream/lib/backfill.js";
import { withDayNote, dayNoteOf } from "../upstream/lib/day-notes.js";
import { rowLoad, inventoryFor, baseWeightFor, loadKindFor } from "../upstream/lib/plates.js";
import { findExercise } from "./catalogue.js";
import { bodyWeightAt, convertRoutineUnit, convertWorkoutUnit, startTrainingWorkout, finishTrainingWorkout, type StartTrainingOptions } from "./training.js";
import { defaultProgression, fromUpstreamExercise, fromUpstreamRoutine, toUpstreamExercise, toUpstreamRoutine, toUpstreamState, toUpstreamWorkout, withExerciseSnapshot } from "./upstream-adapter.js";
import { finite, list, record, text } from "./value.js";
import type { FitnessContextOptions, FitnessDayNote, FitnessDayNotes, FitnessUnit, IdentifiedWorkout, RoutineExercise, TrainingRoutine, TrainingWorkout } from "./types.js";

export interface IdentifiedRoutine { id: string; data: TrainingRoutine }
function preserveAdvancedSets(built: RoutineExercise, source: RoutineExercise | undefined): RoutineExercise {
  if (!source) return built; let warm = 0, work = 0;
  const warmups = source.sets.filter(set => set.kind === "warmup"), working = source.sets.filter(set => set.kind !== "warmup");
  return { ...built, notes: source.notes, ...(source.bodyweight != null ? { bodyweight: source.bodyweight } : {}), ...(source.dbLoad ? { dbLoad: source.dbLoad } : {}), ...(source.loadKind ? { loadKind: source.loadKind } : {}), sets: built.sets.map(set => {
    const values = set.kind === "warmup" ? warmups : working; const index = set.kind === "warmup" ? warm++ : work++; const original = values[index] ?? values.at(-1);
    return original ? { ...set, kind: original.kind, drops: original.drops, restPause: original.restPause, failure: original.failure, rpe: original.rpe, rir: original.rir, restSeconds: original.restSeconds, inclinePercent: original.inclinePercent } : set;
  }) };
}
export function startCombinedTrainingWorkout(routines: readonly IdentifiedRoutine[], options: Omit<StartTrainingOptions, "routineId"> & { unit?: FitnessUnit; title?: string } = {}): TrainingWorkout {
  const unique = [...new Map(routines.map(routine => [routine.id, routine])).values()]; const unit = options.unit ?? unique[0]?.data.unit ?? "kg";
  const now = options.now ?? Date.now(); const bodyWeightKg = bodyWeightAt(options.measurements ?? [], now);
  const converted = unique.map(routine => ({ ...routine, data: convertRoutineUnit(routine.data, unit) }));
  const state = { ...toUpstreamState((options.workouts ?? []).map(workout => convertWorkoutUnit(workout, unit)), unit, options.measurements, options), routines: converted.map(routine => toUpstreamRoutine({ ...routine.data, exercises: routine.data.exercises.map(exercise => withExerciseSnapshot(exercise, options.customExercises)) }, routine.id)) };
  const built: unknown = buildCombinedEntries(state, converted.map(routine => routine.id)); const result = record(built);
  const started = new Map(converted.map(routine => [routine.id, startTrainingWorkout(routine.data, { ...options, now, routineId: routine.id }).exercises])); const positions = new Map<string, number>();
  const exercises = list(result.entries).map((raw, index) => { const entry = fromUpstreamExercise(raw, index); const owner = entry.routineId ?? ""; const position = positions.get(owner) ?? 0; positions.set(owner, position + 1); const original = started.get(owner)?.[position]; return original ? { ...original, id: `combined-${index}-${original.id}`, routineId: owner } : entry; });
  return workoutDataSchema.parse({ title: options.title ?? (converted.map(routine => routine.data.title).join(" + ") || "自由训练"), unit, startedAt: now, finishedAt: null, notes: "", exercises, restEndsAt: null, routineIds: converted.map(routine => routine.id), ...(bodyWeightKg != null ? { bodyWeightKg } : {}), ...(options.eventId ? { eventId: options.eventId } : {}), ...(options.deviceId ? { deviceId: options.deviceId } : {}) });
}
export function repeatTrainingWorkout(source: TrainingWorkout, options: StartTrainingOptions = {}): { workout: TrainingWorkout; skipped: number } {
  const now = options.now ?? Date.now(); const bodyWeightKg = bodyWeightAt(options.measurements ?? [], now);
  const state = toUpstreamState(options.workouts ?? [], source.unit, options.measurements, options);
  const exists = (id: string) => Boolean(findExercise(id) || options.customExercises?.some(exercise => exercise.id === id));
  const built: unknown = repeatSessionEntries(state, toUpstreamWorkout(source), { exists }); const result = record(built);
  const originals = source.exercises.filter(exercise => exists(exercise.exerciseId));
  const workout = workoutDataSchema.parse({ title: source.title, unit: source.unit, startedAt: now, finishedAt: null, notes: "", restEndsAt: null, ...(bodyWeightKg != null ? { bodyWeightKg } : {}),
    exercises: list(result.entries).map((entry, index) => { const converted = preserveAdvancedSets(fromUpstreamExercise(entry, index), originals[index]); return { ...withExerciseSnapshot(converted, options.customExercises), sets: converted.sets.map(set => ({ ...set, completed: false, completedAt: null })) }; }), ...(options.deviceId ? { deviceId: options.deviceId } : {}) });
  return { workout, skipped: finite(result.skipped) };
}
export function routineFromWorkout(workout: TrainingWorkout, options: { title?: string; routines?: readonly IdentifiedRoutine[] } = {}): TrainingRoutine {
  const built: unknown = routineFromSession(toUpstreamWorkout(workout), options.title ?? workout.title, (options.routines ?? []).map(routine => toUpstreamRoutine(routine.data, routine.id)));
  const copied = fromUpstreamRoutine(built, workout.unit);
  return routineDataSchema.parse({ ...copied, exercises: copied.exercises.map((entry, index) => preserveAdvancedSets(entry, workout.exercises.filter(exercise => exercise.sets.length)[index])) });
}
export interface BackfillOptions extends StartTrainingOptions { day: string; time?: string; durationMinutes: number; timeZone: string; replaceId?: string }
export function startBackfillWorkout(routine: TrainingRoutine, options: BackfillOptions): TrainingWorkout {
  const time = options.time ?? "18:00"; const start = dateTimeInZone(options.day, time, options.timeZone);
  const state = toUpstreamState(options.workouts ?? [], routine.unit, options.measurements, options);
  const before: unknown = historyAsOf(state, { d: options.day, start, replaceId: options.replaceId, strict: true });
  const ids = new Set(list(record(before).workouts).map(workout => text(record(workout).id)));
  const workout = startTrainingWorkout(routine, { ...options, now: start, workouts: (options.workouts ?? []).filter(workout => ids.has(workout.id)) });
  return workoutDataSchema.parse({ ...workout, backfill: { day: options.day, time, timeZone: options.timeZone, durationMinutes: options.durationMinutes, ...(options.replaceId ? { replaceId: options.replaceId } : {}) } });
}
export function markWorkoutSetsComplete(workout: TrainingWorkout, at = Date.now()): TrainingWorkout { return { ...workout, exercises: workout.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map(set => ({ ...set, completed: true, completedAt: at })) })) }; }
/** Produces the replacement value; the application still performs an optimistic/versioned write. */
export function finishBackfillWorkout(workout: TrainingWorkout, replaced?: TrainingWorkout): TrainingWorkout {
  if (!workout.backfill) throw new Error("这不是补录训练");
  const completed = finishTrainingWorkout(workout);
  return workoutDataSchema.parse({ ...completed, notes: replaced?.notes && !completed.notes.includes(replaced.notes) ? [replaced.notes, completed.notes].filter(Boolean).join("\n") : completed.notes, mediaIds: [...new Set([...(completed.mediaIds ?? []), ...(replaced?.mediaIds ?? [])])].slice(0, 6) });
}
export function setWorkoutProgressionExcluded(workout: TrainingWorkout, excluded: boolean, exerciseEntryId?: string): TrainingWorkout {
  return { ...workout, ...(exerciseEntryId ? {} : { noProg: excluded }), exercises: workout.exercises.map(exercise => !exerciseEntryId || exercise.id === exerciseEntryId ? { ...exercise, noProg: excluded } : exercise) };
}
export function updateFitnessDayNote(notes: FitnessDayNotes, day: string, note: Omit<FitnessDayNote, "at"> | null, options: { now?: number; timeZone?: string } = {}): FitnessDayNotes {
  const now = options.now ?? Date.now(); const zone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (day > localDateKey(now, zone)) throw new Error("只能记录今天或之前的休息说明"); dateTimeInZone(day, "12:00", zone);
  const parsed = fitnessDayNoteSchema.parse({ ...(note ?? { text: "" }), at: now });
  const legacy = Object.fromEntries(Object.entries(notes).map(([key, value]) => [key, { ...value, _ts: value.at }]));
  const updated: unknown = withDayNote(legacy, day, parsed, now);
  return Object.fromEntries(Object.entries(record(updated)).map(([key, value]) => { const entry = record(value); const normalized = record(dayNoteOf({ dayNotes: { [key]: entry } }, key)); return [key, fitnessDayNoteSchema.parse({ ...(normalized.tag ? { tag: normalized.tag } : {}), text: text(normalized.text), at: finite(entry._ts, now) })]; }));
}
export function fitnessDayExcused(notes: FitnessDayNotes, day: string): boolean { return Boolean(notes[day]?.tag || notes[day]?.text.trim()); }
export function exercisePlateLoad(exercise: RoutineExercise, weight: number, unit: FitnessUnit, options: FitnessContextOptions = {}): { kind: string; baseWeight: number; plates: number[]; missing: number; perSide: number; barOnly: boolean } {
  const initial = toUpstreamState([], unit, [], options); const state = { ...initial, loadKind: { ...initial.loadKind, ...(exercise.loadKind ? { [exercise.exerciseId]: exercise.loadKind } : {}) } }; const cfg = toUpstreamExercise(exercise, defaultProgression);
  const kind: unknown = loadKindFor(state, cfg); const base: unknown = options.equipment?.barWeights?.[unit]?.[exercise.exerciseId] ?? baseWeightFor(state, exercise.exerciseId);
  const result: unknown = rowLoad(kind, weight, base, inventoryFor(state)); const value = record(result);
  return { kind: text(kind), baseWeight: finite(base), plates: list(value.plates).filter((item): item is number => typeof item === "number"), missing: finite(value.missing) * (kind === "pairs" ? 2 : 1), perSide: finite(value.perSide), barOnly: value.barOnly === true };
}

export interface SwapTrainingExerciseOptions { loggedConfirmed?: boolean; groupDisposition?: "keep" | "detach" }
export interface SwapTrainingExerciseResult { workout: TrainingWorkout; changed: boolean; needsConfirmation: boolean; grouped: boolean; inserted: boolean }
function legacyActive(workout: TrainingWorkout): { entries: Record<string, unknown>[]; cur: number } {
  const source = toUpstreamWorkout(workout);
  return { entries: list(source.entries).map((entry, index) => ({ ...record(entry), zenoEntryId: workout.exercises[index].id })), cur: 0 };
}
/** Source swap rules never relabel logged results. Group membership needs an explicit choice. */
export function swapTrainingExercise(workout: TrainingWorkout, id: string, replacement: RoutineExercise, options: SwapTrainingExerciseOptions = {}): SwapTrainingExerciseResult {
  const index = workout.exercises.findIndex(entry => entry.id === id), grouped = Boolean(workout.exercises[index]?.groupId);
  const unchanged = { workout, changed: false, needsConfirmation: false, grouped, inserted: false };
  if (index < 0) return unchanged;
  if (workout.exercises.some(entry => entry.id === replacement.id)) throw new Error("替换动作需要新的记录编号");
  const fresh = { ...replacement, groupId: undefined, routineId: undefined, sets: replacement.sets.map(set => ({ ...set, completed: false, completedAt: null })) };
  const active = legacyActive(workout), replacementRow = legacyActive({ ...workout, exercises: [fresh] }).entries[0];
  const raw: unknown = swapActiveExercise(active, index, replacementRow, options); const result = record(raw);
  if (result.needsConfirmation === true) return { ...unchanged, needsConfirmation: true };
  if (!raw) return unchanged;
  const own = new Map([...workout.exercises, fresh].map(entry => [entry.id, entry]));
  const exercises = active.entries.map(row => {
    const entry = own.get(text(row.zenoEntryId)); if (!entry) throw new Error("替换动作映射失败");
    return { ...entry, groupId: typeof row.sg === "string" ? row.sg : undefined, routineId: typeof row.rid === "string" ? row.rid : entry.routineId };
  });
  return { workout: workoutDataSchema.parse({ ...workout, exercises }), changed: true, needsConfirmation: false, grouped, inserted: result.inserted === true };
}
/** Reorder an entire contiguous supergroup, keeping its membership and recorded sets together. */
export function moveTrainingExercise(workout: TrainingWorkout, id: string, direction: -1 | 1): TrainingWorkout {
  const index = workout.exercises.findIndex(entry => entry.id === id); if (index < 0) return workout;
  const active = legacyActive(workout); const changed: unknown = moveActiveWorkoutUnit(active, index, direction); if (!changed) return workout;
  const own = new Map(workout.exercises.map(entry => [entry.id, entry]));
  return { ...workout, exercises: active.entries.map(row => { const entry = own.get(text(row.zenoEntryId)); if (!entry) throw new Error("动作排序映射失败"); return entry; }) };
}
export function removeUnfinishedTrainingExercise(workout: TrainingWorkout, id: string): TrainingWorkout {
  return { ...workout, exercises: workout.exercises.flatMap(entry => { if (entry.id !== id) return [entry]; const completed = entry.sets.filter(set => set.completed); return completed.length ? [{ ...entry, sets: completed }] : []; }) };
}
