import { toast } from "@/components/ui/sonner";
import { useEffect } from "react";
import { expandEvent, recordsOfKind, type PersonalRecord, type ZenoDesktopBridge } from "@zeno/core";

export function dueReminders(records: PersonalRecord[], now: number) {
  return recordsOfKind(records, "event").flatMap(record => expandEvent(record.data, now - 86400000, now + (Math.max(0, ...record.data.reminders) + 1) * 60000).filter(occurrence => occurrence.data.status === "planned").flatMap(occurrence => record.data.reminders.flatMap(minutes => {
    const at = occurrence.startAt - minutes * 60000;
    return at <= now && at > now - 30000 ? [{ id: `${record.id}:${occurrence.originalStartAt}:${minutes}`, title: occurrence.title, startAt: occurrence.startAt }] : [];
  })));
}

/** Notifications run only while this account's UI is open; old reminders are never replayed. */
export function usePersonalReminders(records: PersonalRecord[], enabled: boolean, scope: string, bridge?: ZenoDesktopBridge) {
  useEffect(() => {
    if (!enabled) return;
    const key = "zeno-reminders:" + scope; const sent = new Set<string>();
    try { const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); if (Array.isArray(saved)) for (const item of saved) if (typeof item === "string") sent.add(item); } catch { /* A missing notification ledger does not affect synced records. */ }
    const tick = () => {
      for (const reminder of dueReminders(records, Date.now())) {
        if (sent.has(reminder.id)) continue;
        sent.add(reminder.id); const body = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(reminder.startAt);
        toast(reminder.title, { description: body }); if (!bridge && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState === "hidden") new Notification(reminder.title, { body, tag: reminder.id });
      }
      try { localStorage.setItem(key, JSON.stringify([...sent].slice(-500))); } catch { /* Notification deduplication is best effort when browser storage is full. */ }
    };
    tick(); const timer = window.setInterval(tick, 15000); return () => window.clearInterval(timer);
  }, [records, enabled, scope, bridge]);
}
