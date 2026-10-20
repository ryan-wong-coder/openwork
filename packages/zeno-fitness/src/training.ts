import { nextPrescription, snapWeight, deloadTo } from "../upstream/lib/progression.js";
import { estimate1RM as upstreamEstimate1RM, best1RM } from "../upstream/lib/onerm.js";
import { workoutVolume, workSetsDone } from "../upstream/lib/history.js";
import { loadOfWorkouts } from "../upstream/lib/muscles.js";
import { fatigueOf, strengthOf } from "../upstream/lib/recovery.js";
import { buildSessionEntries } from "../upstream/lib/session-start.js";
import { sessionEnd } from "../upstream/lib/finish-workout.js";
import type { BodyMeasurement, FitnessContextOptions, FitnessExercise, FitnessUnit, IdentifiedWorkout, ProgressionConfig, RoutineExercise, TrainingRoutine, TrainingSchedule, TrainingSet, TrainingWorkout } from "./types.js";
import { findExercise, muscleLabels } from "./catalogue.js";
import { defaultProgression, fromUpstreamExercise, toUpstreamExercise, toUpstreamRoutine, toUpstreamState, toUpstreamWorkout, withExerciseSnapshot } from "./upstream-adapter.js";
import { finite, kgOf, list, numberMap, record, text, weightOf } from "./value.js";

export type OneRmFormula = "epley" | "brzycki" | "lombardi" | "oconner" | "mayhew" | "wathan" | "lander" | "weighted";
export function estimate1RM(weight: number, reps: number, formula: OneRmFormula = "epley", rir: number | null = null): number | null {
  const result: unknown = upstreamEstimate1RM(weight, reps, formula, rir);
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}
export interface NextPrescription { kind: string; policy: string; weight?: number; reps?: number; sets?: number; durationSeconds?: number; rowReps: number[]; reason: string; sourceReason: unknown[] }
export interface PrescriptionInput extends FitnessContextOptions { routine: TrainingRoutine; routineId?: string; exercise: RoutineExercise; workouts: readonly IdentifiedWorkout[]; measurements?: readonly BodyMeasurement[] }
export function calculateNextPrescription(input: PrescriptionInput): NextPrescription {
  if (input.routine.noProg) return { kind: "off", policy: "none", rowReps: [], reason: "此训练不计入进阶", sourceReason: [] };
  const state = toUpstreamState(input.workouts.map(workout => convertWorkoutUnit(workout, input.routine.unit)), input.routine.unit, input.measurements, input);
  const result: unknown = nextPrescription(state, toUpstreamExercise(input.exercise, input.routine.progression), toUpstreamRoutine(input.routine, input.routineId));
  const value = record(result);
  const kind = text(value.kind, "hold");
  const reasons: Record<string, string> = { off: "按计划训练", first: "先完成一次训练，建立基准", up: "已达成目标，增加训练量", hold: "保持目标，继续积累", deload: "适当减量，再逐步提高" };
  return { kind, policy: text(value.policy), ...(typeof value.weight === "number" ? { weight: value.weight } : {}), ...(typeof value.reps === "number" ? { reps: value.reps } : {}), ...(typeof value.sets === "number" ? { sets: value.sets } : {}), ...(typeof value.sec === "number" ? { durationSeconds: value.sec } : {}), rowReps: list(value.rowReps).filter((entry): entry is number => typeof entry === "number"), reason: reasons[kind] ?? "按计划训练", sourceReason: list(value.why) };
}
/** A running session is a separate device-owned record; this function never mutates history. */
export interface StartTrainingOptions extends FitnessContextOptions { routineId?: string; eventId?: string; deviceId?: string; now?: number; workouts?: readonly IdentifiedWorkout[]; measurements?: readonly BodyMeasurement[]; customExercises?: readonly FitnessExercise[]; schedule?: TrainingSchedule }
export function bodyWeightAt(measurements: readonly BodyMeasurement[], at: number): number | undefined { return measurements.filter(measurement => measurement.at <= at && measurement.weightKg != null).sort((a, b) => b.at - a.at)[0]?.weightKg; }
export function scheduledDeload(schedule: TrainingSchedule, at: number, fallbackAnchor?: string): { active: boolean; percent: number; week: number } {
  const anchor = schedule.deloadAnchorDate ?? fallbackAnchor ?? schedule.anchorDate;
  if (!anchor || !schedule.enabled || schedule.deloadEveryWeeks < 1) return { active: false, percent: schedule.deloadPercent, week: 0 };
  const date = dateInZone(at, dayFormatter(schedule.timeZone)); const week = Math.floor((Date.parse(date + "T12:00Z") - Date.parse(anchor + "T12:00Z")) / (7 * 86400000));
  return { active: week >= 0 && (week + 1) % schedule.deloadEveryWeeks === 0, percent: schedule.deloadPercent, week: week + 1 };
}
export function applyScheduledDeload(routine: TrainingRoutine, schedule: TrainingSchedule, at: number, fallbackAnchor?: string): TrainingRoutine {
  const phase = scheduledDeload(schedule, at, fallbackAnchor); if (!phase.active) return routine;
  const factor = 1 - phase.percent / 100;
  return { ...routine, noProg: true, exercises: routine.exercises.map(exercise => ({ ...exercise, noProg: true, sets: exercise.sets.map(set => ({ ...set, ...(set.weight != null ? { weight: set.weight * factor } : {}), ...(set.drops ? { drops: set.drops.map(drop => ({ ...drop, weight: drop.weight * factor })) } : {}) })), ...(exercise.pyramid ? { pyramid: { ...exercise.pyramid, weights: exercise.pyramid.weights.map(weight => weight * factor) } } : {}) })) };
}
export function startTrainingWorkout(inputRoutine: TrainingRoutine, options: StartTrainingOptions = {}): TrainingWorkout {
  const now = options.now ?? Date.now();
  const earliest = (options.workouts ?? []).filter(workout => !options.routineId || workout.routineId === options.routineId || workout.routineIds?.includes(options.routineId)).sort((a, b) => a.startedAt - b.startedAt)[0];
  const routine = options.schedule ? applyScheduledDeload(inputRoutine, options.schedule, now, earliest ? dateInZone(earliest.startedAt, dayFormatter(options.schedule.timeZone)) : undefined) : inputRoutine;
  const baseState = toUpstreamState((options.workouts ?? []).map(workout => convertWorkoutUnit(workout, routine.unit)), routine.unit, options.measurements, options);
  const state = { ...baseState, loadKind: { ...baseState.loadKind, ...Object.fromEntries(routine.exercises.flatMap(exercise => exercise.loadKind ? [[exercise.exerciseId, exercise.loadKind]] : [])) } };
  const snapshotRoutine = { ...routine, exercises: routine.exercises.map(exercise => withExerciseSnapshot(exercise, options.customExercises)) };
  const entries: unknown = buildSessionEntries(state, toUpstreamRoutine(snapshotRoutine, options.routineId));
  const bodyWeightKg = bodyWeightAt(options.measurements ?? [], now);
  return { title: routine.title, unit: routine.unit, startedAt: now, finishedAt: null, notes: "", restEndsAt: null,
    ...(bodyWeightKg != null ? { bodyWeightKg } : {}),
    ...(options.routineId ? { routineId: options.routineId } : {}), ...(options.eventId ? { eventId: options.eventId } : {}), ...(options.deviceId ? { deviceId: options.deviceId } : {}),
    exercises: list(entries).map((entry, index) => {
      const built = fromUpstreamExercise(entry, index); const original = snapshotRoutine.exercises[index];
      if (!original) return built;
      const reset = (set: TrainingSet): TrainingSet => ({ ...set, completed: false, completedAt: null });
      const workTemplates = original.sets.filter(set => set.kind !== "warmup");
      const work = built.sets.filter(set => set.kind !== "warmup").map((set, setIndex) => {
        const template = workTemplates[setIndex] ?? workTemplates.at(-1);
        const weight = original.backoffPercent != null && set.weight != null ? roundTrainingWeight((built.sets.find(row => row.kind !== "warmup")?.weight ?? set.weight) * Math.pow(1 - original.backoffPercent / 100, setIndex), original.progression?.increment ?? routine.progression.increment) : set.weight;
        return reset({ ...set, ...(template ? { kind: template.kind, drops: template.drops, restPause: template.restPause, failure: template.failure, rpe: template.rpe, rir: template.rir, inclinePercent: template.inclinePercent, restSeconds: template.restSeconds } : {}), ...(weight != null ? { weight } : {}) });
      });
      const preserve = (original.progression ?? routine.progression).mode === "none" && !original.pyramid && original.backoffPercent == null;
      return { ...built, notes: original.notes, restSeconds: original.restSeconds, progression: original.progression ?? routine.progression, ...(original.muscleSnapshot ? { muscleSnapshot: original.muscleSnapshot } : {}),
        ...(original.bodyweight != null ? { bodyweight: original.bodyweight } : {}), ...(original.dbLoad ? { dbLoad: original.dbLoad } : {}), ...(original.loadKind ? { loadKind: original.loadKind } : {}), ...(original.noProg || routine.noProg ? { noProg: true } : {}), ...(options.routineId ? { routineId: options.routineId } : {}),
        sets: preserve ? original.sets.map(reset) : [...original.sets.filter(set => set.kind === "warmup").map(reset), ...work],
        ...(original.groupId ? { groupId: original.groupId } : {}),
      };
    }), ...(routine.noProg ? { noProg: true } : {}),
  };
}
export function finishTrainingWorkout(workout: TrainingWorkout, now = Date.now()): TrainingWorkout {
  if (workout.backfill) return { ...workout, finishedAt: workout.startedAt + workout.backfill.durationMinutes * 60000, restEndsAt: null };
  if (now < workout.startedAt) throw new Error("训练结束时间早于开始时间");
  const ended: unknown = sessionEnd(toUpstreamWorkout(workout), now);
  return { ...workout, finishedAt: Math.max(workout.startedAt, Math.min(now, finite(ended, now))), restEndsAt: null };
}
export function toggleTrainingSet(workout: TrainingWorkout, exerciseId: string, setId: string, now = Date.now()): TrainingWorkout {
  let rest = 0;
  const exercises = workout.exercises.map(exercise => exercise.id !== exerciseId ? exercise : { ...exercise, sets: exercise.sets.map(set => {
    if (set.id !== setId) return set;
    const completed = !set.completed;
    if (completed) rest = set.restSeconds ?? exercise.restSeconds;
    return { ...set, completed, completedAt: completed ? now : null };
  }) });
  return { ...workout, exercises, restEndsAt: rest > 0 ? now + rest * 1000 : null };
}
export function convertWorkoutUnit<T extends TrainingWorkout>(workout: T, unit: FitnessUnit): T {
  if (workout.unit === unit) return workout;
  return { ...workout, unit, exercises: workout.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map(set => ({ ...set,
    ...(set.weight != null ? { weight: weightOf(kgOf(set.weight, workout.unit), unit) } : {}),
    ...(set.drops ? { drops: set.drops.map(drop => ({ ...drop, weight: weightOf(kgOf(drop.weight, workout.unit), unit) })) } : {}),
  })) })) };
}
/** Weight fields change numerically when the display unit changes; time/rep targets do not. */
export function convertRoutineUnit(routine: TrainingRoutine, unit: FitnessUnit): TrainingRoutine {
  if (routine.unit === unit) return routine;
  const convert = (weight: number) => weightOf(kgOf(weight, routine.unit), unit);
  const progression = (value: ProgressionConfig): ProgressionConfig => ({ ...value, increment: value.mode === "time" ? value.increment : convert(value.increment) });
  const prescription = (value: RoutineExercise["prescription"]): RoutineExercise["prescription"] => value ? { ...value, ...(value.weight != null ? { weight: convert(value.weight) } : {}), ...(value.backoffStep != null ? { backoffStep: convert(value.backoffStep) } : {}) } : undefined;
  return { ...routine, unit, progression: progression(routine.progression), exercises: routine.exercises.map(exercise => ({ ...exercise,
    sets: exercise.sets.map(set => ({ ...set, ...(set.weight != null ? { weight: convert(set.weight) } : {}), ...(set.drops ? { drops: set.drops.map(drop => ({ ...drop, weight: convert(drop.weight) })) } : {}) })),
    ...(exercise.progression ? { progression: progression(exercise.progression) } : {}),
    ...(exercise.pyramid ? { pyramid: { ...exercise.pyramid, weights: exercise.pyramid.weights.map(convert) } } : {}),
    ...(exercise.prescription ? { prescription: prescription(exercise.prescription) } : {}), ...(exercise.planSnapshot ? { planSnapshot: prescription(exercise.planSnapshot) } : {}),
  })) };
}
export interface TrainingDay { date: string; sessions: number; sets: number; volumeKg: number; durationSeconds: number }
export interface ExerciseRecord { exerciseId: string; name: string; estimated1RMKg: number; weightKg: number; reps: number; at: number; workoutId: string }
export interface TrainingStats { sessions: number; completedSets: number; volumeKg: number; durationSeconds: number; days: TrainingDay[]; muscleSets: Record<string, number>; records: ExerciseRecord[] }
export function deriveExerciseRecords(workouts: readonly IdentifiedWorkout[], formula: OneRmFormula = "epley"): ExerciseRecord[] {
  const finished = workouts.filter(workout => workout.finishedAt !== null).map(workout => convertWorkoutUnit(workout, "kg"));
  const state = toUpstreamState(finished);
  const ids = [...new Set(finished.flatMap(workout => workout.exercises.map(exercise => exercise.exerciseId)))];
  return ids.flatMap(exerciseId => {
    const result: unknown = best1RM({ ...state, oneRmFormula: formula }, exerciseId, formula);
    const value = record(result);
    const estimate = finite(value.est);
    if (!(estimate > 0)) return [];
    return [{ exerciseId, name: findExercise(exerciseId)?.name ?? finished.flatMap(workout => workout.exercises).find(exercise => exercise.exerciseId === exerciseId)?.name ?? exerciseId, estimated1RMKg: estimate, weightKg: finite(value.w), reps: finite(value.r), at: finite(value.t), workoutId: finished.find(workout => workout.startedAt === value.t)?.id ?? "" }];
  });
}
export interface TrainingStatsOptions { since?: number; until?: number; formula?: OneRmFormula; timeZone?: string; customExercises?: readonly FitnessExercise[] }
function dayFormatter(timeZone?: string): Intl.DateTimeFormat { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }); }
function dateInZone(at: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(at); const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function deriveTrainingStats(workouts: readonly IdentifiedWorkout[], options: TrainingStatsOptions = {}): TrainingStats {
  const selected = workouts.filter(workout => workout.finishedAt !== null && workout.startedAt >= (options.since ?? 0) && workout.startedAt <= (options.until ?? Infinity)).map(workout => convertWorkoutUnit(workout, "kg"));
  const days = new Map<string, TrainingDay>(); const formatter = dayFormatter(options.timeZone);
  let volumeKg = 0; let completedSets = 0; let durationSeconds = 0;
  for (const workout of selected) {
    const legacy = toUpstreamWorkout(workout, workout.id);
    const volume: unknown = workoutVolume(legacy); const sets: unknown = workSetsDone(legacy);
    const duration = Math.max(0, ((workout.finishedAt ?? workout.startedAt) - workout.startedAt) / 1000);
    volumeKg += finite(volume); completedSets += finite(sets); durationSeconds += duration;
    const date = dateInZone(workout.startedAt, formatter);
    const day = days.get(date) ?? { date, sessions: 0, sets: 0, volumeKg: 0, durationSeconds: 0 };
    day.sessions++; day.sets += finite(sets); day.volumeKg += finite(volume); day.durationSeconds += duration; days.set(date, day);
  }
  const muscleLoad: unknown = loadOfWorkouts(selected.map(workout => toUpstreamWorkout(workout, workout.id, options.customExercises)), undefined);
  return { sessions: selected.length, completedSets, volumeKg, durationSeconds, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), muscleSets: numberMap(muscleLoad), records: deriveExerciseRecords(selected, options.formula) };
}
export interface MuscleRecovery { id: string; name: string; fatigue: number; retainedStrength: number; status: "rest" | "ready" | "recovering" }
export function deriveRecovery(workouts: readonly IdentifiedWorkout[], options: { now?: number; bodyweightKg?: number; customExercises?: readonly FitnessExercise[] } = {}): MuscleRecovery[] {
  const history = workouts.filter(workout => workout.finishedAt !== null).map(workout => toUpstreamWorkout(convertWorkoutUnit(workout, "kg"), workout.id, options.customExercises));
  const now = options.now ?? Date.now();
  const fatigue: unknown = fatigueOf(history, now, { unit: "kg", bodyweightKg: options.bodyweightKg });
  const retained: unknown = strengthOf(history, now);
  const fatigueMap = numberMap(fatigue); const strengthMap = numberMap(retained);
  return Object.keys(strengthMap).map(id => ({ id, name: muscleLabels[id] ?? id, fatigue: fatigueMap[id] ?? 0, retainedStrength: strengthMap[id], status: (fatigueMap[id] ?? 0) > 0.5 ? "recovering" : strengthMap[id] === 0.5 ? "rest" : "ready" }));
}
export function heatmapDays(workouts: readonly IdentifiedWorkout[], from: string, count = 365, options: Pick<TrainingStatsOptions, "timeZone" | "customExercises"> = {}): TrainingDay[] {
  const byDay = new Map(deriveTrainingStats(workouts, options).days.map(day => [day.date, day]));
  const start = new Date(from + "T12:00:00Z").getTime();
  if (!Number.isFinite(start) || !Number.isInteger(count) || count < 0 || count > 3660) throw new Error("日期范围无效");
  return Array.from({ length: count }, (_, index) => { const date = new Date(start + index * 86400000).toISOString().slice(0, 10); return byDay.get(date) ?? { date, sessions: 0, sets: 0, volumeKg: 0, durationSeconds: 0 }; });
}
export function scheduledRoutineId(schedule: TrainingSchedule, day: string, overrides: Readonly<Record<string, string | null>> = {}): string | null {
  if (!schedule.enabled) return null;
  if (Object.hasOwn(overrides, day)) return overrides[day] ?? null;
  const date = new Date(day + "T12:00:00Z");
  if (!Number.isFinite(date.getTime()) || schedule.anchorDate && day < schedule.anchorDate || schedule.restDays.includes(date.getUTCDay())) return null;
  if (schedule.mode !== "rotation") return schedule.week[String(date.getUTCDay())] ?? null;
  if (!schedule.rotation.length) return null;
  const anchor = schedule.anchorDate ? new Date(schedule.anchorDate + "T12:00:00Z").getTime() : date.getTime();
  const days = Math.floor((date.getTime() - anchor) / 86400000); if (days > 366000) throw new Error("训练计划的起始日期过早");
  let offset = 0;
  for (let index = 0; index < days; index++) if (!schedule.restDays.includes(new Date(anchor + index * 86400000).getUTCDay())) offset++;
  const id = schedule.rotation[(schedule.position + offset) % schedule.rotation.length]; return id === "rest" ? null : id;
}
export function advanceRotation(schedule: TrainingSchedule): TrainingSchedule { return schedule.mode === "rotation" && schedule.rotation.length ? { ...schedule, position: (schedule.position + 1) % schedule.rotation.length } : schedule; }
export function deloadWeight(weight: number, increment = 2.5, percent = 10): number { const result: unknown = deloadTo(weight, increment, 1 - percent / 100); return finite(result); }
export function roundTrainingWeight(weight: number, increment = 2.5): number { const result: unknown = snapWeight(weight, increment); return finite(result); }
export function addTrainingSet(exercise: RoutineExercise, kind: TrainingSet["kind"] = "normal", id = crypto.randomUUID()): RoutineExercise {
  const previous = exercise.sets.filter(set => set.kind !== "warmup").at(-1);
  const set: TrainingSet = { ...(previous ?? {}), id, kind, side: previous?.side ?? "both", completed: false, completedAt: null };
  return { ...exercise, sets: [...exercise.sets, set] };
}
export { defaultProgression };
