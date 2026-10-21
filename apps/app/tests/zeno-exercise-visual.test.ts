import { expect, test } from "bun:test";
import { exerciseAliases, findExercise, fitnessExercises } from "@zeno/fitness";
import { exerciseForWorkoutEntry, exerciseMuscleValues, interpolatePose, mascotDemoForExercise, movementForExercise, movementProgress, movementScenes } from "../src/react-app/domains/zeno/movement-scenes";
import { routineExerciseSchema } from "@zeno/core";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import mascotDemos from "../src/react-app/domains/zeno/mascot-demos.json";
import selection from "../art-source/fitness/mainstream/selection.json";
import provenance from "../art-source/fitness/provenance.json";
import expansionProgress from "../art-source/fitness/expansion-1000/progress.json";
import expansionSelection from "../art-source/fitness/expansion-1000/selection.json";
import techniqueCredits from "../art-source/fitness/expansion-1000/technique-credits.json";
import generationStop from "../art-source/fitness/expansion-1000/generation-stop.json";
import { z } from "zod";
import { searchExercisesForPicker } from "../src/react-app/domains/zeno/exercise-search";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("all eleven original scenes match exactly one real canonical catalogue entry", () => {
  expect(movementScenes).toHaveLength(11); expect(new Set(movementScenes.map(scene => scene.exerciseId)).size).toBe(11);
  for (const scene of movementScenes) {
    const exercise = findExercise(scene.exerciseId); if (!exercise) throw new Error("Missing exercise");
    expect(exercise.englishName).toBe(scene.englishName); expect(movementForExercise(exercise)).toBe(scene);
  }
  expect(fitnessExercises.filter(exercise => movementForExercise(exercise))).toHaveLength(11);
});
test("ready demonstrations retain unique canonical identities and honest illustration types", () => {
  expect(mascotDemos.length).toBeGreaterThan(0);
  const readyIds = new Set(mascotDemos.map(item => item.exerciseId));
  expect(readyIds.size).toBe(mascotDemos.length);
  expect(new Set(mascotDemos.map(item => item.stem)).size).toBe(mascotDemos.length);
  expect(mascotDemos.map(item => item.exerciseId).sort()).toEqual(provenance.assets.map(asset => asset.canonicalExerciseId).sort());
  expect(fitnessExercises.filter(exercise => mascotDemoForExercise(exercise)).map(exercise => exercise.id).sort()).toEqual(mascotDemos.map(item => item.exerciseId).sort());
  for (const item of mascotDemos) {
    const exercise = findExercise(item.exerciseId); if (!exercise) throw new Error("Missing exercise");
    expect(exercise.id).toBe(item.exerciseId);
    expect(exercise.englishName).toBe(item.englishName);
    expect(["mascot", "diagram"]).toContain(item.kind);
    expect(item.stem).toMatch(/^[a-z\d][a-z\d-]*$/);
    expect(mascotDemoForExercise(exercise)).toEqual({ video: `zeno/fitness/${item.stem}.mp4`, poster: `zeno/fitness/${item.stem}-poster.webp`, kind: item.kind });
    expect(mascotDemoForExercise({ ...exercise, bodyPartId: "custom" })).toBeUndefined();
    expect(mascotDemoForExercise({ ...exercise, englishName: item.englishName + " different variant" })).toBeUndefined();
    expect(mascotDemoForExercise({ ...exercise, englishName: item.englishName + " " })).toBeUndefined();
  }
  const uncovered = fitnessExercises.find(exercise => !readyIds.has(exercise.id));
  if (uncovered) expect(mascotDemoForExercise(uncovered)).toBeUndefined();
  expect(new Set(fitnessExercises.flatMap(exercise => mascotDemoForExercise(exercise)?.video ?? [])).size).toBe(mascotDemos.length);
});
test("the original mainstream baseline keeps its identities, equipment and frozen media bytes", () => {
  // Frozen 1.1.2 baseline only: ready additions do not change either digest.
  expect(digest(readFileSync(new URL("../art-source/fitness/mainstream/selection.json", import.meta.url)))).toBe("5dfb46e441f732b3d640c68d0cfabc55f18ca90a268c0039c0de749920adb078");
  const baseline = selection.exercises.map(selected => {
    const item = mascotDemos.find(item => item.exerciseId === selected.exerciseId);
    const asset = provenance.assets.find(asset => asset.canonicalExerciseId === selected.exerciseId);
    const exercise = findExercise(selected.exerciseId);
    if (!item || !asset || !exercise) throw new Error("Missing original baseline");
    expect(exercise.equipmentId).toBe(selected.equipment);
    return [selected.exerciseId, item.englishName, item.stem, item.kind, asset.name, asset.kind, asset.video.file, asset.video.bytes, asset.video.sha256, asset.poster.file, asset.poster.bytes, asset.poster.sha256];
  });
  expect(digest(JSON.stringify(baseline))).toBe("279a1a561e8bdc19ce8e1d3fdae00c5655bccbcfd2d375c228e5744dd1c475ad");
});
test("expansion progress credits reviewed techniques without counting supplemental catalogue labels twice", () => {
  const baselineIds = new Set(selection.exercises.map(item => item.exerciseId));
  const additions = mascotDemos.filter(item => !baselineIds.has(item.exerciseId));
  const creditedIds = new Set(expansionProgress.accepted.map(item => item.exerciseId));
  const supplementalIds = new Set(expansionProgress.supplementalCoverage.map(item => item.exerciseId));
  expect(creditedIds.size).toBe(expansionProgress.accepted.length);
  expect(supplementalIds.size).toBe(expansionProgress.supplementalCoverage.length);
  expect([...creditedIds].every(id => !supplementalIds.has(id))).toBe(true);
  expect([...creditedIds, ...supplementalIds].sort()).toEqual(additions.map(item => item.exerciseId).sort());
  expect(expansionProgress.baselineReady).toBe(baselineIds.size);
  expect(expansionProgress.acceptedAdditional).toBe(creditedIds.size);
  expect(expansionProgress.additionalCanonicalCoverage).toBe(additions.length);
  expect(expansionProgress.totalReady).toBe(mascotDemos.length);
  expect(expansionProgress.remainingTarget).toBe(expansionProgress.targetAdditional - creditedIds.size);
  expect(creditedIds.size).toBeLessThanOrEqual(expansionProgress.targetAdditional);
  expect(provenance.scope.creditedExpansionMovements).toBe(creditedIds.size);
  expect(provenance.scope.supplementalExpansionCoverage).toBe(supplementalIds.size);
  expect(provenance.scope.completedExpansionVideos).toBe(additions.length);
  for (const item of expansionProgress.supplementalCoverage) {
    const policy = techniqueCredits.supplementalCandidates.find(candidate => candidate.exerciseId === item.exerciseId);
    const asset = provenance.assets.find(candidate => candidate.canonicalExerciseId === item.exerciseId);
    const peer = provenance.assets.find(candidate => candidate.canonicalExerciseId === item.sameTechniqueAs);
    if (!policy || !asset || !peer) throw new Error("Supplemental coverage requires an accepted independent pair and reviewed original technique");
    expect(item.englishName).toBe(policy.englishName);
    expect(item.sameTechniqueAs).toBe(policy.sameTechniqueAs);
    expect(item.creditedTowardTarget).toBe(false);
    expect(baselineIds.has(item.sameTechniqueAs) || creditedIds.has(item.sameTechniqueAs)).toBe(true);
    expect(asset.video.sha256).not.toBe(peer.video.sha256);
    expect(asset.poster.sha256).not.toBe(peer.poster.sha256);
    const credit = z.object({ productionCredit: z.object({ creditedTowardTarget: z.literal(false), sameTechniqueAs: z.string(), reason: z.string().min(1) }) }).parse(asset);
    expect(credit.productionCredit.sameTechniqueAs).toBe(item.sameTechniqueAs);
    expect(credit.productionCredit.reason).toBe(policy.reason);
  }
  const readySteps = new Map<string, string>();
  for (const row of [...expansionSelection.exercises, ...expansionSelection.reserves]) {
    if (!creditedIds.has(row.exerciseId)) continue;
    const steps = JSON.stringify(row.sourceSteps);
    expect(readySteps.has(steps)).toBe(false);
    readySteps.set(steps, row.exerciseId);
  }
});
test("every ready local media pair matches its complete recorded provenance hashes", () => {
  const folder = new URL("../public/zeno/fitness/", import.meta.url);
  const expectedNames = mascotDemos.flatMap(item => [item.stem + ".mp4", item.stem + "-poster.webp"]).sort();
  expect(readdirSync(folder).sort()).toEqual(expectedNames);
  expect(provenance.assets).toHaveLength(mascotDemos.length);
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
      expect(digest(bytes)).toBe(part.sha256);
      expect(bytes.subarray(0, 32).toString("ascii")).toContain(name.endsWith(".mp4") ? "ftyp" : "WEBP");
    }
  }
});
test("the insufficient-compute stop preserves incomplete work without inflating accepted coverage", () => {
  expect(expansionProgress.status).toBe("stopped-provider-insufficient-compute");
  expect(expansionProgress.generationStopped).toBe(true);
  expect(expansionProgress.remainingTarget).toBeGreaterThan(0);
  expect(expansionProgress.creditsRemainingKnown).toBe(false);
  expect(expansionProgress.creditsRemaining).toBeNull();
  expect(generationStop.balanceZeroClaimed).toBe(false);
  expect(generationStop.stopNewImageAndPaidGeneration).toBe(true);
  expect(generationStop.noRechargeOrAccountSwitching).toBe(true);
  for (const failure of generationStop.taskCreationFailures) {
    expect(failure.providerError.code).toBe(1200000136);
    expect(failure.providerError.message).toBe("算力不足");
    expect(failure.taskIdObserved).toBe(false);
    expect(failure.terminalSuccessObserved).toBe(false);
    expect(failure.rerunProhibited).toBe(true);
    expect(failure.receiptSha256.stderr).toMatch(/^[a-f0-9]{64}$/);
    expect(mascotDemos.some(item => item.exerciseId === failure.canonicalExerciseId)).toBe(false);
  }
  for (const id of ["0534", "3006"]) expect(mascotDemos.some(item => item.exerciseId === id)).toBe(false);
});
test("picker exposes completed mainstream art while retaining query, equipment and custom exact matches", () => {
  expect(searchExercisesForPicker({ limit: mascotDemos.length }).map(item => item.id).sort()).toEqual(mascotDemos.map(item => item.exerciseId).sort());
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
  expect(mascotDemoForExercise({ ...exercise, id: "not-a-canonical-id" })).toBeUndefined();
  const alias = Object.entries(exerciseAliases).find(([, id]) => id === exercise.id);
  if (alias) {
    expect(movementForExercise({ ...exercise, id: alias[0] })).toBe(movementForExercise(exercise));
    expect(mascotDemoForExercise({ ...exercise, id: alias[0] })).toEqual(mascotDemoForExercise(exercise));
    expect(mascotDemoForExercise({ ...exercise, id: alias[0], bodyPartId: "custom" })).toBeUndefined();
  }
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
