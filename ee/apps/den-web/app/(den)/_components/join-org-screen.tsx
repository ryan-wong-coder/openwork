"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getErrorMessage, requestJson } from "../_lib/den-flow";
import {
  PENDING_ORG_INVITATION_STORAGE_KEY,
  formatRoleLabel,
  getJoinOrgRoute,
  getOrgDashboardRoute,
  isEmailAllowedForOrganization,
  parseInvitationPreviewPayload,
  type DenInvitationPreview,
} from "../_lib/den-org";
import { useDenFlow } from "../_providers/den-flow-provider";
import { AuthPanel } from "./auth-panel";
import { JoinOrgSuccess } from "./join-org-success";
import { OnboardingCard } from "./onboarding-card";
import { OnboardingShell } from "./onboarding-shell";
import type { OrganizationBrand } from "./organization-brand-identity";

const primaryActionClassName = "den-button-primary min-h-12 w-full focus:outline-hidden focus:ring-4 focus:ring-slate-950/10";

type JoinedOrg = {
  id: string;
  name: string;
  slug: string;
  brand: OrganizationBrand;
};

type AccountSummary = {
  email: string;
} | null;

type AcceptedAutoResolveFailure = {
  id: string;
  reason: "membership_removed" | "unknown";
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 text-sm font-medium leading-6 text-slate-900 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function InvitationDetails({
  preview,
  account,
  roleLabel,
}: {
  preview: DenInvitationPreview;
  account: AccountSummary;
  roleLabel: string;
}) {
  return (
    <dl className="divide-y divide-slate-200/80 border-y border-slate-200/80" data-testid="join-org-invitation-details">
      <DetailRow label="组织">{preview.organization.name}</DetailRow>
      <DetailRow label="受邀邮箱">{preview.invitation.email}</DetailRow>
      <DetailRow label="角色">{roleLabel}</DetailRow>
      <DetailRow label="账号">{account ? account.email : "未登录"}</DetailRow>
    </dl>
  );
}

function InvitationSummary({ preview }: { preview: DenInvitationPreview }) {
  return (
    <span data-testid="join-org-invitation-summary">
      受邀身份 <span className="font-medium text-slate-950">{preview.invitation.email}</span>
    </span>
  );
}

function InvitationHeading({
  title,
  copy,
}: {
  title: string;
  copy: ReactNode;
}) {
  return (
    <div className="grid gap-2.5">
      <h1 className="m-0 text-balance text-[30px] font-semibold leading-[38px] tracking-[-0.03em] text-slate-950 sm:text-[38px] sm:leading-[46px]">{title}</h1>
      <p className="m-0 text-[15px] leading-[23px] text-slate-600">{copy}</p>
    </div>
  );
}

function ActionGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3" data-testid="join-org-actions">
      {children}
    </div>
  );
}

function NotNowButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-12 w-full items-center justify-center rounded-full px-3 text-sm font-medium text-slate-500 transition hover:text-slate-950 focus:outline-hidden focus:ring-4 focus:ring-slate-950/10"
      onClick={onClick}
    >
      暂不迁移
    </button>
  );
}

function InlineAlert({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-medium leading-6 text-rose-700" role="alert">
      {children}
    </div>
  );
}

function getCardOrganization(preview: DenInvitationPreview | null) {
  if (!preview) {
    return null;
  }

  return {
    name: preview.organization.name,
    brand: preview.organization.branding,
  };
}

function LoadingState({
  preview = null,
  title = "正在加载邀请。",
  copy = "正在检查邀请详情与账户状态…",
}: {
  preview?: DenInvitationPreview | null;
  title?: string;
  copy?: string;
}) {
  return (
    <OnboardingShell state="loading" width="wide" background="surface">
      <OnboardingCard organization={getCardOrganization(preview)}>
        <div className="grid gap-5" aria-busy="true">
          <InvitationHeading title={title} copy={copy} />
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.18)]">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-slate-900" />
          </div>
        </div>
      </OnboardingCard>
    </OnboardingShell>
  );
}

function statusMessage(preview: DenInvitationPreview | null) {
  switch (preview?.invitation.status) {
    case "accepted":
      return "此邀请已被使用。";
    case "canceled":
      return "此邀请已被取消。";
    case "expired":
      return "此邀请已过期。";
    default:
      return "此邀请已失效。";
  }
}

function formatAllowedDomains(allowedEmailDomains: readonly string[] | null | undefined) {
  if (!allowedEmailDomains || allowedEmailDomains.length === 0) {
    return "任一受邀邮箱";
  }

  return allowedEmailDomains.length === 1
    ? allowedEmailDomains[0]
    : allowedEmailDomains.join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringProperty(value: unknown, key: string) {
  if (!isRecord(value)) {
    return null;
  }

  const property = value[key];
  return typeof property === "string" ? property : null;
}

function getJoinedOrgFromPayload(payload: unknown, preview: DenInvitationPreview): JoinedOrg {
  const organizationSlug = getStringProperty(payload, "organizationSlug")?.trim() || preview.organization.slug;
  const organizationId = getStringProperty(payload, "organizationId")?.trim() || preview.organization.id;

  return {
    id: organizationId,
    name: preview.organization.name,
    slug: organizationSlug,
    brand: preview.organization.branding,
  };
}

function InviteAuthPanel({
  preview,
  initialMode,
}: {
  preview: DenInvitationPreview;
  initialMode: "sign-in" | "sign-up";
}) {
  return (
    <div data-testid="join-org-auth">
      <AuthPanel
        bare
        hideIntro
        prefilledEmail={preview.invitation.email}
        prefillKey={preview.invitation.id}
        initialMode={initialMode}
        lockEmail
        hideEmailField
        hideLockedEmailSummary
        hideSocialAuth
        emailFirstFlow
        emailFirstInvitationId={preview.invitation.id}
        resolveEmailFirstOnPrefill
        signUpContent={{
          submitLabel: "创建账户",
        }}
        signInContent={{
          title: "登录后继续。",
          copy: initialMode === "sign-in"
            ? `以 ${preview.invitation.email} 身份登录以打开工作区。`
            : "请使用受邀账户接受邀请。",
          submitLabel: initialMode === "sign-in" ? "登录以打开工作区" : "登录以加入",
        }}
        verificationContent={{
          title: "请检查收件箱",
          copy: `输入发送至 ${preview.invitation.email} 的六位验证码。`,
          submitLabel: "验证并加入",
        }}
      />
    </div>
  );
}

export function JoinOrgScreen({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const { user, sessionHydrated, signOut, revalidateSession, desktopAuthRequested, desktopAuthScheme } = useDenFlow();
  const [preview, setPreview] = useState<DenInvitationPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [joinedOrg, setJoinedOrg] = useState<JoinedOrg | null>(null);
  const [acceptedAutoResolveFailure, setAcceptedAutoResolveFailure] = useState<AcceptedAutoResolveFailure | null>(null);
  const acceptedInvitationResolutionRef = useRef<string | null>(null);

  const invitedEmailMatches = preview && user
    ? preview.invitation.email.trim().toLowerCase() === user.email.trim().toLowerCase()
    : false;
  const invitedEmailAllowed = preview
    ? isEmailAllowedForOrganization(preview.organization.allowedEmailDomains, preview.invitation.email)
    : true;
  const signedInEmailAllowed = preview && user
    ? isEmailAllowedForOrganization(preview.organization.allowedEmailDomains, user.email)
    : true;
  const roleLabel = preview ? formatRoleLabel(preview.invitation.role) : "";
  const allowedDomainsLabel = preview ? formatAllowedDomains(preview.organization.allowedEmailDomains) : "";

  const clearPendingInvitation = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PENDING_ORG_INVITATION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!invitationId) {
        setPreview(null);
        setPreviewError("缺少邀请链接。");
        setPreviewBusy(false);
        return;
      }

      setPreviewBusy(true);
      setPreviewError(null);

      try {
        const { response, payload } = await requestJson(
          `/v1/orgs/invitations/preview?id=${encodeURIComponent(invitationId)}`,
          { method: "GET" },
          12000,
        );

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          if (typeof window !== "undefined" && response.status === 404) {
            window.sessionStorage.removeItem(PENDING_ORG_INVITATION_STORAGE_KEY);
          }

          setPreview(null);
          setPreviewError(getErrorMessage(payload, response.status === 404 ? "此邀请已失效。" : `无法加载邀请（${response.status}）。`));
          return;
        }

        const nextPreview = parseInvitationPreviewPayload(payload);
        if (!nextPreview) {
          setPreview(null);
          setPreviewError("邀请详情不完整。");
          return;
        }

        setPreview(nextPreview);
      } catch (error) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : "无法加载邀请，请重试。");
        }
      } finally {
        if (!cancelled) {
          setPreviewBusy(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  useEffect(() => {
    if (
      !invitationId ||
      !sessionHydrated ||
      !preview ||
      preview.invitation.status !== "accepted" ||
      !user ||
      !invitedEmailMatches
    ) {
      return;
    }

    const acceptedPreview = preview;
    const acceptedInvitationId = acceptedPreview.invitation.id;

    if (acceptedInvitationResolutionRef.current === acceptedInvitationId) {
      return;
    }

    acceptedInvitationResolutionRef.current = acceptedInvitationId;

    // The ref above guarantees a single in-flight resolution per invitation,
    // so every outcome below is applied unconditionally. Sign-in rehydration
    // churns the user identity mid-flight; a cancellation guard here dropped
    // the outcome and stranded users on the loading card in two real eval
    // regressions (first the success redirect, then the 410 failure card).
    async function resolveAcceptedInvitation() {
      setAcceptedAutoResolveFailure(null);

      try {
        const { response, payload } = await requestJson(
          "/v1/orgs/invitations/accept",
          {
            method: "POST",
            body: JSON.stringify({ id: invitationId }),
          },
          12000,
        );

        if (!response.ok) {
          setAcceptedAutoResolveFailure({
            id: acceptedInvitationId,
            reason: getStringProperty(payload, "error") === "membership_removed" ? "membership_removed" : "unknown",
          });
          return;
        }

        clearPendingInvitation();
        const nextJoinedOrg = getJoinedOrgFromPayload(payload, acceptedPreview);

        if (desktopAuthRequested) {
          setJoinedOrg(nextJoinedOrg);
          return;
        }

        router.replace("/install");
      } catch {
        // Transient transport failure: allow a later effect run to retry.
        acceptedInvitationResolutionRef.current = null;
        setAcceptedAutoResolveFailure({ id: acceptedInvitationId, reason: "unknown" });
      }
    }

    void resolveAcceptedInvitation();
  }, [clearPendingInvitation, desktopAuthRequested, invitationId, invitedEmailMatches, preview, router, sessionHydrated, user]);

  function handleNotNow() {
    clearPendingInvitation();
    router.replace("/");
  }

  async function handleAcceptInvitation() {
    if (!invitationId) {
      setJoinError("缺少邀请链接。");
      return;
    }
    if (!preview) {
      setJoinError("邀请详情仍在加载。");
      return;
    }

    setJoinBusy(true);
    setJoinError(null);

    try {
      const { response, payload } = await requestJson(
        "/v1/orgs/invitations/accept",
        {
          method: "POST",
          body: JSON.stringify({ id: invitationId }),
        },
        12000,
      );

      if (response.status === 401) {
        // No live session: it expired, was revoked, or was never created.
        // Ask Den; a dead session drops the page back to the invite sign-in
        // form instead of showing the raw "unauthorized" code (ENG-550).
        if (!(await revalidateSession())) {
          setSessionEnded(true);
          return;
        }
        setJoinError("无法加入组织，请重试。");
        return;
      }

      if (!response.ok) {
        setJoinError(getErrorMessage(payload, response.status === 404 ? "无法接受此邀请。" : `无法加入组织（${response.status}）。`));
        return;
      }

      clearPendingInvitation();
      const nextJoinedOrg = getJoinedOrgFromPayload(payload, preview);
      if (desktopAuthRequested) {
        setJoinedOrg(nextJoinedOrg);
      } else {
        router.replace("/install");
      }
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "无法加入组织，请重试。");
    } finally {
      setJoinBusy(false);
    }
  }

  async function handleSwitchAccount() {
    await signOut();
    if (typeof window !== "undefined" && invitationId) {
      window.sessionStorage.setItem(PENDING_ORG_INVITATION_STORAGE_KEY, invitationId);
    }
    router.replace(getJoinOrgRoute(invitationId));
  }

  if (!sessionHydrated || previewBusy) {
    return <LoadingState />;
  }

  if (joinedOrg) {
    return (
      <JoinOrgSuccess
        organizationName={joinedOrg.name}
        brand={joinedOrg.brand}
        desktopAuthRequested={desktopAuthRequested}
        desktopAuthScheme={desktopAuthScheme}
        onContinueInBrowser={() => router.replace(joinedOrg.slug ? getOrgDashboardRoute(joinedOrg.slug) : "/dashboard")}
      />
    );
  }

  if (!preview) {
    return (
      <OnboardingShell state="invalid" width="wide" background="surface">
        <OnboardingCard organization={getCardOrganization(preview)}>
          <InvitationHeading title="无法打开此邀请。" copy={previewError ?? "无法加载此邀请。"} />
          <ActionGroup>
            <button type="button" className={primaryActionClassName} onClick={handleNotNow}>
              返回 OpenWork 云端
            </button>
          </ActionGroup>
        </OnboardingCard>
      </OnboardingShell>
    );
  }

  const account = user ? { email: user.email } : null;
  const showAcceptAction = preview.invitation.status === "pending" && Boolean(user) && invitedEmailMatches;
  const acceptedAutoResolveFailureForPreview = acceptedAutoResolveFailure?.id === preview.invitation.id
    ? acceptedAutoResolveFailure
    : null;
  const acceptedAutoResolveFailed = Boolean(acceptedAutoResolveFailureForPreview);

  if (preview.invitation.status === "accepted" && user && invitedEmailMatches && !acceptedAutoResolveFailed) {
    return (
      <LoadingState
        preview={preview}
        title="正在打开工作区。"
        copy={`正在确认你在 ${preview.organization.name} 中的成员资格…`}
      />
    );
  }

  if (preview.invitation.status === "accepted" && user && invitedEmailMatches && acceptedAutoResolveFailureForPreview?.reason === "membership_removed") {
    return (
      <OnboardingShell state="membership-removed" width="wide" background="surface">
        <OnboardingCard organization={getCardOrganization(preview)}>
          <InvitationHeading
            title="你的访问权限已被移除。"
            copy={`你对 ${preview.organization.name} 的访问权限已移除，请联系工作区管理员重新邀请。`}
          />
          <ActionGroup>
            <button type="button" className={primaryActionClassName} onClick={handleNotNow}>
              返回 OpenWork 云端
            </button>
          </ActionGroup>
        </OnboardingCard>
      </OnboardingShell>
    );
  }

  if (preview.invitation.status === "accepted" && !user) {
    return (
      <OnboardingShell state="accepted-signed-out" width="wide" background="surface">
        <OnboardingCard organization={getCardOrganization(preview)}>
          <div className="grid gap-4">
            <InvitationHeading
              title={`你已加入 ${preview.organization.name}。`}
              copy={`此邀请已接受。请以 ${preview.invitation.email} 身份登录以打开工作区。`}
            />
            <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />
          </div>

          <InviteAuthPanel preview={preview} initialMode="sign-in" />

          <ActionGroup>
            <NotNowButton onClick={handleNotNow} />
          </ActionGroup>
        </OnboardingCard>
      </OnboardingShell>
    );
  }

  if (preview.invitation.status === "accepted" && user && !invitedEmailMatches) {
    return (
      <OnboardingShell state="accepted-wrong-account" width="wide" background="surface">
        <OnboardingCard organization={getCardOrganization(preview)}>
          <InvitationHeading
            title="请使用受邀账户。"
            copy={`此邀请属于 ${preview.invitation.email}，你当前登录的账户为 ${user.email}。请切换账户以打开此工作区。`}
          />
          <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />
          <ActionGroup>
            <button
              type="button"
              className={primaryActionClassName}
              onClick={() => void handleSwitchAccount()}
              disabled={joinBusy}
            >
              使用其他账户
            </button>
            <NotNowButton onClick={handleNotNow} />
          </ActionGroup>
        </OnboardingCard>
      </OnboardingShell>
    );
  }

  if (preview.invitation.status !== "pending") {
    return (
      <OnboardingShell state="unavailable" width="wide" background="surface">
        <OnboardingCard organization={getCardOrganization(preview)}>
          <InvitationHeading title="此邀请不可用。" copy={statusMessage(preview)} />
          <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />
          <ActionGroup>
            <button type="button" className={primaryActionClassName} onClick={handleNotNow}>
              返回 OpenWork 云端
            </button>
          </ActionGroup>
        </OnboardingCard>
      </OnboardingShell>
    );
  }

  if (!invitedEmailAllowed) {
    return (
      <OnboardingShell state="domain-blocked" width="wide" background="surface">
        <OnboardingCard organization={getCardOrganization(preview)}>
          <InvitationHeading
            title="此邀请要求使用其他邮箱域名。"
            copy={`${preview.organization.name} 目前仅接受来自 ${allowedDomainsLabel} 的账户，请联系工作区所有者更新允许列表或重新邀请。`}
          />
          <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />
          <ActionGroup>
            <button type="button" className={primaryActionClassName} onClick={handleNotNow}>
              返回 OpenWork 云端
            </button>
          </ActionGroup>
        </OnboardingCard>
      </OnboardingShell>
    );
  }

  if (!user) {
    return (
      <OnboardingShell state="signed-out" width="wide" background="surface">
        <OnboardingCard organization={getCardOrganization(preview)}>
          <div className="grid gap-4">
            <InvitationHeading
              title={`加入 ${preview.organization.name}`}
              copy={<InvitationSummary preview={preview} />}
            />
            {preview.organization.allowedEmailDomains?.length ? (
              <p className="m-0 text-[15px] leading-[23px] text-slate-600">
                此工作区仅接受 {allowedDomainsLabel} 域名的账户。
              </p>
            ) : null}
          </div>

          {sessionEnded ? <InlineAlert>会话已结束，请重新登录后加入。</InlineAlert> : null}

          <InviteAuthPanel preview={preview} initialMode="sign-up" />

          <ActionGroup>
            <NotNowButton onClick={handleNotNow} />
          </ActionGroup>
        </OnboardingCard>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell state="signed-in" width="wide" background="surface">
      <OnboardingCard organization={getCardOrganization(preview)}>
        <InvitationHeading title={`加入 ${preview.organization.name}。`} copy="请检查邀请并使用正确的账户继续。" />
        <InvitationDetails preview={preview} account={account} roleLabel={roleLabel} />

        {user && !signedInEmailAllowed ? (
          <div className="grid gap-4">
            <p className="m-0 text-[15px] leading-[23px] text-slate-600">
              {preview.organization.name} 仅接受来自以下域名的账户： <span className="font-medium text-slate-950">{allowedDomainsLabel}</span>。你当前登录的账户为 <span className="font-medium text-slate-950">{user.email}</span>，因此此账户无法加入。
            </p>
            <p className="m-0 text-[15px] leading-[23px] text-slate-500">
              请退出登录后创建新账户，或使用允许的邮箱地址登录。
            </p>
            <ActionGroup>
              <button
                type="button"
                className={primaryActionClassName}
                onClick={() => void handleSwitchAccount()}
                disabled={joinBusy}
              >
                退出登录
              </button>
              <NotNowButton onClick={handleNotNow} />
            </ActionGroup>
          </div>
        ) : !invitedEmailMatches ? (
          <div className="grid gap-4">
            <p className="m-0 text-[15px] leading-[23px] text-slate-600">
              此邀请发给 <span className="font-medium text-slate-950">{preview.invitation.email}</span>。请切换账户以继续。
            </p>
            <ActionGroup>
              <button
                type="button"
                className={primaryActionClassName}
                onClick={() => void handleSwitchAccount()}
                disabled={joinBusy}
              >
                使用其他账户
              </button>
              <NotNowButton onClick={handleNotNow} />
            </ActionGroup>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="m-0 text-[15px] leading-[23px] text-slate-600">继续即可进入团队工作区。</p>
            <ActionGroup>
              <button
                type="button"
                className={primaryActionClassName}
                onClick={() => void handleAcceptInvitation()}
                disabled={!showAcceptAction || joinBusy}
              >
                {joinBusy ? "正在加入…" : `加入 ${preview.organization.name}`}
              </button>
              <NotNowButton onClick={handleNotNow} />
            </ActionGroup>
          </div>
        )}

        {joinError ? <InlineAlert>{joinError}</InlineAlert> : null}
        {previewError ? <InlineAlert>{previewError}</InlineAlert> : null}
      </OnboardingCard>
    </OnboardingShell>
  );
}
