import { parseImport, parseBodyweight, parseCSV } from "../upstream/lib/import-csv.js";
import { parseHevyWorkouts as upstreamHevyWorkouts, parseHevyRoutines as upstreamHevyRoutines, parseHevyBodyweight as upstreamHevyBodyweight } from "../upstream/lib/import-hevy.js";
import type { FitnessUnit, ImportedFitnessData } from "./types.js";
import { exerciseFromUpstream, fitnessExercises } from "./catalogue.js";
import { fromUpstreamRoutine, fromUpstreamWorkout, withExerciseSnapshot } from "./upstream-adapter.js";
import { finite, isoDate, kgOf, list, record, text } from "./value.js";

function normalizeImport(value: unknown, unit: FitnessUnit): ImportedFitnessData {
  const parsed = record(value);
  if (parsed.error) throw new Error(parsed.error === "empty" ? "文件没有可导入的数据" : "无法识别此训练或体重文件");
  const skipped = finite(parsed.skipped);
  const custom = list(parsed.customEx).map(exerciseFromUpstream);
  const customNames = new Map(custom.map(exercise => [exercise.id, exercise.name]));
  return {
    source: text(parsed.source, "导入"),
    workouts: list(parsed.workouts).map((workout, index) => {
      const result = fromUpstreamWorkout(workout, unit, index);
      return { ...result, exercises: result.exercises.map(exercise => withExerciseSnapshot({ ...exercise, name: customNames.get(exercise.exerciseId) ?? exercise.name }, custom)) };
    }),
    measurements: list(parsed.bodyweight).map(raw => { const entry = record(raw); return { at: new Date(isoDate(entry.t, `${text(entry.d, "1970-01-01")}T12:00:00.000Z`)).getTime(), weightKg: kgOf(finite(entry.w), unit), circumferences: {}, photoMediaIds: [], notes: "" }; }),
    routines: list(parsed.routines).map((raw, index) => ({ id: text(record(raw).id, `import-routine-${index}`), data: fromUpstreamRoutine(raw, unit) })),
    customExercises: custom, warnings: skipped > 0 ? [`已跳过 ${skipped} 条无效记录`] : [],
  };
}
/** FitNotes / FitNotes 2 / Strong / Hevy / Gravl and the upstream generic-column dialect. */
export function parseFitnessCsv(content: string, options: { unit?: FitnessUnit } = {}): ImportedFitnessData {
  const unit = options.unit ?? "kg";
  let normalized = content;
  if (!/^\s*</.test(content)) {
    const rawRows: unknown = parseCSV(content); const rows = list(rawRows).map(row => list(row).map(cell => text(cell)));
    const headerNames: Record<string, string> = { "日期": "date", "动作": "exercise", "动作名称": "exercise name", "训练名称": "workout name", "重量": "weight", "重量单位": "weight unit", "重量(kg)": "weight kg", "重量（kg）": "weight kg", "次数": "reps", "时长(秒)": "duration seconds", "时长（秒）": "duration seconds", "距离": "distance", "距离单位": "distance unit", "组类型": "set type", "备注": "notes" };
    if (rows[0]) {
      rows[0] = rows[0].map(value => headerNames[value.trim()] ?? value);
      const exerciseColumn = rows[0].findIndex(value => /^(exercise|exercise name|exercise title)$/i.test(value.trim()));
      if (exerciseColumn >= 0) {
        const byName = new Map<string, string | null>();
        for (const exercise of fitnessExercises) byName.set(exercise.name, byName.has(exercise.name) ? null : exercise.englishName);
        for (const row of rows.slice(1)) { const english = byName.get((row[exerciseColumn] ?? "").trim()); if (english) row[exerciseColumn] = english; }
      }
      normalized = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    }
  }
  const parsed: unknown = parseImport(normalized, { unit });
  return normalizeImport(parsed, unit);
}
/** A linear text scan of body-mass Record tags, not a DOM or an external-entity XML parser. */
export function parseAppleHealthWeight(content: string): ImportedFitnessData {
  const parsed: unknown = parseBodyweight(content, { unit: "kg" });
  return normalizeImport(parsed, "kg");
}
export function parseHevyWorkouts(workouts: readonly unknown[], templates: readonly unknown[], options: { unit?: FitnessUnit } = {}): ImportedFitnessData {
  const unit = options.unit ?? "kg"; const parsed: unknown = upstreamHevyWorkouts(workouts, templates, { unit }); return normalizeImport(parsed, unit);
}
export function parseHevyRoutines(routines: readonly unknown[], templates: readonly unknown[], options: { unit?: FitnessUnit } = {}): ImportedFitnessData {
  const unit = options.unit ?? "kg"; const parsed: unknown = upstreamHevyRoutines(routines, templates, { unit }); return normalizeImport(parsed, unit);
}
export function parseHevyBodyweight(measurements: readonly unknown[]): ImportedFitnessData {
  const parsed: unknown = upstreamHevyBodyweight(measurements, { unit: "kg" }); return normalizeImport(parsed, "kg");
}
/** Parsing is deliberately separate from authenticated network access and saving a user's data. */
export function mergeImportedFitness(existing: ImportedFitnessData, incoming: ImportedFitnessData): ImportedFitnessData {
  const distinct = <T>(items: T[], key: (item: T) => string): T[] => [...new Map(items.map(item => [key(item), item])).values()];
  return { source: incoming.source, workouts: distinct([...existing.workouts, ...incoming.workouts], workout => workout.id), measurements: distinct([...existing.measurements, ...incoming.measurements], measurement => new Date(measurement.at).toISOString().slice(0, 10)), routines: distinct([...existing.routines, ...incoming.routines], routine => routine.id), customExercises: distinct([...existing.customExercises, ...incoming.customExercises], exercise => exercise.id), warnings: [...existing.warnings, ...incoming.warnings] };
}
