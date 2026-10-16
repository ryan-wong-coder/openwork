"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReauthDialog } from "../../_components/reauth-dialog";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { getUser, getErrorMessage, requestJson } from "../../_lib/den-flow";
import { getDesktopHandoffGrant } from "../../_lib/desktop-handoff";

function DesktopReauth() {
  const params = useSearchParams();
  const nonce = params.get("nonce") ?? "";
  const [identity, setIdentity] = useState<URLSearchParams | null>(null);
  useEffect(() => { setIdentity(new URLSearchParams(window.location.hash.slice(1))); }, [nonce]);
  const userId = identity?.get("userId") ?? "";
  const [email, setEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [loadingSession, setLoadingSession] = useState(true);
  const [cancelled, setCancelled] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoadingSession(true);
    void requestJson("/api/auth/get-session", { method: "GET" }).then((result) => {
      const currentUser = getUser(result.payload);
      if (active && result.response.ok && currentUser?.id === userId) setEmail(currentUser.email);
    }).catch(() => {
      // A missing browser session can still verify using the email form.
    }).finally(() => { if (active) setLoadingSession(false); });
    return () => { active = false; };
  }, [userId]);
  // The account reference is a hint, never a credential. Both surfaces validate
  // the signed-in identity; sharing rechecks authorization server-side.
  const user = useMemo(() => ({ id: userId, email, name: null, authProviders: ["email", "google", "github"] }), [userId, email]);
  const valid = /^[a-f0-9-]{36}$/i.test(nonce) && Boolean(userId);

  async function verified() {
    // Read the cookie just created by browser sign-in, through that same origin.
    // API discovery and a legacy web bearer token must not select another session.
    const me = await requestJson("/api/auth/get-session", { method: "GET" });
    if (!me.response.ok || !getUser(me.payload)) throw new Error("无法确认浏览器会话，请重新验证。");
    if (getUser(me.payload)?.id !== userId) throw new Error(`以 ${email} 身份登录以确认此次分享。`);
    const result = await requestJson("/api/auth/desktop-handoff", { method: "POST", body: JSON.stringify({ desktopScheme: "openwork" }) });
    if (!result.response.ok) throw new Error(getErrorMessage(result.payload, "无法将验证结果返回 OpenWork，请重试。"));
    const grant = getDesktopHandoffGrant(result.payload, null);
    if (!grant) throw new Error("无法创建验证链接，请重试。");
    const returned = new URL("openwork://den-reauth");
    returned.searchParams.set("nonce", nonce);
    returned.searchParams.set("grant", grant);
    setLink(returned.toString());
  }

  return <div className="den-page flex min-h-screen items-center justify-center p-6">
    <div className="den-frame grid w-full max-w-[520px] gap-4 p-6">
      <h1 className="den-title-lg">{link ? "返回 OpenWork 以完成共享" : "验证身份以共享应用"}</h1>
      {!identity ? <p>正在加载安全检查…</p> : !valid ? <p>从 OpenWork 共享对话框中打开验证，以开始新的安全检查。</p>
        : loadingSession ? <p>正在检查浏览器会话…</p>
        : cancelled ? <><p>验证已取消，请返回 OpenWork 共享对话框。</p><DenButton onClick={() => { setEmail(""); setCancelled(false); }}>重新验证</DenButton></>
        : !email ? <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setEmail(emailInput.trim()); }}>
          <p>输入在 OpenWork 中使用的邮箱以继续验证。</p>
          <label className="grid gap-2"><span>OpenWork 邮箱</span><DenInput type="email" autoComplete="email" required value={emailInput} onChange={(event) => setEmailInput(event.target.value)} /></label>
          <DenButton type="submit">继续</DenButton>
        </form>
        : link ? <>
          <p>返回应用完成待处理共享。若无法打开，请复制链接并粘贴到共享对话框。</p>
          <a className={buttonVariants()} href={link}>返回 OpenWork</a>
          <DenInput aria-label="验证链接" readOnly value={link} onFocus={(event) => event.target.select()} />
          <DenButton variant="secondary" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? "已复制" : "复制验证链接"}</DenButton>
        </> : <p>完成安全检查以返回待处理共享。</p>}
    </div>
    <ReauthDialog open={valid && !loadingSession && Boolean(email) && !cancelled && !link} user={user} orgContext={null} onCancel={() => setCancelled(true)} onVerified={verified}
      title="验证身份以共享应用" description="验证后返回 OpenWork，以完成所选应用的共享。" />
  </div>;
}

export default function DesktopReauthPage() {
  return <Suspense fallback={<p>正在加载安全检查…</p>}><DesktopReauth /></Suspense>;
}
