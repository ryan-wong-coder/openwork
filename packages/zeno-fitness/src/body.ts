import { computeBalance } from "../upstream/lib/structuralBalance.js";
import { TEMPLATES } from "../upstream/lib/structuralBalanceTemplates.js";
import { plateStack } from "../upstream/lib/plates.js";
import type { BodyMeasurement, IdentifiedWorkout } from "./types.js";
import { findExercise } from "./catalogue.js";
import { toUpstreamState } from "./upstream-adapter.js";
import { convertWorkoutUnit } from "./training.js";
import { finite, list, record, text } from "./value.js";

export const measurementFields = [
  { id: "neck", name: "颈围" }, { id: "shoulders", name: "肩围" }, { id: "chest", name: "胸围" }, { id: "waist", name: "腰围" }, { id: "hips", name: "臀围" }, { id: "abdomen", name: "腹围" },
  { id: "upperArmLeft", name: "左上臂" }, { id: "upperArmRight", name: "右上臂" }, { id: "forearmLeft", name: "左前臂" }, { id: "forearmRight", name: "右前臂" }, { id: "wristLeft", name: "左腕围" }, { id: "wristRight", name: "右腕围" }, { id: "thighLeft", name: "左大腿" }, { id: "thighRight", name: "右大腿" }, { id: "calfLeft", name: "左小腿" }, { id: "calfRight", name: "右小腿" }, { id: "ankleLeft", name: "左踝围" }, { id: "ankleRight", name: "右踝围" },
];
export function measurementSeries(measurements: readonly BodyMeasurement[], field: string): Array<{ at: number; value: number }> {
  return measurements.flatMap(measurement => { const value = field === "weightKg" ? measurement.weightKg : field === "bodyFatPercent" ? measurement.bodyFatPercent : measurement.circumferences[field]; return typeof value === "number" && Number.isFinite(value) ? [{ at: measurement.at, value }] : []; }).sort((a, b) => a.at - b.at);
}
export function deriveBodyTrends(measurements: readonly BodyMeasurement[]): Array<{ field: string; name: string; latest: number; previous: number | null; delta: number | null; unit: string }> {
  return [{ id: "weightKg", name: "体重", unit: "kg" }, { id: "bodyFatPercent", name: "体脂率", unit: "%" }, ...measurementFields.map(field => ({ ...field, unit: "cm" }))].flatMap(field => {
    const series = measurementSeries(measurements, field.id); const latest = series.at(-1); if (!latest) return [];
    const previous = series.at(-2)?.value ?? null; return [{ field: field.id, name: field.name, latest: latest.value, previous, delta: previous == null ? null : latest.value - previous, unit: field.unit }];
  });
}
export interface StructuralBalanceRow { id: string; exerciseId: string; name: string; currentKg: number | null; actualPercent: number | null; targetPercent: number; status: string; needsBodyweight: boolean; needsAnchor: boolean }
export function deriveStructuralBalance(workouts: readonly IdentifiedWorkout[], measurements: readonly BodyMeasurement[], templateId = "poliquin", body: "male" | "female" = "male"): StructuralBalanceRow[] {
  const templates = record(TEMPLATES); const template = templates[templateId]; if (!template) throw new Error("未知的力量比例模板");
  const state = { ...toUpstreamState(workouts.map(workout => convertWorkoutUnit(workout, "kg")), "kg", measurements), body };
  const result: unknown = computeBalance(state, template);
  return list(result).map(item => { const row = record(item); const current = record(row.current); const exerciseId = text(row.mappedExerciseId, text(row.configuredExerciseId)); return { id: text(row.roleId), exerciseId, name: findExercise(exerciseId)?.name ?? exerciseId, currentKg: typeof current.estKg === "number" ? current.estKg : null, actualPercent: typeof row.actualPct === "number" ? row.actualPct : null, targetPercent: finite(row.targetPct), status: text(row.status), needsBodyweight: row.needsBodyweight === true, needsAnchor: row.needsAnchor === true }; });
}
export function calculatePlateLoad(total: number, bar = 20, inventory: Array<{ weight: number; count: number }> = [{ weight: 20, count: 6 }, { weight: 10, count: 2 }, { weight: 5, count: 2 }, { weight: 2.5, count: 2 }, { weight: 1.25, count: 2 }]): { perSide: number[]; missing: number; loaded: number } {
  const requested = Math.max(0, (total - bar) / 2);
  const result: unknown = plateStack(requested, inventory.map(plate => ({ w: plate.weight, n: plate.count })));
  const row = record(result); const plates = list(row.plates).filter((value): value is number => typeof value === "number");
  return { perSide: plates, missing: finite(row.missing) * 2, loaded: bar + plates.reduce((sum, plate) => sum + plate, 0) * 2 };
}
