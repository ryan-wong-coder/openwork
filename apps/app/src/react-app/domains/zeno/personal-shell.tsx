import type { ReactNode } from "react";
import { CalendarDays, CheckCheck, Dumbbell, RefreshCw, UserRound, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ZenoMark } from "@/components/brand/zeno-brand";
import { cn } from "@/lib/utils";

export type ZenoSection = "calendar" | "fitness" | "tasks" | "account";
const destinations = [
  { id: "calendar", label: "日历", icon: CalendarDays },
  { id: "fitness", label: "健身", icon: Dumbbell },
  { id: "tasks", label: "任务", icon: CheckCheck },
  { id: "account", label: "账号", icon: UserRound },
] satisfies { id: ZenoSection; label: string; icon: typeof CalendarDays }[];

export function PersonalShell({ section, onSection, embedded = false, offline, syncing, pending = 0, children }: {
  section: ZenoSection; onSection: (section: ZenoSection) => void; embedded?: boolean;
  offline: boolean; syncing: boolean; pending?: number; children: ReactNode;
}) {
  return <div className={cn("flex min-h-0 min-w-0 bg-background text-foreground", embedded ? "h-full" : "min-h-[100svh]")} data-zeno-personal>
    {!embedded ? <aside className="hidden w-48 shrink-0 flex-col border-r border-border bg-muted/15 p-3 md:flex">
      <div className="flex h-14 items-center gap-2.5 px-3"><ZenoMark className="size-6" /><span className="font-semibold tracking-tight">泽诺</span></div>
      <nav aria-label="个人空间" className="mt-5 grid gap-1">{destinations.map(item => <Button key={item.id} variant="ghost" aria-current={section === item.id ? "page" : undefined} onClick={() => onSection(item.id)} className={cn("h-11 justify-start gap-3 px-3", section === item.id && "bg-muted font-semibold")}><item.icon className="size-4" strokeWidth={1.5} />{item.label}</Button>)}</nav>
    </aside> : null}
    <div className="flex min-h-0 min-w-0 flex-1 flex-col max-md:pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {offline || pending > 0 ? <div className="flex min-h-8 shrink-0 items-center justify-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground" role="status">{offline ? <WifiOff className="size-3.5" strokeWidth={1.5} /> : <RefreshCw className={cn("size-3.5", syncing && "animate-spin motion-reduce:animate-none")} strokeWidth={1.5} />}{offline ? "离线，修改已保存在此设备" : pending > 0 ? `${pending} 项修改待同步` : "正在同步"}</div> : null}
      {children}
    </div>
    {!embedded ? <nav aria-label="个人空间" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden">{destinations.map(item => <Button key={item.id} variant="ghost" aria-current={section === item.id ? "page" : undefined} onClick={() => onSection(item.id)} className={cn("h-16 flex-col gap-1 rounded-none text-[11px] text-muted-foreground", section === item.id && "text-foreground")}><item.icon className="size-5" strokeWidth={section === item.id ? 2 : 1.5} />{item.label}</Button>)}</nav> : null}
  </div>;
}
