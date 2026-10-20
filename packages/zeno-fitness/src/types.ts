import type { Progression, TrainingSet as CoreTrainingSet, RoutineExercise as CoreRoutineExercise, RoutineData, WorkoutData, MeasurementData, TrainingScheduleData, MembershipData, FitnessEquipment as CoreFitnessEquipment, FitnessDayNote as CoreFitnessDayNote } from "@zeno/core/schema";
export type FitnessUnit = "kg" | "lb";
export type ProgressionConfig = Progression;
export type ProgressionMode = Progression["mode"];
export type TrainingSet = CoreTrainingSet;
export type TrainingSetKind = TrainingSet["kind"];
export type RoutineExercise = CoreRoutineExercise;
export type TrainingRoutine = RoutineData;
export type TrainingWorkout = WorkoutData;
export type BodyMeasurement = MeasurementData;
export type TrainingSchedule = TrainingScheduleData;
export type MembershipCard = MembershipData;
export type FitnessEquipment = CoreFitnessEquipment;
export type FitnessDayNote = CoreFitnessDayNote;
export type FitnessDayNotes = Readonly<Record<string, FitnessDayNote>>;
export interface FitnessContextOptions { equipment?: FitnessEquipment; dayNotes?: FitnessDayNotes; timeZone?: string }
export interface IdentifiedWorkout extends TrainingWorkout { id: string }
export interface FitnessExercise {
  id: string;
  name: string;
  englishName: string;
  bodyPart: string;
  bodyPartId: string;
  category: string;
  categoryId: string;
  equipment: string;
  equipmentId: string;
  primaryMuscles: string[];
  primaryMuscleIds: string[];
  secondaryMuscles: string[];
  secondaryMuscleIds: string[];
  instructions: string[];
  description: string;
  /** Own uploaded media references, never upstream Gym artwork. */
  mediaIds?: string[];
}
export interface FitnessOption { id: string; label: string }
export interface ImportedFitnessData {
  source: string;
  workouts: IdentifiedWorkout[];
  measurements: BodyMeasurement[];
  routines: Array<{ id: string; data: TrainingRoutine }>;
  customExercises: FitnessExercise[];
  warnings: string[];
}
