import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { muscleMapSvg, type FitnessExercise } from "@zeno/fitness";
import { Button } from "@/components/ui/button";
import { exerciseMuscleValues, interpolatePose, mascotDemoForExercise, movementForExercise, movementProgress, type MovementScene, type Point } from "./movement-scenes";

const points = (...values: Point[]) => values.map(point => point.join(",")).join(" ");

export function MovementFigure({ scene, progress }: { scene: MovementScene; progress: number }) {
  const body = interpolatePose(scene, progress);
  const shoulder: Point = scene.view === "front" ? [body.shoulder[0] - 15, body.shoulder[1]] : body.shoulder;
  const farShoulder: Point = [body.shoulder[0] + (scene.view === "front" ? 15 : -8), body.shoulder[1]];
  const hip: Point = [body.hip[0] - (scene.view === "front" ? 8 : 0), body.hip[1]];
  const farHip: Point = [body.hip[0] + (scene.view === "front" ? 8 : -8), body.hip[1]];
  const bar: Point = scene.exerciseId === "3593" ? [body.shoulder[0] - 3, body.shoulder[1] + 3] : [(body.hand[0] + body.farHand[0]) / 2, body.hand[1]];
  const dumbbell = (position: Point, key: string) => <g key={key} transform={`translate(${position[0]} ${position[1]})`} strokeWidth="3"><path d="M-13 0H13" /><rect x="-18" y="-8" width="7" height="16" rx="2" fill="currentColor" stroke="none" /><rect x="11" y="-8" width="7" height="16" rx="2" fill="currentColor" stroke="none" /></g>;
  return <svg viewBox="0 0 320 240" className="mx-auto w-full max-w-sm text-foreground" role="img" aria-label="原创动作关键姿态示意" data-movement-figure>
    <path d="M48 216H272" stroke="currentColor" opacity=".12" />
    {scene.support ? <g fill="none" stroke="currentColor" strokeWidth="4" opacity=".25"><path d={scene.support === "bench" ? "M76 164H190M89 164V212M178 164V212" : "M126 155H194M133 155V212M187 155V212M194 155V101"} strokeLinecap="round" /></g> : null}
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <g opacity=".28" strokeWidth="8"><polyline points={points(farShoulder, body.farElbow, body.farHand)} /><polyline points={points(farHip, body.farKnee, body.farAnkle, body.farToe)} /></g>
      <path d={`M${body.head.join(" ")}L${body.shoulder.join(" ")}`} strokeWidth="9" />
      <path d={`M${body.shoulder.join(" ")}L${body.hip.join(" ")}`} strokeWidth="19" />
      {scene.view === "front" ? <path d={`M${shoulder.join(" ")}H${farShoulder[0]}`} strokeWidth="10" /> : null}
      <polyline points={points(hip, body.knee, body.ankle, body.toe)} strokeWidth="9" />
      <polyline points={points(shoulder, body.elbow, body.hand)} strokeWidth="8" />
      <circle cx={body.head[0]} cy={body.head[1]} r="11" fill="currentColor" stroke="none" />
      <g className="text-primary">{scene.equipment === "dumbbells" ? [dumbbell(body.farHand, "far"), dumbbell(body.hand, "near")] : null}
        {scene.equipment === "barbell" ? <g transform={`translate(${bar[0]} ${bar[1]})`} strokeWidth="3"><path d="M-44 0H44" /><rect x="-37" y="-13" width="8" height="26" rx="2" fill="currentColor" stroke="none" /><rect x="29" y="-13" width="8" height="26" rx="2" fill="currentColor" stroke="none" /></g> : null}
      </g>
    </g>
  </svg>;
}

function elapsedAtProgress(progress: number): number {
  let low = 0, high = 1;
  for (let index = 0; index < 20; index++) { const middle = (low + high) / 2; if (middle * middle * (3 - 2 * middle) < progress) low = middle; else high = middle; }
  return (.08 + .38 * (low + high) / 2) * 4800;
}

export function ExerciseMovement({ scene }: { scene: MovementScene }) {
  const [progress, setProgress] = useState(0), [playing, setPlaying] = useState(false), [reduced, setReduced] = useState(false);
  const elapsed = useRef(0), frame = useRef<number | null>(null);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(preference.matches); if (preference.matches) setPlaying(false); };
    const visibility = () => { if (document.visibilityState !== "visible") setPlaying(false); };
    update(); preference.addEventListener("change", update); document.addEventListener("visibilitychange", visibility);
    return () => { preference.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!playing || reduced) return;
    let previous: number | null = null;
    const tick = (time: number) => {
      if (previous !== null) elapsed.current += Math.min(100, Math.max(0, time - previous));
      previous = time; setProgress(movementProgress(elapsed.current)); frame.current = window.requestAnimationFrame(tick);
    };
    frame.current = window.requestAnimationFrame(tick);
    return () => { if (frame.current !== null) window.cancelAnimationFrame(frame.current); frame.current = null; };
  }, [playing, reduced]);
  return <div className="overflow-hidden rounded-xl bg-muted/35" data-exercise-movement={scene.exerciseId}>
    <MovementFigure scene={scene} progress={progress} />
    <div className="flex items-center gap-3 border-t border-border/50 px-3 py-2">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={playing ? "暂停动作演示" : "播放动作演示"} disabled={reduced} onClick={() => setPlaying(current => !current)}>{playing ? <Pause strokeWidth={1.5} /> : <Play strokeWidth={1.5} />}</Button>
      <input type="range" min="0" max="100" step="1" value={Math.round(progress * 100)} aria-label="动作进度" aria-valuetext={`${Math.round(progress * 100)}%，${progress < .5 ? scene.phases[0] : scene.phases[1]}`} className="min-w-0 flex-1 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" onChange={event => { const value = Number(event.currentTarget.value) / 100; setPlaying(false); elapsed.current = elapsedAtProgress(value); setProgress(value); }} />
      <span className="min-w-14 text-right text-xs text-muted-foreground">{progress < .5 ? scene.phases[0] : scene.phases[1]}</span>
    </div>
    {reduced ? <p className="px-4 pb-3 text-xs text-muted-foreground">减少动态效果已开启，可拖动查看姿态。</p> : null}
  </div>;
}

function MascotMovement({ demo }: { demo: { video: string; poster: string } }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = video.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pause = () => { if (document.visibilityState !== "visible" || preference.matches) video.current?.pause(); };
    preference.addEventListener("change", pause); document.addEventListener("visibilitychange", pause);
    return () => { element?.pause(); preference.removeEventListener("change", pause); document.removeEventListener("visibilitychange", pause); };
  }, []);
  const base = import.meta.env.BASE_URL;
  return <div className="overflow-hidden rounded-xl bg-muted/35"><video ref={video} src={base + demo.video} poster={base + demo.poster} aria-label="泽诺吉祥物动作演示" controls muted playsInline preload="none" className="aspect-video w-full object-contain" onError={() => setFailed(true)} />{failed ? <p className="px-3 py-2 text-xs text-muted-foreground">视频暂不可用，可切换到姿态示意。</p> : null}</div>;
}

export function ExerciseVisual({ exercise }: { exercise: FitnessExercise }) {
  const scene = movementForExercise(exercise);
  const demo = mascotDemoForExercise(exercise);
  const [view, setView] = useState(demo ? "mascot" : "pose");
  return <section className="grid gap-3" aria-label="动作示意">{demo ? <div className="flex gap-1" role="group" aria-label="演示形式"><Button type="button" variant={view === "mascot" ? "secondary" : "ghost"} size="xs" aria-pressed={view === "mascot"} onClick={() => setView("mascot")}>泽诺演示</Button><Button type="button" variant={view === "pose" ? "secondary" : "ghost"} size="xs" aria-pressed={view === "pose"} onClick={() => setView("pose")}>姿态示意</Button></div> : null}{demo && view === "mascot" ? <MascotMovement demo={demo} /> : scene ? <ExerciseMovement key={scene.exerciseId} scene={scene} /> : <p className="py-3 text-xs text-muted-foreground">暂无动作演示</p>}</section>;
}

export function ExerciseMuscleMap({ exercise }: { exercise: FitnessExercise }) {
  const values = exerciseMuscleValues(exercise);
  if (!Object.keys(values).length) return <p className="text-xs text-muted-foreground">暂无肌群标注</p>;
  return <section className="border-t border-border pt-4" aria-label="动作肌群"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">肌群</h3><span className="text-[11px] text-muted-foreground">深色主要 · 浅色辅助</span></div><div className="mt-3 grid grid-cols-2 gap-4">{(["front", "back"] satisfies ("front" | "back")[]).map(view => {
    // Fixed licensed geometry plus numeric intensity only. No user HTML is interpolated.
    const svg = muscleMapSvg({ view, values }).replaceAll("#16a394", "var(--primary)").replaceAll("#dce3e1", "var(--muted)");
    return <figure key={view}><div className="[&_svg]:mx-auto [&_svg]:h-44 [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} /><figcaption className="mt-2 text-center text-[11px] text-muted-foreground">{view === "front" ? "正面" : "背面"}</figcaption></figure>;
  })}</div></section>;
}
