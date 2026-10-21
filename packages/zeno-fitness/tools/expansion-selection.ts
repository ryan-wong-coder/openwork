import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fitnessExercises } from "../src/catalogue.ts";
import type { FitnessExercise } from "../src/types.ts";

/** Internal production planning only. This module never registers or generates media. */
export const EXPANSION_TARGET = 1000;
export const FIRST_BRIEF_IDS = ["0042", "0375", "0044", "0297", "1160"];
const presentationOnly = /\b(?:pov|camera|view|male|female)\b|\bv\.?\s*\d+\b|\bversion\s*\d+\b/i;
const deferredCategories = new Set(["olympic", "rehab", "combat"]);
const bodyOrder = ["chest", "back", "upper legs", "shoulders", "waist", "upper arms", "lower legs", "lower arms", "cardio", "full body"];
const equipmentOrder = ["body weight", "dumbbell", "barbell", "cable", "leverage machine", "band", "resistance band", "kettlebell", "smith machine", "weighted", "ez barbell"];
const categoryOrder = ["strength", "calisthenics", "cardio", "isometric", "stretching", "mobility", "plyometrics", "yoga", "pilates"];
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byId = (a: FitnessExercise, b: FitnessExercise) => Number(a.id) - Number(b.id) || lexical(a.id, b.id);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const normalizeText = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
export function englishMeaningKey(exercise: FitnessExercise): string {
  const name = normalizeText(exercise.englishName).replace(/(\d+)\s*(?:degrees?|°)/g, "$1deg")
    .replace(/[\-–_]/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return [name, exercise.equipmentId, exercise.bodyPartId].join("|");
}
export const instructionKey = (exercise: FitnessExercise) => exercise.equipmentId + "|" + exercise.instructions.map(normalizeText).join("\n");

interface CompletedExercise { exerciseId: string; englishName: string }
interface DuplicateExclusion { exerciseId: string; reason: string; duplicateOf: string }
interface Queue { rows: FitnessExercise[]; children: Queue[]; cursor: number }

function orderedKeys(keys: string[], preferred: readonly string[]): string[] {
  const rank = (value: string) => { const index = preferred.indexOf(value); return index < 0 ? preferred.length : index; };
  return keys.sort((a, b) => rank(a) - rank(b) || lexical(a, b));
}

function makeQueue(rows: FitnessExercise[], depth = 0): Queue {
  if (depth === 3) return { rows: rows.sort(byId), children: [], cursor: 0 };
  const key = (row: FitnessExercise) => depth === 0 ? row.bodyPartId : depth === 1 ? row.equipmentId : row.categoryId;
  const groups = new Map<string, FitnessExercise[]>();
  for (const row of rows) { const value = key(row); groups.set(value, [...(groups.get(value) ?? []), row]); }
  const preferred = depth === 0 ? bodyOrder : depth === 1 ? equipmentOrder : categoryOrder;
  return { rows: [], cursor: 0, children: orderedKeys([...groups.keys()], preferred).map(value => makeQueue(groups.get(value) ?? [], depth + 1)) };
}

function take(queue: Queue): FitnessExercise | undefined {
  if (!queue.children.length) return queue.rows.shift();
  for (let index = 0; index < queue.children.length; index++) {
    const child = queue.children[queue.cursor];
    queue.cursor = (queue.cursor + 1) % queue.children.length;
    const row = take(child);
    if (row) return row;
  }
  return undefined;
}

export function balanceCandidates(rows: readonly FitnessExercise[]): FitnessExercise[] {
  const queue = makeQueue([...rows]);
  const result: FitnessExercise[] = [];
  for (let row = take(queue); row; row = take(queue)) result.push(row);
  assert.equal(result.length, rows.length);
  return result;
}

function descriptor(exercise: FitnessExercise) {
  return {
    exerciseId: exercise.id, englishName: exercise.englishName, chineseName: exercise.name,
    equipmentId: exercise.equipmentId, equipmentLabel: exercise.equipment,
    bodyPartId: exercise.bodyPartId, bodyPartLabel: exercise.bodyPart,
    categoryId: exercise.categoryId, categoryLabel: exercise.category,
    muscles: { primaryIds: [...exercise.primaryMuscleIds], primaryLabels: [...exercise.primaryMuscles],
      secondaryIds: [...exercise.secondaryMuscleIds], secondaryLabels: [...exercise.secondaryMuscles] },
    sourceSteps: [...exercise.instructions],
  };
}

export function expansionEntry(exercise: FitnessExercise, order: number) {
  const source = descriptor(exercise);
  return { order, ...source, descriptorSha256: sha256(JSON.stringify(source)), assetStem: `exp-${exercise.id}`,
    briefStatus: "pending-review", sourceStepsTechniqueReviewed: false, readyMedia: false };
}

function histogram(rows: readonly FitnessExercise[], key: (row: FitnessExercise) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => lexical(a, b)));
}

export function buildExpansionSelection(exercises: readonly FitnessExercise[], completed: readonly CompletedExercise[], target: number, firstIds: readonly string[] = []) {
  assert.ok(Number.isSafeInteger(target) && target > 0);
  const catalogue = new Map(exercises.map(row => [row.id, row]));
  assert.equal(catalogue.size, exercises.length, "Canonical catalogue IDs must be unique.");
  const completedIds = new Set<string>();
  const english = new Map<string, string>(); const chinese = new Map<string, string>(); const steps = new Map<string, string>();
  for (const entry of completed) {
    assert.ok(!completedIds.has(entry.exerciseId));
    const row = catalogue.get(entry.exerciseId);
    assert.ok(row && row.englishName === entry.englishName, "Completed media must match the exact canonical identity.");
    completedIds.add(entry.exerciseId); english.set(englishMeaningKey(row), row.id); chinese.set(normalizeText(row.name), row.id);
    if (row.instructions.length) steps.set(instructionKey(row), row.id);
  }
  const counts = { completed: completed.length, missingSteps: 0, presentationOrUnresolvedVersion: 0,
    duplicateEnglish: 0, duplicateChineseOrSteps: 0, deferredCategoryOrNeck: 0 };
  const duplicateExclusions: DuplicateExclusion[] = [];
  const rows: FitnessExercise[] = [];
  let textCandidates = 0; let englishDistinct = 0; let chineseAndStepsDistinct = 0;
  for (const row of [...exercises].sort(byId)) {
    if (completedIds.has(row.id)) continue;
    if (row.instructions.length < 3 || row.instructions.some(step => !step.trim()) || !/\p{Script=Han}/u.test(row.instructions.join(""))) { counts.missingSteps++; continue; }
    if (presentationOnly.test(row.englishName)) { counts.presentationOrUnresolvedVersion++; continue; }
    textCandidates++;
    const englishKey = englishMeaningKey(row); const englishMatch = english.get(englishKey);
    if (englishMatch) { counts.duplicateEnglish++; duplicateExclusions.push({ exerciseId: row.id, reason: "normalized-english-equipment-body", duplicateOf: englishMatch }); continue; }
    english.set(englishKey, row.id); englishDistinct++;
    const chineseKey = normalizeText(row.name); const stepKey = instructionKey(row);
    const match = chinese.get(chineseKey) ?? steps.get(stepKey);
    if (match) { counts.duplicateChineseOrSteps++; duplicateExclusions.push({ exerciseId: row.id, reason: completedIds.has(match) ? "already-completed-semantic" : "duplicate-label-or-same-equipment-steps", duplicateOf: match }); continue; }
    chinese.set(chineseKey, row.id); steps.set(stepKey, row.id); chineseAndStepsDistinct++;
    if (deferredCategories.has(row.categoryId) || row.bodyPartId === "neck") { counts.deferredCategoryOrNeck++; continue; }
    rows.push(row);
  }
  assert.ok(rows.length >= target, "Not enough distinct text-supported candidates; do not pad with instructionless or duplicate exercises.");
  const first: FitnessExercise[] = [];
  const firstSeen = new Set<string>();
  for (const id of firstIds) {
    assert.ok(!firstSeen.has(id)); firstSeen.add(id);
    const row = rows.find(exercise => exercise.id === id);
    assert.ok(row, "A first-brief ID is not an eligible distinct candidate."); first.push(row);
  }
  const ordered = [...first, ...balanceCandidates(rows.filter(row => !firstSeen.has(row.id)))];
  const selected = ordered.slice(0, target); const reserves = ordered.slice(target);
  return {
    schemaVersion: 1, kind: "internal-media-production-plan", algorithm: "body-equipment-category-round-robin-v1",
    scope: "Selection is a plan, not reviewed movement specifications or completed media. No runtime registration is performed.",
    completedBaseline: completed.map(row => ({ exerciseId: row.exerciseId, englishName: row.englishName })),
    target: { alreadyCompleted: completed.length, additional: target, combinedIfAllCompleted: completed.length + target },
    selectedCount: selected.length, reserveCount: reserves.length, readyMediaCount: 0,
    policy: { exactCanonicalIdentity: true, independentMascotPosterAndVideoRequired: true, restrictedUpstreamMediaProhibited: true,
      sourceStepsDoNotProveTechniqueCorrectness: true, runtimeMappingUnchanged: true,
      presentationAndUnresolvedVersionNamesDeferred: true, deferredCategories: [...deferredCategories], deferredBodyParts: ["neck"],
      duplicateGroupsConservativelyHoldOtherVariants: true, numericCanonicalIdTieBreak: true,
      firstBriefIds: [...firstIds], semanticReviewRequiredBeforeGeneration: true },
    inventory: { canonical: exercises.length, withSourceSteps: exercises.filter(row => row.instructions.length).length,
      completedWithSourceSteps: exercises.filter(row => completedIds.has(row.id) && row.instructions.length).length,
      textCandidates, englishDistinct, chineseAndStepsDistinct, eligible: rows.length, exclusions: counts },
    selectedCoverage: { bodyPart: histogram(selected, row => row.bodyPartId), equipment: histogram(selected, row => row.equipmentId), category: histogram(selected, row => row.categoryId) },
    duplicateExclusions,
    exercises: selected.map((row, index) => expansionEntry(row, index + 1)),
    reserves: reserves.map((row, index) => expansionEntry(row, target + index + 1)),
  };
}

function readCompleted(text: string): CompletedExercise[] {
  const source: unknown = JSON.parse(text);
  const rows: unknown = source && typeof source === "object" && "exercises" in source ? source.exercises : source;
  assert.ok(Array.isArray(rows));
  return rows.map((row: unknown) => {
    assert.ok(row && typeof row === "object" && "exerciseId" in row && typeof row.exerciseId === "string"
      && "englishName" in row && typeof row.englishName === "string");
    return { exerciseId: row.exerciseId, englishName: row.englishName };
  });
}

export function createRepositorySelection(repo: string) {
  // The production plan freezes its original baseline. New runtime admissions
  // must not silently reshuffle the remaining 1000 planned identities.
  const completedPath = "apps/app/art-source/fitness/mainstream/selection.json";
  const completed = readCompleted(readFileSync(resolve(repo, completedPath), "utf8"));
  assert.equal(completed.length, 32, "This expansion freezes the existing 32; later batches must not silently change the baseline.");
  const runtime = new Map(readCompleted(readFileSync(resolve(repo, "apps/app/src/react-app/domains/zeno/mascot-demos.json"), "utf8"))
    .map(row => [row.exerciseId, row.englishName]));
  assert.ok(completed.every(row => runtime.get(row.exerciseId) === row.englishName), "The frozen completed baseline must remain available in the runtime map.");
  const plan = buildExpansionSelection(fitnessExercises, completed, EXPANSION_TARGET, FIRST_BRIEF_IDS);
  const paths = ["packages/zeno-fitness/tools/expansion-selection.ts", "packages/zeno-fitness/src/catalogue.ts", "packages/zeno-fitness/src/instruction-corrections.ts",
    "packages/zeno-fitness/upstream/lib/exercises-data.js", "packages/zeno-fitness/upstream/exercise-names/zh.js",
    "packages/zeno-fitness/upstream/instr/zh.js", completedPath];
  return { ...plan, sources: paths.map(path => ({ path, sha256: sha256(readFileSync(resolve(repo, path), "utf8")) })),
    textLicense: "Retain packages/zeno-fitness/NOTICE.md, UPSTREAM-NOTICE.md and corresponding AGPL/MIT source notices. No restricted upstream media is input or output." };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, "No selection overrides are accepted.");
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const plan = createRepositorySelection(repo);
  const output = resolve(repo, "apps/app/art-source/fitness/expansion-1000/selection.json");
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(plan, null, 2) + "\n");
  console.log(JSON.stringify({ selected: plan.selectedCount, reserves: plan.reserveCount, eligible: plan.inventory.eligible,
    completed: plan.target.alreadyCompleted, ready: plan.readyMediaCount, output: "apps/app/art-source/fitness/expansion-1000/selection.json" }));
}
