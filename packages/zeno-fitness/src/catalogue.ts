import { EXDB, EXALIAS } from "../upstream/lib/exercises-data.js";
import { EXIDX, canonicalExId } from "../upstream/lib/exercises.js";
import { muscleWeightsOf } from "../upstream/lib/muscles.js";
import chineseNames from "../upstream/exercise-names/zh.js";
import chineseInstructions from "../upstream/instr/zh.js";
import type { FitnessExercise, FitnessOption } from "./types.js";
import { list, numberMap, record, stringList, text } from "./value.js";
import { instructionCorrections } from "./instruction-corrections.js";

export const muscleLabels: Readonly<Record<string, string>> = {
  trapezius: "斜方肌", deltoids: "三角肌", chest: "胸肌", "upper-back": "背部", serratus: "前锯肌",
  biceps: "肱二头肌", triceps: "肱三头肌", forearm: "前臂", abs: "腹肌", obliques: "腹斜肌",
  "lower-back": "下背", gluteal: "臀肌", quadriceps: "股四头肌", hamstring: "腘绳肌", adductors: "内收肌",
  "hip-flexors": "髋屈肌", calves: "小腿", tibialis: "胫骨前肌", "cardiovascular system": "心肺",
};
const bodyLabels: Record<string, string> = { back: "背部", cardio: "心肺", chest: "胸部", "full body": "全身", "lower arms": "前臂", "lower legs": "小腿", neck: "颈部", shoulders: "肩部", "upper arms": "上臂", "upper legs": "腿部", waist: "核心" };
const equipmentLabels: Record<string, string> = {
  assisted: "辅助器械", band: "弹力带", barbell: "杠铃", "body weight": "自重", "bosu ball": "半球平衡球", cable: "绳索器械", dumbbell: "哑铃", "elliptical machine": "椭圆机", "ez barbell": "曲杆杠铃", hammer: "锤", kettlebell: "壶铃", landmine: "地雷杆", "leverage machine": "固定器械", macebell: "棒铃", "medicine ball": "药球", "olympic barbell": "奥林匹克杠铃", "resistance band": "阻力带", roller: "滚筒", rope: "绳", sandbag: "沙袋", "skierg machine": "滑雪机", "sled machine": "雪橇机", "smith machine": "史密斯机", "stability ball": "健身球", "stationary bike": "动感单车", "stepmill machine": "登楼机", "suspension trainer": "悬挂训练带", tire: "轮胎", "trap bar": "六角杠铃", "upper body ergometer": "上肢功率车", "weight plate": "杠铃片", weighted: "负重", "wheel roller": "健腹轮", custom: "自定义",
};
const categoryLabels: Record<string, string> = { strength: "力量", calisthenics: "徒手", olympic: "举重", plyometrics: "爆发力", isometric: "静力", cardio: "有氧", stretching: "拉伸", mobility: "灵活性", yoga: "瑜伽", pilates: "普拉提", combat: "格斗", rehab: "康复" };
const names = record(chineseNames);
const instructions = record(chineseInstructions);
const aliases = record(EXALIAS);
const index = record(EXIDX);
export function canonicalExerciseId(id: string): string { return text(canonicalExId(id), id); }
export function exerciseFromUpstream(value: unknown): FitnessExercise {
  const raw = record(value);
  const id = canonicalExerciseId(text(raw.id));
  const canonical = record(index[id]);
  const weights = numberMap(muscleWeightsOf(Object.keys(canonical).length ? canonical : raw));
  const primaryMuscleIds = Object.keys(weights).filter(key => weights[key] >= 1);
  const secondaryMuscleIds = Object.keys(weights).filter(key => weights[key] > 0 && weights[key] < 1);
  const bodyPartId = text(raw.bp);
  const equipmentId = text(raw.eq);
  const categoryId = text(raw.cat, "strength");
  const correction = instructionCorrections[id];
  const steps = correction?.englishName === text(raw.n) ? [...correction.steps] : stringList(instructions[id]);
  return {
    id, name: text(names[id], text(raw.n, "自定义动作")), englishName: text(raw.n),
    bodyPartId, bodyPart: bodyLabels[bodyPartId] ?? "其他", categoryId, category: categoryLabels[categoryId] ?? "其他",
    equipmentId, equipment: equipmentLabels[equipmentId] ?? "其他",
    primaryMuscleIds, primaryMuscles: primaryMuscleIds.map(key => muscleLabels[key] ?? "其他"),
    secondaryMuscleIds, secondaryMuscles: secondaryMuscleIds.map(key => muscleLabels[key] ?? "其他"),
    instructions: steps, description: steps[0] ?? "",
  };
}
/** Upstream EXDB already omits alternate female drawings; aliases resolve only at input. */
export const fitnessExercises: readonly FitnessExercise[] = list(EXDB).map(exerciseFromUpstream);
const byId = new Map(fitnessExercises.map(exercise => [exercise.id, exercise]));
export function findExercise(id: string): FitnessExercise | undefined { return byId.get(canonicalExerciseId(id)); }
export const exerciseAliases: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(aliases).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
const options = (labels: Record<string, string>, ids: string[]): FitnessOption[] => [...new Set(ids)].map(id => ({ id, label: labels[id] ?? "其他" })).sort((a, b) => a.label.localeCompare(b.label, "zh"));
export const equipmentOptions = options(equipmentLabels, fitnessExercises.map(exercise => exercise.equipmentId));
export const muscleOptions = options(muscleLabels, fitnessExercises.flatMap(exercise => [...exercise.primaryMuscleIds, ...exercise.secondaryMuscleIds]));
export const categoryOptions = options(categoryLabels, fitnessExercises.map(exercise => exercise.categoryId));
export const bodyPartOptions = options(bodyLabels, fitnessExercises.map(exercise => exercise.bodyPartId));
export interface ExerciseSearch { query?: string; muscles?: string[]; equipment?: string[]; category?: string; bodyPart?: string; limit?: number; customExercises?: FitnessExercise[] }
export function searchExercises(filter: ExerciseSearch = {}): FitnessExercise[] {
  const query = (filter.query ?? "").normalize("NFKC").trim().toLocaleLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  return [...(filter.customExercises ?? []), ...fitnessExercises].filter(exercise => {
    if (filter.equipment?.length && !filter.equipment.some(value => exercise.equipmentId === value || exercise.equipment === value)) return false;
    if (filter.category && exercise.categoryId !== filter.category && exercise.category !== filter.category) return false;
    if (filter.bodyPart && exercise.bodyPartId !== filter.bodyPart && exercise.bodyPart !== filter.bodyPart) return false;
    if (filter.muscles?.length && !filter.muscles.some(value => [...exercise.primaryMuscleIds, ...exercise.secondaryMuscleIds, ...exercise.primaryMuscles, ...exercise.secondaryMuscles].includes(value))) return false;
    const haystack = `${exercise.name} ${exercise.englishName} ${exercise.equipment} ${exercise.bodyPart} ${exercise.primaryMuscles.join(" ")} ${exercise.secondaryMuscles.join(" ")}`.normalize("NFKC").toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  }).sort((a, b) => Number(b.name.startsWith(query)) - Number(a.name.startsWith(query))).slice(0, Math.max(0, filter.limit ?? 200));
}
export const catalogueCoverage = { canonicalExercises: fitnessExercises.length, aliases: Object.keys(exerciseAliases).length, chineseNames: fitnessExercises.filter(exercise => /[\u3400-\u9fff]/u.test(exercise.name)).length, chineseInstructions: fitnessExercises.filter(exercise => exercise.instructions.length > 0).length, restrictedMediaFiles: 0 };
