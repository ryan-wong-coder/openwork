import { useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn("grid min-w-0 gap-1.5 text-xs font-medium", className)}><span className="text-muted-foreground">{label}</span>{children}</label>;
}

export function OptionSelect({ value, onChange, options, label, disabled }: { value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[]; label: string; disabled?: boolean }) {
  return <Select value={value} disabled={disabled} onValueChange={next => { if (typeof next === "string") onChange(next); }}>
    <SelectTrigger aria-label={label} className="w-full rounded-lg"><SelectValue>{options.find(option => option.value === value)?.label ?? label}</SelectValue></SelectTrigger>
    <SelectContent alignItemWithTrigger={false}>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

export function PageHeading({ title, children, back }: { title: string; children?: ReactNode; back?: () => void }) {
  return <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
    {back ? <Button variant="ghost" size="icon-sm" aria-label="返回" onClick={back}><ArrowLeft strokeWidth={1.5} /></Button> : null}
    <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>{children}
  </header>;
}

export function PersonalDialog({ title, open, onClose, children, wide = false }: { title: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <DialogContent className={cn("max-h-[90dvh] overflow-y-auto", wide && "lg:max-w-2xl")}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>{children}
    </DialogContent>
  </Dialog>;
}

export function InlineError({ message }: { message: string | null | undefined }) {
  return message ? <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />{message}</p> : null;
}

export function QuietEmpty({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <div className="flex min-h-56 flex-col items-center justify-center gap-4 px-6 py-12 text-center"><p className="text-sm text-muted-foreground">{title}</p>{action && onAction ? <Button variant="outline" onClick={onAction}><Plus strokeWidth={1.5} />{action}</Button> : null}</div>;
}

export function SaveButton({ busy, disabled, children = "保存" }: { busy: boolean; disabled?: boolean; children?: ReactNode }) {
  return <Button type="submit" disabled={busy || disabled}>{busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={1.5} aria-label="正在保存" /> : null}{children}</Button>;
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (caught) { setError(readableError(caught)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return { busy, error, setError, run };
}

export function readableError(caught: unknown) {
  if (caught instanceof Error && caught.name === "ZodError") return "输入内容不完整或格式不正确，请检查后重试。";
  if (caught instanceof Error && /invalid.*(?:password|credentials)|INVALID_EMAIL_OR_PASSWORD/i.test(caught.message)) return "邮箱或密码不正确。";
  if (caught instanceof Error && /[\u3400-\u9fff]/.test(caught.message)) return caught.message;
  return "操作未完成，请检查连接后重试。";
}

export function downloadText(filename: string, text: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function localDateInput(value: number | string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localDateTimeInput(value: number | string | Date) {
  const date = new Date(value);
  return `${localDateInput(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function shortDate(value: number | string, timeZone?: string) { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", weekday: "short", timeZone }).format(new Date(value)); }
export function shortTime(value: number | string, timeZone?: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(value)); }
