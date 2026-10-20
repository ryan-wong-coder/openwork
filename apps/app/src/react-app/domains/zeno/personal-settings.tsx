import { useState } from "react";
import { recordsOfKind, settingsDataSchema, type PersonalRecord, type SettingsData, type ZenoDesktopBridge } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineError, OptionSelect, useAction } from "./ui";
import type { PersonalStore } from "./use-zeno-sync";

export function personalSettings(records: readonly PersonalRecord[]): SettingsData {
  const current = recordsOfKind([...records], "settings").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return settingsDataSchema.parse(current?.data ?? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
}

const cities: Record<string, string> = { "Asia/Shanghai": "上海", "Asia/Hong_Kong": "香港", "Asia/Taipei": "台北", "Asia/Tokyo": "东京", "Asia/Singapore": "新加坡", "Asia/Seoul": "首尔", "Europe/London": "伦敦", "Europe/Paris": "巴黎", "Europe/Berlin": "柏林", "America/New_York": "纽约", "America/Los_Angeles": "洛杉矶", "America/Chicago": "芝加哥", "Australia/Sydney": "悉尼", "Pacific/Auckland": "奥克兰", "UTC": "协调世界时" };
function zoneLabel(timeZone: string) {
  const name = new Intl.DateTimeFormat("zh-CN", { timeZone, timeZoneName: "long" }).formatToParts().find(part => part.type === "timeZoneName")?.value ?? timeZone;
  return cities[timeZone] ? `${cities[timeZone]} · ${name}` : `${name} · ${timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone}`;
}

export function PersonalSettings({ store, desktopBridge, readOnly = false }: { store: PersonalStore; desktopBridge?: ZenoDesktopBridge; readOnly?: boolean }) {
  const current = recordsOfKind(store.records, "settings").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const settings = personalSettings(store.records), action = useAction();
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const zones = [...new Set([settings.timeZone, "UTC", ...Object.keys(cities), ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])];
  const save = (change: Partial<SettingsData>) => action.run(() => store.save("settings", settingsDataSchema.parse({ ...settings, ...change }), current));
  const disabled = !store.writable || readOnly || action.busy;
  return <section className="border-t border-border py-6" data-zeno-preferences><h2 className="mb-3 text-sm font-medium">偏好</h2>
    <div className="divide-y divide-border">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-2 text-sm"><span>时区</span><div className="w-full sm:w-72"><OptionSelect label="日历时区" value={settings.timeZone} options={zones.map(value => ({ value, label: zoneLabel(value) }))} disabled={disabled} onChange={timeZone => void save({ timeZone })} /></div></div>
      <div className="flex min-h-12 items-center justify-between gap-3 py-2 text-sm"><span>重量单位</span><div className="w-36"><OptionSelect label="默认重量单位" value={settings.unit} options={[{ value: "kg", label: "公斤 kg" }, { value: "lb", label: "磅 lb" }]} disabled={disabled} onChange={unit => { if (unit === "kg" || unit === "lb") void save({ unit }); }} /></div></div>
      <div className="flex min-h-12 items-center justify-between gap-3 text-sm"><span>每周开始</span><span className="text-muted-foreground">周一</span></div>
      <label className="flex min-h-12 items-center justify-between gap-3 text-sm"><span>日程提醒</span><Checkbox aria-label="启用日程提醒" checked={settings.notifications} disabled={disabled} onCheckedChange={enabled => void save({ notifications: enabled === true })} /></label>
    </div>
    {!desktopBridge && settings.notifications ? <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{permission === "granted" ? "页面打开时可接收通知" : permission === "denied" ? "通知已关闭，可在浏览器设置中开启" : permission === "unsupported" ? "此浏览器支持站内提醒" : "浏览器通知未开启"}</span>{permission === "default" ? <Button variant="outline" size="xs" onClick={() => void action.run(async () => setPermission(await Notification.requestPermission()))}>开启通知</Button> : null}</div> : null}
    <InlineError message={action.error} />
  </section>;
}
