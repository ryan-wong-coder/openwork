import { useState } from "react";
import { Pencil } from "lucide-react";
import { fitnessDayNoteSchema, localDateKey, recordsOfKind, type FitnessDayNote } from "@zeno/core";
import { updateFitnessDayNote } from "@zeno/fitness";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { personalSettings } from "./personal-settings";
import { Field, InlineError, OptionSelect, PersonalDialog, SaveButton, useAction } from "./ui";
import type { PersonalStore } from "./use-zeno-sync";

const labels = [{ value: "none", label: "日常" }, { value: "rest", label: "休息" }, { value: "sick", label: "生病" }, { value: "injured", label: "受伤" }, { value: "travel", label: "旅行" }];
function NoteEditor({ day, maxDay, initial, onSave, onRemove }: { day: string; maxDay: string; initial?: FitnessDayNote; onSave: (day: string, value: FitnessDayNote) => Promise<void>; onRemove: (day: string) => Promise<void> }) {
  const [date, setDate] = useState(day), [tag, setTag] = useState(initial?.tag ?? "none"), [text, setText] = useState(initial?.text ?? ""); const action = useAction();
  return <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void action.run(() => onSave(date, fitnessDayNoteSchema.parse({ tag: tag === "none" ? undefined : tag, text, at: Date.now() }))); }}><Field label="日期"><Input type="date" value={date} max={maxDay} required onChange={event => setDate(event.currentTarget.value)} /></Field><Field label="今天的状态"><OptionSelect label="训练日状态" value={tag} options={labels} onChange={setTag} /></Field><Field label="备注"><Textarea rows={3} maxLength={4000} value={text} onChange={event => setText(event.currentTarget.value)} /></Field><InlineError message={action.error} /><div className="flex items-center gap-3">{initial ? <Button type="button" variant="ghost" disabled={action.busy} onClick={() => void action.run(() => onRemove(day))}>清除备注</Button> : null}<div className="flex-1" /><SaveButton busy={action.busy} /></div></form>;
}
export function FitnessDayNoteEditor({ store, readOnly = false }: { store: PersonalStore; readOnly?: boolean }) {
  const [open, setOpen] = useState(false); const settings = personalSettings(store.records), today = localDateKey(Date.now(), settings.timeZone);
  const current = recordsOfKind(store.records, "settings").sort((a, b) => b.updatedAt - a.updatedAt)[0], note = settings.fitnessDayNotes?.[today];
  const [day, setDay] = useState(today);
  const change = async (date: string, value?: FitnessDayNote) => { if (readOnly || !store.writable) throw new Error("此页面暂时不能编辑，请检查功能状态。"); const options = { timeZone: settings.timeZone }; const notes = value && date !== day ? updateFitnessDayNote(settings.fitnessDayNotes ?? {}, day, null, options) : settings.fitnessDayNotes ?? {}; const fitnessDayNotes = updateFitnessDayNote(notes, date, value ?? null, options); await store.save("settings", { ...settings, fitnessDayNotes }, current); setOpen(false); };
  return <section className="border-t border-border py-5"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-medium">{note?.tag ? labels.find(item => item.value === note.tag)?.label : "今日状态"}</h2><Button variant="ghost" size="sm" disabled={readOnly || !store.writable} onClick={() => { setDay(today); setOpen(true); }}><Pencil strokeWidth={1.5} />记录</Button></div>{note?.text ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{note.text}</p> : null}<details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">过往备注</summary><ul className="mt-2 divide-y divide-border">{Object.entries(settings.fitnessDayNotes ?? {}).filter(([, value]) => value.tag || value.text.trim()).sort(([a], [b]) => b.localeCompare(a)).map(([date, value]) => <li key={date}><button className="flex min-h-11 w-full items-center gap-3 text-left text-xs" onClick={() => { setDay(date); setOpen(true); }} disabled={readOnly || !store.writable}><span className="shrink-0 text-muted-foreground">{date}</span><span className="min-w-0 flex-1 truncate">{value.tag ? labels.find(item => item.value === value.tag)?.label : ""}{value.text ? " · " + value.text : ""}</span></button></li>)}</ul></details><PersonalDialog title="训练日备注" open={open} onClose={() => setOpen(false)}>{open ? <NoteEditor key={day} day={day} maxDay={today} initial={settings.fitnessDayNotes?.[day]} onSave={(date, value) => change(date, value)} onRemove={date => change(date)} /> : null}</PersonalDialog></section>;
}
