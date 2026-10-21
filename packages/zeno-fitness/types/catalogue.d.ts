/** Public type facade for the bundled Node catalogue; implementation stays in src/catalogue.ts. */
import type { FitnessExercise, FitnessOption } from "../src/types.js";

export interface ExerciseSearch { query?: string; muscles?: string[]; equipment?: string[]; category?: string; bodyPart?: string; limit?: number; customExercises?: FitnessExercise[] }
export declare const muscleLabels: Readonly<Record<string, string>>;
export declare function canonicalExerciseId(id: string): string;
export declare function exerciseFromUpstream(value: unknown): FitnessExercise;
export declare const fitnessExercises: readonly FitnessExercise[];
export declare function findExercise(id: string): FitnessExercise | undefined;
export declare const exerciseAliases: Readonly<Record<string, string>>;
export declare const equipmentOptions: FitnessOption[];
export declare const muscleOptions: FitnessOption[];
export declare const categoryOptions: FitnessOption[];
export declare const bodyPartOptions: FitnessOption[];
export declare function searchExercises(filter?: ExerciseSearch): FitnessExercise[];
export declare const catalogueCoverage: { canonicalExercises: number; aliases: number; chineseNames: number; chineseInstructions: number; restrictedMediaFiles: number };
