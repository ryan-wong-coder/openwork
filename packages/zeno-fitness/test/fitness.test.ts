import { describe, expect, test } from "bun:test";
import { progressionSchema, routineDataSchema, trainingScheduleDataSchema, workoutDataSchema } from "@zeno/core/schema";
import cases from "./fixtures/upstream-cases.json";
import {
  fitnessExercises, catalogueCoverage, findExercise, canonicalExerciseId, exerciseAliases, searchExercises,
  estimate1RM, calculateNextPrescription, startTrainingWorkout, finishTrainingWorkout, toggleTrainingSet,
  deriveTrainingStats, deriveRecovery, convertWorkoutUnit, convertRoutineUnit, heatmapDays, scheduledRoutineId, advanceRotation,
  parseFitnessCsv, parseAppleHealthWeight, parseHevyWorkouts, parseHevyBodyweight, parseHevyRoutines,
  createFitnessBackup, serializeFitnessBackup, parseFitnessBackup, exportFitnessBackupZip, importFitnessBackupZip,
  parseOpenGymBackup, shareFitnessPlan, parseFitnessPlan, buildStarterFitnessPlan, planPdfData,
  deriveBodyTrends, calculatePlateLoad, muscleMapSvg, exerciseCategorySvg, deriveStructuralBalance,
  toUpstreamState, toUpstreamExercise, toUpstreamRoutine,
  exportWorkoutFit, exportWorkoutsCsv,
  fitnessBackupMediaIds, importOpenGymBackupZip,
  startCombinedTrainingWorkout, repeatTrainingWorkout, routineFromWorkout, startBackfillWorkout,
  finishBackfillWorkout, markWorkoutSetsComplete, setWorkoutProgressionExcluded, updateFitnessDayNote,
  fitnessDayExcused, swapTrainingExercise, moveTrainingExercise, removeUnfinishedTrainingExercise, exercisePlateLoad, scheduledDeload, toUpstreamWorkout, fromUpstreamWorkout,
} from "../src/index.ts";
import { nextPrescription } from "../upstream/lib/progression.js";
import { zipStore } from "../upstream/lib/zip.js";
import type { FitnessBackup, FitnessExercise, IdentifiedWorkout, TrainingRoutine } from "../src/index.ts";

const NOW = Date.UTC(2026, 0, 10, 12);
function routine(mode: "none" | "linear" | "greyskull" | "double" | "triple" | "time" = "none"): TrainingRoutine {
  return routineDataSchema.parse({ title: "测试训练", unit: "kg", exercises: [{ id: "exercise-1", exerciseId: "0025", name: findExercise("0025")?.name ?? "卧推", sets: Array.from({ length: 3 }, (_, index) => ({ id: `set-${index}`, reps: 5, weight: 60 })) }], progression: { mode, repMin: 5, repMax: 5, increment: 2.5 } });
}
function finished(plan = routine("linear"), reps = 5, at = NOW): IdentifiedWorkout {
  const running = startTrainingWorkout(plan, { routineId: "routine-1", now: at });
  return { ...finishTrainingWorkout({ ...running, exercises: running.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map(set => ({ ...set, reps, completed: true, completedAt: at })) })) }, at + 1800000), id: `workout-${at}` };
}
function backup(): FitnessBackup {
  return createFitnessBackup({ routines: [{ id: "routine-1", data: routine() }], schedules: [], workouts: [finished()], measurements: [], memberships: [], customExercises: [] }, NOW);
}

describe("fixed text-only Chinese catalogue", () => {
  test("5632 canonical names, alias resolution, exact source coverage", () => {
    expect(fitnessExercises).toHaveLength(5632); expect(catalogueCoverage.chineseNames).toBe(5632);
    expect(catalogueCoverage.chineseInstructions).toBe(1324); expect(catalogueCoverage.restrictedMediaFiles).toBe(0);
    expect(new Set(fitnessExercises.map(exercise => exercise.id)).size).toBe(5632);
    for (const [alias, id] of Object.entries(exerciseAliases)) { expect(canonicalExerciseId(alias)).toBe(id); expect(findExercise(alias)?.id).toBe(id); }
    expect(JSON.stringify(fitnessExercises)).not.toMatch(/\.mp4|\.webp|https?:/);
  });
  test("Chinese and English search combine equipment/muscle/category filters", () => {
    const exercise = findExercise("0025"); expect(exercise).toBeDefined();
    const rows = searchExercises({ query: "卧推", equipment: ["barbell"], muscles: ["chest"], limit: 100 });
    expect(rows.some(row => row.id === "0025")).toBe(true);
    expect(searchExercises({ query: "barbell bench press", limit: 100 }).some(row => row.id === "0025")).toBe(true);
    expect(searchExercises({ query: "不可能存在的动作" })).toHaveLength(0);
  });
});
describe("upstream numerical regressions and own-data lifecycle", () => {
  test("documented formula fixtures and high-rep refusal", () => {
    for (const item of cases.oneRm) expect(estimate1RM(item.weight, item.reps)).toBe(item.expected);
    expect(estimate1RM(100, 13)).toBeNull(); expect(estimate1RM(0, 5)).toBeNull(); expect(estimate1RM(100, 5, "brzycki")).toBe(112.5);
    expect(estimate1RM(100, 13, "weighted", 1)).toBeGreaterThan(100);
  });
  test("linear success, miss and exact preserved-kernel result", () => {
    const plan = routine("linear"); const hit = finished(plan);
    const prescribed = calculateNextPrescription({ routine: plan, routineId: "routine-1", exercise: plan.exercises[0], workouts: [hit] });
    expect(prescribed.kind).toBe("up"); expect(prescribed.weight).toBe(62.5);
    const reference = nextPrescription(toUpstreamState([hit]), toUpstreamExercise(plan.exercises[0], plan.progression), toUpstreamRoutine(plan, "routine-1"));
    expect(prescribed.weight).toBe(reference.weight);
    expect(calculateNextPrescription({ routine: plan, routineId: "routine-1", exercise: plan.exercises[0], workouts: [finished(plan, 3)] }).kind).toBe("hold");
  });
  test("progression deload validation matches the upstream supported factor", () => {
    for (const percent of [5, 10, 50]) expect(progressionSchema.parse({ deloadPercent: percent }).deloadPercent).toBe(percent);
    for (const percent of [0, 4, 51, 100]) expect(progressionSchema.safeParse({ deloadPercent: percent }).success).toBe(false);
    expect(parseOpenGymBackup({ workouts: [], routines: [{ id: "legacy", ex: [{ id: "0025", prog: "linear", deloadFactor: 0.99 }] }] }).routines[0].data.exercises[0].progression?.deloadPercent).toBe(10);
    expect(parseOpenGymBackup({ workouts: [], routines: [{ id: "legacy", ex: [{ id: "0025", prog: "linear", deloadFactor: 0.95 }] }] }).routines[0].data.exercises[0].progression?.deloadPercent).toBe(5);
    expect(trainingScheduleDataSchema.parse({ title: "周期", mode: "weekly", timeZone: "Asia/Shanghai", deloadPercent: 100 }).deloadPercent).toBe(100);
  });
  test("custom stall count triggers deload without changing upstream default kernel", () => {
    const plan = routine("linear"); plan.progression.stallLimit = 2;
    const histories = [finished(plan, 3, NOW), finished(plan, 3, NOW + 86400000)];
    const next = calculateNextPrescription({ routine: plan, routineId: "routine-1", exercise: plan.exercises[0], workouts: histories });
    expect(next.kind).toBe("deload"); expect(next.weight).toBeLessThan(60);
  });
  test("native timed prescription retains its mode and duration snapshot", () => {
    const plan = routine("time"); plan.progression.increment = 5;
    plan.exercises[0].sets = plan.exercises[0].sets.map(({ reps: _reps, ...set }) => ({ ...set, durationSeconds: 45 }));
    const started = startTrainingWorkout(plan, { routineId: "routine-1", now: NOW });
    const history = { ...finishTrainingWorkout({ ...started, exercises: started.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map(set => ({ ...set, completed: true, completedAt: NOW })) })) }, NOW + 60000), id: "timed" };
    const next = calculateNextPrescription({ routine: plan, routineId: "routine-1", exercise: plan.exercises[0], workouts: [history] });
    expect(next.kind).toBe("up"); expect(next.durationSeconds).toBe(50);
  });
  test("warmup, drop extra volume and rest-pause do not double-count", () => {
    const value = finished(); const exercise = value.exercises[0];
    exercise.sets = [
      { id: "warm", kind: "warmup", reps: 10, weight: 100, side: "both", completed: true, completedAt: NOW },
      { id: "drop", kind: "drop", reps: 5, weight: 60, drops: [{ weight: 40, reps: 5 }], side: "both", completed: true, completedAt: NOW },
      { id: "rest", kind: "rest_pause", reps: 10, weight: 60, restPause: [{ reps: 3, restSeconds: 20 }, { reps: 2, restSeconds: 20 }], side: "both", completed: true, completedAt: NOW },
    ];
    const stats = deriveTrainingStats([value]); expect(stats.volumeKg).toBe(1100); expect(stats.completedSets).toBe(2);
    expect(deriveTrainingStats([convertWorkoutUnit(value, "lb")]).volumeKg).toBeCloseTo(1100, 5);
    expect(stats.records[0]?.estimated1RMKg).toBe(80);
  });
  test("routine kg/lb conversion preserves physical loads and time progression increments", () => {
    const plan = routine("double"); const entry = plan.exercises[0];
    entry.sets[0] = { ...entry.sets[0], kind: "drop", drops: [{ weight: 40, reps: 5 }] }; entry.pyramid = { reps: [8, 6], weights: [50, 60] };
    entry.progression = { ...plan.progression }; entry.prescription = { sets: 3, weight: 60, reps: 8, backoffStep: 2.5 }; entry.planSnapshot = { sets: 3, weight: 60, reps: 8 };
    const pounds = convertRoutineUnit(plan, "lb"); routineDataSchema.parse(pounds);
    expect(pounds.exercises[0].sets[0].weight).toBeCloseTo(132.2773573, 5); expect(pounds.exercises[0].sets[0].drops?.[0].weight).toBeCloseTo(88.1849049, 5);
    expect(pounds.progression.increment).toBeCloseTo(5.5115566, 5); expect(pounds.exercises[0].progression?.increment).toBeCloseTo(5.5115566, 5);
    expect(pounds.exercises[0].pyramid?.weights[0]).toBeCloseTo(110.231131, 5); expect(pounds.exercises[0].prescription?.backoffStep).toBeCloseTo(5.5115566, 5);
    const back = convertRoutineUnit(pounds, "kg"); expect(back.exercises[0].sets[0].weight).toBeCloseTo(60, 8); expect(back.exercises[0].prescription?.weight).toBeCloseTo(60, 8); expect(back.exercises[0].planSnapshot?.weight).toBeCloseTo(60, 8);
    expect(plan.exercises[0].sets[0].weight).toBe(60);
    const timed = routine("time"); timed.progression.increment = 5; timed.exercises[0].progression = { ...timed.progression };
    const timedPounds = convertRoutineUnit(timed, "lb"); expect(timedPounds.progression.increment).toBe(5); expect(timedPounds.exercises[0].progression?.increment).toBe(5);
  });
  test("starting preserves explicit per-set advanced plan, completing starts rest", () => {
    const plan = routine(); plan.exercises[0].sets[0].kind = "warmup"; plan.exercises[0].sets[1].kind = "drop"; plan.exercises[0].sets[1].drops = [{ weight: 40, reps: 8 }];
    const running = startTrainingWorkout(plan, { now: NOW }); workoutDataSchema.parse(running);
    expect(running.exercises[0].sets[1].drops).toEqual([{ weight: 40, reps: 8 }]);
    const ticked = toggleTrainingSet(running, running.exercises[0].id, running.exercises[0].sets[1].id, NOW);
    expect(ticked.restEndsAt).toBe(NOW + 90000); expect(finishTrainingWorkout(ticked, NOW + 100000).restEndsAt).toBeNull();
    expect(running.exercises[0].sets[1].completed).toBe(false);
  });
  test("forgotten sessions finish at the last completed run instead of adding overnight time", () => {
    const started = startTrainingWorkout(routine(), { now: NOW });
    const ticked = { ...started, exercises: started.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map((set, index) => ({ ...set, completed: index < 2, completedAt: index < 2 ? NOW + (index + 1) * 60000 : null })) })) };
    expect(finishTrainingWorkout(ticked, NOW + 86400000).finishedAt).toBe(NOW + 120000);
    expect(finishTrainingWorkout(ticked, NOW + 180000).finishedAt).toBe(NOW + 180000);
    expect(finishTrainingWorkout(started, NOW + 86400000).finishedAt).toBe(NOW + 86400000);
    expect(() => finishTrainingWorkout(started, NOW - 1)).toThrow();
  });
  test("prescription snapshots survive core validation and triple uses changing row targets", () => {
    const plan = routine("triple"); plan.progression.repMin = 5; plan.progression.repMax = 8; plan.exercises[0].sets.forEach(set => set.reps = 8);
    const running = workoutDataSchema.parse(startTrainingWorkout(plan, { routineId: "routine-1", now: NOW }));
    expect(running.exercises[0].prescription?.rowReps).toEqual([5, 5, 5]);
    expect(running.exercises[0].planSnapshot?.reps).toBe(8);
  });
  test("fatigue decays and retained strength follows upstream two-week plateau", () => {
    const history = [finished()];
    const recent = deriveRecovery(history, { now: NOW + 3600000 }); const later = deriveRecovery(history, { now: NOW + 60 * 86400000 });
    expect(recent.some(row => row.fatigue > 0)).toBe(true);
    for (const row of recent.filter(row => row.fatigue > 0)) { expect(row.retainedStrength).toBe(1); expect(later.find(other => other.id === row.id)?.retainedStrength).toBeLessThan(1); }
    expect(heatmapDays(history, "2026-01-09", 3).map(day => day.sessions)).toEqual([0, 1, 0]);
  });
  test("local day buckets use the requested timezone across UTC midnight and DST", () => {
    const history = [finished(routine(), 5, Date.UTC(2026, 0, 10, 17))];
    expect(deriveTrainingStats(history, { timeZone: "Asia/Shanghai" }).days[0].date).toBe("2026-01-11");
    expect(deriveTrainingStats(history, { timeZone: "America/Los_Angeles" }).days[0].date).toBe("2026-01-10");
    expect(heatmapDays(history, "2026-01-10", 2, { timeZone: "Asia/Shanghai" }).map(day => day.sessions)).toEqual([0, 1]);
    const dst = [finished(routine(), 5, Date.UTC(2026, 2, 8, 9, 30)), finished(routine(), 5, Date.UTC(2026, 2, 8, 10, 30))];
    expect(deriveTrainingStats(dst, { timeZone: "America/Los_Angeles" }).days.map(day => [day.date, day.sessions])).toEqual([["2026-03-08", 2]]);
    expect(() => deriveTrainingStats(history, { timeZone: "invalid-zone" })).toThrow();
  });
  test("custom exercise Chinese muscle metadata is account-local and snapshots survive deletion", () => {
    const catalogue = findExercise("0025"); if (!catalogue) throw new Error("fixture missing");
    const custom: FitnessExercise = { ...catalogue, id: "custom-chest", name: "测试自定义", categoryId: "bodyweight", primaryMuscleIds: ["胸肌"], primaryMuscles: ["胸肌"], secondaryMuscleIds: ["肱三头肌"], secondaryMuscles: ["肱三头肌"] };
    const plan = routine(); plan.exercises[0].exerciseId = custom.id; plan.exercises[0].name = custom.name;
    const noSnapshot = finished(plan); expect(deriveTrainingStats([noSnapshot]).muscleSets.chest ?? 0).toBe(0);
    const withCustom = deriveTrainingStats([noSnapshot], { customExercises: [custom] }); expect(withCustom.muscleSets.chest).toBe(3); expect(withCustom.muscleSets.triceps).toBeCloseTo(1.2);
    expect(deriveRecovery([noSnapshot], { now: NOW + 3600000, customExercises: [custom] }).find(row => row.id === "chest")?.fatigue).toBeGreaterThan(0);
    expect(deriveTrainingStats([noSnapshot]).muscleSets.chest ?? 0).toBe(0); expect(findExercise(custom.id)).toBeUndefined();
    const started = startTrainingWorkout(plan, { now: NOW, customExercises: [custom] }); workoutDataSchema.parse(started);
    expect(started.exercises[0].muscleSnapshot?.primaryMuscles).toEqual(["chest"]);
    const snapshotHistory = { ...finishTrainingWorkout({ ...started, exercises: started.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map(set => ({ ...set, completed: true })) })) }, NOW + 1800000), id: "snapshotted" };
    expect(deriveTrainingStats([snapshotHistory]).muscleSets.chest).toBe(3);
    expect(deriveRecovery([snapshotHistory], { now: NOW + 3600000 }).find(row => row.id === "chest")?.fatigue).toBeGreaterThan(0);
  });
  test("incline, explicit bodyweight, dumbbell meaning and exclusions survive the own-data adapter", () => {
    const plan = routine(); const entry = plan.exercises[0]; entry.bodyweight = false; entry.dbLoad = "total"; entry.loadKind = "single"; entry.noProg = true; entry.sets[0].inclinePercent = 12.5;
    const workout = finished(plan); workout.mediaIds = ["technique-clip"];
    const restored = fromUpstreamWorkout(toUpstreamWorkout(workout));
    expect(restored.mediaIds).toEqual(["technique-clip"]);
    expect(restored.exercises[0].bodyweight).toBe(false); expect(restored.exercises[0].dbLoad).toBe("total"); expect(restored.exercises[0].loadKind).toBe("single"); expect(restored.exercises[0].noProg).toBe(true); expect(restored.exercises[0].sets[0].inclinePercent).toBe(12.5);
    const advancing = routine("linear"); const good = finished(advancing); const excluded = setWorkoutProgressionExcluded(finished(advancing, 0, NOW + 86400000), true);
    expect(calculateNextPrescription({ routine: advancing, exercise: advancing.exercises[0], routineId: "routine-1", workouts: [good, { ...excluded, id: "excluded" }] }).weight).toBe(62.5);
    advancing.noProg = true; expect(calculateNextPrescription({ routine: advancing, exercise: advancing.exercises[0], workouts: [good] }).kind).toBe("off");
  });
  test("owned dumbbell rack controls the next load and per-hand meaning changes volume", () => {
    const metadata = fitnessExercises.find(exercise => exercise.englishName === "dumbbell bench press"); if (!metadata) throw new Error("fixture missing");
    const plan = routine("linear"); plan.exercises[0].exerciseId = metadata.id; plan.exercises[0].dbLoad = "each"; plan.exercises[0].sets.forEach(set => set.weight = 20);
    const history = finished(plan); expect(deriveTrainingStats([history]).volumeKg).toBe(600);
    expect(calculateNextPrescription({ routine: plan, routineId: "routine-1", exercise: plan.exercises[0], workouts: [history], equipment: { dumbbells: { kg: [10, 20, 30] } } }).weight).toBe(30);
    const load = exercisePlateLoad(routine().exercises[0], 60, "kg", { equipment: { plates: { kg: [{ weight: 10, pairs: 2 }] }, barWeights: { kg: { "0025": 20 } } } });
    expect(load.baseWeight).toBe(20); expect(load.plates).toEqual([10, 10]); expect(load.missing).toBe(0);
  });
  test("combined sessions retain routine ownership and repeat/save-as-routine leave history unchanged", () => {
    const one = routine(); one.exercises[0].sets[0] = { ...one.exercises[0].sets[0], kind: "drop", drops: [{ weight: 40, reps: 5 }] }; const two = routine(); two.title = "第二计划"; two.noProg = true;
    const combined = startCombinedTrainingWorkout([{ id: "r-one", data: one }, { id: "r-two", data: two }], { now: NOW }); workoutDataSchema.parse(combined);
    expect(combined.routineIds).toEqual(["r-one", "r-two"]); expect(combined.exercises.map(entry => entry.routineId)).toEqual(["r-one", "r-two"]); expect(combined.exercises[1].noProg).toBe(true);
    const completed = finishTrainingWorkout(markWorkoutSetsComplete(combined, NOW + 60000), NOW + 120000);
    const copied = routineFromWorkout(completed, { title: "从记录保存", routines: [{ id: "r-one", data: one }, { id: "r-two", data: two }] }); routineDataSchema.parse(copied); expect(copied.exercises).toHaveLength(2);
    expect(combined.exercises[0].sets[0].drops).toEqual([{ weight: 40, reps: 5 }]); expect(copied.exercises[0].sets[0].drops).toEqual([{ weight: 40, reps: 5 }]);
    const repeated = repeatTrainingWorkout(completed, { now: NOW + 86400000 }); expect(repeated.skipped).toBe(0); expect(repeated.workout.exercises.flatMap(entry => entry.sets).every(set => !set.completed)).toBe(true);
    expect(completed.exercises[0].sets[0].completed).toBe(true); expect(repeated.workout.startedAt).toBe(NOW + 86400000);
    expect(repeated.workout.exercises[0].sets[0].drops).toEqual([{ weight: 40, reps: 5 }]);
  });
  test("backfill excludes later history and preserves replaced notes and workout media", () => {
    const plan = routine("linear"); const before = finished(plan, 5, NOW - 86400000); const future = finished(plan, 5, NOW + 86400000); future.exercises[0].sets.forEach(set => set.weight = 100);
    const logged = startBackfillWorkout(plan, { day: "2026-01-10", time: "18:00", durationMinutes: 45, timeZone: "Asia/Shanghai", routineId: "routine-1", workouts: [before, future], replaceId: "old" });
    expect(logged.exercises[0].sets[0].weight).toBe(62.5);
    const saved = finishBackfillWorkout(markWorkoutSetsComplete(logged, logged.startedAt), { ...before, notes: "原记录备注", mediaIds: ["original-photo"] });
    expect(saved.finishedAt).toBe(saved.startedAt + 45 * 60000); expect(saved.notes).toBe("原记录备注"); expect(saved.mediaIds).toEqual(["original-photo"]);
  });
  test("session bodyweight snapshots choose only measurements at or before their actual start", () => {
    const measurements = [{ at: NOW - 1, weightKg: 80, circumferences: {}, photoMediaIds: [], notes: "" }, { at: NOW + 1, weightKg: 90, circumferences: {}, photoMediaIds: [], notes: "" }];
    const started = startTrainingWorkout(routine(), { now: NOW, measurements }); expect(started.bodyWeightKg).toBe(80);
    expect(startCombinedTrainingWorkout([{ id: "r", data: routine() }], { now: NOW, measurements }).bodyWeightKg).toBe(80);
    expect(repeatTrainingWorkout(finished(), { now: NOW, measurements }).workout.bodyWeightKg).toBe(80);
    expect(startBackfillWorkout(routine(), { day: "2026-01-10", time: "12:00", durationMinutes: 30, timeZone: "UTC", measurements }).bodyWeightKg).toBe(80);
  });
  test("scheduled fourth-week deload reduces real work load and is excluded from progression", () => {
    const schedule = trainingScheduleDataSchema.parse({ title: "周期训练", mode: "weekly", timeZone: "Asia/Shanghai", anchorDate: "2026-01-05", deloadEveryWeeks: 4, deloadPercent: 20 });
    const at = Date.UTC(2026, 0, 26, 10); expect(scheduledDeload(schedule, at).active).toBe(true); expect(scheduledDeload(schedule, NOW).active).toBe(false);
    const started = startTrainingWorkout(routine("linear"), { now: at, schedule }); expect(started.noProg).toBe(true); expect(started.exercises[0].noProg).toBe(true); expect(started.exercises[0].sets[0].weight).toBe(48);
    const rotation = { ...schedule, anchorDate: "2026-01-27", deloadAnchorDate: "2026-01-05" }; expect(scheduledDeload(rotation, at).active).toBe(true);
  });
  test("active swap requires logged/group confirmation without relabelling old results", () => {
    const workout = startTrainingWorkout(routine(), { now: NOW });
    const first = workout.exercises[0]; first.groupId = "pair"; first.routineId = "owner"; first.sets[0] = { ...first.sets[0], completed: true, completedAt: NOW };
    const second = { ...first, id: "member-2", exerciseId: "0046", sets: first.sets.map(set => ({ ...set, id: "second-" + set.id, completed: false, completedAt: null })) };
    workout.exercises.push(second); const replacement = { ...second, id: "new-entry", name: "替换动作", groupId: undefined };
    expect(swapTrainingExercise(workout, first.id, replacement).needsConfirmation).toBe(true);
    expect(swapTrainingExercise(workout, first.id, replacement, { loggedConfirmed: true }).needsConfirmation).toBe(true);
    const detached = swapTrainingExercise(workout, first.id, replacement, { loggedConfirmed: true, groupDisposition: "detach" });
    expect(detached.changed).toBe(true); expect(detached.inserted).toBe(true); expect(detached.workout.exercises.map(entry => entry.id)).toEqual([first.id, second.id, replacement.id]);
    expect(detached.workout.exercises[0].sets).toEqual(first.sets); expect(detached.workout.exercises[2].groupId).toBeUndefined(); expect(detached.workout.exercises[2].routineId).toBe("owner"); expect(detached.workout.exercises[2].sets.every(set => !set.completed && set.completedAt === null)).toBe(true);
    const kept = swapTrainingExercise(workout, first.id, replacement, { loggedConfirmed: true, groupDisposition: "keep" }); expect(kept.workout.exercises[1].groupId).toBe("pair");
    const unlogged = swapTrainingExercise(workout, second.id, replacement); expect(unlogged.inserted).toBe(false); expect(unlogged.workout.exercises).toHaveLength(2); expect(unlogged.workout.exercises[1].groupId).toBe("pair");
    expect(workout.exercises).toHaveLength(2); expect(() => swapTrainingExercise(workout, first.id, first)).toThrow("新的记录编号");
  });
  test("reordering moves whole supergroups and removal keeps completed set identities", () => {
    const workout = startTrainingWorkout(routine(), { now: NOW }); const first = workout.exercises[0]; first.groupId = "pair"; first.sets[0] = { ...first.sets[0], completed: true, completedAt: NOW };
    workout.exercises.push({ ...first, id: "member-2", sets: first.sets.map(set => ({ ...set, id: "member-" + set.id })) }, { ...first, id: "single", groupId: undefined });
    expect(moveTrainingExercise(workout, first.id, 1).exercises.map(entry => entry.id)).toEqual(["single", first.id, "member-2"]);
    expect(moveTrainingExercise(workout, first.id, -1)).toBe(workout); const trimmed = removeUnfinishedTrainingExercise(workout, first.id); expect(trimmed.exercises[0].sets).toEqual([first.sets[0]]); expect(trimmed.exercises[0].id).toBe(first.id);
    const unlogged = { ...workout, exercises: [{ ...first, sets: first.sets.map(set => ({ ...set, completed: false })) }] }; expect(removeUnfinishedTrainingExercise(unlogged, first.id).exercises).toHaveLength(0); expect(workout.exercises[0].sets).toHaveLength(3);
  });
  test("day notes are typed, clearable tombstones and cannot excuse future dates", () => {
    const notes = updateFitnessDayNote({}, "2026-01-10", { tag: "sick", text: "休息" }, { now: NOW, timeZone: "Asia/Shanghai" });
    expect(fitnessDayExcused(notes, "2026-01-10")).toBe(true); expect(notes["2026-01-10"].at).toBe(NOW);
    const cleared = updateFitnessDayNote(notes, "2026-01-10", null, { now: NOW + 1, timeZone: "Asia/Shanghai" }); expect(fitnessDayExcused(cleared, "2026-01-10")).toBe(false); expect(cleared["2026-01-10"].at).toBe(NOW + 1);
    expect(() => updateFitnessDayNote(notes, "2026-01-11", { text: "future" }, { now: NOW, timeZone: "Asia/Shanghai" })).toThrow();
  });
});
describe("real import dialect fixtures", () => {
  test("upstream warm-up provenance and Gravl seconds", () => {
    const warm = parseFitnessCsv(cases.warmupCsv); expect(warm.workouts).toHaveLength(1);
    expect(warm.workouts[0].exercises[0].sets[0].kind).toBe("warmup"); expect(deriveTrainingStats(warm.workouts).volumeKg).toBe(1055);
    const gravl = parseFitnessCsv(cases.gravlCsv); expect(gravl.workouts).toHaveLength(2); expect(gravl.workouts[1].exercises[0].sets[0].durationSeconds).toBe(24);
    warm.workouts.forEach(workout => { const { id: _id, ...data } = workout; workoutDataSchema.parse(data); });
  });
  test("FitNotes, Strong and Hevy CSV headers", () => {
    const files = [
      "Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment\n2026-01-10,Bench Press,Chest,60,kg,5,,,,",
      "Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n2026-01-10,Push,Bench Press,1,60,5,,,,,",
      'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\n"训练","10 Jan 2026, 18:00","10 Jan 2026, 19:00","","Bench Press (Barbell)",,"",0,normal,60,5,,,',
    ];
    for (const csv of files) { const parsed = parseFitnessCsv(csv); expect(parsed.workouts).toHaveLength(1); expect(deriveTrainingStats(parsed.workouts).volumeKg).toBe(300); }
  });
  test("Chinese CSV headers and unique Chinese catalogue names resolve canonical ids", () => {
    const name = findExercise("0025")?.name;
    const result = parseFitnessCsv(`日期,动作,重量,重量单位,次数\n2026-01-10,${name},60,kg,5`);
    expect(result.workouts[0].exercises[0].exerciseId).toBe("0025"); expect(result.customExercises).toHaveLength(0);
  });
  test("Apple Health mixed units, daily records, and inert XML external entities", () => {
    const xml = '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///not-read">]><HealthData><Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-01-01 12:00:00 +0000"/><Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="176.3698" startDate="2026-01-02 12:00:00 +0000"/></HealthData>';
    const parsed = parseAppleHealthWeight(xml); expect(parsed.measurements.map(value => value.weightKg)).toEqual([80, 80]);
  });
  test("Hevy API parsers preserve units, custom exercises and routine supersets", () => {
    const templates = [{ id: "synthetic-custom", title: "自定义测试", equipment: "other", primary_muscle_group: "other" }];
    const workouts = parseHevyWorkouts([{ id: "h1", title: "测试", start_time: "2026-01-10T12:00:00Z", end_time: "2026-01-10T13:00:00Z", exercises: [{ exercise_template_id: "synthetic-custom", title: "自定义测试", sets: [{ type: "normal", weight_kg: 60, reps: 5 }] }] }], templates);
    expect(workouts.workouts).toHaveLength(1); expect(workouts.customExercises).toHaveLength(1);
    expect(parseHevyBodyweight([{ date: "2026-01-10", weight_kg: 80 }]).measurements[0].weightKg).toBe(80);
    expect(parseHevyRoutines([{ id: "h", title: "测试计划", exercises: [{ exercise_template_id: "synthetic-custom", title: "自定义测试", sets: [{ type: "normal", weight_kg: 60, reps: 5 }] }] }], templates).routines).toHaveLength(1);
  });
});
describe("portable backups, plans, bodies and scheduling", () => {
  test("strict JSON backup round trip and unsupported version rejection", () => { const value = backup(); expect(parseFitnessBackup(serializeFitnessBackup(value))).toEqual(value); expect(() => parseFitnessBackup({ ...value, version: 2 })).toThrow(); });
  test("streamed stored ZIP with synthetic media hashes, no extraction and corruption rejection", async () => {
    const value = backup(); const zip = await exportFitnessBackupZip(value, [{ id: "photo-1", name: "fixture.png", mime: "image/png", blob: new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])]) }]);
    const restored = await importFitnessBackupZip(zip); expect(restored.backup).toEqual(value); expect(restored.media[0].blob.size).toBe(7);
    const bytes = new Uint8Array(await zip.arrayBuffer()); const position = bytes.findIndex((byte, index) => byte === 137 && bytes[index + 1] === 80); expect(position).toBeGreaterThan(0); bytes[position + 4] ^= 1;
    await expect(importFitnessBackupZip(new Blob([bytes]))).rejects.toThrow("媒体校验失败");
  });
  test("backup media uses the shared 10 MiB image and 50 MiB video policy", async () => {
    const value = backup();
    await expect(exportFitnessBackupZip(value, [{ id: "large-image", name: "fixture.png", mime: "image/png", blob: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) }])).rejects.toThrow("10 MB");
    await expect(exportFitnessBackupZip(value, [{ id: "large-video", name: "fixture.webm", mime: "video/webm", blob: new Blob([new Uint8Array(50 * 1024 * 1024 + 1)]) }])).rejects.toThrow("50 MB");
    const webm = await exportFitnessBackupZip(value, [{ id: "video", name: "fixture.webm", mime: "video/webm", blob: new Blob([new Uint8Array([26, 69, 223, 163])]) }]);
    expect((await importFitnessBackupZip(webm)).media[0].mime).toBe("video/webm");
  });
  test("custom image, GIF and video references survive JSON/ZIP and missing files are rejected", async () => {
    const catalogue = findExercise("0025"); if (!catalogue) throw new Error("fixture missing");
    const custom = { ...catalogue, id: "custom-with-media", mediaIds: ["photo", "animation", "clip"] };
    const value = createFitnessBackup({ ...backup(), customExercises: [custom], measurements: [{ at: NOW, circumferences: {}, photoMediaIds: ["photo"], notes: "" }] }, NOW);
    expect(parseFitnessBackup(serializeFitnessBackup(value)).customExercises[0].mediaIds).toEqual(custom.mediaIds);
    expect(fitnessBackupMediaIds(value)).toEqual(["photo", "animation", "clip"]);
    await expect(exportFitnessBackupZip(value)).rejects.toThrow("备份缺少引用的媒体文件");
    const media = [{ id: "photo", name: "fixture.png", mime: "image/png", blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]) }, { id: "animation", name: "fixture.gif", mime: "image/gif", blob: new Blob(["GIF89a"]) }, { id: "clip", name: "fixture.mp4", mime: "video/mp4", blob: new Blob([new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0])]) }];
    const restored = await importFitnessBackupZip(await exportFitnessBackupZip(value, media));
    expect(restored.backup.customExercises[0].mediaIds).toEqual(custom.mediaIds); expect(restored.media.map(item => item.mime)).toEqual(["image/png", "image/gif", "video/mp4"]);
    for (let index = 0; index < media.length; index++) expect(await restored.media[index].blob.arrayBuffer()).toEqual(await media[index].blob.arrayBuffer());
    const missing = { ...value, customExercises: [{ ...custom, mediaIds: ["not-in-manifest"] }] };
    const archive = await zipStore([{ name: "backup.json", blob: new Blob([serializeFitnessBackup(missing)]) }, { name: "media.json", blob: new Blob(["[]"]) }]);
    await expect(importFitnessBackupZip(archive)).rejects.toThrow("备份缺少引用的媒体文件");
    expect(() => parseFitnessBackup({ ...value, customExercises: [{ ...custom, mediaIds: ["../path"] }] })).toThrow();
  });
  test("workout media, equipment and day notes remain complete through backup and legacy metadata migration", async () => {
    const value = backup(); value.workouts[0].mediaIds = ["workout-photo"]; value.equipment = { plates: { kg: [{ weight: 20, pairs: 2 }] }, dumbbells: { kg: [10, 20] }, barWeights: { kg: { "0025": 15 } }, dbLoad: { "0025": "total" }, loadKind: { "0025": "pairs" } }; value.dayNotes = { "2026-01-10": { tag: "travel", text: "休息", at: NOW } };
    const media = [{ id: "workout-photo", name: "fixture.png", mime: "image/png", blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]) }];
    expect(fitnessBackupMediaIds(value)).toEqual(["workout-photo"]); const restored = await importFitnessBackupZip(await exportFitnessBackupZip(value, media));
    expect(restored.backup.equipment).toEqual(value.equipment); expect(restored.backup.dayNotes).toEqual(value.dayNotes); expect(restored.backup.workouts[0].mediaIds).toEqual(["workout-photo"]);
    const legacy = parseOpenGymBackup({ workouts: [], unit: "kg", plates: { kg: { "20": 2, _ts: NOW } }, dumbbells: { kg: { weights: [10, 20] } }, barWeights: { "0025": 15 }, dbLoad: { "0025": { mode: "total" } }, loadKind: { "0025": { kind: "pairs" } }, dayNotes: { "2026-01-10": { tag: "sick", text: "休息", _ts: NOW } } });
    expect(legacy.equipment?.plates?.kg).toEqual([{ weight: 20, pairs: 2 }]); expect(legacy.equipment?.barWeights?.kg?.["0025"]).toBe(15); expect(legacy.dayNotes?.["2026-01-10"].tag).toBe("sick");
    expect(() => parseFitnessBackup({ ...value, dayNotes: [] })).toThrow();
  });
  test("original openGym stored ZIP remaps own exercise/workout media by original byte hash", async () => {
    const bytes = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0]);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const ref = { kind: "gif", hash, mime: "image/gif", size: bytes.length, width: 1, height: 1 };
    const state = { routines: [], customEx: [{ id: "own", name: "原动作", media: ref }], workouts: [{ id: "w", d: "2026-01-10", media: [ref], entries: [] }] };
    const zip = await zipStore([{ name: "opengym-backup.json", blob: new Blob([JSON.stringify(state)]) }, { name: `media/${hash}.gif`, blob: new Blob([bytes]) }, { name: "README.txt", blob: new Blob(["synthetic fixture"]) }]);
    const restored = await importOpenGymBackupZip(zip); expect(restored.warnings).toHaveLength(0); expect(restored.media).toHaveLength(1);
    expect(new Uint8Array(await restored.media[0].blob.arrayBuffer())).toEqual(bytes);
    expect(restored.backup.customExercises[0].mediaIds).toEqual([restored.media[0].id]); expect(restored.backup.workouts[0].mediaIds).toEqual([restored.media[0].id]);
    const damaged = await zipStore([{ name: "opengym-backup.json", blob: new Blob([JSON.stringify(state)]) }, { name: `media/${hash}.gif`, blob: new Blob(["tampered"]) }]);
    const refused = await importOpenGymBackupZip(damaged); expect(refused.media).toHaveLength(0); expect(refused.warnings).toHaveLength(1); expect(refused.backup.customExercises[0].mediaIds).toEqual([]);
  });
  test("upstream backup excludes account material and preserves workout data", () => { const value = parseOpenGymBackup({ unit: "kg", routines: [{ id: "r", name: "计划", ex: [{ id: "0025", sets: 3, reps: 5, weight: 60 }] }], workouts: [], bodyweight: [{ d: "2026-01-01", w: 80 }], secret: "synthetic-ignored", coach: { apiKey: "synthetic-ignored" } }); expect(value.routines[0].data.exercises[0].sets).toHaveLength(3); expect(JSON.stringify(value)).not.toContain("synthetic-ignored"); });
  test("starter templates and share export carry no workout history", () => {
    const plan = buildStarterFitnessPlan("ppl"); expect(plan.routines).toHaveLength(3); expect(plan.schedules[0].week["1"]).toBe(plan.routines[0].id);
    const shared = shareFitnessPlan("计划", plan.routines, plan.schedules); expect(parseFitnessPlan(shared)).toEqual({ ...plan, title: "计划" }); expect(shared).not.toContain("startedAt"); expect(planPdfData(plan.routines[0].data).exercises.length).toBeGreaterThan(0);
  });
  test("plan print data keeps advanced sub-sets, effort, incline and per-hand load semantics", () => {
    const plan = routine(); plan.exercises[0].dbLoad = "each";
    plan.exercises[0].sets[0] = { ...plan.exercises[0].sets[0], kind: "drop", drops: [{ weight: 40, reps: 5 }], restPause: [{ reps: 3, restSeconds: 20 }], rpe: 8, rir: 2, inclinePercent: 5, restSeconds: 45 };
    const printed = planPdfData(plan).exercises[0].sets[0];
    for (const value of ["递减至 40 kg × 5 次", "休息 20 秒后 3 次", "RPE 8", "RIR 2", "坡度 5%", "休息 45 秒", "每手"]) expect(printed).toContain(value);
    const pyramid = routine(); pyramid.exercises[0].pyramid = { reps: [12, 8, 6], weights: [40, 50, 60] };
    expect(planPdfData(pyramid).exercises[0].sets.map(set => set.split(" · ")[0])).toEqual(["40 kg × 12 次", "50 kg × 8 次", "60 kg × 6 次"]);
  });
  test("weekly overrides and rotation advancement are immutable", () => {
    const schedule = trainingScheduleDataSchema.parse({ title: "训练", mode: "weekly", week: { "1": "r" }, timeZone: "Asia/Shanghai" });
    expect(scheduledRoutineId(schedule, "2026-01-12")).toBe("r"); expect(scheduledRoutineId(schedule, "2026-01-12", { "2026-01-12": null })).toBeNull();
    const rotation = { ...schedule, mode: "rotation", rotation: ["r", "r2"] }; const parsed = trainingScheduleDataSchema.parse(rotation); expect(scheduledRoutineId(advanceRotation(parsed), "2026-01-12")).toBe("r2"); expect(parsed.position).toBe(0);
    const anchored = trainingScheduleDataSchema.parse({ ...rotation, anchorDate: "2026-01-12", restDays: [2] });
    expect(scheduledRoutineId(anchored, "2026-01-11")).toBeNull(); expect(scheduledRoutineId(anchored, "2026-01-13")).toBeNull(); expect(scheduledRoutineId(anchored, "2026-01-14")).toBe("r2");
  });
  test("legacy deleted custom muscle snapshots survive the JSON migration", () => {
    const value = parseOpenGymBackup({ routines: [], workouts: [{ id: "old", d: "2026-01-10", entries: [{ id: "deleted-custom", n: "已删除动作", muscleSnapshot: { muscleWeights: { chest: 1, triceps: 0.4 } }, sets: [{ w: 60, r: 5, done: true }] }] }] });
    expect(value.workouts[0].exercises[0].muscleSnapshot?.primaryMuscles).toEqual(["chest"]);
    expect(deriveTrainingStats(value.workouts).muscleSets.chest).toBe(1); expect(deriveTrainingStats(value.workouts).muscleSets.triceps).toBe(0.4);
  });
  test("body trends, exact plates, structural balance and local-only SVG", () => {
    expect(deriveBodyTrends([{ at: NOW, weightKg: 80, circumferences: { waist: 90 }, photoMediaIds: [], notes: "" }, { at: NOW + 1, weightKg: 79, circumferences: {}, photoMediaIds: [], notes: "" }]).find(row => row.field === "weightKg")?.delta).toBe(-1);
    expect(calculatePlateLoad(100).loaded).toBe(100); expect(calculatePlateLoad(100).missing).toBe(0);
    expect(deriveStructuralBalance([finished()], []).length).toBeGreaterThan(0);
    expect(muscleMapSvg({ values: { chest: 1 } })).toContain("<path"); expect(exerciseCategorySvg()).not.toMatch(/https?:\/\/[^w]|<image|<script/);
  });
  test("Garmin FIT is a real binary container and CSV exports completed sets", () => {
    const workout = finished(); const fit = exportWorkoutFit(workout);
    expect(new TextDecoder().decode(fit.slice(8, 12))).toBe(".FIT");
    expect(fit.byteLength).toBeGreaterThan(100);
    expect(parseFitnessCsv(exportWorkoutsCsv([workout])).workouts).toHaveLength(1);
  });
});
