"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { MemberAuthGuard } from "../_components/member-auth-guard";
import { AUTH_TOKEN_STORAGE_KEY, getErrorMessage, getToken, requestJson } from "../_lib/den-flow";
import type { SetupBootstrapStatus } from "../_lib/member-auth-routing";

type SetupStatus = SetupBootstrapStatus;
type SetupStep = "verify" | "create";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string) {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field : "";
}

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus>("loading");
  const [step, setStep] = useState<SetupStep>("verify");
  const [email, setEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [grant, setGrant] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void requestJson("/v1/auth/bootstrap/status", { method: "GET" }, 12000)
      .then(({ response, payload }) => {
        if (!active) return;
        const nextStatus = readString(payload, "status");
        setStatus(response.ok && (nextStatus === "available" || nextStatus === "complete" || nextStatus === "unavailable") ? nextStatus : "unavailable");
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/auth/bootstrap/verify", {
        method: "POST",
        body: JSON.stringify({ email, code: setupCode }),
      });
      if (!response.ok) {
        setError(getErrorMessage(payload, "无法验证配置，请检查管理员邮箱与一次性配置代码。"));
        return;
      }
      const nextGrant = readString(payload, "grant");
      if (!nextGrant) {
        setError("无法验证配置，请刷新后重试。");
        return;
      }
      setGrant(nextGrant);
      setStep("create");
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : "无法验证配置，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({
          email,
          name: name.trim() || "OpenWork 管理员",
          password,
          bootstrapGrant: grant,
        }),
      });
      if (!response.ok) {
        setError(getErrorMessage(payload, `账户创建失败（${response.status}）。`));
        return;
      }
      const token = getToken(payload);
      if (token) {
        window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
      }
      window.location.assign("/install");
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : "创建账户失败，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  }

  const complete = status === "complete";
  const unavailable = status === "unavailable";

  return (
    <Suspense fallback={null}>
      <MemberAuthGuard route="/setup" setupStatus={status}>
        <section className="den-page flex min-h-[calc(100vh-2.5rem)] w-full items-center justify-center py-3 sm:py-4">
          <div className="den-frame mx-auto grid w-full max-w-[680px] gap-8 p-5 sm:p-8 md:p-10" data-testid="initial-admin-setup">
            <div className="grid gap-3">
              <p className="den-eyebrow">私有部署配置</p>
              <h1 className="den-title-lg">{complete ? "配置已完成" : "配置管理员账户"}</h1>
              <p className="den-copy">
                {complete
                  ? "此 OpenWork 部署已有首位管理员，请使用常规流程登录。"
                  : "为此私有 OpenWork 部署创建首位管理员，配置期间公开注册保持关闭。"}
              </p>
            </div>

            {status === "loading" ? (
              <div className="den-frame-inset rounded-[1.5rem] px-4 py-3 text-sm text-[var(--dls-text-secondary)]" role="status">
                正在检查配置可用性…
              </div>
            ) : complete || unavailable ? (
              <div className="grid gap-5">
                <div className="den-frame-inset rounded-[1.5rem] px-4 py-4 text-sm text-[var(--dls-text-secondary)]" role="status" aria-live="polite">
                  <div className="flex items-start gap-3">
                    {complete ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : null}
                    <p className="m-0 leading-6">
                      {complete
                        ? "此部署已永久关闭初始管理员配置。"
                        : "初始管理员配置不可用，请联系部署运维人员检查初始化配置。"}
                    </p>
                  </div>
                </div>
                <button type="button" className="den-button-primary" onClick={() => window.location.assign("/")}>登录</button>
              </div>
            ) : step === "verify" ? (
              <form className="grid gap-5" onSubmit={submitVerification}>
                <div className="grid gap-2">
                  <label className="den-label" htmlFor="setup-email">管理员邮箱</label>
                  <input
                    id="setup-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    className="den-input"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label className="den-label" htmlFor="setup-code">一次性配置代码</label>
                  <input
                    id="setup-code"
                    name="setupCode"
                    type="password"
                    autoComplete="one-time-code"
                    className="den-input"
                    value={setupCode}
                    onChange={(event) => setSetupCode(event.currentTarget.value)}
                    required
                  />
                  <p className="m-0 text-xs leading-5 text-[var(--dls-text-secondary)]">
                    使用部署运维人员通过密钥管理系统提供的代码，此代码不会通过邮件发送。
                  </p>
                </div>
                {error ? <p className="m-0 text-sm font-medium text-rose-600" role="alert">{error}</p> : null}
                <button type="submit" className="den-button-primary" disabled={busy}>
                  {busy ? "正在检查…" : "继续"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <form className="grid gap-5" onSubmit={submitAccount}>
                <div className="grid gap-2">
                  <p className="den-eyebrow">创建管理员账户</p>
                  <p className="den-copy">输入姓名与密码，OpenWork 将创建首个账户、完成登录，并永久关闭初始配置。</p>
                </div>
                <div className="grid gap-2">
                  <label className="den-label" htmlFor="setup-name">名称</label>
                  <input
                    id="setup-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    className="den-input"
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label className="den-label" htmlFor="setup-password">密码</label>
                  <input
                    id="setup-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    className="den-input"
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    required
                  />
                </div>
                {error ? <p className="m-0 text-sm font-medium text-rose-600" role="alert">{error}</p> : null}
                <button type="submit" className="den-button-primary" disabled={busy}>
                  {busy ? "正在创建…" : "创建管理员"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>
        </section>
      </MemberAuthGuard>
    </Suspense>
  );
}
