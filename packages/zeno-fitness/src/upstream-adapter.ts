import { plannedOf, deloadFactorOf } from "../upstream/lib/progression.js";
import { syncSideAggregate } from "../upstream/lib/workout-model.js";
import { buildPlannedEntry } from "../upstream/lib/session-start.js";
import type { BodyMeasurement, FitnessContextOptions, FitnessExercise, FitnessUnit, IdentifiedWorkout, ProgressionConfig, RoutineExercise, TrainingRoutine, TrainingSet, TrainingWorkout } from "./types.js";
import { canonicalExerciseId, findExercise, muscleLabels } from "./catalogue.js";
import { finite, isoDate, kgOf, list, numberMap, record, stringList, text, weightOf } from "./value.js";

export const defaultProgression: ProgressionConfig = { mode: "none", increment: 2.5, repMin: 8, repMax: 12, maxSets: 5, deloadPercent: 10, stallLimit: 3 };
type Prescription = NonNullable<RoutineExercise["prescription"]>;
type MuscleSnapshot = NonNullable<RoutineExercise["muscleSnapshot"]>;
const chineseMuscles: Readonly<Record<string, string>> = { ...Object.fromEntries(Object.entries(muscleLabels).map(([id, label]) => [label, id])), 胸: "chest", 背: "upper-back", 背阔肌: "upper-back", 肩: "deltoids", 腹: "abs", 臀: "gluteal", 股二头肌: "hamstring", 股四头: "quadriceps", 小腿肌: "calves" };
function canonicalMuscles(values: readonly string[]): string[] { return [...new Set(values.map(value => chineseMuscles[value.trim()] ?? value.trim()))].slice(0, 50); }
/** Per-record metadata never changes the upstream global exercise index or another account. */
export function withExerciseSnapshot(exercise: RoutineExercise, customExercises: readonly FitnessExercise[] = []): RoutineExercise {
  if (exercise.muscleSnapshot) return exercise;
  const metadata = customExercises.find(value => value.id === exercise.exerciseId) ?? findExercise(exercise.exerciseId);
  if (!metadata) return exercise;
  const muscleSnapshot: MuscleSnapshot = { primaryMuscles: canonicalMuscles(metadata.primaryMuscleIds.length ? metadata.primaryMuscleIds : metadata.primaryMuscles), secondaryMuscles: canonicalMuscles(metadata.secondaryMuscleIds.length ? metadata.secondaryMuscleIds : metadata.secondaryMuscles), equipment: metadata.categoryId === "bodyweight" || /^(?:body weight|bodyweight|自重)$/.test(metadata.equipmentId) ? "body weight" : metadata.equipment.slice(0, 100), bodyPart: metadata.bodyPartId.slice(0, 100) };
  return { ...exercise, muscleSnapshot };
}
function toLegacyMuscles(snapshot: MuscleSnapshot | undefined): Record<string, unknown> {
  return snapshot ? { muscleSnapshot: { primaryMuscles: canonicalMuscles(snapshot.primaryMuscles), secondaryMuscles: canonicalMuscles(snapshot.secondaryMuscles), eq: snapshot.equipment, bp: snapshot.bodyPart }, ...(/^(?:body weight|bodyweight|自重)$/.test(snapshot.equipment) ? { bodyweight: true } : {}) } : {};
}
function fromLegacyMuscles(value: unknown): MuscleSnapshot | undefined {
  const raw = record(value); if (!Object.keys(raw).length) return undefined;
  const weights = numberMap(raw.muscleWeights);
  const primary = stringList(raw.primaryMuscles).length ? stringList(raw.primaryMuscles) : stringList(raw.primaries);
  const secondary = stringList(raw.secondaryMuscles).length ? stringList(raw.secondaryMuscles) : stringList(raw.secondaries);
  return { primaryMuscles: canonicalMuscles(primary.length ? primary : Object.keys(weights).filter(id => weights[id] >= 1)), secondaryMuscles: canonicalMuscles(secondary.length ? secondary : Object.keys(weights).filter(id => weights[id] > 0 && weights[id] < 1)), equipment: text(raw.equipment, text(raw.eq)).slice(0, 100), bodyPart: text(raw.bodyPart, text(raw.bp)).slice(0, 100) };
}
function toLegacyPrescription(value: Prescription): Record<string, unknown> {
  return { sets: value.sets, reps: value.reps, repsMin: value.repMin, setsMax: value.maxSets, weight: value.weight, sec: value.durationSeconds, mode: value.durationSeconds != null ? "time" : "reps", rowReps: value.rowReps, backoffStep: value.backoffStep };
}
function fromLegacyPrescription(value: unknown): Prescription | undefined {
  const raw = record(value); if (!(finite(raw.sets) > 0)) return undefined;
  return { sets: finite(raw.sets), ...(typeof raw.reps === "number" ? { reps: raw.reps } : {}), ...(typeof raw.repsMin === "number" ? { repMin: raw.repsMin } : {}), ...(typeof raw.setsMax === "number" ? { maxSets: raw.setsMax } : {}), ...(typeof raw.weight === "number" ? { weight: raw.weight } : {}), ...(typeof raw.sec === "number" && (raw.mode === "time" || typeof raw.reps !== "number") ? { durationSeconds: raw.sec } : {}), ...(Array.isArray(raw.rowReps) ? { rowReps: list(raw.rowReps).filter((item): item is number => typeof item === "number" && Number.isFinite(item)) } : {}), ...(typeof raw.backoffStep === "number" ? { backoffStep: raw.backoffStep } : {}) };
}
export function toUpstreamSet(set: TrainingSet): Record<string, unknown> {
  return {
    w: set.weight ?? 0, r: set.reps ?? 0, sec: set.durationSeconds ?? 0,
    min: (set.durationSeconds ?? 0) / 60, km: (set.distanceMeters ?? 0) / 1000,
    speed: set.speedKmh ?? (set.durationSeconds ? (set.distanceMeters ?? 0) / set.durationSeconds * 3.6 : 0),
    mode: set.distanceMeters != null || set.speedKmh != null ? "cardio" : set.durationSeconds != null && set.reps == null ? "time" : "reps",
    done: set.completed === true, phase: set.kind === "warmup" ? "warmup" : "work",
    ...(set.completedAt != null ? { at: set.completedAt } : {}),
    type: set.kind === "drop" ? "dropset" : set.kind === "rest_pause" ? "restpause" : "straight",
    drops: set.drops?.map(drop => ({ w: drop.weight, r: drop.reps })),
    clusters: set.restPause?.map(burst => ({ r: burst.reps, rest: burst.restSeconds })),
    rpe: set.rpe, rir: set.rir, failure: set.failure,
    ...(set.inclinePercent != null ? { incline: set.inclinePercent } : {}),
  };
}
export function toUpstreamSets(sets: readonly TrainingSet[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (let index = 0; index < sets.length; index++) {
    const current = sets[index];
    const next = sets[index + 1];
    if (current.side === "left" && next?.side === "right" && current.kind === next.kind) {
      const combined: unknown = syncSideAggregate({ ...toUpstreamSet(current), sides: { L: toUpstreamSet(current), R: toUpstreamSet(next) } });
      result.push(record(combined)); index++;
    } else result.push(toUpstreamSet(current));
  }
  return result;
}
export function toUpstreamExercise(exercise: RoutineExercise, progression = defaultProgression): Record<string, unknown> {
  const work = exercise.sets.filter(set => set.kind !== "warmup");
  const first = work[0] ?? exercise.sets[0];
  const config = exercise.progression ?? progression;
  const mode = first?.distanceMeters != null ? "cardio" : first?.durationSeconds != null && first.reps == null ? "time" : "reps";
  return {
    id: canonicalExerciseId(exercise.exerciseId), n: exercise.name,
    ...toLegacyMuscles(exercise.muscleSnapshot),
    ...(exercise.noProg != null ? { noProg: exercise.noProg } : {}), ...(exercise.bodyweight != null ? { bodyweight: exercise.bodyweight } : {}), ...(exercise.dbLoad ? { dbLoad: exercise.dbLoad } : {}), ...(exercise.loadKind ? { loadKind: exercise.loadKind } : {}),
    sets: toUpstreamSets(work).length || 1, reps: first?.reps != null ? first.reps * (first.side === "left" && work[1]?.side === "right" ? 2 : 1) : config.repMax,
    repsMin: config.repMin, setsMax: config.maxSets, weight: first?.weight ?? 0,
    sec: first?.durationSeconds ?? 30, min: (first?.durationSeconds ?? 1200) / 60,
    km: (first?.distanceMeters ?? 0) / 1000, mode,
    prog: config.mode === "none" ? "off" : config.mode,
    inc: config.increment, deloadFactor: 1 - config.deloadPercent / 100, stallLimit: config.stallLimit,
    rest: exercise.restSeconds, sg: exercise.groupId,
    side: work.some(set => set.side === "left" || set.side === "right"),
    warmupSets: exercise.sets.filter(set => set.kind === "warmup").length,
    ...(exercise.pyramid ? { pyramid: exercise.pyramid.reps, pyramidWeight: exercise.pyramid.weights } : {}),
    ...(exercise.backoffPercent != null ? { backoffStep: exercise.backoffPercent } : {}),
  };
}
export function toUpstreamRoutine(routine: TrainingRoutine, id = "routine"): Record<string, unknown> {
  return { id, name: routine.title, notes: routine.description, ...(routine.noProg ? { excludeFromProgression: true } : {}), ex: routine.exercises.map(exercise => toUpstreamExercise(exercise, routine.progression)) };
}
function dateKey(at: number, timeZone?: string): string { const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).formatToParts(at); return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value ?? "").join("-"); }
export function toUpstreamWorkout(workout: TrainingWorkout, id = "workout", customExercises: readonly FitnessExercise[] = [], timeZone?: string): Record<string, unknown> {
  return {
    id, d: dateKey(workout.startedAt, timeZone), start: workout.startedAt, end: workout.finishedAt,
    name: workout.title, routineId: workout.routineId, notes: workout.notes, unit: workout.unit,
    ...(workout.bodyWeightKg != null ? { bw: workout.bodyWeightKg, bwUnit: "kg" } : {}),
    ...(workout.routineIds ? { routineIds: workout.routineIds } : {}), ...(workout.noProg ? { excludeFromProgression: true } : {}),
    ...(workout.mediaIds ? { mediaIds: workout.mediaIds } : {}),
    entries: workout.exercises.map(exercise => ({ id: canonicalExerciseId(exercise.exerciseId), n: exercise.name, sg: exercise.groupId, rid: exercise.routineId ?? workout.routineId, ...toLegacyMuscles(withExerciseSnapshot(exercise, customExercises).muscleSnapshot), ...(exercise.noProg || workout.noProg ? { noProg: true } : {}), sets: toUpstreamSets(exercise.sets), ...(exercise.prescription || exercise.progression || exercise.bodyweight != null || exercise.dbLoad || exercise.loadKind ? { target: { ...toUpstreamExercise(exercise), ...(exercise.prescription ? toLegacyPrescription(exercise.prescription) : {}), side: exercise.sets.some(set => set.side !== "both") } } : {}), ...(exercise.planSnapshot ? { planned: toLegacyPrescription(exercise.planSnapshot) } : {}) })),
  };
}
export function toUpstreamState(workouts: readonly IdentifiedWorkout[], unit: FitnessUnit = "kg", measurements: readonly BodyMeasurement[] = [], options: FitnessContextOptions = {}) {
  return {
    unit, workouts: workouts.map(workout => toUpstreamWorkout(workout, workout.id, [], options.timeZone)).sort((a, b) => finite(a.start) - finite(b.start)),
    bodyweight: measurements.filter(measurement => measurement.weightKg != null).map(measurement => ({ d: new Date(measurement.at).toISOString().slice(0, 10), w: weightOf(measurement.weightKg ?? 0, unit), t: measurement.at })),
    exWeights: {}, routines: [], customEx: [], week: {}, dayPlan: {},
    plates: Object.fromEntries(Object.entries(options.equipment?.plates ?? {}).map(([key, rows]) => [key, Object.fromEntries((rows ?? []).map(row => [String(row.weight), row.pairs]))])),
    dumbbells: Object.fromEntries(Object.entries(options.equipment?.dumbbells ?? {}).map(([key, weights]) => [key, { weights }])),
    barWeights: options.equipment?.barWeights?.[unit] ?? {}, dbLoad: options.equipment?.dbLoad ?? {}, loadKind: options.equipment?.loadKind ?? {},
    dayNotes: Object.fromEntries(Object.entries(options.dayNotes ?? {}).map(([day, note]) => [day, { tag: note.tag, text: note.text, _ts: note.at }])),
  };
}
export function fromUpstreamSet(value: unknown, id: string): TrainingSet {
  const row = record(value);
  const kind = row.phase === "warmup" || row.warmup === true ? "warmup" : row.type === "dropset" ? "drop" : row.type === "restpause" ? "rest_pause" : "normal";
  return {
    id, kind, ...(typeof row.r === "number" ? { reps: finite(row.r) } : {}),
    ...(typeof row.w === "number" ? { weight: finite(row.w) } : {}),
    ...(typeof row.sec === "number" && finite(row.sec) > 0 ? { durationSeconds: finite(row.sec) } : typeof row.min === "number" && finite(row.min) > 0 ? { durationSeconds: finite(row.min) * 60 } : {}),
    ...(typeof row.km === "number" && finite(row.km) > 0 ? { distanceMeters: finite(row.km) * 1000 } : {}),
    ...(typeof row.speed === "number" && finite(row.speed) > 0 ? { speedKmh: finite(row.speed), distanceMeters: finite(row.min) / 60 * finite(row.speed) * 1000 } : {}),
    ...(typeof row.rpe === "number" ? { rpe: finite(row.rpe) } : {}), ...(typeof row.rir === "number" ? { rir: finite(row.rir) } : {}),
    ...(typeof row.incline === "number" ? { inclinePercent: finite(row.incline) } : {}),
    completed: row.done === true, completedAt: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : null, side: "both", failure: row.failure === true,
    ...(kind === "drop" ? { drops: list(row.drops).map(drop => ({ weight: finite(record(drop).w), reps: finite(record(drop).r) })) } : {}),
    ...(kind === "rest_pause" ? { restPause: list(row.clusters).map(burst => ({ reps: finite(record(burst).r), restSeconds: finite(record(burst).rest, 20) })) } : {}),
  };
}
export function fromUpstreamSets(value: unknown, prefix: string): TrainingSet[] {
  return list(value).flatMap((raw, index) => {
    const row = record(raw);
    const sides = record(row.sides);
    if (sides.L && sides.R) return [{ ...fromUpstreamSet(sides.L, `${prefix}-${index}-L`), side: "left" }, { ...fromUpstreamSet(sides.R, `${prefix}-${index}-R`), side: "right" }];
    return [fromUpstreamSet(raw, `${prefix}-${index}`)];
  });
}
export function fromUpstreamExercise(value: unknown, index = 0, planned = false): RoutineExercise {
  const original = record(value);
  const entry = { ...record(original.target), ...original };
  const exerciseId = canonicalExerciseId(text(entry.id));
  const id = `exercise-${index}-${exerciseId}`;
  let sets = fromUpstreamSets(entry.sets, id);
  if (planned && !Array.isArray(entry.sets)) {
    const mode = text(entry.mode, "reps");
    sets = Array.from({ length: Math.min(100, Math.max(1, finite(entry.sets, 3))) }, (_, i) => ({
      id: `${id}-${i}`, kind: "normal", side: "both", completed: false, completedAt: null, weight: finite(entry.weight),
      ...(mode === "time" ? { durationSeconds: finite(entry.sec, 30) } : mode === "cardio" ? { durationSeconds: finite(entry.min, 20) * 60, distanceMeters: finite(entry.km) * 1000 } : { reps: finite(entry.reps, 10) }),
    }));
  }
  const policy = entry.prog;
  const config: ProgressionConfig = { ...defaultProgression,
    mode: policy === "linear" || policy === "greyskull" || policy === "double" || policy === "triple" || policy === "time" ? policy : "none",
    increment: finite(entry.inc, 2.5), repMin: finite(entry.repsMin, 8), repMax: finite(entry.reps, 12), maxSets: finite(entry.setsMax, 5),
    deloadPercent: Math.round((1 - deloadFactorOf(entry)) * 100 * 1e8) / 1e8, stallLimit: finite(entry.stallLimit, defaultProgression.stallLimit),
  };
  const prescription = fromLegacyPrescription(original.target); const snapshot = fromLegacyPrescription(original.planned); const muscleSnapshot = fromLegacyMuscles(original.muscleSnapshot);
  return { id, exerciseId, name: findExercise(exerciseId)?.name ?? text(entry.n, "自定义动作"), sets, restSeconds: finite(entry.restSec, finite(entry.rest, 90)), notes: text(entry.note, text(entry.notes)), ...(typeof entry.sg === "string" ? { groupId: entry.sg } : {}), ...(planned || typeof entry.prog === "string" ? { progression: config } : {}), ...(prescription ? { prescription } : {}), ...(snapshot ? { planSnapshot: snapshot } : {}), ...(muscleSnapshot ? { muscleSnapshot } : {}), ...(typeof entry.noProg === "boolean" ? { noProg: entry.noProg } : {}), ...(typeof entry.bodyweight === "boolean" ? { bodyweight: entry.bodyweight } : {}), ...(entry.dbLoad === "as" || entry.dbLoad === "each" || entry.dbLoad === "total" ? { dbLoad: entry.dbLoad } : {}), ...(entry.loadKind === "pairs" || entry.loadKind === "single" || entry.loadKind === "none" ? { loadKind: entry.loadKind } : {}), ...(typeof original.rid === "string" ? { routineId: original.rid } : {}), ...(Array.isArray(entry.pyramid) ? { pyramid: { reps: list(entry.pyramid).map(item => finite(item, 12)), weights: list(entry.pyramidWeight).map(item => finite(item)) } } : {}) };
}
export function fromUpstreamWorkout(value: unknown, unit: FitnessUnit = "kg", index = 0): IdentifiedWorkout {
  const workout = record(value);
  const id = text(workout.id, `import-${index}`);
  const date = `${text(workout.d, "1970-01-01")}T12:00:00.000Z`;
  return { id, title: text(workout.name, "导入训练"), unit,
    ...(typeof workout.routineId === "string" ? { routineId: workout.routineId } : {}),
    ...(Array.isArray(workout.routineIds) ? { routineIds: stringList(workout.routineIds) } : {}), ...(workout.excludeFromProgression === true || workout.noProg === true ? { noProg: true } : {}), ...(Array.isArray(workout.mediaIds) ? { mediaIds: stringList(workout.mediaIds) } : {}),
    ...(typeof workout.bw === "number" || typeof workout.bodyweight === "number" ? { bodyWeightKg: kgOf(finite(workout.bw, finite(workout.bodyweight)), text(workout.bwUnit, unit) === "lb" ? "lb" : "kg") } : {}),
    startedAt: new Date(isoDate(workout.start, date)).getTime(), finishedAt: new Date(isoDate(workout.end, date)).getTime(), notes: text(workout.notes), restEndsAt: null,
    exercises: list(workout.entries).map((entry, entryIndex) => fromUpstreamExercise(entry, entryIndex)),
  };
}
export function fromUpstreamRoutine(value: unknown, unit: FitnessUnit = "kg"): TrainingRoutine {
  const routine = record(value);
  const state = toUpstreamState([], unit);
  return { title: text(routine.name, "导入计划"), description: text(routine.notes), unit, progression: { ...defaultProgression }, ...(routine.noProg === true || routine.excludeFromProgression === true ? { noProg: true } : {}), exercises: list(routine.ex).map((exercise, index) => {
    const built: unknown = buildPlannedEntry(state, record(exercise), routine, { noProg: true });
    return fromUpstreamExercise({ ...record(exercise), sets: record(built).sets }, index, true);
  }) };
}
/** Exposed for deterministic parity tests and migration diagnostics; never a persistence API. */
export function upstreamPlannedOf(exercise: RoutineExercise, progression = defaultProgression): Record<string, unknown> {
  const result: unknown = plannedOf(toUpstreamExercise(exercise, progression)); return record(result);
}
