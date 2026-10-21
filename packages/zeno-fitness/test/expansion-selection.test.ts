import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fitnessExercises } from "../src/catalogue.ts";
import type { FitnessExercise } from "../src/types.ts";
import { assertFrozenExpansionEntries, balanceCandidates, buildExpansionSelection, createPlanningCatalogue, createRepositorySelection, englishMeaningKey, expansionEntry,
  FIRST_BRIEF_IDS, instructionKey, normalizeText, ORIGINAL_SELECTION_PATH, ORIGINAL_SELECTION_SHA256 } from "../tools/expansion-selection.ts";

const repo = resolve(import.meta.dir, "../../..");
const base = fitnessExercises.find(row => row.id === "0042");
if (!base) throw new Error("Missing canonical fixture.");
function exercise(id: string, equipmentId = "body weight", bodyPartId = "chest", categoryId = "strength"): FitnessExercise {
  if (!base) throw new Error("Missing canonical fixture.");
  return { ...base, id, name: `合成动作${id}`, englishName: `synthetic exercise ${id}`, equipmentId, bodyPartId, categoryId,
    instructions: [`动作${id}的起始姿态。`, `动作${id}的明确运动过程。`, `动作${id}回到起始姿态。`] };
}

test("the committed expansion is reproducible and distinguishes planned coverage from completed runtime media", () => {
  const plan = createRepositorySelection(repo);
  const committed: unknown = JSON.parse(readFileSync(resolve(repo, "apps/app/art-source/fitness/expansion-1000/selection.json"), "utf8"));
  expect(committed).toEqual(plan);
  expect(plan.target).toEqual({ alreadyCompleted: 32, additional: 1000, combinedIfAllCompleted: 1032 });
  expect(plan.inventory.withSourceSteps).toBe(1324); expect(plan.inventory.completedWithSourceSteps).toBe(24);
  expect(plan.inventory.eligible).toBe(1175); expect(plan.exercises).toHaveLength(1000); expect(plan.reserves).toHaveLength(175);
  expect(plan.readyMediaCount).toBe(0);
  expect(plan.exercises.slice(0, FIRST_BRIEF_IDS.length).map(row => row.exerciseId)).toEqual(FIRST_BRIEF_IDS);
  expect(plan.duplicateExclusions).toContainEqual({ exerciseId: "0376", reason: "already-completed-semantic", duplicateOf: "0334" });
  expect(plan.duplicateExclusions).toContainEqual({ exerciseId: "0684", reason: "already-completed-semantic", duplicateOf: "0685" });
});

test("all 1175 planned IDs retain exact source descriptors without existing exercises, aliases, camera versions or duplicate semantics", () => {
  const plan = createRepositorySelection(repo);
  const rows = [...plan.exercises, ...plan.reserves];
  const catalogue = new Map(createPlanningCatalogue().map(row => [row.id, row]));
  const existing = plan.completedBaseline;
  const existingIds = new Set(existing.map(row => row.exerciseId));
  const english = new Set<string>(); const chinese = new Set<string>(); const steps = new Set<string>();
  for (const item of existing) {
    const row = catalogue.get(item.exerciseId); if (!row) throw new Error("Missing existing canonical exercise.");
    english.add(englishMeaningKey(row)); chinese.add(normalizeText(row.name));
    if (row.instructions.length) steps.add(instructionKey(row));
  }
  expect(new Set(rows.map(row => row.exerciseId)).size).toBe(1175);
  for (const [index, item] of rows.entries()) {
    const source = catalogue.get(item.exerciseId); if (!source) throw new Error("Selection contains a non-canonical ID.");
    expect(existingIds.has(item.exerciseId)).toBe(false);
    expect(item.englishName).not.toMatch(/\b(?:pov|camera|view|male|female)\b|\bv\.?\s*\d+\b|\bversion\s*\d+\b/i);
    expect(["olympic", "rehab", "combat"]).not.toContain(source.categoryId); expect(source.bodyPartId).not.toBe("neck");
    expect(english.has(englishMeaningKey(source))).toBe(false); english.add(englishMeaningKey(source));
    expect(chinese.has(normalizeText(source.name))).toBe(false); chinese.add(normalizeText(source.name));
    expect(steps.has(instructionKey(source))).toBe(false); steps.add(instructionKey(source));
    expect(item).toEqual(expansionEntry(source, index + 1));
    expect(item.sourceSteps.length).toBeGreaterThanOrEqual(3); expect(item.briefStatus).toBe("pending-review");
    expect(item.readyMedia).toBe(false); expect(item.sourceStepsTechniqueReviewed).toBe(false);
    expect(JSON.stringify(item)).not.toMatch(/https?:|\.mp4|\.webp|gymvisual/i);
  }
});

test("runtime corrections cannot change the frozen planning text or any original selected/reserve descriptor", () => {
  const originalText = readFileSync(resolve(repo, ORIGINAL_SELECTION_PATH), "utf8");
  expect(createHash("sha256").update(originalText).digest("hex")).toBe(ORIGINAL_SELECTION_SHA256);
  const original: unknown = JSON.parse(originalText);
  const plan = createRepositorySelection(repo);
  const { sources: _sources, textLicense: _license, ...entries } = plan;
  assertFrozenExpansionEntries(entries, original);
  const changedRuntime = fitnessExercises.map(row => ({ ...row, instructions: ["后续运行时更正不进入旧制作计划。"], description: "新的运行时摘要。" }));
  const frozen = createPlanningCatalogue();
  expect(createPlanningCatalogue(changedRuntime)).toEqual(frozen);
  expect(frozen.find(row => row.id === "0407")?.instructions.join(" ")).toContain("哑铃的另一侧");
  expect(fitnessExercises.find(row => row.id === "0407")?.instructions.join(" ")).toContain("持哑铃的一侧");
  expect(frozen.find(row => row.id === "0446")?.instructions[0]).toContain("双手分开与肩同宽");
  expect(fitnessExercises.find(row => row.id === "0446")?.instructions[0]).toContain("双手间距窄于肩宽");
  expect(frozen.find(row => row.id === "0313")?.instructions.join(" ")).toContain("全程保持中立握法");
  const rebuilt = buildExpansionSelection(createPlanningCatalogue(changedRuntime), plan.completedBaseline, 1000, FIRST_BRIEF_IDS);
  assertFrozenExpansionEntries(rebuilt, original);
  expect(plan.sources.some(source => source.path.endsWith("/instruction-corrections.ts"))).toBe(false);
  expect(plan.sources.some(source => source.path.endsWith("/expansion-instruction-baseline.json"))).toBe(true);
  expect(plan.sources).toContainEqual({ path: ORIGINAL_SELECTION_PATH, sha256: ORIGINAL_SELECTION_SHA256 });
  const briefs: unknown = JSON.parse(readFileSync(resolve(repo, "apps/app/art-source/fitness/expansion-1000/briefs.json"), "utf8"));
  if (!briefs || typeof briefs !== "object" || !("selectionSha256" in briefs) || !("selectionSnapshotPath" in briefs)) throw new Error("Missing brief snapshot reference.");
  expect(briefs.selectionSha256).toBe(ORIGINAL_SELECTION_SHA256);
  expect(briefs.selectionSnapshotPath).toBe(ORIGINAL_SELECTION_PATH);
});

test("frozen planning refuses canonical identity/equipment drift and any replacement of planned descriptor text", () => {
  const frozen = createPlanningCatalogue();
  const plan = createRepositorySelection(repo);
  const original: unknown = JSON.parse(readFileSync(resolve(repo, ORIGINAL_SELECTION_PATH), "utf8"));
  for (const replacement of [{ englishName: "different hammer curl" }, { equipmentId: "barbell" }]) {
    expect(() => createPlanningCatalogue(fitnessExercises.map(row => row.id === "0313" ? { ...row, ...replacement } : row))).toThrow("exact canonical identity");
  }
  for (const replacement of [{ name: "改变了中文名称" }, { englishName: "different side bend" }, { equipmentId: "cable" }, { instructions: ["替换了计划源步骤。", "新的过程。", "新的结束。"] }]) {
    const changed = frozen.map(row => row.id === "0407" ? { ...row, ...replacement } : row);
    const rebuilt = buildExpansionSelection(changed, plan.completedBaseline, 1000, FIRST_BRIEF_IDS);
    expect(() => assertFrozenExpansionEntries(rebuilt, original)).toThrow("non-source plan metadata");
  }
});

test("selection refuses padding and ambiguous duplicates while retaining described equipment and posture variants", () => {
  const done = exercise("100");
  const gripA = { ...exercise("101", "barbell"), englishName: "barbell curl supinated grip" };
  const gripB = { ...exercise("102", "barbell"), englishName: "barbell curl reverse grip" };
  const otherEquipment = { ...exercise("103", "dumbbell"), englishName: gripA.englishName };
  const noSteps = { ...exercise("104"), instructions: [] };
  const sameMeaning = { ...exercise("105", "barbell"), englishName: "barbell-curl supinated grip" };
  const sameChinese = { ...exercise("106"), name: gripB.name };
  const sameSteps = { ...exercise("107", "barbell"), instructions: gripA.instructions };
  const completedDuplicate = { ...exercise("108"), name: done.name };
  const camera = { ...exercise("109"), englishName: "new exercise (side pov)" };
  const version = { ...exercise("110"), englishName: "new exercise v. 2" };
  const rehabilitation = exercise("111", "body weight", "back", "rehab");
  const neck = exercise("112", "body weight", "neck");
  const source = [done, gripA, gripB, otherEquipment, noSteps, sameMeaning, sameChinese, sameSteps, completedDuplicate, camera, version, rehabilitation, neck];
  const completed = [{ exerciseId: done.id, englishName: done.englishName }];
  const plan = buildExpansionSelection(source, completed, 3);
  expect(new Set(plan.exercises.map(row => row.exerciseId))).toEqual(new Set(["101", "102", "103"]));
  expect(plan.reserves).toHaveLength(0);
  expect(() => buildExpansionSelection(source, completed, 4)).toThrow("Not enough distinct");
  expect(() => buildExpansionSelection(source, [{ ...completed[0], englishName: "different identity" }], 3)).toThrow();
  expect(() => buildExpansionSelection(source, completed, 3, ["109"])).toThrow();
});

test("coverage ordering is deterministic across input order and alternates bodies and equipment", () => {
  const rows = [exercise("201", "body weight"), exercise("202", "body weight"), exercise("203", "dumbbell"),
    exercise("204", "dumbbell"), exercise("205", "barbell", "back"), exercise("206", "barbell", "back"),
    exercise("207", "body weight", "upper legs"), exercise("208", "body weight", "upper legs")];
  const ordered = balanceCandidates(rows);
  expect(balanceCandidates([...rows].reverse()).map(row => row.id)).toEqual(ordered.map(row => row.id));
  expect(ordered.slice(0, 3).map(row => row.bodyPartId)).toEqual(["chest", "back", "upper legs"]);
  expect(ordered.filter(row => row.bodyPartId === "chest").slice(0, 2).map(row => row.equipmentId)).toEqual(["body weight", "dumbbell"]);
  expect(new Set(ordered.map(row => row.id)).size).toBe(rows.length);
});

test("descriptor identity changes when instructions or equipment change, without implying that either is reviewed", () => {
  const row = exercise("301"); const original = expansionEntry(row, 1);
  expect(expansionEntry({ ...row, instructions: [...row.instructions, "新的动作阶段。"] }, 1).descriptorSha256).not.toBe(original.descriptorSha256);
  expect(expansionEntry({ ...row, equipmentId: "cable" }, 1).descriptorSha256).not.toBe(original.descriptorSha256);
  expect(expansionEntry(row, 99).descriptorSha256).toBe(original.descriptorSha256);
  expect(original.briefStatus).toBe("pending-review");
});
