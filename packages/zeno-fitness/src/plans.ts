import { routineDataSchema, trainingScheduleDataSchema } from "@zeno/core/schema";
import { parsePlan as upstreamParsePlan } from "../upstream/lib/plan-share.js";
import { buildStarterPlan as upstreamStarter } from "../upstream/lib/starter.js";
import { queueView } from "../upstream/lib/queue.js";
import type { FitnessUnit, TrainingRoutine, TrainingSchedule } from "./types.js";
import { fromUpstreamRoutine } from "./upstream-adapter.js";
import { finite, list, record, stringList, text } from "./value.js";
import { startTrainingWorkout } from "./training.js";

export interface FitnessPlan { format: "zeno-fitness-plan"; version: 1; title: string; routines: Array<{ id: string; data: TrainingRoutine }>; schedules: TrainingSchedule[] }
export function shareFitnessPlan(title: string, routines: FitnessPlan["routines"], schedules: TrainingSchedule[] = []): string { return JSON.stringify({ format: "zeno-fitness-plan", version: 1, title, routines, schedules }); }
export function parseFitnessPlan(content: string, unit: FitnessUnit = "kg"): FitnessPlan {
  const raw: unknown = JSON.parse(content); const value = record(raw);
  if (value.format === "zeno-fitness-plan" && value.version === 1) return {
    format: "zeno-fitness-plan", version: 1, title: text(value.title),
    routines: list(value.routines).map((item, index) => ({ id: text(record(item).id, `routine-${index}`), data: routineDataSchema.parse(record(item).data) })),
    schedules: list(value.schedules).map(item => trainingScheduleDataSchema.parse(item)),
  };
  const parsed: unknown = upstreamParsePlan(content, unit); const legacy = record(parsed);
  return { format: "zeno-fitness-plan", version: 1, title: text(legacy.name), routines: list(legacy.routines).map((item, index) => ({ id: text(record(item).id, `routine-${index}`), data: fromUpstreamRoutine(item, unit) })), schedules: parseOpenGymSchedules(legacy).map(schedule => schedule.data) };
}
/** One native schedule per weekday lane preserves upstream multi-routine training days. */
export function parseOpenGymSchedules(value: unknown, timeZone = "Asia/Shanghai"): Array<{ id: string; data: TrainingSchedule }> {
  const state = record(value); const week = record(state.week);
  const idsByDay = Object.fromEntries(Object.entries(week).filter(([day]) => /^[0-6]$/.test(day)).map(([day, ids]) => [day, typeof ids === "string" ? [ids] : stringList(ids)]));
  const lanes = Math.max(0, ...Object.values(idsByDay).map(ids => ids.length));
  const schedules = Array.from({ length: lanes }, (_, index) => ({ id: `imported-week-${index}`, data: trainingScheduleDataSchema.parse({ title: "导入的训练安排", mode: "weekly", week: Object.fromEntries(Object.entries(idsByDay).filter(([, ids]) => ids[index]).map(([day, ids]) => [day, ids[index]])), timeZone }) }));
  const rotation = stringList(record(state.rotation).sequence); const sequence = rotation.length ? rotation : stringList(record(state.queue).ids);
  if (sequence.length) {
    const viewed: unknown = queueView({ ...state, routines: list(state.routines), workouts: list(state.workouts), dayPlan: record(state.dayPlan) }, new Date().toISOString().slice(0, 10));
    const next = stringList(record(viewed).remaining)[0];
    schedules.push({ id: "imported-rotation", data: trainingScheduleDataSchema.parse({ title: text(record(state.rotation).label, "导入的轮换训练"), mode: "rotation", rotation: sequence, position: Math.max(0, sequence.indexOf(next ?? sequence[0])), timeZone }) });
  }
  return schedules;
}
export interface PlanPrintExercise { name: string; sets: string[]; restSeconds: number; groupId?: string; notes: string }
export interface PlanPrintData { title: string; unit: FitnessUnit; exercises: PlanPrintExercise[] }
/** Declarative print data: the host owns printing / Save as PDF, with its normal escaping. */
export function planPdfData(routine: TrainingRoutine): PlanPrintData {
  const planned = startTrainingWorkout({ ...routine, noProg: true }, { now: 0 });
  return { title: routine.title, unit: routine.unit, exercises: planned.exercises.map(exercise => ({ name: exercise.name, restSeconds: exercise.restSeconds, ...(exercise.groupId ? { groupId: exercise.groupId } : {}), notes: exercise.notes,
    sets: exercise.sets.map(set => {
      const prefix = [set.kind === "warmup" ? "热身" : set.kind === "drop" ? "递减" : set.kind === "rest_pause" ? "休息暂停" : "", set.side === "left" ? "左侧" : set.side === "right" ? "右侧" : "", exercise.bodyweight ? "自重（重量为附加负重）" : "", exercise.dbLoad === "each" ? "每手" : exercise.dbLoad === "total" ? "双手合计" : ""].filter(Boolean).join(" ");
      const target = `${set.weight != null ? `${set.weight} ${routine.unit} × ` : ""}${set.reps != null ? `${set.reps} 次` : set.durationSeconds != null ? `${set.durationSeconds} 秒` : ""}`;
      const extras = [set.distanceMeters != null ? `${set.distanceMeters} 米` : "", set.speedKmh != null ? `${set.speedKmh} km/h` : "", set.inclinePercent != null ? `坡度 ${set.inclinePercent}%` : "", set.rpe != null ? `RPE ${set.rpe}` : "", set.rir != null ? `RIR ${set.rir}` : "", set.failure ? "至力竭" : "", set.restSeconds != null ? `休息 ${set.restSeconds} 秒` : "", ...(set.drops ?? []).map(drop => `递减至 ${drop.weight} ${routine.unit} × ${drop.reps} 次`), ...(set.restPause ?? []).map(burst => `休息 ${burst.restSeconds} 秒后 ${burst.reps} 次`)];
      return [prefix, target].filter(Boolean).join(" ") + extras.filter(Boolean).map(value => ` · ${value}`).join("");
    }),
  })) };
}
export const starterPlanOptions = [{ id: "ppl", name: "推 · 拉 · 腿", days: 3 }, { id: "upper-lower", name: "上肢 · 下肢", days: 4 }, { id: "full-body", name: "全身训练", days: 3 }, { id: "5x5", name: "5 × 5", days: 3 }];
const starterNames: Record<string, string> = { "Push Day": "推日", "Pull Day": "拉日", "Leg Day": "腿日", "Upper A": "上肢 A", "Upper B": "上肢 B", "Lower A": "下肢 A", "Lower B": "下肢 B", "Full Body A": "全身 A", "Full Body B": "全身 B", "Full Body C": "全身 C" };
export function buildStarterFitnessPlan(id: string, options: { unit?: FitnessUnit; equipment?: string[]; timeZone?: string } = {}): FitnessPlan {
  const result: unknown = upstreamStarter(id, options.equipment); const value = record(result);
  if (!Object.keys(value).length) throw new Error("未知的训练模板");
  const unit = options.unit ?? "kg";
  const routines = list(value.routines).map((entry, index) => { const raw = record(entry); const routine = fromUpstreamRoutine(entry, unit); return { id: text(raw.id, `starter-${index}`), data: { ...routine, title: starterNames[routine.title] ?? routine.title } }; });
  const schedule = trainingScheduleDataSchema.parse({ title: starterPlanOptions.find(plan => plan.id === id)?.name ?? "训练安排", mode: "weekly", week: Object.fromEntries(list(value.schedule).map(entry => [String(finite(record(entry).day)), text(record(entry).routineId)])), timeZone: options.timeZone ?? "Asia/Shanghai" });
  return { format: "zeno-fitness-plan", version: 1, title: schedule.title, routines, schedules: [schedule] };
}
