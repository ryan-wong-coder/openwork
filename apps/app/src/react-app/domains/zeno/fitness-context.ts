import { recordsOfKind } from "@zeno/core";
import type { StartTrainingOptions } from "@zeno/fitness";
import { customFitnessExercises } from "./exercise-picker";
import { personalSettings } from "./personal-settings";
import type { PersonalStore } from "./use-zeno-sync";

export function fitnessContext(store: Pick<PersonalStore, "records">): StartTrainingOptions {
  const settings = personalSettings(store.records);
  return { workouts: recordsOfKind(store.records, "workout").map(({ id, data }) => ({ ...data, id })), measurements: recordsOfKind(store.records, "measurement").map(record => record.data), customExercises: customFitnessExercises(store), equipment: settings.fitnessEquipment, dayNotes: settings.fitnessDayNotes, timeZone: settings.timeZone };
}
