import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { KindRecord } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { PrivatePhoto } from "./private-photo";
import { personalSettings } from "./personal-settings";
import { OptionSelect } from "./ui";
import type { PersonalStore } from "./use-zeno-sync";

export function PhotoComparison({ records, store }: { records: KindRecord<"measurement">[]; store: PersonalStore }) {
  const [leftId, setLeft] = useState(records.at(-1)?.id ?? ""), [rightId, setRight] = useState(records[0]?.id ?? "");
  const [leftPhoto, setLeftPhoto] = useState(0), [rightPhoto, setRightPhoto] = useState(0);
  const zone = personalSettings(store.records).timeZone;
  const format = (at: number) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }).format(at);
  const options = records.map(record => ({ value: record.id, label: format(record.data.at) }));
  const left = records.find(record => record.id === leftId) ?? records.at(-1), right = records.find(record => record.id === rightId) ?? records[0];
  return <div data-zeno-photo-comparison className="grid grid-cols-2 items-start gap-3 sm:gap-5">{[{ key: "left", record: left, photo: leftPhoto, setId: setLeft, setPhoto: setLeftPhoto }, { key: "right", record: right, photo: rightPhoto, setId: setRight, setPhoto: setRightPhoto }].map(pane => pane.record ? <section key={pane.key} className="grid min-w-0 gap-3"><OptionSelect label={pane.key === "left" ? "对比前日期" : "对比后日期"} value={pane.record.id} options={options} onChange={id => { pane.setId(id); pane.setPhoto(0); }} /><PrivatePhoto key={pane.record.data.photoMediaIds[pane.photo]} id={pane.record.data.photoMediaIds[Math.min(pane.photo, pane.record.data.photoMediaIds.length - 1)]} store={store} />{pane.record.data.photoMediaIds.length > 1 ? <div className="flex items-center justify-between"><Button variant="ghost" size="icon-sm" disabled={pane.photo <= 0} aria-label="上一张对比照片" onClick={() => pane.setPhoto(current => Math.max(0, current - 1))}><ChevronLeft strokeWidth={1.5} /></Button><span className="text-xs tabular-nums text-muted-foreground">{pane.photo + 1} / {pane.record.data.photoMediaIds.length}</span><Button variant="ghost" size="icon-sm" disabled={pane.photo >= pane.record.data.photoMediaIds.length - 1} aria-label="下一张对比照片" onClick={() => pane.setPhoto(current => current + 1)}><ChevronRight strokeWidth={1.5} /></Button></div> : null}<p className="text-xs text-muted-foreground">{pane.record.data.weightKg !== undefined ? `${pane.record.data.weightKg} kg` : ""}{pane.record.data.bodyFatPercent !== undefined ? ` · ${pane.record.data.bodyFatPercent}% 体脂` : ""}</p></section> : null)}</div>;
}
