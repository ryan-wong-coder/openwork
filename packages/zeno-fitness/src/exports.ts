import { workoutFit, fitFileName } from "../upstream/lib/fit-export.js";
import type { TrainingWorkout } from "./types.js";
import { toUpstreamWorkout } from "./upstream-adapter.js";
import { findExercise } from "./catalogue.js";
import { text } from "./value.js";

export function exportWorkoutFit(workout: TrainingWorkout): Uint8Array {
  const result: unknown = workoutFit(toUpstreamWorkout(workout), { unit: workout.unit, version: "zeno-fitness" });
  if (!(result instanceof Uint8Array)) throw new Error("FIT 导出失败"); return result;
}
export function workoutFitFilename(workout: TrainingWorkout): string { const result: unknown = fitFileName(toUpstreamWorkout(workout)); return text(result, "workout.fit"); }
export function exportWorkoutsCsv(workouts: readonly TrainingWorkout[]): string {
  const cell = (value: string | number | undefined): string => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows: Array<Array<string | number | undefined>> = [["date", "workout name", "exercise", "weight unit", "weight", "reps", "duration seconds", "distance", "distance unit", "set type", "RPE", "RIR"]];
  for (const workout of workouts) for (const exercise of workout.exercises) for (const set of exercise.sets.filter(row => row.completed)) rows.push([new Date(workout.startedAt).toISOString(), workout.title, findExercise(exercise.exerciseId)?.englishName ?? exercise.name, workout.unit, set.weight, set.reps, set.durationSeconds, set.distanceMeters, "m", set.kind === "warmup" ? "Warm-up" : "Working", set.rpe, set.rir]);
  return rows.map(row => row.map(cell).join(",")).join("\r\n");
}
