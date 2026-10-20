import type { FitnessExercise } from "@zeno/fitness";
import { ExerciseMuscleMap, ExerciseVisual } from "./exercise-visual";
import { PrivateMedia } from "./personal-media";
import type { PersonalStore } from "./use-zeno-sync";

/** Shared by the exercise catalogue and in-workout detail; custom media stays authenticated. */
export function ExerciseDetail({ exercise, store }: { exercise: FitnessExercise; store: PersonalStore }) {
  const media = exercise.mediaIds ?? [];
  return <div className="grid gap-5" data-exercise-detail={exercise.id}>
    <p className="text-xs text-muted-foreground">{exercise.equipment}</p>
    {media.length ? <div className="grid gap-3">{media.map(id => <PrivateMedia key={id} id={id} store={store} />)}</div> : <ExerciseVisual key={exercise.id} exercise={exercise} />}
    <ExerciseMuscleMap exercise={exercise} />
    <div className="grid gap-2 text-xs"><p><span className="text-muted-foreground">主要肌群　</span>{exercise.primaryMuscles.join("、") || "未标注"}</p>{exercise.secondaryMuscles.length ? <p><span className="text-muted-foreground">辅助肌群　</span>{exercise.secondaryMuscles.join("、")}</p> : null}</div>
    {exercise.instructions.length ? <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium">动作步骤</summary><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">{exercise.instructions.map((step, index) => <li key={index}>{step}</li>)}</ol></details> : null}
  </div>;
}
