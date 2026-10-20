import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import type { PersonalStore } from "./use-zeno-sync";

export function PrivatePhoto({ id, store }: { id: string; store: PersonalStore }) {
  const [url, setUrl] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let stopped = false; let objectUrl: string | null = null; setUrl(null); setFailed(false); void store.readMedia(id).then(blob => { if (!stopped) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } }).catch(() => { if (!stopped) setFailed(true); }); return () => { stopped = true; if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [id]);
  return url ? <img src={url} alt="身体记录照片" className="aspect-[3/4] w-full rounded-lg object-cover" loading="lazy" /> : <div className="flex aspect-[3/4] items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">{failed ? "照片暂时不可用" : <Camera className="size-5" strokeWidth={1.5} />}</div>;
}
