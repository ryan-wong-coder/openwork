"use client";

import { ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DenButton, buttonVariants } from "./ui/button";
import { DenInput } from "./ui/input";
import { DenNotice } from "./ui/notice";
import { type AuthUser, getErrorMessage, getUser, requestJson, type SocialAuthProvider, WORKSPACE_REAUTH_SECURITY_MESSAGE } from "../_lib/den-flow";
import { type DenOrgContext, getRequireSsoFromMetadata } from "../_lib/den-org";

function getSocialLabel(provider: SocialAuthProvider) {
  return provider === "google" ? "Google" : "GitHub";
}

function getRedirectUrl(response: Response, payload: unknown) {
  return payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string"
    ? payload.url
    : response.headers.get("location") ?? "";
}

function getReauthCompleteUrl(nonce: string, error = false) {
  const url = new URL("/reauth/complete", window.location.origin);
  url.searchParams.set("nonce", nonce);
  if (error) {
    url.searchParams.set("error", "1");
  }
  return url.toString();
}

type ReauthCompleteMessage = {
  type: "openwork:reauth-complete";
  nonce: string;
  error: string | null;
};

function getReauthCompleteMessage(data: unknown): ReauthCompleteMessage | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  if (!("type" in data) || data.type !== "openwork:reauth-complete") {
    return null;
  }
  if (!("nonce" in data) || typeof data.nonce !== "string") {
    return null;
  }
  const error = "error" in data ? data.error : null;
  if (error !== null && typeof error !== "string") {
    return null;
  }
  return { type: "openwork:reauth-complete", nonce: data.nonce, error };
}

const REAUTH_SOCIAL_PROVIDERS: readonly SocialAuthProvider[] = ["google", "github"];

export function ReauthDialog({
  open,
  user,
  orgContext,
  onCancel,
  onVerified,
  title = "确认身份以更改工作区设置",
  description = "确认身份后将自动完成更改。",
}: {
  open: boolean;
  user: AuthUser | null;
  orgContext: DenOrgContext | null;
  onCancel: () => void;
  onVerified: () => Promise<void>;
  title?: string;
  description?: string;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitingForPopup, setWaitingForPopup] = useState(false);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [ssoUrl, setSsoUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState("");
  const wasOpenRef = useRef(false);
  const onVerifiedRef = useRef(onVerified);
  const popupRef = useRef<Window | null>(null);
  const popupClosedIntervalRef = useRef<number | null>(null);

  const effectiveProviders = providers.length > 0 ? providers : user?.authProviders ?? [];
  const hasPassword = !loadingMethods && (effectiveProviders.length === 0 || effectiveProviders.includes("email"));
  const socialProviders = useMemo(
    () => REAUTH_SOCIAL_PROVIDERS.filter((provider) => effectiveProviders.includes(provider)),
    [effectiveProviders],
  );
  const hasManagedOrgSignIn = Boolean(
    ssoUrl ||
      getRequireSsoFromMetadata(orgContext?.organization.metadata ?? null) ||
      orgContext?.authMethods.sso ||
      orgContext?.authMethods.scim ||
      effectiveProviders.includes("sso") ||
      effectiveProviders.includes("scim"),
  );

  function stopPopupWatcher() {
    if (popupClosedIntervalRef.current !== null) {
      window.clearInterval(popupClosedIntervalRef.current);
      popupClosedIntervalRef.current = null;
    }
    popupRef.current = null;
    setWaitingForPopup(false);
  }

  function startPopupWatcher(popup: Window) {
    stopPopupWatcher();
    popupRef.current = popup;
    setWaitingForPopup(true);
    popupClosedIntervalRef.current = window.setInterval(() => {
      if (!popup.closed) {
        return;
      }
      stopPopupWatcher();
      setError("确认前登录窗口已关闭，请准备好后重试。");
      setBusy(false);
    }, 500);
  }

  function cancelSignIn() {
    popupRef.current?.close();
    stopPopupWatcher();
    onCancel();
  }

  useEffect(() => {
    onVerifiedRef.current = onVerified;
  }, [onVerified]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      popupRef.current?.close();
      stopPopupWatcher();
      setPassword("");
      setError(null);
      setBusy(false);
      setLoadingMethods(false);
      return;
    }

    if (!wasOpenRef.current) {
      setNonce(crypto.randomUUID());
      wasOpenRef.current = true;
    }

    let cancelled = false;
    setLoadingMethods(true);

    void (async () => {
      try {
        const meResult = await requestJson("/v1/me", { method: "GET" }, 12000);
        const refreshedUser = getUser(meResult.payload);
        if (!cancelled && refreshedUser && refreshedUser.id === user?.id) {
          setProviders(refreshedUser.authProviders);
        }

        const email = user?.email ?? "";
        if (email) {
          const ssoResult = await requestJson(`/v1/orgs/sso/resolve?email=${encodeURIComponent(email)}`, { method: "GET" }, 12000);
          if (!cancelled && ssoResult.response.ok) {
            const payload = ssoResult.payload;
            const nextUrl = payload && typeof payload === "object" && "signInUrl" in payload && typeof payload.signInUrl === "string"
              ? payload.signInUrl
              : null;
            setSsoUrl(nextUrl);
          }
        }
      } catch (nextError) {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "无法加载登录方式，请重试。");
      } finally {
        if (!cancelled) {
          setLoadingMethods(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user?.email, user?.id]);

  useEffect(() => {
    if (!open || !nonce) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const message = getReauthCompleteMessage(event.data);
      if (event.origin !== window.location.origin || !message || message.nonce !== nonce) {
        return;
      }

      const popup = popupRef.current;
      if (!popup) return;
      stopPopupWatcher();
      popup?.close();

      if (message.error) {
        setError("登录已取消或失败，请重试。");
        setBusy(false);
        return;
      }

      // This message only says "try again now"; the retried request still hits
      // the server-side freshness check, so a forged message cannot bypass reauth.
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          // Verify the cookie created by the popup, not a cached web bearer token.
          const result = await requestJson("/api/auth/get-session", { method: "GET" });
          const verifiedUser = getUser(result.payload);
          if (!result.response.ok || !verifiedUser || verifiedUser.id !== user?.id) {
            throw new Error(`以 ${user?.email} 身份登录以确认此更改。`);
          }
          await onVerifiedRef.current();
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "重新验证身份失败，请重试。");
          setBusy(false);
        }
      })();
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      popupRef.current?.close();
      stopPopupWatcher();
    };
  }, [open, nonce, user?.id, user?.email]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.email) {
      setError(WORKSPACE_REAUTH_SECURITY_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: user.email, password }),
      });

      if (!response.ok) {
        setError(getErrorMessage(payload, `重新验证身份失败（${response.status}）。`));
        return;
      }

      await onVerified();
      setPassword("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "重新验证身份失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function continueSocial(provider: SocialAuthProvider) {
    const popup = window.open("", "openwork-reauth", "popup,width=480,height=640");
    if (!popup) {
      setError("无法打开登录窗口，请允许 OpenWork 弹出窗口后重试。");
      return;
    }

    setBusy(true);
    setError(null);
    startPopupWatcher(popup);
    try {
      const callbackURL = getReauthCompleteUrl(nonce);
      const errorCallbackURL = getReauthCompleteUrl(nonce, true);
      const { response, payload } = await requestJson("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({ provider, callbackURL, errorCallbackURL }),
      });
      if (popupRef.current !== popup) {
        return;
      }
      if (!response.ok) {
        stopPopupWatcher();
        popup.close();
        setError(getErrorMessage(payload, `${getSocialLabel(provider)} 登录失败（${response.status}）。`));
        setBusy(false);
        return;
      }

      const redirectUrl = getRedirectUrl(response, payload);
      if (!redirectUrl) {
        stopPopupWatcher();
        popup.close();
        setError(`${getSocialLabel(provider)} 登录未返回跳转地址。`);
        setBusy(false);
        return;
      }

      popup.location.href = redirectUrl;
    } catch (nextError) {
      if (popupRef.current !== popup) return;
      stopPopupWatcher();
      popup.close();
      setError(nextError instanceof Error ? nextError.message : `${getSocialLabel(provider)} 登录失败。`);
      setBusy(false);
    }
  }

  function continueSso() {
    if (!ssoUrl || !user?.email) {
      setError("此工作区由组织管理，但未找到此邮箱可用的 SSO 登录地址。");
      return;
    }

    const popup = window.open("", "openwork-reauth", "popup,width=480,height=640");
    if (!popup) {
      setError("无法打开登录窗口，请允许 OpenWork 弹出窗口后重试。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const nextUrl = new URL(ssoUrl, window.location.origin);
      nextUrl.searchParams.set("callbackURL", getReauthCompleteUrl(nonce));
      nextUrl.searchParams.set("errorCallbackURL", getReauthCompleteUrl(nonce, true));
      nextUrl.searchParams.set("loginHint", user.email);

      popup.location.href = nextUrl.toString();
      startPopupWatcher(popup);
    } catch (nextError) {
      popup?.close();
      setError(nextError instanceof Error ? nextError.message : "组织 SSO 登录失败，请重试。");
      setBusy(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-dialog-title"
        // Test seam: the reauth popup eval matches the completion message to this nonce.
        data-reauth-nonce={nonce}
        className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_80px_-36px_rgba(15,23,42,0.6)]"
      >
        <div className="relative border-b border-slate-100 bg-slate-50/70 px-6 pb-5 pt-6">
          <button
            type="button"
            aria-label="关闭安全检查"
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
            disabled={busy && !waitingForPopup}
            onClick={cancelSignIn}
          >
            <X size={17} aria-hidden="true" />
          </button>
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-xs">
            <ShieldCheck size={20} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="grid gap-2 pr-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">安全检查</p>
            <h2 id="reauth-dialog-title" className="text-[22px] font-semibold tracking-[-0.03em] text-slate-950">
              {waitingForPopup ? "在另一窗口中完成登录" : title}
            </h2>
            <p className="text-[14px] leading-6 text-slate-600">
              {waitingForPopup
                ? "登录后返回此页面，更改将自动完成。"
                : description}
            </p>
          </div>
        </div>

        <div className="p-6">
          {user?.email ? (
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[12px] font-semibold uppercase text-white">
                {user.email.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">当前登录身份</p>
                <p className="truncate text-[13px] font-medium text-slate-700">{user.email}</p>
              </div>
            </div>
          ) : null}

          {error ? (
            <DenNotice message={error} tone="error" className="mb-5" />
          ) : null}

          {waitingForPopup ? (
            <div className="grid gap-4" role="status">
              <p className="text-sm text-slate-600">正在等待确认…</p>
              <DenButton className="w-full" onClick={() => popupRef.current?.focus()}>
                重新打开登录
              </DenButton>
            </div>
          ) : (
            <div className="grid gap-4">
              {loadingMethods ? (
                <div className="rounded-[18px] border border-gray-200 bg-gray-50 px-4 py-3 text-[14px] text-gray-500">
                  正在检查可用的登录方式…
                </div>
              ) : null}

              {hasManagedOrgSignIn ? (
                <DenButton className="w-full" onClick={continueSso} loading={busy || loadingMethods} disabled={!ssoUrl || busy || loadingMethods}>
                  通过 SSO 继续
                </DenButton>
              ) : null}

              {!ssoUrl && socialProviders.map((provider) => {
                const primarySocial = !hasManagedOrgSignIn && (provider === "google" || socialProviders.length === 1);
                return (
                  <button
                    key={provider}
                    type="button"
                    className={buttonVariants({ variant: primarySocial ? "primary" : "secondary", className: "w-full" })}
                    disabled={busy}
                    onClick={() => void continueSocial(provider)}
                  >
                    继续使用 {getSocialLabel(provider)}
                  </button>
                );
              })}

              {hasPassword && !ssoUrl ? (
                <form className="grid gap-3" onSubmit={submitPassword}>
                  <label className="grid gap-2">
                    <span className="text-[13px] font-medium text-gray-700">密码</span>
                    <DenInput
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      disabled={busy}
                      required
                    />
                  </label>
                  <DenButton className="w-full" type="submit" loading={busy} disabled={!password.trim()}>
                    验证密码
                  </DenButton>
                </form>
              ) : null}
            </div>
          )}

          <button
            type="button"
            className="mt-5 w-full rounded-lg py-2 text-[13px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:opacity-60"
            onClick={cancelSignIn}
            disabled={busy && !waitingForPopup}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
