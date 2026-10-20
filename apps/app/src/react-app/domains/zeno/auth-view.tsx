import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ZenoMark } from "@/components/brand/zeno-brand";
import { Field, InlineError, PersonalDialog, SaveButton, useAction } from "./ui";

export type AuthCredentials = { email: string; password: string; displayName: string; inviteCode: string };
export function AuthView({ onSignIn, onRegister }: { onSignIn: (input: AuthCredentials) => Promise<void>; onRegister: (input: AuthCredentials) => Promise<void> }) {
  const [mode, setMode] = useState<"signin" | "register">(() => location.pathname.includes("invite") && new URLSearchParams(location.search).has("token") ? "register" : "signin");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [displayName, setName] = useState(""); const [inviteCode, setInvite] = useState(() => location.pathname.includes("invite") ? new URLSearchParams(location.search).get("token") ?? "" : "");
  const [visible, setVisible] = useState(false); const [help, setHelp] = useState(false);
  const action = useAction();
  const switchMode = (next: typeof mode) => { setMode(next); action.setError(null); };
  return <main className="flex min-h-[100svh] items-center justify-center bg-background p-6 text-foreground" data-zeno-auth>
    <section className="w-full max-w-sm">
      <div className="mb-10 flex items-center gap-3"><ZenoMark className="size-8" /><span className="text-xl font-semibold tracking-tight">泽诺</span></div>
      <h1 className="mb-7 text-xl font-semibold tracking-tight">{mode === "signin" ? "欢迎回来" : "创建账号"}</h1>
      <form className="grid gap-5" onSubmit={event => { event.preventDefault(); void action.run(async () => {
        await (mode === "signin" ? onSignIn : onRegister)({ email: email.trim(), password, displayName: displayName.trim(), inviteCode: inviteCode.trim() });
      }); }}>
        <Field label="邮箱"><Input type="email" name="email" autoComplete="email" value={email} required onChange={event => setEmail(event.currentTarget.value)} /></Field>
        {mode === "register" ? <Field label="称呼"><Input name="name" autoComplete="nickname" value={displayName} required onChange={event => setName(event.currentTarget.value)} /></Field> : null}
        <Field label="密码"><div className="relative"><Input type={visible ? "text" : "password"} name="password" minLength={mode === "register" ? 12 : undefined} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} className="pr-11" required onChange={event => setPassword(event.currentTarget.value)} /><Button type="button" variant="ghost" size="icon-sm" className="absolute right-0.5 top-0.5" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff strokeWidth={1.5} /> : <Eye strokeWidth={1.5} />}</Button></div></Field>
        {mode === "register" ? <Field label="邀请码"><Input name="invite" autoComplete="off" value={inviteCode} required onChange={event => setInvite(event.currentTarget.value)} /></Field> : null}
        <InlineError message={action.error} />
        <SaveButton busy={action.busy}>{mode === "signin" ? "登录" : "创建账号"}</SaveButton>
      </form>
      <div className="mt-5 flex items-center justify-between text-sm">
        <Button variant="link" className="px-0 text-muted-foreground" onClick={() => switchMode(mode === "register" ? "signin" : "register")}>{mode === "signin" ? "使用邀请码注册" : "返回登录"}</Button>
        {mode === "signin" ? <Button variant="link" className="px-0 text-muted-foreground" onClick={() => setHelp(true)}>忘记密码</Button> : null}
      </div>
      <PersonalDialog title="重置密码" open={help} onClose={() => setHelp(false)}><p className="text-sm text-muted-foreground">联系此服务的管理员重置密码。</p><Button onClick={() => setHelp(false)}>返回登录</Button></PersonalDialog>
    </section>
  </main>;
}
