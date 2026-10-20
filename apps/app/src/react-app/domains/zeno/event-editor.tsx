import { useState } from "react";
import { addDays, dateKey, parseDateKey } from "@openwork/calendar";
import { dateTimeInZone, eventDataSchema, localDateKey, timeInZone, type EventData, type WorkspaceChoice } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, InlineError, OptionSelect, SaveButton, useAction } from "./ui";

export type SeriesScope = "one" | "following" | "all";
export function EventEditor({ initial, recurring = false, onSave, onDelete, onCancel, workspaces = [] }: { initial: EventData; recurring?: boolean; onSave: (data: EventData, scope: SeriesScope) => Promise<void>; onDelete?: (scope: SeriesScope) => Promise<void>; onCancel: () => void; workspaces?: readonly WorkspaceChoice[] }) {
  const [workspaceId, setWorkspaceId] = useState(initial.workspaceId ?? "__personal__");
  const workspaceOptions = [{ value: "__personal__", label: "个人全局" }, ...workspaces.map(workspace => ({ value: workspace.id, label: workspace.name })), ...(initial.workspaceId && !workspaces.some(workspace => workspace.id === initial.workspaceId) ? [{ value: initial.workspaceId, label: "已关联工作区（暂不可用）" }] : [])];
  const [status, setStatus] = useState(initial.status); const [category, setCategory] = useState(initial.category);
  const [title, setTitle] = useState(initial.title); const [description, setDescription] = useState(initial.description);
  const [zone, setZone] = useState(initial.timeZone); const [allDay, setAllDay] = useState(initial.allDay);
  const [start, setStart] = useState(`${localDateKey(initial.startAt, zone)}T${timeInZone(initial.startAt, zone)}`);
  const [end, setEnd] = useState(`${localDateKey(initial.allDay ? initial.endAt - 1 : initial.endAt, zone)}T${timeInZone(initial.endAt, zone)}`);
  const [frequency, setFrequency] = useState<EventData["recurrence"]["frequency"]>(initial.recurrence.frequency);
  const [interval, setInterval] = useState(initial.recurrence.interval); const [weekdays, setWeekdays] = useState(initial.recurrence.weekdays);
  const [until, setUntil] = useState(initial.recurrence.until === null ? "" : localDateKey(initial.recurrence.until, zone));
  const [count, setCount] = useState(initial.recurrence.count?.toString() ?? "");
  const [reminder, setReminder] = useState(initial.reminders[0]?.toString() ?? "none"); const [location, setLocation] = useState(initial.location);
  const [scope, setScope] = useState<SeriesScope>(recurring ? "one" : "all"); const action = useAction();
  const thisOnly = recurring && scope === "one";
  const submit = () => action.run(async () => {
    const startDate = start.slice(0, 10), lastDay = parseDateKey(end.slice(0, 10));
    if (!lastDay) throw new Error("请选择结束时间。");
    const finishDate = allDay ? dateKey(addDays(lastDay, 1)) : end.slice(0, 10);
    const data = eventDataSchema.parse({ ...initial, title, description, location, status, category, workspaceId: workspaceId === "__personal__" ? undefined : workspaceId, timeZone: zone, allDay,
      startAt: dateTimeInZone(startDate, allDay ? "00:00" : start.slice(11, 16), zone), endAt: dateTimeInZone(finishDate, allDay ? "00:00" : end.slice(11, 16), zone),
      ...(allDay ? { startDate, endDate: finishDate } : { startDate: undefined, endDate: undefined }),
      recurrence: { frequency, interval, weekdays, until: until ? dateTimeInZone(until, "23:59", zone) : null, count: count ? Number(count) : null }, reminders: reminder === "none" ? [] : [Number(reminder)],
    });
    if (data.endAt <= data.startAt) throw new Error("结束时间需要晚于开始时间。");
    await onSave(data, scope);
  });
  return <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {recurring ? <Field label="修改范围"><OptionSelect label="修改范围" value={scope} onChange={value => { if (value === "one" || value === "following" || value === "all") setScope(value); }} options={[{ value: "one", label: "仅此日程" }, { value: "following", label: "此日程及之后" }, { value: "all", label: "整个系列" }]} /></Field> : null}
    <Field label="日程"><Input autoFocus value={title} onChange={event => setTitle(event.currentTarget.value)} placeholder="给这段时间一个名字" maxLength={240} required /></Field>
    <div className="grid grid-cols-2 gap-3">{initial.category === "plan" || initial.category === "todo" ? <Field label="类型"><OptionSelect label="日程类型" value={category} disabled={thisOnly} options={[{ value: "plan", label: "日程" }, { value: "todo", label: "待办" }]} onChange={value => { if (value === "plan" || value === "todo") setCategory(value); }} /></Field> : null}<Field label="状态"><OptionSelect label="日程状态" value={status} options={[{ value: "planned", label: "待完成" }, { value: "completed", label: "已完成" }, ...(initial.status === "cancelled" ? [{ value: "cancelled", label: "已取消" }] : [])]} onChange={value => { if (value === "planned" || value === "completed" || value === "cancelled") setStatus(value); }} /></Field></div>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={allDay} onCheckedChange={value => setAllDay(value === true)} />全天</label>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="开始"><Input type={allDay ? "date" : "datetime-local"} required value={allDay ? start.slice(0, 10) : start} onChange={event => setStart(allDay ? event.currentTarget.value + "T00:00" : event.currentTarget.value)} /></Field><Field label="结束"><Input type={allDay ? "date" : "datetime-local"} required value={allDay ? end.slice(0, 10) : end} onChange={event => setEnd(allDay ? event.currentTarget.value + "T00:00" : event.currentTarget.value)} /></Field></div>
    {!thisOnly ? <>
      <Field label="重复"><OptionSelect label="重复" value={frequency} onChange={value => { if (value === "once" || value === "daily" || value === "weekly" || value === "monthly" || value === "yearly") setFrequency(value); }} options={[{ value: "once", label: "不重复" }, { value: "daily", label: "每天" }, { value: "weekly", label: "每周" }, { value: "monthly", label: "每月" }, { value: "yearly", label: "每年" }]} /></Field>
      {frequency !== "once" ? <div className="grid gap-3"><Field label="间隔"><Input type="number" min={1} max={365} value={interval} onChange={event => setInterval(Number(event.currentTarget.value))} /></Field>{frequency === "weekly" ? <div className="flex flex-wrap gap-2" role="group" aria-label="重复星期">{["日", "一", "二", "三", "四", "五", "六"].map((day, index) => <Button key={day} type="button" variant={weekdays.includes(index) ? "default" : "outline"} size="icon-sm" aria-pressed={weekdays.includes(index)} onClick={() => setWeekdays(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index])}>{day}</Button>)}</div> : null}<div className="grid grid-cols-2 gap-3"><Field label="截止日期（可选）"><Input type="date" value={until} onChange={event => { setUntil(event.currentTarget.value); setCount(""); }} /></Field><Field label="重复次数（可选）"><Input type="number" min={1} max={10000} value={count} onChange={event => { setCount(event.currentTarget.value); setUntil(""); }} /></Field></div></div> : null}
      <details className="group border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">更多选项</summary><div className="mt-4 grid gap-4"><Field label="地点"><Input value={location} onChange={event => setLocation(event.currentTarget.value)} /></Field><Field label="提醒"><OptionSelect label="提醒" value={reminder} onChange={setReminder} options={[{ value: "none", label: "不提醒" }, { value: "0", label: "开始时" }, { value: "5", label: "提前 5 分钟" }, { value: "10", label: "提前 10 分钟" }, { value: "30", label: "提前 30 分钟" }, { value: "1440", label: "提前一天" }]} /></Field><Field label="时区"><Input value={zone} onChange={event => setZone(event.currentTarget.value)} /></Field><Field label="备注"><Textarea value={description} onChange={event => setDescription(event.currentTarget.value)} rows={3} /></Field></div></details>
    </> : null}
    <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">工作区</summary><div className="mt-3"><Field label="关联工作区"><OptionSelect label="关联工作区" value={workspaceId} disabled={thisOnly} options={workspaceOptions} onChange={setWorkspaceId} /></Field></div></details>
    <InlineError message={action.error} />
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">{onDelete ? <Button type="button" variant="destructive" disabled={action.busy} onClick={() => void action.run(() => onDelete(scope))}>删除</Button> : null}<div className="flex-1" /><Button type="button" variant="outline" onClick={onCancel}>取消</Button><SaveButton busy={action.busy} /></div>
  </form>;
}
