/** Original Zeno vector keyframes. No upstream exercise image, video or geometry is used. */
import { canonicalExerciseId, findExercise, muscleLabels, type FitnessExercise } from "@zeno/fitness";
import type { RoutineExercise } from "@zeno/core";
import mascotDemos from "./mascot-demos.json";

export type Point = readonly [number, number];
export type Pose = { head: Point; shoulder: Point; hip: Point; elbow: Point; hand: Point; knee: Point; ankle: Point; toe: Point; farElbow: Point; farHand: Point; farKnee: Point; farAnkle: Point; farToe: Point };
export type MovementScene = { exerciseId: string; englishName: string; equipment: "barbell" | "dumbbells" | "none"; view: "side" | "front"; support?: "bench" | "seat"; phases: readonly [string, string]; start: Pose; end: Pose };
const standing: Pose = { head: [155, 39], shoulder: [151, 64], hip: [145, 125], elbow: [164, 94], hand: [161, 124], knee: [150, 170], ankle: [147, 211], toe: [166, 213], farElbow: [143, 96], farHand: [140, 125], farKnee: [132, 171], farAnkle: [130, 211], farToe: [147, 213] };
const pose = (changes: Partial<Pose>): Pose => ({ ...standing, ...changes });

/** Deliberate exact-ID allowlist: variants never inherit a different exercise's technique. */
export const movementScenes: readonly MovementScene[] = [
  { exerciseId: "0025", englishName: "barbell bench press", equipment: "barbell", view: "side", support: "bench", phases: ["下放", "推起"],
    start: pose({ head: [82, 141], shoulder: [108, 144], hip: [181, 151], elbow: [121, 164], hand: [130, 127], knee: [222, 170], ankle: [219, 211], toe: [242, 213], farElbow: [111, 155], farHand: [120, 127], farKnee: [207, 174], farAnkle: [202, 211], farToe: [222, 213] }),
    end: pose({ head: [82, 141], shoulder: [108, 144], hip: [181, 151], elbow: [117, 105], hand: [126, 65], knee: [222, 170], ankle: [219, 211], toe: [242, 213], farElbow: [106, 105], farHand: [116, 65], farKnee: [207, 174], farAnkle: [202, 211], farToe: [222, 213] }) },
  { exerciseId: "3593", englishName: "barbell squat", equipment: "barbell", view: "side", phases: ["站立", "下蹲"],
    start: pose({ elbow: [126, 87], hand: [143, 70], farElbow: [115, 83], farHand: [132, 69] }),
    end: pose({ head: [162, 94], shoulder: [150, 119], hip: [111, 166], elbow: [125, 139], hand: [143, 125], knee: [174, 167], ankle: [147, 211], toe: [166, 213], farElbow: [115, 135], farHand: [132, 124], farKnee: [159, 171], farAnkle: [130, 211], farToe: [147, 213] }) },
  { exerciseId: "1197", englishName: "squat", equipment: "none", view: "side", phases: ["站立", "下蹲"],
    start: pose({ elbow: [180, 68], hand: [210, 70], farElbow: [174, 64], farHand: [204, 66] }),
    end: pose({ head: [162, 94], shoulder: [150, 119], hip: [111, 166], elbow: [180, 121], hand: [210, 123], knee: [174, 167], ankle: [147, 211], toe: [166, 213], farElbow: [174, 117], farHand: [204, 119], farKnee: [159, 171], farAnkle: [130, 211], farToe: [147, 213] }) },
  { exerciseId: "0032", englishName: "barbell deadlift", equipment: "barbell", view: "side", phases: ["起始", "站起"],
    start: pose({ head: [190, 95], shoulder: [171, 117], hip: [114, 153], elbow: [177, 153], hand: [177, 188], knee: [165, 173], ankle: [147, 211], toe: [166, 213], farElbow: [165, 153], farHand: [165, 188], farKnee: [151, 175], farAnkle: [130, 211], farToe: [147, 213] }),
    end: pose({ elbow: [163, 100], hand: [161, 139], farElbow: [148, 99], farHand: [148, 139] }) },
  { exerciseId: "0027", englishName: "barbell bent over row", equipment: "barbell", view: "side", phases: ["伸臂", "拉向腹部"],
    start: pose({ head: [202, 95], shoulder: [180, 115], hip: [120, 147], elbow: [182, 151], hand: [181, 187], knee: [152, 175], farElbow: [170, 151], farHand: [169, 187], farKnee: [136, 177] }),
    end: pose({ head: [202, 95], shoulder: [180, 115], hip: [120, 147], elbow: [137, 113], hand: [156, 146], knee: [152, 175], farElbow: [126, 112], farHand: [144, 146], farKnee: [136, 177] }) },
  { exerciseId: "0294", englishName: "dumbbell biceps curl", equipment: "dumbbells", view: "side", phases: ["伸臂", "弯举"], start: pose({}),
    end: pose({ elbow: [164, 94], hand: [183, 67], farElbow: [143, 96], farHand: [163, 68] }) },
  { exerciseId: "0334", englishName: "dumbbell lateral raise", equipment: "dumbbells", view: "front", phases: ["下放", "平举"],
    start: pose({ head: [160, 39], shoulder: [160, 65], hip: [160, 126], elbow: [137, 96], hand: [129, 129], farElbow: [183, 96], farHand: [191, 129], knee: [146, 169], ankle: [145, 211], toe: [134, 213], farKnee: [174, 169], farAnkle: [175, 211], farToe: [186, 213] }),
    end: pose({ head: [160, 39], shoulder: [160, 65], hip: [160, 126], elbow: [111, 63], hand: [76, 68], farElbow: [209, 63], farHand: [244, 68], knee: [146, 169], ankle: [145, 211], toe: [134, 213], farKnee: [174, 169], farAnkle: [175, 211], farToe: [186, 213] }) },
  { exerciseId: "0405", englishName: "dumbbell seated shoulder press", equipment: "dumbbells", view: "front", support: "seat", phases: ["肩侧", "上推"],
    start: pose({ head: [160, 61], shoulder: [160, 86], hip: [160, 151], elbow: [112, 90], hand: [111, 54], farElbow: [208, 90], farHand: [209, 54], knee: [131, 172], ankle: [130, 211], toe: [114, 213], farKnee: [189, 172], farAnkle: [190, 211], farToe: [206, 213] }),
    end: pose({ head: [160, 61], shoulder: [160, 86], hip: [160, 151], elbow: [130, 51], hand: [139, 16], farElbow: [190, 51], farHand: [181, 16], knee: [131, 172], ankle: [130, 211], toe: [114, 213], farKnee: [189, 172], farAnkle: [190, 211], farToe: [206, 213] }) },
  { exerciseId: "0417", englishName: "dumbbell standing calf raise", equipment: "dumbbells", view: "side", phases: ["落跟", "提踵"], start: pose({}),
    end: pose({ head: [160, 23], shoulder: [156, 48], hip: [150, 109], elbow: [169, 78], hand: [166, 108], knee: [155, 154], ankle: [152, 195], toe: [166, 213], farElbow: [148, 80], farHand: [145, 109], farKnee: [137, 155], farAnkle: [135, 195], farToe: [147, 213] }) },
  { exerciseId: "0662", englishName: "push-up", equipment: "none", view: "side", phases: ["支撑", "下放"],
    start: pose({ head: [89, 105], shoulder: [111, 119], hip: [176, 159], elbow: [112, 165], hand: [110, 211], knee: [213, 184], ankle: [246, 206], toe: [256, 213], farElbow: [100, 165], farHand: [98, 211], farKnee: [207, 183], farAnkle: [235, 206], farToe: [245, 213] }),
    end: pose({ head: [75, 169], shoulder: [100, 175], hip: [172, 188], elbow: [143, 187], hand: [110, 211], knee: [212, 200], ankle: [246, 206], toe: [256, 213], farElbow: [131, 187], farHand: [98, 211], farKnee: [205, 199], farAnkle: [235, 206], farToe: [245, 213] }) },
  { exerciseId: "0612", englishName: "lunge", equipment: "none", view: "side", phases: ["站立", "迈步下蹲"], start: pose({}),
    end: pose({ head: [162, 74], shoulder: [159, 99], hip: [151, 160], elbow: [177, 129], hand: [174, 159], knee: [205, 166], ankle: [206, 211], toe: [226, 213], farElbow: [147, 130], farHand: [143, 160], farKnee: [98, 203], farAnkle: [79, 188], farToe: [65, 213] }) },
];

export function movementForExercise(exercise: Pick<FitnessExercise, "id" | "englishName" | "bodyPartId">): MovementScene | undefined {
  if (exercise.bodyPartId === "custom") return undefined;
  const canonicalId = canonicalExerciseId(exercise.id);
  return movementScenes.find(scene => scene.exerciseId === canonicalId && scene.englishName === exercise.englishName);
}

export type ExerciseDemo = { video: string; poster: string; kind: "mascot" | "diagram" };
export function mascotDemoForExercise(exercise: Pick<FitnessExercise, "id" | "englishName" | "bodyPartId">): ExerciseDemo | undefined {
  if (exercise.bodyPartId === "custom") return undefined;
  const canonicalId = canonicalExerciseId(exercise.id);
  const demo = mascotDemos.find(item => item.exerciseId === canonicalId && item.englishName === exercise.englishName);
  return demo ? { video: `zeno/fitness/${demo.stem}.mp4`, poster: `zeno/fitness/${demo.stem}-poster.webp`, kind: demo.kind === "diagram" ? "diagram" : "mascot" } : undefined;
}
export function interpolatePose(scene: MovementScene, progress: number): Pose {
  const ratio = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const point = (key: keyof Pose): Point => [scene.start[key][0] + (scene.end[key][0] - scene.start[key][0]) * ratio, scene.start[key][1] + (scene.end[key][1] - scene.start[key][1]) * ratio];
  return { head: point("head"), shoulder: point("shoulder"), hip: point("hip"), elbow: point("elbow"), hand: point("hand"), knee: point("knee"), ankle: point("ankle"), toe: point("toe"), farElbow: point("farElbow"), farHand: point("farHand"), farKnee: point("farKnee"), farAnkle: point("farAnkle"), farToe: point("farToe") };
}
/** 4.8-second illustrative cycle with brief end holds; not an exercise prescription. */
export function movementProgress(elapsedMs: number): number {
  const cycle = ((elapsedMs % 4800) + 4800) % 4800 / 4800;
  const linear = cycle < .08 ? 0 : cycle < .46 ? (cycle - .08) / .38 : cycle < .58 ? 1 : cycle < .96 ? 1 - (cycle - .58) / .38 : 0;
  return linear * linear * (3 - 2 * linear);
}

/** Only recognized anatomical keys are highlighted; arbitrary custom labels are not guessed. */
export function exerciseMuscleValues(exercise: Pick<FitnessExercise, "primaryMuscleIds" | "secondaryMuscleIds">): Record<string, number> {
  const result: Record<string, number> = {};
  const canonical = (value: string) => Object.hasOwn(muscleLabels, value) ? value : Object.entries(muscleLabels).find(([, label]) => label === value)?.[0];
  for (const value of exercise.secondaryMuscleIds) { const id = canonical(value); if (id) result[id] = .4; }
  for (const value of exercise.primaryMuscleIds) { const id = canonical(value); if (id) result[id] = 1; }
  return result;
}

/** A deleted custom exercise keeps its historical labels without impersonating a built-in. */
export function exerciseForWorkoutEntry(entry: RoutineExercise, custom: readonly FitnessExercise[]): FitnessExercise {
  const current = custom.find(exercise => exercise.id === entry.exerciseId) ?? findExercise(entry.exerciseId);
  if (current) return current;
  const snapshot = entry.muscleSnapshot;
  return { id: entry.exerciseId, name: entry.name, englishName: entry.name, bodyPartId: "custom", bodyPart: snapshot?.bodyPart ?? "自定义", category: "自定义", categoryId: "strength", equipment: snapshot?.equipment ?? "未标注器械", equipmentId: "custom", primaryMuscleIds: snapshot?.primaryMuscles ?? [], primaryMuscles: snapshot?.primaryMuscles ?? [], secondaryMuscleIds: snapshot?.secondaryMuscles ?? [], secondaryMuscles: snapshot?.secondaryMuscles ?? [], instructions: [], description: "" };
}
