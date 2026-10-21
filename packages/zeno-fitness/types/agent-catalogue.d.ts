/** Public type facade for the bundled Node tool catalogue. No source JSON/JS is typechecked by consumers. */
import type { FitnessExercise } from "../src/types.js";
import type { ExerciseSearch } from "./catalogue.js";

export type OriginalExerciseDemo = { kind: "mascot" | "diagram"; video: string; poster: string };
export type AgentExercise = FitnessExercise & { exerciseId: string; source: "builtin" | "custom"; demo: OriginalExerciseDemo | null };
export declare function originalExerciseDemo(exercise: Pick<FitnessExercise, "id" | "englishName" | "bodyPartId">): OriginalExerciseDemo | null;
export declare function agentExercise(exercise: FitnessExercise): AgentExercise;
export declare function findAgentExercise(id: string, customExercises?: readonly FitnessExercise[]): AgentExercise | undefined;
export declare function searchAgentExercises(filter?: ExerciseSearch): AgentExercise[];
export declare const agentCatalogueCoverage: { builtinExercises: number; originalDemonstrations: number };
