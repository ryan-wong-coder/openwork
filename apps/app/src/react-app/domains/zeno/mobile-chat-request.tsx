import { useState } from "react";
import { ChevronRight, Send, Sparkles } from "lucide-react";
import { recordsOfKind, type Device } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, InlineError, OptionSelect, PersonalDialog, SaveButton, shortDate, shortTime, useAction } from "./ui";
import type { PersonalStore } from "./use-zeno-sync";

const modelKey = (model: { providerId: string; modelId: string; variant?: string }) => JSON.stringify([model.providerId, model.modelId, model.variant ?? ""]);
const pending = new Set(["pending", "accepted", "running", "waiting_permission"]);

export function MobileChatRequest({ store, devices, readOnly = false }: { store: PersonalStore; devices: Device[]; readOnly?: boolean }) {
  const [open, setOpen] = useState(false), [prompt, setPrompt] = useState("");
  const [deviceId, setDevice] = useState(""), [workspaceId, setWorkspace] = useState(""), [modelId, setModel] = useState("");
  const [selectedId, setSelected] = useState<string | null>(null); const action = useAction();
  const available = devices.filter(device => !device.revokedAt && (!device.expiresAt || device.expiresAt > Date.now()));
  const device = available.find(item => item.id === deviceId) ?? available.find(item => item.windowOpen) ?? available[0];
  const workspace = device?.workspaces.find(item => item.id === workspaceId) ?? device?.workspaces[0];
  const model = device?.models.find(item => modelKey(item) === modelId) ?? device?.models[0];
  const requests = recordsOfKind(store.records, "request").filter(record => record.data.type === "chat").sort((a, b) => b.data.createdAt - a.data.createdAt);
  const selected = requests.find(record => record.id === selectedId);
  const state = (id: string) => {
    const request = requests.find(record => record.id === id); if (!request) return "";
    if (request.data.cancelRequested && pending.has(request.data.status)) return "等待电脑确认取消";
    if (request.data.status === "pending") return request.data.expiresAt <= Date.now() ? "请求已过期" : devices.find(item => item.id === request.data.deviceId)?.windowOpen ? "等待电脑接收" : "等待电脑打开";
    return ({ accepted: "电脑已接收", running: "正在回复", waiting_permission: "等待电脑端授权", succeeded: "已回复", failed: "回复未完成", cancelled: "已取消", expired: "请求已过期" })[request.data.status];
  };
  return <section className="border-t border-border py-5" data-zeno-mobile-chat><div className="flex items-center gap-2"><Sparkles className="size-4 text-muted-foreground" strokeWidth={1.5} /><h2 className="min-w-0 flex-1 text-sm font-medium">问泽诺</h2><Button variant="outline" size="sm" disabled={readOnly} onClick={() => setOpen(true)}><Send strokeWidth={1.5} />发给电脑</Button></div>
    <ul className="mt-2 divide-y divide-border">{requests.map(request => <li key={request.id}><button className="flex min-h-14 w-full items-center gap-3 py-2 text-left" onClick={() => setSelected(request.id)}><span className="min-w-0 flex-1"><span className="block truncate text-sm">{request.data.prompt}</span><span className="mt-1 block text-xs text-muted-foreground">{shortDate(request.data.createdAt)} {shortTime(request.data.createdAt)}</span></span><span role="status" className="text-xs text-muted-foreground">{state(request.id)}</span><ChevronRight className="size-4 text-muted-foreground" strokeWidth={1.5} /></button></li>)}</ul>
    <PersonalDialog title="问泽诺" open={open} onClose={() => setOpen(false)}><form className="grid gap-4" onSubmit={event => { event.preventDefault(); void action.run(async () => { if (readOnly || !device || !workspace || !model) throw new Error("先在电脑端连接账号并配置工作区与模型。"); await store.save("request", { type: "chat", prompt: prompt.trim(), deviceId: device.id, workspaceId: workspace.id, model, status: "pending", createdAt: Date.now(), expiresAt: Date.now() + 86400000, response: "", cancelRequested: false }); setPrompt(""); setOpen(false); }); }}>
      <Field label="消息"><Textarea required maxLength={50000} autoFocus rows={4} value={prompt} onChange={event => setPrompt(event.currentTarget.value)} /></Field>
      <Field label="电脑"><OptionSelect label="接收消息的电脑" value={device?.id ?? ""} options={available.map(item => ({ value: item.id, label: item.name }))} onChange={id => { setDevice(id); setWorkspace(""); setModel(""); }} /></Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="工作区"><OptionSelect label="消息工作区" value={workspace?.id ?? ""} options={(device?.workspaces ?? []).map(item => ({ value: item.id, label: item.name }))} onChange={setWorkspace} /></Field><Field label="模型"><OptionSelect label="消息模型" value={model ? modelKey(model) : ""} options={(device?.models ?? []).map(item => ({ value: modelKey(item), label: item.label ?? item.modelId }))} onChange={setModel} /></Field></div>
      <p className="text-xs text-muted-foreground">{device ? device.windowOpen ? "由这台电脑执行" : "等待这台电脑打开泽诺 · 有效期 24 小时" : "尚未连接电脑"}</p><InlineError message={action.error} /><SaveButton busy={action.busy} disabled={readOnly || !device || !workspace || !model || !prompt.trim()}>发送</SaveButton>
    </form></PersonalDialog>
    <PersonalDialog title={selected ? state(selected.id) : "电脑回复"} open={!!selected} onClose={() => setSelected(null)} wide>{selected ? <><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{selected.data.prompt}</p><p className="whitespace-pre-wrap break-words border-t border-border pt-4 text-sm">{selected.data.response || state(selected.id)}</p>{pending.has(selected.data.status) ? <Button variant="outline" disabled={readOnly || action.busy || selected.data.cancelRequested} onClick={() => void action.run(() => store.save("request", { ...selected.data, cancelRequested: true }, selected))}>{selected.data.cancelRequested ? "等待确认取消" : "取消请求"}</Button> : null}<InlineError message={action.error} /></> : null}</PersonalDialog>
  </section>;
}
