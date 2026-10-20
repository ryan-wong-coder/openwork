import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineError, useAction } from "./ui";
import type { PersonalStore } from "./use-zeno-sync";

export function PrivateMedia({ id, store, compact = false }: { id: string; store: PersonalStore; compact?: boolean }) {
  const [media, setMedia] = useState<{ url: string; video: boolean } | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { let stopped = false, url: string | undefined; setFailed(false); setMedia(null); void store.readMedia(id).then(blob => { if (stopped) return; url = URL.createObjectURL(blob); setMedia({ url, video: blob.type.startsWith("video/") }); }).catch(() => { if (!stopped) setFailed(true); }); return () => { stopped = true; if (url) URL.revokeObjectURL(url); }; }, [id]);
  return media ? media.video ? <video src={media.url} controls playsInline preload="metadata" aria-label="自定义动作视频" className="aspect-video w-full rounded-lg bg-muted object-contain" /> : <img src={media.url} alt="自定义动作图片" loading="lazy" className={compact ? "aspect-square w-full rounded-lg object-cover" : "max-h-80 w-full rounded-lg object-contain"} /> : <div className="grid aspect-video place-content-center rounded-lg bg-muted/40 text-xs text-muted-foreground">{failed ? "媒体暂不可用，联网后重试" : "正在读取媒体"}</div>;
}

export function PersonalMediaEditor({ ids, onChange, store, max = 10 }: { ids: string[]; onChange: (ids: string[]) => void; store: PersonalStore; max?: number }) {
  const input = useRef<HTMLInputElement>(null), action = useAction();
  return <div className="grid gap-3"><div className="grid grid-cols-2 gap-3">{ids.map(id => <div key={id} className="min-w-0"><PrivateMedia id={id} store={store} compact /><Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => onChange(ids.filter(value => value !== id))}><Trash2 strokeWidth={1.5} />移除</Button></div>)}</div><input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" className="sr-only" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ""; void action.run(async () => { if (ids.length + files.length > max) throw new Error(`每个动作最多保存 ${max} 个媒体。`); const added: string[] = []; for (const file of files) added.push(await store.addMedia(file, file.name)); onChange([...ids, ...added]); }); }} /><Button type="button" variant="outline" disabled={action.busy || ids.length >= max} onClick={() => input.current?.click()}><ImagePlus strokeWidth={1.5} />添加图片或视频</Button><p className="text-[11px] text-muted-foreground">图片 / GIF 10 MB，MP4 / WebM 50 MB。</p><InlineError message={action.error} /></div>;
}
