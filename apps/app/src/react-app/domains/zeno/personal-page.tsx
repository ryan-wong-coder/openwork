import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Laptop, Lock, RefreshCw } from "lucide-react";
import { ZenoApiClient, recordsOfKind, type AccountSession, type Device, type PersonalFeatures, type ZenoDesktopBridge } from "@zeno/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ZenoMark } from "@/components/brand/zeno-brand";
import { readAccountHint, writeAccountHint, clearAccountHint, clearAccountSignedOut, isAccountSignedOut, markAccountSignedOut, conflictFields } from "./account-hint";
import { AuthView } from "./auth-view";
import { PersonalAccountPage } from "./account-page";
import { PersonalCalendarPage } from "./calendar-page";
import { PersonalFitnessPage } from "./fitness-page";
import { PersonalShell, type ZenoSection } from "./personal-shell";
import { PersonalTasksPage } from "./tasks-page";
import { usePersonalReminders } from "./use-personal-reminders";
import { useZenoSync } from "./use-zeno-sync";
import { Field, InlineError, PersonalDialog, readableError, SaveButton, useAction } from "./ui";

export type ZenoPersonalPageProps = { initialSection?: ZenoSection; apiBaseUrl?: string; desktopBridge?: ZenoDesktopBridge; embedded?: boolean };
function DesktopConnect({ bridge, error }: { bridge: ZenoDesktopBridge; error: string | null }) {
  const [waiting, setWaiting] = useState(false); const action = useAction();
  return <div className="flex min-h-[70svh] flex-1 items-center justify-center p-6"><div className="max-w-sm text-center"><ZenoMark className="mx-auto mb-6 size-10" /><h1 className="text-xl font-semibold">连接你的账号</h1><p className="mb-6 mt-3 text-sm text-muted-foreground">{waiting ? "在浏览器中同意连接，完成后会自动同步。" : "日历、训练与任务，随设备同行。"}</p><InlineError message={action.error ?? error} /><Button disabled={action.busy} onClick={() => void action.run(async () => { await bridge.connect(); setWaiting(true); })}><Laptop strokeWidth={1.5} />{waiting ? "重新打开授权" : "连接账号"}</Button></div></div>;
}
function ResetPassword({ client, token, onDone }: { client: ZenoApiClient; token: string; onDone: () => void }) {
  const [password, setPassword] = useState(""); const action = useAction();
  return <div className="flex min-h-[100svh] items-center justify-center p-6"><form className="grid w-full max-w-sm gap-5" onSubmit={event => { event.preventDefault(); void action.run(async () => { await client.resetPassword({ token, password }); const url = new URL(location.href); url.search = ""; url.pathname = "/app/account"; history.replaceState(null, "", url); onDone(); }); }}><ZenoMark className="mb-3 size-8" /><h1 className="text-xl font-semibold">设置新密码</h1><Field label="新密码"><Input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={event => setPassword(event.currentTarget.value)} /></Field><InlineError message={action.error} /><SaveButton busy={action.busy}>保存密码</SaveButton></form></div>;
}

function AuthenticatedPersonal({ client: unboundClient, session, props, refreshSession, logout, offlineAccount }: { client: ZenoApiClient; session: AccountSession; props: ZenoPersonalPageProps; refreshSession: () => Promise<void>; logout: () => Promise<void>; offlineAccount: boolean }) {
  const client = useMemo(() => unboundClient.forAccount(session.user.id), [unboundClient, session.user.id]);
  const [section, setSection] = useState<ZenoSection>(props.initialSection ?? "calendar");
  const [devices, setDevices] = useState<Device[]>([]); const [features, setFeatures] = useState<PersonalFeatures | null>(() => { const hint = readAccountHint(client.baseUrl); return hint?.session.user.id === session.user.id ? hint.features : null; });
  const [focusRoutineId, setFocusRoutineId] = useState<string | undefined>();
  const [conflictsOpen, setConflictsOpen] = useState(false); const action = useAction();
  const store = useZenoSync(client, session.user.id, client.baseUrl || location.origin);
  usePersonalReminders(store.records, features?.personalCalendar === true && (recordsOfKind(store.records, "settings")[0]?.data.notifications ?? true), client.baseUrl + ":" + session.user.id, props.desktopBridge);
  useEffect(() => { if (store.accountChanged) void refreshSession(); }, [store.accountChanged, refreshSession]);
  useEffect(() => setSection(props.initialSection ?? "calendar"), [props.initialSection]);
  const refreshDevices = useCallback(async () => { setDevices(await client.listDevices()); }, [client]);
  useEffect(() => { let stopped = false; void client.features().then(value => { if (!stopped) { setFeatures(value); writeAccountHint(client.baseUrl, session, value); } }).catch(() => {}); void refreshDevices().catch(() => {}); const timer = window.setInterval(() => { void refreshDevices().catch(() => {}); void client.features().then(value => { if (!stopped) { setFeatures(value); writeAccountHint(client.baseUrl, session, value); } }).catch(() => {}); }, 15000); return () => { stopped = true; window.clearInterval(timer); }; }, [client, refreshDevices]);
  useEffect(() => { if (props.embedded) return; const onBack = () => { const path = location.pathname.split("/").at(-1); if (path === "calendar" || path === "fitness" || path === "tasks" || path === "account") setSection(path); }; window.addEventListener("popstate", onBack); return () => window.removeEventListener("popstate", onBack); }, [props.embedded]);
  const changeSection = (next: ZenoSection) => { setSection(next); if (!props.embedded) { const url = new URL(location.href); url.pathname = "/app/" + next; url.search = ""; history.pushState(null, "", url); } };
  const readOnly = !store.writable || (section === "calendar" ? features?.personalCalendar !== true : section === "fitness" ? features?.fitnessTracking !== true : section === "tasks" ? features?.localScheduledTasks !== true : features?.zenoAccounts !== true);
  const undoAllowed = store.undoKinds.every(kind => kind === "event" ? features?.personalCalendar === true : ["routine", "trainingSchedule", "workout", "measurement", "exercise", "membership"].includes(kind) ? features?.fitnessTracking === true : ["task", "run", "request"].includes(kind) ? features?.localScheduledTasks === true : features?.zenoAccounts === true);
  const conflict = store.conflicts[0];
  const titleOf = (data: unknown) => data && typeof data === "object" && "title" in data && typeof data.title === "string" ? data.title : "这项记录";
  return <PersonalShell section={section} onSection={changeSection} embedded={props.embedded} offline={store.offline || offlineAccount} syncing={store.syncing} pending={store.pending}>
    {store.canUndo && store.writable ? <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"><span>已保存</span><Button size="xs" variant="ghost" disabled={!undoAllowed || store.syncing} title={undoAllowed ? undefined : "相关功能已停用"} onClick={() => void action.run(store.undo)}>撤销</Button></div> : null}
    <InlineError message={action.error} />
    {store.conflicts.length ? <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs"><span>{store.conflicts.length} 项修改需要处理</span><Button variant="outline" size="xs" onClick={() => setConflictsOpen(true)}>处理</Button></div> : null}
    {!store.writable && store.ready ? <div role="status" data-zeno-writer="readonly" className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{navigator.locks ? "另一页面正在编辑。关闭该页面后，这里会自动继续。" : "此浏览器不支持安全离线编辑，请使用新版浏览器。"}</div> : null}
    {readOnly && store.writable && features ? <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground"><Lock className="size-3.5" strokeWidth={1.5} />此功能已停用，历史仍可查看和导出。由服务管理员启用。</div> : null}
    {store.error ? <div className="flex items-start gap-3 border-b border-border px-4 py-2"><p role="status" className="min-w-0 flex-1 text-xs text-muted-foreground">{readableError(new Error(store.error))}</p><Button variant="ghost" size="xs" onClick={() => void store.synchronize()}>重试</Button></div> : null}
    {!store.ready ? <div className="grid gap-4 p-6"><Skeleton className="h-9 w-40" /><Skeleton className="h-64 w-full" /><Skeleton className="h-12 w-full" /></div> : <>
      <div hidden={section !== "calendar"} className="min-h-0 flex-1 data-[active=true]:flex data-[active=true]:flex-col" data-active={section === "calendar"}><PersonalCalendarPage workspaces={[...new Map(devices.flatMap(device => device.workspaces).map(workspace => [workspace.id, workspace])).values()]} store={store} readOnly={!store.writable || features?.personalCalendar !== true} onOpenTraining={id => { setFocusRoutineId(id); changeSection("fitness"); }} /></div>
      <div hidden={section !== "fitness"} className="min-h-0 flex-1 data-[active=true]:flex data-[active=true]:flex-col" data-active={section === "fitness"}><PersonalFitnessPage focusRoutineId={focusRoutineId} store={store} client={client} devices={devices} readOnly={!store.writable || features?.fitnessTracking !== true} desktopBridge={props.desktopBridge} /></div>
      <div hidden={section !== "tasks"} className="min-h-0 flex-1 data-[active=true]:flex data-[active=true]:flex-col" data-active={section === "tasks"}><PersonalTasksPage store={store} devices={devices} readOnly={!store.writable || features?.localScheduledTasks !== true} /></div>
      <div hidden={section !== "account"} className="min-h-0 flex-1 data-[active=true]:flex data-[active=true]:flex-col" data-active={section === "account"}><PersonalAccountPage readOnly={features?.zenoAccounts !== true} client={client} user={session.user} devices={devices} refreshDevices={refreshDevices} desktopBridge={props.desktopBridge} store={store} onFeatures={value => { setFeatures(value); writeAccountHint(client.baseUrl, session, value); }} approvalCode={new URLSearchParams(location.search).get("code") ?? ""} onLogout={async () => { await store.flushDrafts(); await logout(); }} /></div>
    </>}
    <PersonalDialog title="处理修改冲突" open={conflictsOpen && !!conflict} onClose={() => setConflictsOpen(false)}>{conflict ? <><p className="text-sm font-medium">{titleOf(conflict.mutation.data)}</p><div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground"><span>此设备{conflict.mutation.deleted ? "（已删除）" : ""}</span><span>已同步版本{conflict.remote?.deletedAt || !conflict.remote ? "（已删除）" : ""}</span></div><div className="max-h-[50dvh] divide-y divide-border overflow-y-auto">{conflictFields(conflict.mutation.data, conflict.remote?.data ?? null).map(field => <div key={field.key} className="py-3"><h3 className="mb-2 text-xs font-medium">{field.label}</h3><div className="grid grid-cols-2 gap-3 text-xs"><pre className="whitespace-pre-wrap break-words font-sans">{field.local}</pre><pre className="whitespace-pre-wrap break-words font-sans">{field.remote}</pre></div></div>)}</div><InlineError message={action.error} /><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!store.writable || action.busy} onClick={() => void action.run(() => store.resolveConflict(conflict.mutation.operationId, "remote"))}>使用已同步版本</Button><Button disabled={!store.writable || action.busy} onClick={() => void action.run(() => store.resolveConflict(conflict.mutation.operationId, "local"))}>保留此设备修改</Button></div></> : null}</PersonalDialog>
  </PersonalShell>;
}

export function ZenoPersonalPage(props: ZenoPersonalPageProps) {
  const client = useMemo(() => new ZenoApiClient({ baseUrl: props.apiBaseUrl ?? props.desktopBridge?.serviceOrigin, desktopBridge: props.desktopBridge }), [props.apiBaseUrl, props.desktopBridge]);
  const [session, setSession] = useState<AccountSession | null | undefined>(() => isAccountSignedOut(client.baseUrl) ? null : undefined); const [offlineAccount, setOfflineAccount] = useState(false); const epoch = useRef(0); const requestSequence = useRef(0); const signedOut = useRef(isAccountSignedOut(client.baseUrl)); const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState(() => !props.desktopBridge && location.pathname.includes("reset") ? new URLSearchParams(location.search).get("token") : null);
  const refreshSession = useCallback(async () => {
    if (signedOut.current) return;
    const generation = epoch.current, sequence = ++requestSequence.current;
    try { const next = await client.getSession(); if (generation !== epoch.current || sequence !== requestSequence.current) return; if (next) writeAccountHint(client.baseUrl, next); else clearAccountHint(client.baseUrl); setSession(next); setOfflineAccount(false); setError(null); }
    catch (caught) { if (generation !== epoch.current || sequence !== requestSequence.current) return; const hint = readAccountHint(client.baseUrl); if (hint) { setSession(hint.session); setOfflineAccount(true); } else setError(readableError(caught)); }
  }, [client]);
  const authenticated = async (action: () => Promise<AccountSession | null>) => { const generation = ++epoch.current; const next = await action(); if (generation !== epoch.current) return; if (!next) throw new Error("登录未完成，请重试。"); signedOut.current = false; clearAccountSignedOut(client.baseUrl); writeAccountHint(client.baseUrl, next); if (location.pathname.includes("invite")) { const url = new URL(location.href); url.pathname = "/app/calendar"; url.search = ""; history.replaceState(null, "", url); } setOfflineAccount(false); setSession(next); };
  const logout = async () => { ++epoch.current; signedOut.current = true; markAccountSignedOut(client.baseUrl); clearAccountHint(client.baseUrl); setSession(null); setOfflineAccount(false); await client.signOut(); };
  useEffect(() => { void refreshSession(); const online = () => void refreshSession(); window.addEventListener("online", online); const timer = window.setInterval(() => void refreshSession(), props.desktopBridge ? 3000 : 30000); const remove = props.desktopBridge?.onAccountChanged?.(() => { signedOut.current = false; clearAccountSignedOut(client.baseUrl); void refreshSession(); }); return () => { window.removeEventListener("online", online); window.clearInterval(timer); remove?.(); }; }, [props.desktopBridge, refreshSession]);
  if (reset) return <ResetPassword client={client} token={reset} onDone={() => { setReset(null); void refreshSession(); }} />;
  if (session === undefined) return error ? <div className="flex min-h-[70svh] items-center justify-center p-6"><div className="grid max-w-sm gap-4"><InlineError message={error} /><Button variant="outline" onClick={() => void refreshSession()}><RefreshCw strokeWidth={1.5} />重新连接</Button></div></div> : <div className="grid min-h-[70svh] place-content-center gap-5 p-6"><Skeleton className="h-9 w-40" /><Skeleton className="h-40 w-72" /></div>;
  if (!session) return props.desktopBridge ? <DesktopConnect bridge={props.desktopBridge} error={error} /> : <AuthView onSignIn={async credentials => { await authenticated(() => client.signIn(credentials)); }} onRegister={async credentials => { await authenticated(() => client.redeemInvite({ token: credentials.inviteCode, email: credentials.email, name: credentials.displayName, password: credentials.password })); }} />;
  return <AuthenticatedPersonal key={session.user.id} client={client} session={session} props={props} refreshSession={refreshSession} logout={logout} offlineAccount={offlineAccount} />;
}
