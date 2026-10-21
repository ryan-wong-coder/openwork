import demos from "../../../apps/app/src/react-app/domains/zeno/mascot-demos.json";
import { canonicalExerciseId, findExercise, fitnessExercises, searchExercises, type ExerciseSearch } from "./catalogue.js";
import type { FitnessExercise } from "./types.js";

export type OriginalExerciseDemo = { kind: "mascot" | "diagram"; video: string; poster: string };
export type AgentExercise = FitnessExercise & { exerciseId: string; source: "builtin" | "custom"; demo: OriginalExerciseDemo | null };
const demosById = new Map(demos.map(demo => [demo.exerciseId, demo]));

/** These are public PWA resource paths, never native file URLs or upstream media. */
export function originalExerciseDemo(exercise: Pick<FitnessExercise, "id" | "englishName" | "bodyPartId">): OriginalExerciseDemo | null {
  if (exercise.bodyPartId === "custom") return null;
  const demo = demosById.get(canonicalExerciseId(exercise.id));
  if (!demo || demo.englishName !== exercise.englishName) return null;
  return { kind: demo.kind === "diagram" ? "diagram" : "mascot", video: `/app/zeno/fitness/${demo.stem}.mp4`, poster: `/app/zeno/fitness/${demo.stem}-poster.webp` };
}
export function agentExercise(exercise: FitnessExercise): AgentExercise {
  return { ...exercise, exerciseId: exercise.id, source: exercise.bodyPartId === "custom" ? "custom" : "builtin", demo: originalExerciseDemo(exercise) };
}
/** Exact IDs resolve only to the current account's custom entries or canonical built-ins. */
export function findAgentExercise(id: string, customExercises: readonly FitnessExercise[] = []): AgentExercise | undefined {
  const exercise = customExercises.find(item => item.id === id) ?? findExercise(id);
  return exercise ? agentExercise(exercise) : undefined;
}
export function searchAgentExercises(filter: ExerciseSearch = {}): AgentExercise[] {
  return searchExercises({ ...filter, equipment: undefined, limit: fitnessExercises.length + (filter.customExercises?.length ?? 0) })
    .filter(exercise => !filter.equipment?.length || filter.equipment.some(value => exercise.equipmentId === value || exercise.equipment === value || exercise.bodyPartId === "custom" && exercise.equipment.split("、").includes(value)))
    .map(agentExercise);
}
export const agentCatalogueCoverage = { builtinExercises: fitnessExercises.length, originalDemonstrations: demos.filter(demo => findExercise(demo.exerciseId)?.englishName === demo.englishName).length };
