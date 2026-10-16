"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import {
  PENDING_WORKSPACE_CLAIM_STORAGE_KEY,
  getOrgDashboardRoute,
} from "../_lib/den-org";
import { useDenFlow } from "../_providers/den-flow-provider";
import { AuthPanel } from "./auth-panel";

function LoadingCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="den-page py-4 lg:py-6">
      <div className="den-frame grid max-w-[44rem] gap-4 p-6 md:p-7">
        <p className="den-eyebrow">OpenWork Cloud</p>
        <div className="grid gap-2">
          <h1 className="den-title-lg">{title}</h1>
          <p className="den-copy">{body}</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--dls-hover)]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--dls-accent)]" />
        </div>
      </div>
    </section>
  );
}

type AcceptedClaim = {
  organizationName: string;
  organizationSlug: string;
};

const AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY = "openwork:web:auto-accept-workspace-claim";

function parseAcceptedClaim(payload: unknown): AcceptedClaim | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const organization = (payload as { organization?: unknown }).organization;
  if (typeof organization !== "object" || organization === null) {
    return null;
  }

  const name = (organization as { name?: unknown }).name;
  const slug = (organization as { slug?: unknown }).slug;

  return {
    organizationName: typeof name === "string" ? name : "你的工作区",
    organizationSlug: typeof slug === "string" ? slug : "",
  };
}

function getOpenworkUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const url = (payload as { openworkUrl?: unknown }).openworkUrl;
  return typeof url === "string" && url.trim() ? url : null;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}`;
}

// Teammates saved with the workspace come back on accept, so invites survive a
// sign-up or verification round trip that drops the `invite` URL parameter.
function teammatesToInvite(fromUrl: readonly string[], payload: unknown): string[] {
  const saved =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { teammateEmails?: unknown }).teammateEmails)
      ? (payload as { teammateEmails: unknown[] }).teammateEmails.filter((email): email is string => typeof email === "string")
      : [];
  return [...new Set([...fromUrl, ...saved].map((email) => email.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}

async function inviteTeammates(inviteEmails: readonly string[]): Promise<string> {
  const results = await Promise.allSettled(
    inviteEmails.map((email) =>
      requestJson("/v1/invitations", { method: "POST", body: JSON.stringify({ email, role: "member" }) }, 12000),
    ),
  );

  const succeeded = results.filter((result) => result.status === "fulfilled" && result.value.response.ok).length;
  const failed = inviteEmails.length - succeeded;

  if (failed === 0) {
    return `已邀请 ${pluralize(succeeded, "名团队成员")}。`;
  }
  if (succeeded === 0) {
    return `无法邀请 ${pluralize(failed, "名团队成员")}，你可以稍后在“管理成员”中重试。`;
  }
  return `已邀请 ${pluralize(succeeded, "名团队成员")}，${pluralize(failed, "项邀请")} 发送失败。你可以在“管理成员”中重试。`;
}

export function WorkspaceClaimScreen({
  token,
  prefilledEmail,
  inviteEmails = [],
}: {
  token: string;
  prefilledEmail?: string;
  inviteEmails?: string[];
}) {
  const router = useRouter();
  const { user, sessionHydrated, signOut } = useDenFlow();
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedOrg, setClaimedOrg] = useState<AcceptedClaim | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffAttempted, setHandoffAttempted] = useState(false);
  const [inviteSummary, setInviteSummary] = useState<string | null>(null);
  const autoClaimAttempted = useRef(false);
  const isLoopback = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  // Persist the token so sign-in / sign-up returns the user to this page.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (token) {
      window.sessionStorage.setItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (!sessionHydrated || user || !token || typeof window === "undefined") return;
    window.sessionStorage.setItem(AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY, token);
  }, [sessionHydrated, token, user]);

  async function handleClaim() {
    if (!token) {
      setClaimError("缺少认领链接。");
      return;
    }

    setClaimBusy(true);
    setClaimError(null);

    try {
      const { response, payload } = await requestJson(
        "/v1/bootstrap/claims/accept",
        {
          method: "POST",
          body: JSON.stringify({ token }),
        },
        12000,
      );

      if (!response.ok) {
        setClaimError(
          getErrorMessage(
            payload,
            response.status === 404
              ? "此认领链接缺失、已过期或已被使用。"
              : `无法认领工作区（${response.status}）。`,
          ),
        );
        return;
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY);
      }

      const toInvite = teammatesToInvite(inviteEmails, payload);
      if (toInvite.length > 0) {
        // The claim above just made this account the owner (and set it as
        // the session's active organization), so it can now invite
        // teammates through the same endpoint Manage Members uses. Show the
        // result briefly before moving on - this is best-effort: a failed
        // invite never blocks the claim, the owner can always retry from
        // Manage Members.
        const summary = await inviteTeammates(toInvite);
        setInviteSummary(summary);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1400));
      }

      // Don't navigate away immediately - offer to sign the already-running
      // desktop app in with zero retyped credentials, reusing the same
      // one-time handoff grant the normal "connect desktop" flow already
      // uses. The human chooses; we never auto-redirect them into an OS
      // "open this link?" prompt without asking.
      setClaimedOrg(parseAcceptedClaim(payload));
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : "无法认领工作区，请重试。");
    } finally {
      setClaimBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionHydrated || !user || !token || claimBusy || claimedOrg || autoClaimAttempted.current) return;
    if (window.sessionStorage.getItem(AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY) !== token) return;

    autoClaimAttempted.current = true;
    window.sessionStorage.removeItem(AUTO_ACCEPT_WORKSPACE_CLAIM_STORAGE_KEY);
    void handleClaim();
  }, [claimBusy, claimedOrg, sessionHydrated, token, user]);

  async function createDesktopHandoff(): Promise<string> {
    const { response, payload } = await requestJson(
      "/v1/auth/desktop-handoff",
      {
        method: "POST",
        body: JSON.stringify({ desktopScheme: "openwork" }),
      },
      12000,
    );

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, `无法准备 OpenWork 链接（${response.status}）。`));
    }

    const openworkUrl = getOpenworkUrl(payload);
    if (!openworkUrl) {
      throw new Error("未返回 OpenWork 链接。");
    }

    return openworkUrl;
  }

  async function handleOpenDesktop() {
    setHandoffBusy(true);
    setHandoffError(null);
    setHandoffAttempted(true);

    try {
      window.location.assign(await createDesktopHandoff());
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : "无法打开 OpenWork，请重试。");
    } finally {
      setHandoffBusy(false);
    }
  }

  async function handleCopyOpenWorkLink() {
    setCopyBusy(true);
    setLinkCopied(false);
    setHandoffError(null);

    try {
      if (!navigator.clipboard) {
        throw new Error("此浏览器不支持剪贴板。");
      }

      const openworkUrl = await createDesktopHandoff();
      await navigator.clipboard.writeText(openworkUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1800);
    } catch (error) {
      setHandoffError(error instanceof Error ? error.message : "无法复制 OpenWork 链接，请手动复制。");
    } finally {
      setCopyBusy(false);
    }
  }

  function continueInBrowser() {
    router.replace(getOrgDashboardRoute(claimedOrg?.organizationSlug ?? null));
  }

  if (!token) {
    return (
      <section className="den-page py-4 lg:py-6">
        <div className="den-frame grid max-w-[44rem] gap-6 p-6 md:p-8">
          <div className="grid gap-2">
            <p className="den-eyebrow">OpenWork Cloud</p>
            <h1 className="den-title-lg">无法打开此认领链接。</h1>
            <p className="den-copy">链接缺少认领令牌，请从配置页面重新打开，或申请新链接。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/" className="den-button-primary w-full sm:w-auto">
              返回 OpenWork 云端
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!sessionHydrated) {
    return <LoadingCard title="正在加载工作区认领信息。" body="正在检查账户状态…" />;
  }

  // Signed out: collect credentials, then resume on this page automatically.
  if (!user) {
    return (
      <section className="den-page py-6 lg:py-10">
        <div className="mx-auto grid w-full max-w-[32rem] gap-5">
          <div className="grid gap-2 text-center">
            <p className="den-eyebrow">OpenWork Cloud</p>
            <h1 className="den-title-lg">认领工作区</h1>
            <p className="den-copy">
              登录或创建账户以成为所有者，工作区已配置完成。
            </p>
          </div>

          <AuthPanel
            eyebrow="工作区所有者"
            // Prefill only - never locked. The claim token (not the email) is
            // what authorizes accepting this claim, so the human can still
            // claim with a different email if they want to.
            prefilledEmail={prefilledEmail}
            prefillKey={token}
            signUpContent={{
              title: "创建账户",
              copy: "你将成为此工作区的所有者。",
              submitLabel: "创建账户并认领",
            }}
            signInContent={{
              title: "登录后继续",
              copy: "你将成为此工作区的所有者。",
              submitLabel: "登录并认领",
            }}
          />
        </div>
      </section>
    );
  }

  // Claimed: offer to sign the desktop app in with zero retyped credentials,
  // or continue in the browser.
  if (claimedOrg) {
    return (
      <section
        className={`flex min-h-dvh w-full items-center justify-center px-5 py-8 ${isLoopback ? "bg-[#edf6ff]" : ""}`}
        data-demo-claim={isLoopback ? "true" : undefined}
      >
        <div className={`den-frame mx-auto grid w-full max-w-[38rem] gap-7 p-7 text-center md:p-10 ${isLoopback ? "border-blue-200/80 bg-white/90 shadow-[0_28px_80px_-44px_rgba(37,99,235,0.45)]" : ""}`}>
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_12px_28px_-14px_rgba(37,99,235,0.8)]">
            <Check className="size-6" strokeWidth={2.5} aria-hidden />
          </div>

          <div className="grid justify-items-center gap-3">
            <p className={`den-eyebrow ${isLoopback ? "text-blue-700" : ""}`}>{isLoopback ? "演示工作区已就绪" : "工作区已就绪"}</p>
            <h1 className="den-title-lg max-w-[22ch]">{claimedOrg.organizationName} 已属于你。</h1>
            <p className="den-copy max-w-[46ch]">
              复制 OpenWork 链接，打开应用后粘贴到“粘贴登录代码”中，无需再次输入密码。
            </p>
          </div>

          <div className="grid gap-3">
            <button
              type="button"
              className={`den-button-primary w-full sm:w-auto ${isLoopback ? "bg-blue-600 shadow-[0_16px_34px_-18px_rgba(37,99,235,0.75)] hover:!bg-blue-700" : ""}`}
              onClick={() => void handleCopyOpenWorkLink()}
              disabled={handoffBusy || copyBusy}
            >
              <Copy className="size-4" aria-hidden />
              {copyBusy ? "正在复制…" : linkCopied ? "链接已复制" : "复制 OpenWork 链接"}
            </button>

            <div className="flex flex-col items-center justify-center gap-2 text-sm sm:flex-row sm:gap-5">
              <button
                type="button"
                className={`inline-flex min-h-10 items-center gap-1.5 px-2 font-medium transition disabled:opacity-60 ${isLoopback ? "text-[var(--dls-text-primary)] hover:text-blue-700" : "text-[var(--dls-text-secondary)] hover:text-[var(--dls-text-primary)]"}`}
                onClick={() => void handleOpenDesktop()}
                disabled={handoffBusy || copyBusy}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {handoffBusy ? "正在打开 OpenWork…" : "打开 OpenWork"}
              </button>
              <span className="hidden text-[var(--dls-border)] sm:inline" aria-hidden>•</span>
              <button
                type="button"
                className="min-h-10 px-2 font-medium text-[var(--dls-text-secondary)] transition hover:text-[var(--dls-text-primary)] disabled:opacity-60"
                onClick={continueInBrowser}
                disabled={handoffBusy || copyBusy}
              >
                改为在浏览器中继续
              </button>
            </div>
          </div>

          {linkCopied ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
              打开 OpenWork，将链接粘贴到“粘贴登录代码”中。
            </div>
          ) : null}

          {handoffAttempted && !handoffError ? (
            <p className="den-copy text-sm">
              正在打开 OpenWork。若应用未打开，例如当前设备尚未安装应用，请选择“改为在浏览器中继续”。
            </p>
          ) : null}
          {handoffError ? <div className="den-notice is-error">{handoffError}</div> : null}
        </div>
      </section>
    );
  }

  // Signed in: confirm ownership.
  return (
    <section className="den-page py-6 lg:py-10">
      <div className="den-frame mx-auto grid max-w-[34rem] gap-6 p-6 md:p-8">
        <div className="grid gap-2">
          <p className="den-eyebrow">OpenWork Cloud</p>
          <h1 className="den-title-lg">认领工作区</h1>
          <p className="den-copy">确认此账户以成为所有者。</p>
        </div>

        <div className="den-frame-inset grid gap-1 rounded-[1.5rem] px-4 py-3">
          <p className="den-label">当前登录账户</p>
          <p className="m-0 text-sm font-medium text-[var(--dls-text-primary)]">{user.email}</p>
        </div>

        <div className="grid gap-4">
          {inviteEmails.length > 0 ? (
            <div className="den-frame-inset rounded-[1.5rem] px-4 py-3">
              <p className="den-label">认领后将发送邀请</p>
              <p className="m-0 text-sm text-[var(--dls-text-primary)]">{inviteEmails.join(", ")}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="den-button-primary w-full sm:w-auto"
              onClick={() => void handleClaim()}
              disabled={claimBusy}
            >
              {claimBusy ? (inviteSummary ?? "正在认领…") : "认领此工作区"}
            </button>
            <button
              type="button"
              className="den-button-secondary w-full sm:w-auto"
              onClick={() => void signOut()}
              disabled={claimBusy}
            >
              使用其他账户
            </button>
          </div>
        </div>

        {inviteSummary ? <div className="den-notice is-info">{inviteSummary}</div> : null}
        {claimError ? <div className="den-notice is-error">{claimError}</div> : null}
      </div>
    </section>
  );
}
