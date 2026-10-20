import { useRef, useState } from "react";
import { Camera, Plus, Trash2 } from "lucide-react";
import { measurementFields, deriveBodyTrends } from "@zeno/fitness";
import { measurementDataSchema, recordsOfKind, type KindRecord, type MeasurementData } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, InlineError, localDateTimeInput, PersonalDialog, QuietEmpty, SaveButton, shortDate, useAction } from "./ui";
export { PrivatePhoto } from "./private-photo";
import { PrivatePhoto } from "./private-photo";
import { PhotoComparison } from "./photo-comparison";
import { personalSettings } from "./personal-settings";
import type { PersonalStore } from "./use-zeno-sync";


function MeasurementEditor({ record, store, onClose }: { record?: KindRecord<"measurement">; store: PersonalStore; onClose: () => void }) {
  const [draft, setDraft] = useState<MeasurementData>(record?.data ?? { at: Date.now(), circumferences: {}, photoMediaIds: [], notes: "" });
  const input = useRef<HTMLInputElement>(null); const action = useAction();
  return <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void action.run(async () => { await store.save("measurement", measurementDataSchema.parse(draft), record); onClose(); }); }}>
    <Field label="记录时间"><Input type="datetime-local" value={localDateTimeInput(draft.at)} required onChange={event => { if (event.currentTarget.value) setDraft(current => ({ ...current, at: new Date(event.currentTarget.value).getTime() })); }} /></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="体重（kg）"><Input type="number" min={1} max={700} step="0.1" value={draft.weightKg ?? ""} onChange={event => setDraft(current => ({ ...current, weightKg: event.currentTarget.value ? Number(event.currentTarget.value) : undefined }))} /></Field><Field label="体脂率（%）"><Input type="number" min={0} max={100} step="0.1" value={draft.bodyFatPercent ?? ""} onChange={event => setDraft(current => ({ ...current, bodyFatPercent: event.currentTarget.value ? Number(event.currentTarget.value) : undefined }))} /></Field></div>
    <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">围度（cm）</summary><div className="mt-4 grid grid-cols-2 gap-3">{measurementFields.map(field => <Field key={field.id} label={field.name}><Input type="number" min={0} max={1000} step="0.1" value={draft.circumferences[field.id] ?? ""} onChange={event => setDraft(current => { const circumferences = { ...current.circumferences }; if (event.currentTarget.value) circumferences[field.id] = Number(event.currentTarget.value); else delete circumferences[field.id]; return { ...current, circumferences }; })} /></Field>)}</div></details>
    <div className="grid grid-cols-3 gap-2">{draft.photoMediaIds.map(id => <div key={id} className="relative"><PrivatePhoto id={id} store={store} /><Button type="button" variant="secondary" size="icon-xs" aria-label="移除照片" className="absolute right-1 top-1" onClick={() => setDraft(current => ({ ...current, photoMediaIds: current.photoMediaIds.filter(value => value !== id) }))}><Trash2 strokeWidth={1.5} /></Button></div>)}</div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="sr-only" aria-label="添加身体照片" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ""; void action.run(async () => { if (files.length + draft.photoMediaIds.length > 20) throw new Error("每条记录最多保存 20 张照片。"); const ids: string[] = []; for (const file of files) ids.push(await store.addMedia(file, file.name)); setDraft(current => ({ ...current, photoMediaIds: [...current.photoMediaIds, ...ids] })); }); }} />
    <Button type="button" variant="outline" disabled={action.busy} onClick={() => input.current?.click()}><Camera strokeWidth={1.5} />添加照片</Button>
    <Field label="目标体重（kg）"><Input type="number" min={1} max={700} step="0.1" value={draft.goalWeightKg ?? ""} onChange={event => setDraft(current => ({ ...current, goalWeightKg: event.currentTarget.value ? Number(event.currentTarget.value) : undefined }))} /></Field>
    <Field label="备注"><Textarea rows={2} value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.currentTarget.value }))} /></Field><InlineError message={action.error} /><div className="flex gap-2 border-t border-border pt-4">{record ? <Button type="button" variant="destructive" onClick={() => void action.run(async () => { await store.remove(record); onClose(); })}>删除</Button> : null}<div className="flex-1" /><Button type="button" variant="outline" onClick={onClose}>取消</Button><SaveButton busy={action.busy} /></div>
  </form>;
}

export function BodyRecords({ store, readOnly = false }: { store: PersonalStore; readOnly?: boolean }) {
  const [comparison, setComparison] = useState(false);
  const zone = personalSettings(store.records).timeZone;
  const [editing, setEditing] = useState<KindRecord<"measurement"> | "new" | null>(null);
  const records = recordsOfKind(store.records, "measurement").sort((a, b) => b.data.at - a.data.at);
  const photoRecords = records.filter(record => record.data.photoMediaIds.length > 0);
  const trends = deriveBodyTrends(records.map(record => record.data));
  return <section><div className="mb-4 flex items-center justify-between"><h2 className="min-w-0 flex-1 text-sm font-medium">身体记录</h2><Button variant="ghost" size="sm" disabled={photoRecords.length < 2} onClick={() => setComparison(true)}>照片对比</Button><Button variant="outline" size="sm" disabled={readOnly} onClick={() => setEditing("new")}><Plus strokeWidth={1.5} />记录</Button></div>{trends.length ? <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{trends.slice(0, 6).map(trend => <div key={trend.field}><dt className="text-xs text-muted-foreground">{trend.name}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{trend.latest}<span className="ml-1 text-xs font-normal text-muted-foreground">{trend.unit}</span></dd></div>)}</dl> : null}
    {records.find(record => record.data.goalWeightKg)?.data.goalWeightKg ? <p className="mb-4 text-xs text-muted-foreground">目标体重 {records.find(record => record.data.goalWeightKg)?.data.goalWeightKg} kg</p> : null}
    {records.length ? <ul className="divide-y divide-border">{records.map(record => <li key={record.id}><button className="flex min-h-14 w-full items-center gap-3 py-3 text-left" onClick={() => setEditing(record)}><span className="min-w-0 flex-1 text-sm">{shortDate(record.data.at, zone)}</span><span className="text-sm tabular-nums">{record.data.weightKg ? `${record.data.weightKg} kg` : ""}</span>{record.data.photoMediaIds.length ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Camera className="size-3.5" strokeWidth={1.5} />{record.data.photoMediaIds.length}</span> : null}</button>{record.data.photoMediaIds.length ? <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5">{record.data.photoMediaIds.map(id => <PrivatePhoto key={id} id={id} store={store} />)}</div> : null}</li>)}</ul> : <QuietEmpty title="还没有身体记录" />}
    <PersonalDialog title="照片对比" open={comparison} onClose={() => setComparison(false)} wide><PhotoComparison records={photoRecords} store={store} /></PersonalDialog>
    <PersonalDialog title={editing === "new" ? "添加身体记录" : "编辑身体记录"} open={editing !== null && (!readOnly || editing !== "new")} onClose={() => setEditing(null)} wide>{editing && readOnly && editing !== "new" ? <div className="grid gap-4"><p className="text-xs text-muted-foreground">{shortDate(editing.data.at, zone)}</p><dl className="grid grid-cols-2 gap-4">{[{ name: "体重", value: editing.data.weightKg, unit: "kg" }, { name: "体脂率", value: editing.data.bodyFatPercent, unit: "%" }, ...measurementFields.map(field => ({ name: field.name, value: editing.data.circumferences[field.id], unit: "cm" }))].filter(field => field.value !== undefined).map(field => <div key={field.name}><dt className="text-xs text-muted-foreground">{field.name}</dt><dd className="mt-1 text-sm">{field.value} {field.unit}</dd></div>)}</dl><p className="whitespace-pre-wrap text-sm">{editing.data.notes}</p><div className="grid grid-cols-2 gap-2">{editing.data.photoMediaIds.map(id => <PrivatePhoto key={id} id={id} store={store} />)}</div></div> : editing ? <MeasurementEditor key={editing === "new" ? "new" : editing.id} record={editing === "new" ? undefined : editing} store={store} onClose={() => setEditing(null)} /> : null}</PersonalDialog>
  </section>;
}
