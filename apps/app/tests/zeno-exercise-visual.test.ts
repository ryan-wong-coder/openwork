import { expect, test } from "bun:test";
import { exerciseAliases, findExercise, fitnessExercises } from "@zeno/fitness";
import { exerciseForWorkoutEntry, exerciseMuscleValues, interpolatePose, mascotDemoForExercise, movementForExercise, movementProgress, movementScenes } from "../src/react-app/domains/zeno/movement-scenes";
import { routineExerciseSchema } from "@zeno/core";

test("all eleven original scenes match exactly one real canonical catalogue entry", () => {
  expect(movementScenes).toHaveLength(11); expect(new Set(movementScenes.map(scene => scene.exerciseId)).size).toBe(11);
  for (const scene of movementScenes) {
    const exercise = findExercise(scene.exerciseId); if (!exercise) throw new Error("Missing exercise");
    expect(exercise.englishName).toBe(scene.englishName); expect(movementForExercise(exercise)).toBe(scene);
  }
  expect(fitnessExercises.filter(exercise => movementForExercise(exercise))).toHaveLength(11);
});
test("three mascot clips apply only to their exact matching exercise and equipment", () => {
  expect(fitnessExercises.filter(exercise => mascotDemoForExercise(exercise)).map(exercise => exercise.id).sort()).toEqual(["0294", "0405", "1197"]);
  const loadedSquat = findExercise("3593"); if (!loadedSquat) throw new Error("Missing exercise");
  expect(mascotDemoForExercise(loadedSquat)).toBeUndefined();
  expect(new Set(fitnessExercises.flatMap(exercise => mascotDemoForExercise(exercise)?.video ?? []))).toHaveProperty("size", 3);
});
test("workout detail resolves account-local media and retains deleted custom muscle snapshots", () => {
  const builtin = routineExerciseSchema.parse({ id: "entry", exerciseId: "0025", name: "杠铃卧推", sets: [] });
  expect(exerciseForWorkoutEntry(builtin, []).id).toBe("0025");
  const entry = routineExerciseSchema.parse({ ...builtin, exerciseId: "deleted-custom", name: "旧动作", muscleSnapshot: { primaryMuscles: ["胸肌"], secondaryMuscles: ["肱三头肌"], equipment: "弹力带", bodyPart: "上身" } });
  const fallback = exerciseForWorkoutEntry(entry, []);
  expect(fallback.name).toBe("旧动作"); expect(fallback.equipment).toBe("弹力带"); expect(exerciseMuscleValues(fallback)).toEqual({ chest: 1, triceps: .4 }); expect(movementForExercise(fallback)).toBeUndefined();
  expect(exerciseForWorkoutEntry(entry, [{ ...fallback, mediaIds: ["private-custom-video"] }]).mediaIds).toEqual(["private-custom-video"]);
});
test("variants, custom identities and name substitutions never receive another technique", () => {
  const exercise = findExercise("0025"); if (!exercise) throw new Error("Missing exercise");
  expect(movementForExercise({ ...exercise, id: "custom-0025", bodyPartId: "custom" })).toBeUndefined();
  expect(movementForExercise({ ...exercise, bodyPartId: "custom" })).toBeUndefined();
  expect(movementForExercise({ ...exercise, englishName: "incline bench press" })).toBeUndefined();
  expect(movementForExercise({ ...exercise, id: "not-a-canonical-id" })).toBeUndefined();
  const alias = Object.entries(exerciseAliases).find(([, id]) => id === exercise.id);
  if (alias) expect(movementForExercise({ ...exercise, id: alias[0] })).toBe(movementForExercise(exercise));
});
test("all original frames and interpolated joints remain finite and inside the viewbox", () => {
  for (const scene of movementScenes) for (const progress of [-1, 0, .25, .5, .75, 1, 2, Number.NaN]) {
    const frame = interpolatePose(scene, progress);
    for (const [x, y] of Object.values(frame)) { expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true); expect(x).toBeGreaterThanOrEqual(12); expect(x).toBeLessThanOrEqual(308); expect(y).toBeGreaterThanOrEqual(12); expect(y).toBeLessThanOrEqual(228); }
    if (progress <= 0 || Number.isNaN(progress)) expect(frame).toEqual(scene.start);
    if (progress >= 1) expect(frame).toEqual(scene.end);
  }
});
test("illustration cycle holds both endpoints and returns seamlessly", () => {
  expect(movementProgress(0)).toBe(0); expect(movementProgress(100)).toBe(0);
  expect(movementProgress(2400)).toBe(1); expect(movementProgress(4800)).toBe(0);
  for (const time of [500, 1000, 2000, 3000, 4000]) { expect(movementProgress(time)).toBeGreaterThanOrEqual(0); expect(movementProgress(time)).toBeLessThanOrEqual(1); expect(movementProgress(time + 4800)).toBeCloseTo(movementProgress(time)); }
});
test("muscle intensity distinguishes primary, secondary, Chinese custom labels and unknown labels", () => {
  expect(exerciseMuscleValues({ primaryMuscleIds: ["chest"], secondaryMuscleIds: ["triceps", "chest"] })).toEqual({ triceps: .4, chest: 1 });
  expect(exerciseMuscleValues({ primaryMuscleIds: ["胸肌"], secondaryMuscleIds: ["肱三头肌", "arbitrary", "<script>"] })).toEqual({ triceps: .4, chest: 1 });
  for (const exercise of fitnessExercises) for (const value of Object.values(exerciseMuscleValues(exercise))) expect([.4, 1]).toContain(value);
});
