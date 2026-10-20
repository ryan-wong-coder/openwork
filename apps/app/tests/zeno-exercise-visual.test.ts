import { expect, test } from "bun:test";
import { exerciseAliases, findExercise, fitnessExercises } from "@zeno/fitness";
import { exerciseForWorkoutEntry, exerciseMuscleValues, interpolatePose, mascotDemoForExercise, movementForExercise, movementProgress, movementScenes } from "../src/react-app/domains/zeno/movement-scenes";
import { routineExerciseSchema } from "@zeno/core";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import mascotDemos from "../src/react-app/domains/zeno/mascot-demos.json";
import selection from "../art-source/fitness/mainstream/selection.json";
import provenance from "../art-source/fitness/provenance.json";
import { searchExercisesForPicker } from "../src/react-app/domains/zeno/exercise-search";

test("all eleven original scenes match exactly one real canonical catalogue entry", () => {
  expect(movementScenes).toHaveLength(11); expect(new Set(movementScenes.map(scene => scene.exerciseId)).size).toBe(11);
  for (const scene of movementScenes) {
    const exercise = findExercise(scene.exerciseId); if (!exercise) throw new Error("Missing exercise");
    expect(exercise.englishName).toBe(scene.englishName); expect(movementForExercise(exercise)).toBe(scene);
  }
  expect(fitnessExercises.filter(exercise => movementForExercise(exercise))).toHaveLength(11);
});
test("all 32 selected videos retain exact canonical identity, equipment and honest illustration type", () => {
  expect(mascotDemos).toHaveLength(32);
  expect(mascotDemos.map(item => item.exerciseId).sort()).toEqual(selection.exercises.map(item => item.exerciseId).sort());
  expect(fitnessExercises.filter(exercise => mascotDemoForExercise(exercise)).map(exercise => exercise.id).sort()).toEqual(mascotDemos.map(item => item.exerciseId).sort());
  expect(mascotDemos.filter(item => item.kind === "mascot")).toHaveLength(30);
  expect(mascotDemos.filter(item => item.kind === "diagram").map(item => item.exerciseId).sort()).toEqual(["0612", "3094"]);
  for (const item of mascotDemos) {
    const exercise = findExercise(item.exerciseId); if (!exercise) throw new Error("Missing exercise");
    expect(exercise.englishName).toBe(item.englishName);
    expect(exercise.equipmentId).toBe(selection.exercises.find(selected => selected.exerciseId === item.exerciseId)?.equipment);
    expect(mascotDemoForExercise(exercise)).toEqual({ video: `zeno/fitness/${item.stem}.mp4`, poster: `zeno/fitness/${item.stem}-poster.webp`, kind: item.kind });
    expect(mascotDemoForExercise({ ...exercise, bodyPartId: "custom" })).toBeUndefined();
    expect(mascotDemoForExercise({ ...exercise, englishName: item.englishName + " different variant" })).toBeUndefined();
  }
  const narrowBench = findExercise("0030"); if (!narrowBench) throw new Error("Missing exercise");
  expect(mascotDemoForExercise(narrowBench)).toBeUndefined();
  expect(new Set(fitnessExercises.flatMap(exercise => mascotDemoForExercise(exercise)?.video ?? []))).toHaveProperty("size", 32);
});
test("all 64 selected local media files match their complete recorded provenance hashes", () => {
  const folder = new URL("../public/zeno/fitness/", import.meta.url);
  const expectedNames = mascotDemos.flatMap(item => [item.stem + ".mp4", item.stem + "-poster.webp"]).sort();
  expect(readdirSync(folder).sort()).toEqual(expectedNames);
  expect(provenance.assets).toHaveLength(32);
  for (const item of mascotDemos) {
    const asset = provenance.assets.find(candidate => candidate.canonicalExerciseId === item.exerciseId);
    if (!asset) throw new Error("Missing provenance");
    expect(asset.name).toBe(item.stem); expect(asset.kind).toBe(item.kind);
    for (const part of [asset.video, asset.poster]) {
      expect(part.file.startsWith("apps/app/public/zeno/fitness/")).toBe(true);
      const name = part.file.slice("apps/app/public/zeno/fitness/".length);
      expect(expectedNames).toContain(name);
      const bytes = readFileSync(new URL(name, folder));
      expect(bytes.length).toBe(part.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(part.sha256);
      expect(bytes.subarray(0, 32).toString("ascii")).toContain(name.endsWith(".mp4") ? "ftyp" : "WEBP");
    }
  }
});
test("picker exposes completed mainstream art while retaining query, equipment and custom exact matches", () => {
  expect(searchExercisesForPicker().slice(0, 32).map(item => item.id).sort()).toEqual(mascotDemos.map(item => item.exerciseId).sort());
  const dumbbells = searchExercisesForPicker({ query: "卧推", equipment: ["dumbbell"], muscles: ["chest"], limit: 100 });
  expect(dumbbells.some(item => item.id === "0289")).toBe(true);
  expect(dumbbells.every(item => item.equipmentId === "dumbbell" && [...item.primaryMuscleIds, ...item.secondaryMuscleIds].includes("chest"))).toBe(true);
  expect(searchExercisesForPicker({ query: "不可能存在的动作" })).toHaveLength(0);
  const bench = findExercise("0025"); if (!bench) throw new Error("Missing exercise");
  const custom = { ...bench, id: "custom-bench", bodyPartId: "custom", name: "卧推自定义", englishName: "Custom bench" };
  expect(searchExercisesForPicker({ query: "卧推", customExercises: [custom] })[0]?.id).toBe(custom.id);
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
