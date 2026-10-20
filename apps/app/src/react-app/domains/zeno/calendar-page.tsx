import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Upload, Undo2 } from "lucide-react";
import { calendarRange, localDateOf, shiftAnchor, type CalendarView } from "@openwork/calendar";
import { createMutation, eventDataSchema, expandEvent, exportIcs, localDateKey, parseIcs, personalRecordSchema, projectTaskSchedule, projectTrainingSchedule, recordsOfKind, splitEventSeries, type EventData, type EventOccurrence, type KindRecord } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { personalSettings } from "./personal-settings";
import { rescheduleCalendarEvent, updateEntireEventSeries } from "./calendar-mutations";
import { CalendarBoard, type CalendarDisplayEntry } from "./calendar-board";
import { EventEditor, type SeriesScope } from "./event-editor";
import { downloadText, InlineError, PageHeading, PersonalDialog, useAction } from "./ui";
import type { PersonalStore } from "./use-zeno-sync";

type Selection = { record: KindRecord<"event">; occurrence: EventOccurrence };
export function PersonalCalendarPage({ store, onOpenTraining, readOnly = false }: { store: PersonalStore; onOpenTraining?: (id: string) => void; readOnly?: boolean }) {
  const settings = personalSettings(store.records);
  const zone = settings.timeZone;
  const [view, setView] = useState<CalendarView | "agenda">("week");
  const [anchor, setAnchor] = useState(() => localDateOf(Date.now(), zone));
  const [taskDetail, setTaskDetail] = useState<{ title: string; status: string; summary: string } | null>(null);
  const [draft, setDraft] = useState<EventData | null>(null); const [selected, setSelected] = useState<Selection | null>(null);
  const [imported, setImported] = useState<ReturnType<typeof parseIcs> | null>(null);
  const [filters, setFilters] = useState({ plan: true, training: true, todo: true, ai: true });
  const inputRef = useRef<HTMLInputElement>(null); const action = useAction();
  const events = recordsOfKind(store.records, "event");
  const range = useMemo(() => calendarRange(view === "agenda" ? "week" : view, anchor, zone, settings?.weekStartsOn ?? 1), [view, anchor, zone, settings?.weekStartsOn]);
  const training = recordsOfKind(store.records, "trainingSchedule").flatMap(schedule => projectTrainingSchedule(schedule, recordsOfKind(store.records, "routine"), range.start, range.end, { overrides: events, workouts: recordsOfKind(store.records, "workout") }).filter(slot => slot.virtual).map(slot => ({ record: personalRecordSchema.parse({ ...schedule, id: slot.id, kind: "event", data: slot.data, version: 0 }), slot }))).flatMap(item => item.record.kind === "event" ? [{ record: item.record, slot: item.slot }] : []);
  const tasks = recordsOfKind(store.records, "task").flatMap(task => projectTaskSchedule(task, recordsOfKind(store.records, "run"), range.start, range.end));
  const occurrences = [...events, ...training.map(item => item.record)].flatMap(record => expandEvent(record.data, range.start, range.end).map(occurrence => ({ record, occurrence })));
  const entries: CalendarDisplayEntry[] = occurrences.filter(item => filters[item.record.data.category]).map(item => ({ key: `${item.record.id}:${item.occurrence.originalStartAt}`, title: item.occurrence.title, start: item.occurrence.startAt, end: item.occurrence.endAt, allDay: item.record.data.allDay, source: item.record.data.category === "training" ? "training" : item.record.data.category === "todo" ? "todo" : "event", done: item.occurrence.data.status === "completed" }));
  if (filters.ai) entries.push(...tasks.map((task): CalendarDisplayEntry => ({ key: "task:" + task.id, title: task.title, start: task.startAt, end: task.endAt, allDay: false, source: "task", done: task.status === "succeeded" })));
  const createAt = (startAt: number, endAt: number) => {
    if (readOnly) return;
    setSelected(null); setDraft({ title: "", description: "", startAt, endAt, timeZone: zone, allDay: false, recurrence: { frequency: "once", interval: 1, weekdays: [], until: null, count: null }, exceptions: {}, reminders: [10], status: "planned", category: "plan", location: "" });
  };
  const close = () => { setDraft(null); setSelected(null); };
  const onSave = async (data: EventData, scope: SeriesScope) => {
    if (readOnly) return;
    if (!selected) { await store.save("event", data); close(); return; }
    const { record, occurrence } = selected;
    if (record.data.recurrence.frequency === "once" || scope === "all") {
      const updated = record.data.recurrence.frequency === "once" ? data : updateEntireEventSeries(record.data, occurrence, data);
      await store.save("event", updated, record);
    } else if (scope === "one") await store.save("event", { ...record.data, exceptions: { ...record.data.exceptions, [localDateKey(occurrence.originalStartAt, record.data.timeZone)]: { cancelled: false, title: data.title, startAt: data.startAt, endAt: data.endAt, status: data.status } } }, record);
    else {
      const split = splitEventSeries(record.data, occurrence.originalStartAt, data);
      await store.saveMutations([createMutation("event", split.previous, { id: record.id, baseVersion: record.version }), createMutation("event", split.following)]);
    }
    close();
  };
  const onDelete = async (scope: SeriesScope) => {
    if (!selected || readOnly) return;
    const { record, occurrence } = selected;
    if (record.data.recurrence.frequency === "once" || scope === "all") { if (record.version === 0) await store.save("event", { ...record.data, status: "cancelled" }, record); else await store.remove(record); }
    else if (scope === "one") await store.save("event", { ...record.data, exceptions: { ...record.data.exceptions, [localDateKey(occurrence.originalStartAt, record.data.timeZone)]: { cancelled: true } } }, record);
    else await store.save("event", { ...record.data, recurrence: { ...record.data.recurrence, count: null, until: occurrence.originalStartAt - 1 } }, record);
    close();
  };
  const choose = (entry: CalendarDisplayEntry) => {
    const task = tasks.find(item => "task:" + item.id === entry.key);
    if (task) { const run = recordsOfKind(store.records, "run").find(item => item.id === task.runId); const labels: Record<string, string> = { planned: "待执行", queued: "等待电脑", running: "正在执行", waiting_permission: "等待电脑端授权", waiting_input: "等待电脑端回复", succeeded: "已完成", failed: "未完成", cancelled: "已取消", missed: "已错过", uncertain: "执行状态待确认" }; setTaskDetail({ title: task.title, status: labels[task.status] ?? task.status, summary: run?.data.summary || run?.data.error || "仅在所选电脑的泽诺窗口打开时执行，错过后不会自动补跑。" }); return; }
    const match = occurrences.find(item => `${item.record.id}:${item.occurrence.originalStartAt}` === entry.key);
    if (!match) return;
    setSelected(match); setDraft({ ...match.record.data, title: match.occurrence.title, status: match.occurrence.data.status, startAt: match.occurrence.startAt, endAt: match.occurrence.endAt });
  };
  const move = (entry: CalendarDisplayEntry, startAt: number, endAt: number) => {
    if (readOnly) return;
    const match = occurrences.find(item => `${item.record.id}:${item.occurrence.originalStartAt}` === entry.key);
    if (!match) return;
    const data = rescheduleCalendarEvent({ ...match.record.data, title: match.occurrence.title, status: match.occurrence.data.status }, startAt, endAt);
    if (match.record.data.recurrence.frequency !== "once") { setSelected(match); setDraft(data); }
    else void action.run(() => store.save("event", data, match.record));
  };
  const heading = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, year: "numeric", month: "long", ...(view === "day" ? { day: "numeric" } : {}) }).format(new Date(range.start + (view === "month" ? 7 * 86400000 : 0)));
  return <div className="flex min-h-0 flex-1 flex-col" data-zeno-calendar>
    <PageHeading title="日历"><Button variant="ghost" size="icon-sm" aria-label="导入日历" disabled={readOnly} onClick={() => inputRef.current?.click()}><Upload strokeWidth={1.5} /></Button><Button variant="ghost" size="icon-sm" aria-label="导出日历" onClick={() => downloadText("泽诺日历.ics", exportIcs(events.map(record => ({ id: record.id, data: record.data }))), "text/calendar")}><Download strokeWidth={1.5} /></Button><Button disabled={!store.ready || readOnly} onClick={() => createAt(Math.ceil(Date.now() / 1800000) * 1800000, Math.ceil(Date.now() / 1800000) * 1800000 + 3600000)}><Plus strokeWidth={1.5} />新增</Button></PageHeading>
    <input ref={inputRef} type="file" accept=".ics,text/calendar" className="sr-only" aria-label="选择日历文件" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void action.run(async () => setImported(parseIcs(await file.text(), zone))); }} />
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6"><Button variant="outline" size="sm" onClick={() => setAnchor(localDateOf(Date.now(), zone))}>今天</Button><Button variant="ghost" size="icon-sm" aria-label="上一个日期范围" onClick={() => setAnchor(current => shiftAnchor(view === "agenda" ? "week" : view, current, -1))}><ChevronLeft strokeWidth={1.5} /></Button><Button variant="ghost" size="icon-sm" aria-label="下一个日期范围" onClick={() => setAnchor(current => shiftAnchor(view === "agenda" ? "week" : view, current, 1))}><ChevronRight strokeWidth={1.5} /></Button><span className="min-w-0 flex-1 text-sm font-medium">{heading}</span><ToggleGroup aria-label="日历视图" value={[view]} onValueChange={values => { const next = values[0]; if (next === "day" || next === "week" || next === "month" || next === "agenda") setView(next); }} variant="segmented" size="sm">{[{ value: "day", label: "日" }, { value: "week", label: "周" }, { value: "month", label: "月" }, { value: "agenda", label: "议程" }].map(item => <ToggleGroupItem key={item.value} value={item.value}>{item.label}</ToggleGroupItem>)}</ToggleGroup></div>
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-1.5 sm:px-6">{([{ key: "plan", label: "日程" }, { key: "todo", label: "待办" }, { key: "training", label: "训练" }, { key: "ai", label: "AI 任务" }] satisfies { key: keyof typeof filters; label: string }[]).map(item => <Button key={item.key} variant="ghost" size="xs" aria-pressed={filters[item.key]} className={filters[item.key] ? "bg-muted" : "text-muted-foreground"} onClick={() => setFilters(current => ({ ...current, [item.key]: !current[item.key] }))}>{item.label}</Button>)}</div>
    <InlineError message={action.error} />
    <CalendarBoard view={view} anchor={anchor} entries={entries} timeZone={zone} weekStartsOn={settings?.weekStartsOn ?? 1} readOnly={readOnly} onMove={move} onSelect={choose} onCreate={(start, end) => { if (!readOnly) createAt(start, end); }} onDay={day => { setAnchor(day); setView("day"); }} />
    <PersonalDialog title={selected ? "日程" : "新日程"} open={draft !== null} onClose={close}>{draft ? <>{selected?.record.data.linkedId && selected.record.data.category === "training" && onOpenTraining ? <Button variant="outline" onClick={() => onOpenTraining(selected.record.data.linkedId ?? "")}>打开训练</Button> : null}{readOnly ? <div className="grid gap-3"><h2 className="font-medium">{draft.title}</h2><p className="text-sm text-muted-foreground">{new Date(draft.startAt).toLocaleString("zh-CN", { timeZone: draft.timeZone })} — {new Date(draft.endAt).toLocaleString("zh-CN", { timeZone: draft.timeZone })}</p><p className="whitespace-pre-wrap text-sm">{draft.description}</p></div> : <EventEditor key={selected?.record.id ?? "new"} initial={draft} recurring={!!selected && selected.record.data.recurrence.frequency !== "once"} onSave={onSave} onDelete={selected ? onDelete : undefined} onCancel={close} />}</> : null}</PersonalDialog>
    <PersonalDialog title={taskDetail?.title ?? "任务"} open={!!taskDetail} onClose={() => setTaskDetail(null)}>{taskDetail ? <><p className="text-xs text-muted-foreground">{taskDetail.status}</p><p className="whitespace-pre-wrap text-sm">{taskDetail.summary}</p></> : null}</PersonalDialog>
    <PersonalDialog title="导入日历" open={imported !== null} onClose={() => setImported(null)}>{imported ? <><p className="text-sm">{imported.length} 项日程</p><ul className="max-h-56 divide-y divide-border overflow-y-auto text-sm">{imported.slice(0, 20).map(item => <li key={item.id} className="py-2">{item.data.title}</li>)}</ul><InlineError message={action.error} /><Button disabled={readOnly || action.busy} onClick={() => void action.run(async () => { for (let offset = 0; offset < imported.length; offset += 100) await store.saveMutations(imported.slice(offset, offset + 100).map(item => createMutation("event", item.data, { id: item.id }))); setImported(null); })}>导入 {imported.length} 项</Button></> : null}</PersonalDialog>
  </div>;
}
