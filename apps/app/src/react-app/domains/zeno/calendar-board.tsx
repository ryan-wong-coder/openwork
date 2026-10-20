import { useEffect, useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import { calendarRange, dateKey, layoutOverlappingBlocks, localDateOf, minutesIntoDay, startOfDay, addDays, type CalendarView, type LocalDate } from "@openwork/calendar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { dateTimeInZone, timeInZone } from "@zeno/core";
import { cn } from "@/lib/utils";
import { shortTime } from "./ui";

/** A display projection only. Persistent entities remain @zeno/core records. */
export type CalendarDisplayEntry = { key: string; title: string; start: number; end: number; allDay: boolean; source: "event" | "training" | "task" | "todo"; done?: boolean };
const dayLabel = (at: number, timeZone: string) => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long", timeZone }).format(at);
const weekdayLabel = (at: number, timeZone: string) => new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone }).format(at);
function dayStart(date: LocalDate, zone: string) { return startOfDay(date, zone); }
function entriesOn(entries: readonly CalendarDisplayEntry[], day: LocalDate, zone: string) {
  const start = dayStart(day, zone), end = dayStart(addDays(day, 1), zone);
  return entries.filter(entry => entry.start < end && entry.end > start).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
}

function EventButton({ entry, onSelect, compact = false, fill = false, draggable = false, timeZone }: { entry: CalendarDisplayEntry; onSelect: (entry: CalendarDisplayEntry) => void; compact?: boolean; fill?: boolean; draggable?: boolean; timeZone?: string }) {
  return <button type="button" draggable={draggable} onDragStart={event => { event.dataTransfer.setData("application/x-zeno-event", entry.key); event.dataTransfer.effectAllowed = "move"; }} onClick={() => onSelect(entry)} className={cn("min-w-0 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-ring", fill ? "h-full w-full border-l-2 border-primary/70 bg-primary/8" : "w-full", entry.done && "opacity-55")} title={entry.title}>
    <span className={cn("block truncate font-medium", entry.done && "line-through")}>{entry.title}</span>{!compact && !entry.allDay ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{shortTime(entry.start, timeZone)} – {shortTime(entry.end, timeZone)}</span> : null}
  </button>;
}

export function CalendarBoard({ view, anchor, entries, onSelect, onCreate, onDay, onMove, readOnly = false, timeZone, weekStartsOn = 1 }: { view: CalendarView | "agenda"; anchor: LocalDate; entries: readonly CalendarDisplayEntry[]; onSelect: (entry: CalendarDisplayEntry) => void; onCreate: (start: number, end: number) => void; onDay: (day: LocalDate) => void; onMove?: (entry: CalendarDisplayEntry, start: number, end: number) => void; readOnly?: boolean; timeZone?: string; weekStartsOn?: number }) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resizing = useRef<{ key: string; y: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * 48; }, [view, zone]);
  const create = (day: LocalDate, time: string) => { try { const start = dateTimeInZone(dateKey(day), time, zone); onCreate(start, start + 3600000); } catch { toast.error("这个时刻在所选时区不存在，请选择其他时间。"); } };
  const move = (key: string, day: LocalDate, time?: string) => { const entry = entries.find(item => item.key === key); if (!entry || readOnly || !onMove || entry.source === "task") return; try { const start = dateTimeInZone(dateKey(day), time ?? timeInZone(entry.start, zone), zone); onMove(entry, start, start + entry.end - entry.start); } catch { toast.error("这个时刻在所选时区不存在，请选择其他时间。"); } };
  const range = useMemo(() => calendarRange(view === "agenda" ? "week" : view, anchor, zone, weekStartsOn), [view, anchor.year, anchor.month, anchor.day, zone, weekStartsOn]);
  const today = dateKey(localDateOf(Date.now(), zone));
  const agenda = <div className="divide-y divide-border px-4 sm:px-6" data-zeno-agenda>{range.days.map(day => {
    const list = entriesOn(entries, day, zone), start = dayStart(day, zone);
    return <section key={dateKey(day)} className="py-4"><div className="mb-2 flex items-center justify-between"><h2 className={cn("text-xs font-medium", dateKey(day) === today ? "text-primary" : "text-muted-foreground")}>{dayLabel(start, zone)}</h2>{!readOnly ? <Button variant="ghost" size="icon-xs" aria-label={`${day.month}月${day.day}日新增日程`} onClick={() => create(day, "09:00")}><Plus strokeWidth={1.5} /></Button> : null}</div>{list.length ? list.map(entry => <button key={entry.key} type="button" onClick={() => onSelect(entry)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-1 text-left text-sm hover:bg-muted/50"><span className="w-14 shrink-0 text-xs text-muted-foreground">{entry.allDay ? "全天" : shortTime(entry.start, zone)}</span><span className={cn("min-w-0 flex-1 truncate", entry.done && "text-muted-foreground line-through")}>{entry.title}</span><span className="text-xs text-muted-foreground">{entry.source === "training" ? "训练" : entry.source === "task" ? "任务" : entry.source === "todo" ? "待办" : ""}</span></button>) : <p className="py-3 text-xs text-muted-foreground">暂无安排</p>}</section>;
  })}</div>;
  if (view === "agenda") return agenda;
  if (view === "month") return <div className="min-h-0 overflow-y-auto" data-zeno-month><div className="grid grid-cols-7 border-b border-border">{range.days.slice(0, 7).map(day => <span key={dateKey(day)} className="px-2 py-3 text-center text-xs text-muted-foreground">{weekdayLabel(dayStart(day, zone), zone)}</span>)}</div><div className="grid grid-cols-7">{range.days.map(day => {
    const list = entriesOn(entries, day, zone), key = dateKey(day);
    return <div key={key} onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes("application/x-zeno-event")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); move(event.dataTransfer.getData("application/x-zeno-event"), day); }} className={cn("min-h-24 min-w-0 border-b border-r border-border p-1 sm:min-h-32", day.month !== anchor.month && "bg-muted/20")}><Button variant="ghost" size="icon-xs" className={cn("mb-1 rounded-full text-xs", key === today && "bg-primary text-primary-foreground")} onClick={() => onDay(day)} aria-label={`${day.month}月${day.day}日`}>{day.day}</Button>{list.slice(0, 3).map(entry => <EventButton timeZone={zone} key={entry.key} entry={entry} onSelect={onSelect} compact draggable={!readOnly && !!onMove && entry.source !== "task"} />)}{list.length > 3 ? <Button variant="link" size="xs" className="px-1 text-muted-foreground" onClick={() => onDay(day)}>另 {list.length - 3} 项</Button> : null}</div>;
  })}</div></div>;
  const columns = `3rem repeat(${range.days.length},minmax(0,1fr))`;
  return <><div className="md:hidden">{agenda}</div><div className="hidden min-h-0 flex-1 flex-col md:flex" data-zeno-time-grid>
    <div className="grid shrink-0 border-b border-border" style={{ gridTemplateColumns: columns }}><div />{range.days.map(day => <button key={dateKey(day)} type="button" onClick={() => onDay(day)} className="flex items-center justify-center gap-2 border-l border-border py-3 text-xs"><span className="text-muted-foreground">{weekdayLabel(dayStart(day, zone), zone)}</span><span className={cn("flex size-6 items-center justify-center rounded-full", dateKey(day) === today && "bg-primary text-primary-foreground")}>{day.day}</span></button>)}</div>
    {entries.some(entry => entry.allDay) ? <div className="grid shrink-0 border-b border-border" style={{ gridTemplateColumns: columns }}><span className="px-1 py-2 text-[11px] text-muted-foreground">全天</span>{range.days.map(day => <div key={dateKey(day)} className="border-l border-border p-1">{entriesOn(entries, day, zone).filter(entry => entry.allDay).map(entry => <EventButton timeZone={zone} key={entry.key} entry={entry} onSelect={onSelect} compact />)}</div>)}</div> : null}
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto"><div className="grid" style={{ gridTemplateColumns: columns }}><div className="relative h-[72rem]">{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="absolute right-2 text-[11px] text-muted-foreground" style={{ top: hour * 48 + 4 }}>{String(hour).padStart(2, "0")}:00</span>)}</div>{range.days.map(day => {
      const start = dayStart(day, zone), end = dayStart(addDays(day, 1), zone);
      const blocks = entriesOn(entries, day, zone).filter(entry => !entry.allDay);
      const places = layoutOverlappingBlocks(blocks.map(entry => ({ key: entry.key, start: Math.max(entry.start, start), end: Math.min(entry.end, end) })));
      return <div key={dateKey(day)} className="relative h-[72rem] border-l border-border">{Array.from({ length: 48 }, (_, slot) => <button key={slot} type="button" disabled={readOnly} tabIndex={-1} aria-label={`${day.month}月${day.day}日 ${Math.floor(slot / 2)}:${slot % 2 ? "30" : "00"}新增日程`} onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes("application/x-zeno-event")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); move(event.dataTransfer.getData("application/x-zeno-event"), day, `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`); }} onClick={() => create(day, `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`)} className={cn("absolute inset-x-0 h-6", !readOnly && "hover:bg-muted/40", slot % 2 === 0 && "border-t border-border/70")} style={{ top: slot * 24 }} />)}{blocks.map(entry => {
        const place = places.get(entry.key) ?? { column: 0, columns: 1 };
        const from = Math.max(0, minutesIntoDay(Math.max(start, entry.start), day, zone));
        const to = Math.min(1440, entry.end >= end ? 1440 : minutesIntoDay(entry.end, day, zone));
        return <div key={entry.key} className="absolute px-0.5" style={{ top: from / 60 * 48 + 1, height: Math.max(22, (to - from) / 60 * 48 - 2), left: `${place.column / place.columns * 100}%`, width: `${100 / place.columns}%` }}><EventButton timeZone={zone} entry={entry} onSelect={onSelect} compact={to - from < 45} fill draggable={!readOnly && !!onMove && entry.source !== "task"} />{!readOnly && onMove && entry.source !== "task" ? <button type="button" aria-label={`调整${entry.title}结束时间`} className="absolute inset-x-1 bottom-0 h-2 cursor-ns-resize rounded-b bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={event => { event.preventDefault(); resizing.current = { key: entry.key, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={event => { const resize = resizing.current; resizing.current = null; if (resize?.key !== entry.key) return; const delta = Math.round((event.clientY - resize.y) / 12) * 15 * 60000; if (delta) onMove(entry, entry.start, Math.max(entry.start + 15 * 60000, entry.end + delta)); }} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); onMove(entry, entry.start, Math.max(entry.start + 15 * 60000, entry.end + (event.key === "ArrowDown" ? 1 : -1) * 15 * 60000)); } }} /> : null}</div>;
      })}</div>;
    })}</div></div>
  </div></>;
}
