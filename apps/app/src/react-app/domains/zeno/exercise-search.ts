import { fitnessExercises, searchExercises, type ExerciseSearch, type FitnessExercise } from "@zeno/fitness";
import { mascotDemoForExercise } from "./movement-scenes";

/** Keep exact query matches first, then make completed demonstrations discoverable. */
export function searchExercisesForPicker(filter: ExerciseSearch = {}): FitnessExercise[] {
  const query = (filter.query ?? "").normalize("NFKC").trim().toLocaleLowerCase();
  const matches = searchExercises({ ...filter, limit: fitnessExercises.length + (filter.customExercises?.length ?? 0) });
  return matches.sort((left, right) =>
    Number(right.name.startsWith(query)) - Number(left.name.startsWith(query))
    || Number(Boolean(mascotDemoForExercise(right))) - Number(Boolean(mascotDemoForExercise(left))))
    .slice(0, Math.max(0, filter.limit ?? 100));
}
