import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { searchExercises, equipmentOptions, muscleOptions, type FitnessExercise } from "@zeno/fitness";
import { recordsOfKind, type KindRecord } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OptionSelect, PersonalDialog } from "./ui";
import { CustomExerciseEditor } from "./custom-exercise-editor";
import { PrivateMedia } from "./personal-media";
import type { PersonalStore } from "./use-zeno-sync";

export function customFitnessExercises(store: Pick<PersonalStore, "records">): FitnessExercise[] {
  return recordsOfKind(store.records, "exercise").map(record => ({ id: record.id, name: record.data.name, englishName: record.data.name, category: record.data.category, categoryId: record.data.category, bodyPart: "自定义", bodyPartId: "custom", equipment: record.data.equipment.join("、"), equipmentId: "custom", primaryMuscles: record.data.primaryMuscles, primaryMuscleIds: record.data.primaryMuscles, secondaryMuscles: record.data.secondaryMuscles, secondaryMuscleIds: record.data.secondaryMuscles, instructions: record.data.instructions, description: "", mediaIds: record.data.mediaIds }));
}

export function ExercisePicker({ open, onClose, onChoose, store, readOnly = false, browseOnly = false }: { open: boolean; onClose: () => void; onChoose: (exercise: FitnessExercise) => void; store: PersonalStore; readOnly?: boolean; browseOnly?: boolean }) {
  const [query, setQuery] = useState(""); const [equipment, setEquipment] = useState("all"); const [muscle, setMuscle] = useState("all");
  const [detail, setDetail] = useState<FitnessExercise | null>(null); const [creating, setCreating] = useState<KindRecord<"exercise"> | "new" | null>(null);
  const custom = customFitnessExercises(store);
  const results = useMemo(() => searchExercises({ query, equipment: equipment === "all" ? undefined : [equipment], muscles: muscle === "all" ? undefined : [muscle], limit: 100, customExercises: custom }), [query, equipment, muscle, store.records]);
  return <><PersonalDialog title="动作目录" open={open} onClose={onClose} wide>
    <div className="grid gap-3"><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" strokeWidth={1.5} /><Input value={query} onChange={event => setQuery(event.currentTarget.value)} className="pl-9" placeholder="搜索动作、肌群或器械" autoFocus aria-label="搜索动作" /></div><div className="grid grid-cols-2 gap-3"><OptionSelect label="器械" value={equipment} onChange={setEquipment} options={[{ value: "all", label: "全部器械" }, ...equipmentOptions.map(item => ({ value: item.id, label: item.label }))]} /><OptionSelect label="肌群" value={muscle} onChange={setMuscle} options={[{ value: "all", label: "全部肌群" }, ...muscleOptions.map(item => ({ value: item.id, label: item.label }))]} /></div></div>
    <div className="max-h-[50dvh] divide-y divide-border overflow-y-auto">{results.length ? results.map(exercise => <div key={exercise.id} className="flex min-h-14 items-center gap-3 py-2"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetail(exercise)}><span className="block truncate text-sm font-medium">{exercise.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{exercise.primaryMuscles.join("、")} · {exercise.equipment}</span></button>{!browseOnly ? <Button variant="ghost" size="icon-sm" aria-label={`添加${exercise.name}`} disabled={readOnly} onClick={() => onChoose(exercise)}><Plus strokeWidth={1.5} /></Button> : null}</div>) : <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的动作</p>}</div>
    <Button variant="outline" disabled={readOnly} onClick={() => setCreating("new")}><Plus strokeWidth={1.5} />自定义动作</Button>
  </PersonalDialog>
  <PersonalDialog title={detail?.name ?? "动作"} open={detail !== null} onClose={() => setDetail(null)}>{detail ? <><p className="text-xs text-muted-foreground">{detail.primaryMuscles.join("、")} · {detail.equipment}</p>{detail.instructions.length ? <ol className="list-decimal space-y-3 pl-5 text-sm">{detail.instructions.map((step, index) => <li key={index}>{step}</li>)}</ol> : null}<div className="grid gap-3">{(detail.mediaIds ?? []).map(id => <PrivateMedia key={id} id={id} store={store} />)}</div><div className="flex gap-2">{!browseOnly ? <Button disabled={readOnly} onClick={() => { onChoose(detail); setDetail(null); }}>添加动作</Button> : null}{recordsOfKind(store.records, "exercise").some(record => record.id === detail.id) ? <Button variant="outline" disabled={readOnly} onClick={() => { const record = recordsOfKind(store.records, "exercise").find(record => record.id === detail.id); if (record) { setCreating(record); setDetail(null); } }}>编辑动作</Button> : null}</div></> : null}</PersonalDialog>
  <PersonalDialog title={creating === "new" ? "自定义动作" : "编辑自定义动作"} open={creating !== null && !readOnly} onClose={() => setCreating(null)} wide>{creating ? <CustomExerciseEditor key={creating === "new" ? "new" : creating.id} initial={creating === "new" ? undefined : creating} store={store} onClose={() => setCreating(null)} onSaved={setQuery} /> : null}</PersonalDialog></>;
}
