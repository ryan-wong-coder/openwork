"use client";

import { createContext, createElement, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SETUP_CONTINUATION_KEY, parseSetupContinuation, type SetupContinuation } from "../_lib/setup-continuation";
import {
  AUTH_TOKEN_STORAGE_KEY,
  DEFAULT_AUTH_NAME,
  PENDING_SOCIAL_SIGNUP_STORAGE_KEY,
  type AuthMode,
  type AuthUser,
  type SocialAuthProvider,
  getAuthInfoForMode,
  getEmailDomain,
  getErrorMessage,
  getSocialCallbackUrl,
  getSocialProviderLabel,
  getToken,
  getUser,
  identifyPosthogUser,
  normalizeAuthIntentParam,
  normalizeAuthModeParam,
  PENDING_AUTH_INTENT_STORAGE_KEY,
  requestJson,
  resetPosthogUser,
  trackPosthogEvent
} from "../_lib/den-flow";
import { EMPTY_RUNTIME_CONFIG, getRuntimeConfig, resetRuntimeConfig, type DenWebRuntimeConfig } from "../_lib/runtime-config";
import { resolveMemberReturnTo, type MemberAuthCheckStatus } from "../_lib/member-auth-routing";
import {
  getDesktopHandoffGrant,
  getDesktopHandoffOpenworkUrl,
  rememberDesktopHandoffGrant,
} from "../_lib/desktop-handoff";
import {
  PENDING_ORG_INVITATION_STORAGE_KEY,
  PENDING_WORKSPACE_CLAIM_STORAGE_KEY,
  getInferenceRoute,
  getJoinOrgRoute,
  getOrgDashboardRoute,
  getWorkspaceClaimRoute,
  parseOrgListPayload,
} from "../_lib/den-org";
import { requestOrgSelectionOnNextLoad } from "../_lib/org-selection";

type AuthNavigationResult = "dashboard" | "join-org" | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSignupPasswordFeedback(payload: unknown) {
  return isRecord(payload)
    && (payload.error === "password_too_short" || payload.error === "password_too_weak" || payload.error === "password_compromised");
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function getSignupPasswordFeedback(payload: unknown, fallback: string) {
  if (!isRecord(payload)) {
    return [fallback];
  }

  const feedback = isRecord(payload.feedback) ? payload.feedback : null;
  const messages = [
    typeof feedback?.warning === "string" ? feedback.warning.trim() : "",
    ...readStringArray(feedback?.suggestions).map((suggestion) => suggestion.trim()),
  ].filter((message) => message.length > 0);

  return messages.length > 0 ? messages : [fallback];
}

type DenFlowContextValue = {
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  email: string;
  setEmail: (value: string) => void;
  authName: string;
  setAuthName: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  verificationCode: string;
  setVerificationCode: (value: string) => void;
  verificationRequired: boolean;
  authBusy: boolean;
  authInfo: string;
  authError: string | null;
  signupPasswordFeedback: string[];
  user: AuthUser | null;
  sessionHydrated: boolean;
  memberAuthCheckStatus: MemberAuthCheckStatus;
  memberAuthCheckError: string | null;
  retryMemberAuthCheck: () => void;
  desktopAuthRequested: boolean;
  desktopAuthScheme: string;
  setupPending: boolean;
  setupOrganizationId: string | null;
  continueSetup: (organizationId: string | null, route: string) => void;
  completeSetup: (organizationId: string) => Promise<boolean>;
  webAuthRequested: boolean;
  desktopRedirectUrl: string | null;
  desktopRedirectBusy: boolean;
  retryDesktopAuthHandoff: () => void;
  showAuthFeedback: boolean;
  submitAuth: (event: FormEvent<HTMLFormElement>) => Promise<AuthNavigationResult>;
  submitVerificationCode: (event: FormEvent<HTMLFormElement>) => Promise<AuthNavigationResult>;
  resendVerificationCode: () => Promise<void>;
  cancelVerification: () => void;
  beginSocialAuth: (provider: SocialAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-checks the session with Den; clears the signed-in user when it is gone. */
  revalidateSession: () => Promise<AuthUser | null>;
  updateUserProfile: (input: { firstName: string; lastName: string }) => Promise<AuthUser>;
  resolveUserLandingRoute: () => Promise<string | null>;
  runtimeConfig: DenWebRuntimeConfig;
  runtimeConfigLoaded: boolean;
};

const DenFlowContext = createContext<DenFlowContextValue | null>(null);

function isEmailNotVerifiedError(payload: unknown) {
  return typeof payload === "object" && payload !== null && "code" in payload && payload.code === "EMAIL_NOT_VERIFIED";
}

function signUpReturnedVerifiedUser(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("user" in payload)) return false;
  const user = payload.user;
  return typeof user === "object" && user !== null && "emailVerified" in user && user.emailVerified === true;
}

function getPendingOrgInvitationId() {
  if (typeof window === "undefined") {
    return null;
  }

  const invitationId = window.sessionStorage.getItem(PENDING_ORG_INVITATION_STORAGE_KEY)?.trim() ?? "";
  return invitationId || null;
}

function getPendingWorkspaceClaimToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const token = window.sessionStorage.getItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY)?.trim() ?? "";
  return token || null;
}

function getPendingAuthIntent() {
  if (typeof window === "undefined") {
    return null;
  }

  return normalizeAuthIntentParam(window.sessionStorage.getItem(PENDING_AUTH_INTENT_STORAGE_KEY));
}

function clearPendingAuthIntent() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PENDING_AUTH_INTENT_STORAGE_KEY);
}

export function DenFlowProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [continuation, setContinuation] = useState<SetupContinuation | null>(null);
  const continuationRef = useRef<SetupContinuation | null>(null);
  const handoffBusyRef = useRef(false);
  const sessionEpochRef = useRef(0);
  const [authMode, setAuthModeState] = useState<AuthMode>("sign-up");
  const [email, setEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [password, setPasswordState] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authInfo, setAuthInfo] = useState(getAuthInfoForMode("sign-up"));
  const [authError, setAuthError] = useState<string | null>(null);
  const [signupPasswordFeedback, setSignupPasswordFeedback] = useState<string[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!token || token.trim().length === 0) {
      return null;
    }

    return token;
  });
  const [hydratedSession, setHydratedSession] = useState<{ token: string | null } | null>(null);
  const sessionHydrated = hydratedSession !== null && hydratedSession.token === authToken;
  const [memberAuthCheckStatus, setMemberAuthCheckStatus] = useState<MemberAuthCheckStatus>("checking");
  const [memberAuthCheckError, setMemberAuthCheckError] = useState<string | null>(null);
  const [memberAuthCheckAttempt, setMemberAuthCheckAttempt] = useState(0);
  const desktopAuthScheme = continuation?.desktopScheme ?? "openwork";
  const setupPending = Boolean(user && continuation?.userId === user.id && continuation.setup);
  const [webAuthRequested, setWebAuthRequested] = useState(false);
  const [webAuthReturnUrl, setWebAuthReturnUrl] = useState<string | null>(null);
  const [desktopRedirectBusy, setDesktopRedirectBusy] = useState(false);
  const [desktopRedirectUrl, setDesktopRedirectUrl] = useState<string | null>(null);
  const desktopAuthRequested = Boolean(continuation?.desktopScheme || desktopRedirectUrl);
  const [desktopRedirectAttempted, setDesktopRedirectAttempted] = useState(false);
  const [webRedirectBusy, setWebRedirectBusy] = useState(false);
  const [webRedirectAttempted, setWebRedirectAttempted] = useState(false);
  const [runtimeConfig, setRuntimeConfig] = useState<DenWebRuntimeConfig>(EMPTY_RUNTIME_CONFIG);
  const [runtimeConfigLoaded, setRuntimeConfigLoaded] = useState(false);
  const isSingleOrgMode = runtimeConfigLoaded && runtimeConfig.orgMode === "single_org";

  const socialSignupHandledRef = useRef<string | null>(null);

  function persistContinuation(next: SetupContinuation | null) {
    continuationRef.current = next;
    setContinuation(next);
    if (next) window.sessionStorage.setItem(SETUP_CONTINUATION_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(SETUP_CONTINUATION_KEY);
  }

  function continueSetup(organizationId: string | null, route: string) {
    if (!runtimeConfigLoaded || !sessionHydrated || !user || isSingleOrgMode) return;
    const current = continuationRef.current;
    persistContinuation({ userId: user.id, desktopScheme: current?.userId === user.id ? current.desktopScheme : null,
      setup: { organizationId, route }, at: Date.now() });
  }

  function setAuthMode(mode: AuthMode) {
    setAuthModeState(mode);
    setVerificationRequired(false);
    setVerificationCode("");
    setAuthInfo(getAuthInfoForMode(mode));
    setAuthError(null);
    setSignupPasswordFeedback([]);
  }

  function setPassword(value: string) {
    setPasswordState(value);
    setSignupPasswordFeedback([]);
  }

  function openVerificationStep(targetEmail: string, message?: string) {
    setVerificationRequired(true);
    setVerificationCode("");
    setAuthInfo(message ?? `输入发送至 ${targetEmail} 的六位验证码。`);
    setAuthError(null);
    setSignupPasswordFeedback([]);
  }

  function cancelVerification() {
    setVerificationRequired(false);
    setVerificationCode("");
    setAuthInfo(getAuthInfoForMode(authMode));
    setAuthError(null);
    setSignupPasswordFeedback([]);
  }

  async function redirectToRequiredSso(trimmedEmail: string) {
    const { response, payload } = await requestJson(`/api/auth/sso-resolve?email=${encodeURIComponent(trimmedEmail)}`, { method: "GET" }, 12000);

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, response.status === 403 ? "无法验证此次登录，请刷新后重试。" : `无法解析工作区单点登录配置（${response.status}）。`));
    }

    const method = typeof (payload as { method?: unknown } | null)?.method === "string"
      ? (payload as { method: string }).method
      : "";
    if (method !== "sso") {
      return false;
    }

    const signInUrl = typeof (payload as { signInUrl?: unknown } | null)?.signInUrl === "string"
      ? (payload as { signInUrl: string }).signInUrl
      : "";
    if (!signInUrl) {
      return false;
    }

    const nextUrl = new URL(signInUrl, window.location.origin);
    nextUrl.searchParams.set("callbackURL", getSocialCallbackUrl());
    nextUrl.searchParams.set("loginHint", trimmedEmail);
    window.location.assign(nextUrl.toString());
    return true;
  }

  async function finalizeEmailPasswordSignIn(
    nextMode: AuthMode,
    trimmedEmail: string,
    payloadOverride?: unknown,
  ): Promise<AuthNavigationResult> {
    let payload = payloadOverride;

    // Verifying an email proves the mailbox but does not sign anyone in:
    // /email-otp/verify-email answers with `token: null` and sets no cookie.
    // Exchange the password the person just typed for a session in sign-in
    // as well as sign-up, or an existing account that verifies from the
    // sign-in form is shown as signed in without a session (ENG-550).
    if (payload === undefined || (!getToken(payload) && Boolean(password))) {
      const signInBody = {
        email: trimmedEmail,
        password,
      };

      const signInResult = await requestJson("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify(signInBody)
      });

      if (!signInResult.response.ok) {
        setAuthError(getErrorMessage(signInResult.payload, `身份验证失败（${signInResult.response.status}）。`));
        trackPosthogEvent("den_auth_failed", {
          mode: nextMode,
          method: "email",
          status: signInResult.response.status
        });
        return null;
      }

      payload = signInResult.payload;
    }

    const token = getToken(payload);
    if (token) {
      setAuthToken(token);
    }

    let authenticatedUser: AuthUser | null = null;
    // A user object alone is not a session: the verify-email reply carries one
    // with `token: null`. Trust it only next to a token; otherwise ask Den.
    const payloadUser = token ? getUser(payload) : null;
    if (payloadUser) {
      authenticatedUser = payloadUser;
      setUser(payloadUser);
      setAuthInfo(`已以 ${payloadUser.email} 身份登录。`);
    } else {
      const refreshed = await refreshSession(true);
      if (refreshed) {
        authenticatedUser = refreshed;
      } else if (getUser(payload)) {
        // Verified, but there is no password to exchange for a session. Keep
        // the person on the sign-in step instead of a signed-in screen that
        // every request would reject.
        setAuthMode("sign-in");
        setAuthInfo(`邮箱已验证，请以 ${trimmedEmail} 身份登录以继续。`);
        return null;
      } else {
        setAuthInfo("身份验证成功，会话详情仍在同步。");
      }
    }

    if (authenticatedUser) {
      identifyPosthogUser(authenticatedUser);
      const analyticsPayload = {
        mode: nextMode,
        method: "email",
        email_domain: getEmailDomain(authenticatedUser.email)
      };

      if (nextMode === "sign-up") {
        trackPosthogEvent("den_signup_completed", analyticsPayload);
      } else {
        trackPosthogEvent("den_signin_completed", analyticsPayload);
      }
    }

    if (authenticatedUser && (getPendingWorkspaceClaimToken() || getPendingOrgInvitationId())) {
      return "join-org";
    }

    if (desktopAuthRequested || webAuthRequested) {
      setAuthInfo("已登录，正在返回 OpenWork…");
      return null;
    }

    return "dashboard" as const;
  }

  async function resendVerificationCode() {
    if (isSingleOrgMode) {
      setAuthError("此单组织部署不使用邮箱验证码。");
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthError("请先输入邮箱，再申请验证码。");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      const { response, payload } = await requestJson("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        body: JSON.stringify({
          email: trimmedEmail,
          type: "email-verification"
        })
      });

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `无法重新发送验证码（${response.status}）。`));
        return;
      }

      setAuthInfo(`我们已向 ${trimmedEmail} 发送新的验证码。`);
      trackPosthogEvent("den_signup_verification_sent", {
        method: "email",
        email_domain: getEmailDomain(trimmedEmail),
      });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "无法重新发送验证码，请重试。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitVerificationCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSingleOrgMode) {
      setVerificationRequired(false);
      setAuthError("此单组织部署不使用邮箱验证码。");
      return null;
    }

    const trimmedEmail = email.trim();
    const otp = verificationCode.trim();
    if (!trimmedEmail || !otp) {
      setAuthError("请输入邮件中的验证码。");
      return null;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      const { response, payload } = await requestJson("/api/auth/email-otp/verify-email", {
        method: "POST",
        body: JSON.stringify({
          email: trimmedEmail,
          otp,
        })
      });

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `验证失败（${response.status}）。`));
        trackPosthogEvent("den_auth_failed", {
          mode: authMode,
          method: "email",
          status: response.status,
          reason: "verification_failed"
        });
        return null;
      }

      setVerificationRequired(false);
      setVerificationCode("");
      setAuthInfo(`${trimmedEmail} 的邮箱已验证，正在完成登录…`);
      trackPosthogEvent("den_email_verified", {
        method: "email",
        email_domain: getEmailDomain(trimmedEmail),
      });

      return await finalizeEmailPasswordSignIn(authMode, trimmedEmail, payload);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "验证失败，请重试。");
      return null;
    } finally {
      setAuthBusy(false);
    }
  }

  async function refreshSession(quiet = false, isCurrent = () => true) {
    const epoch = sessionEpochRef.current;
    const headers = new Headers();
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    const { response, payload } = await requestJson("/v1/me", { method: "GET", headers }, 12000);
    if (!isCurrent() || epoch !== sessionEpochRef.current) return null;

    if (!response.ok) {
      if (response.status === 401) {
        setUser(null);
        if (authToken) {
          setAuthToken(null);
        }
        if (!quiet) {
          setAuthError("未找到有效会话，请先登录。");
        }
        return null;
      }
      throw new Error(getErrorMessage(payload, `无法检查登录状态（${response.status}）。`));
    }

    const sessionUser = getUser(payload);
    if (!sessionUser) {
      throw new Error("会话响应中缺少用户信息。");
    }

    setUser(sessionUser);
    setAuthInfo(`已以 ${sessionUser.email} 身份登录。`);
    return sessionUser;
  }

  async function loadOrgDirectory() {
    const headers = new Headers();
    if (authToken) {
      headers.set("Authorization", `Bearer ${authToken}`);
    }

    const { response, payload } = await requestJson("/v1/me/orgs", { method: "GET", headers }, 12000);
    if (!response.ok) {
      throw new Error(getErrorMessage(payload, "无法加载组织，请刷新后重试。"));
    }
    if (!isRecord(payload) || !Array.isArray(payload.orgs)) throw new Error("组织信息不完整，请重试。");
    const directory = parseOrgListPayload(payload);
    if (directory.orgs.length !== payload.orgs.length) throw new Error("组织信息不完整，请重试。");
    return directory;
  }

  async function completeDesktopAuthHandoff(organizationId?: string) {
    const current = continuationRef.current;
    const epoch = sessionEpochRef.current;
    if (!runtimeConfigLoaded || !sessionHydrated || authBusy || !current?.desktopScheme || current.userId !== user?.id || handoffBusyRef.current
      || (current.setup && current.setup.organizationId !== organizationId)) {
      return false;
    }

    handoffBusyRef.current = true;
    setDesktopRedirectBusy(true);
    setDesktopRedirectAttempted(true);
    setAuthError(null);

    try {
      const headers = new Headers();
      if (authToken) {
        headers.set("Authorization", `Bearer ${authToken}`);
      }

      if (organizationId) {
        const selected = await requestJson("/v1/me/active-organization", {
          method: "POST", headers, body: JSON.stringify({ organizationId }),
        });
        if (!selected.response.ok) throw new Error(getErrorMessage(selected.payload, "无法选择工作区，请重试。"));
      }
      if (continuationRef.current !== current || epoch !== sessionEpochRef.current) return false;

      const { response, payload } = await requestJson("/api/auth/desktop-handoff", {
        method: "POST",
        headers,
        body: JSON.stringify({ desktopScheme: desktopAuthScheme })
      });
      if (continuationRef.current !== current || epoch !== sessionEpochRef.current) return false;

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `桌面应用交接失败（${response.status}）。`));
        return false;
      }

      const openworkUrl = getDesktopHandoffOpenworkUrl(payload) ?? "";
      if (!openworkUrl) {
        setAuthError("桌面交接成功，但未返回 OpenWork 重定向地址。");
        return false;
      }

      rememberDesktopHandoffGrant(getDesktopHandoffGrant(payload, openworkUrl));
      setDesktopRedirectUrl(openworkUrl);
      persistContinuation(null);
      clearPendingAuthIntent();
      window.location.assign(openworkUrl);
      return true;
    } catch (error) {
      if (continuationRef.current === current && epoch === sessionEpochRef.current) setAuthError(error instanceof Error ? error.message : "打开 OpenWork 失败，请重试。");
      return false;
    } finally {
      handoffBusyRef.current = false;
      setDesktopRedirectBusy(false);
    }
  }

  async function completeSetup(organizationId: string) {
    const current = continuationRef.current;
    if (!runtimeConfigLoaded || !sessionHydrated) return false;
    if (!user || (current && current.userId !== user.id)
      || (current?.setup && current.setup.organizationId !== organizationId)) {
      setAuthError("请先返回开始配置的工作区，再完成配置。");
      return false;
    }
    if (getPendingOrgInvitationId() || getPendingWorkspaceClaimToken()) return false;
    if (current?.desktopScheme) return completeDesktopAuthHandoff(organizationId);
    persistContinuation(null);
    clearPendingAuthIntent();
    return true;
  }

  function getWebHandoffReturnUrl(payload: unknown) {
    if (typeof payload !== "object" || payload === null || !("returnUrl" in payload)) {
      return null;
    }

    const returnUrl = payload.returnUrl;
    return typeof returnUrl === "string" && returnUrl.trim() ? returnUrl.trim() : null;
  }

  async function completeWebAuthHandoff() {
    if (!webAuthRequested || webRedirectBusy) {
      return;
    }

    setWebRedirectBusy(true);
    setWebRedirectAttempted(true);
    setAuthError(null);

    try {
      if (!webAuthReturnUrl) {
        setAuthError("网页交接失败，未提供返回地址。");
        return;
      }

      const headers = new Headers();
      if (authToken) {
        headers.set("Authorization", `Bearer ${authToken}`);
      }

      const { response, payload } = await requestJson("/api/auth/desktop-handoff", {
        method: "POST",
        headers,
        body: JSON.stringify({ returnUrl: webAuthReturnUrl })
      });

      if (!response.ok) {
        setAuthError(getErrorMessage(payload, `网页应用交接失败（${response.status}）。`));
        return;
      }

      const grant = getDesktopHandoffGrant(payload, null) ?? "";
      const approvedReturnUrl = getWebHandoffReturnUrl(payload) ?? "";
      if (!grant || !approvedReturnUrl) {
        setAuthError("网页交接成功，但未返回云端地址。");
        return;
      }

      const redirectUrl = new URL(approvedReturnUrl);
      redirectUrl.searchParams.set("grant", grant);
      window.location.replace(redirectUrl.toString());
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "无法返回 OpenWork 云端，请重试。");
    } finally {
      setWebRedirectBusy(false);
    }
  }

  async function resolveUserLandingRoute() {
    // Deliberately ignores desktopAuthRequested: callers that auto-redirect
    // (auth-screen) gate on it themselves, while explicit actions — the
    // "Go to dashboard" button on the signed-in handoff card — must resolve
    // a destination even mid desktop handoff.
    if (!runtimeConfigLoaded || !sessionHydrated || !user) {
      return null;
    }

    const pendingClaimToken = getPendingWorkspaceClaimToken();
    if (pendingClaimToken) {
      return getWorkspaceClaimRoute(pendingClaimToken);
    }

    const pendingInvitationId = getPendingOrgInvitationId();
    if (pendingInvitationId) {
      return getJoinOrgRoute(pendingInvitationId);
    }

    if (continuationRef.current?.userId === user.id && continuationRef.current.setup) {
      return continuationRef.current.setup.route;
    }

    const returnTo = resolveMemberReturnTo(
      new URLSearchParams(window.location.search).get("returnTo"),
      desktopAuthRequested || webAuthRequested,
    );
    if (returnTo) {
      return returnTo;
    }
    if (runtimeConfig === EMPTY_RUNTIME_CONFIG) {
      setAuthError("无法加载工作区配置，请刷新后重试。");
      return null;
    }

    const epoch = sessionEpochRef.current;
    let directory: Awaited<ReturnType<typeof loadOrgDirectory>>;
    try {
      directory = await loadOrgDirectory();
    } catch (error) {
      if (epoch === sessionEpochRef.current) setAuthError(error instanceof Error ? error.message : "无法加载组织，请重试。");
      return null;
    }
    if (epoch !== sessionEpochRef.current) return null;
    requestOrgSelectionOnNextLoad(directory.orgs);
    if (directory.orgs.length === 0) {
      if (!isSingleOrgMode) continueSetup(null, "/organization");
      return "/organization";
    }

    if (getPendingAuthIntent() === "models") {
      clearPendingAuthIntent();
      return getInferenceRoute();
    }
    return getOrgDashboardRoute();
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    sessionEpochRef.current += 1;
    setAuthBusy(true);
    setAuthError(null);
    setSignupPasswordFeedback([]);
    const pendingInvitationId = getPendingOrgInvitationId();
    const submitMode: AuthMode = isSingleOrgMode
      && !runtimeConfig.singleOrgAllowPublicSignup
      && authMode === "sign-up"
      && !pendingInvitationId
      ? "sign-in"
      : authMode;
    trackPosthogEvent("den_auth_submitted", {
      mode: submitMode,
      method: "email"
    });

    try {
      const trimmedEmail = email.trim();
      if (trimmedEmail && await redirectToRequiredSso(trimmedEmail)) {
        return null;
      }
      const endpoint = submitMode === "sign-up" && pendingInvitationId
        ? `/api/auth/sign-up/email?invite=${encodeURIComponent(pendingInvitationId)}`
        : submitMode === "sign-up"
          ? "/api/auth/sign-up/email"
          : "/api/auth/sign-in/email";
      const body =
        submitMode === "sign-up"
          ? {
              name: authName.trim() || DEFAULT_AUTH_NAME,
              email: trimmedEmail,
              password,
              invite: pendingInvitationId ?? undefined,
            }
          : {
              email: trimmedEmail,
              password
            };

      const { response, payload } = await requestJson(endpoint, {
        method: "POST",
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        // Only better-auth's unverified-email refusal means a code was sent;
        // any other 403 (SSO-managed, sign-up policy) is a plain error.
        if (response.status === 403 && !isSingleOrgMode && isEmailNotVerifiedError(payload)) {
          openVerificationStep(trimmedEmail, `输入发送至 ${trimmedEmail} 的六位验证码以完成邮箱验证。`);
        }
        const message = getErrorMessage(payload, `身份验证失败（${response.status}）。`);
        if (submitMode === "sign-up" && isSignupPasswordFeedback(payload)) {
          setSignupPasswordFeedback(getSignupPasswordFeedback(payload, message));
          setAuthError(null);
        } else {
          setAuthError(message);
        }
        trackPosthogEvent("den_auth_failed", {
          mode: submitMode,
          method: "email",
          status: response.status
        });
        return null;
      }

      const token = getToken(payload);

      // Signing up from an invitation link can verify the email right away
      // (inviteLinkVerifiesEmail). Den still answers without a session, so
      // exchange the password for one instead of asking for an emailed code.
      if (submitMode === "sign-up" && !token && signUpReturnedVerifiedUser(payload)) {
        return await finalizeEmailPasswordSignIn(submitMode, trimmedEmail, payload);
      }

      if (submitMode === "sign-up" && !token) {
        setUser(null);
        openVerificationStep(trimmedEmail, `我们已向 ${trimmedEmail} 发送六位验证码，请在下方输入以完成账户创建。`);
        trackPosthogEvent("den_signup_verification_sent", {
          method: "email",
          email_domain: getEmailDomain(trimmedEmail),
        });
        return null;
      }
      return await finalizeEmailPasswordSignIn(submitMode, trimmedEmail, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "网络错误，请检查连接后重试";
      setAuthError(message);
      setSignupPasswordFeedback([]);
      trackPosthogEvent("den_auth_failed", {
        mode: submitMode,
        method: "email",
        reason: "network_error"
      });
      return null;
    } finally {
      setAuthBusy(false);
    }
  }

  async function beginSocialAuth(provider: SocialAuthProvider) {
    if (authBusy || typeof window === "undefined") {
      return;
    }

    const shouldTrackSocialSignup = authMode === "sign-up";
    if (shouldTrackSocialSignup) {
      window.sessionStorage.setItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY, provider);
    }

    setAuthBusy(true);
    setAuthError(null);
    setSignupPasswordFeedback([]);
    setAuthInfo(`正在跳转至 ${getSocialProviderLabel(provider)}…`);
    trackPosthogEvent("den_auth_submitted", {
      mode: authMode,
      method: provider
    });

    try {
      const trimmedEmail = email.trim();
      if (trimmedEmail && await redirectToRequiredSso(trimmedEmail)) {
        if (shouldTrackSocialSignup) {
          window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
        }
        return;
      }
      const latestRuntimeConfig = await getRuntimeConfig();
      setRuntimeConfig(latestRuntimeConfig);
      const callbackURL = getSocialCallbackUrl(latestRuntimeConfig.openworkAuthCallbackUrl);
      const { response, payload } = await requestJson("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({
          provider,
          callbackURL,
          errorCallbackURL: callbackURL
        })
      });

      if (!response.ok) {
        if (shouldTrackSocialSignup) {
          window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
        }
        setAuthInfo(getAuthInfoForMode(authMode));
        setAuthError(getErrorMessage(payload, `${getSocialProviderLabel(provider)} 登录失败（${response.status}）。`));
        setAuthBusy(false);
        return;
      }

      const socialPayload = payload as { url?: unknown } | null;
      const payloadUrl = typeof socialPayload?.url === "string" ? socialPayload.url.trim() : "";
      const headerUrl = response.headers.get("location")?.trim() ?? "";
      const redirectUrl = payloadUrl || headerUrl;

      if (!redirectUrl) {
        if (shouldTrackSocialSignup) {
          window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
        }
        setAuthInfo(getAuthInfoForMode(authMode));
        setAuthError(`${getSocialProviderLabel(provider)} 登录未返回跳转地址。`);
        setAuthBusy(false);
        return;
      }

      window.location.assign(redirectUrl);
    } catch (error) {
      if (shouldTrackSocialSignup) {
        window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
      }
      setAuthInfo(getAuthInfoForMode(authMode));
      setAuthError(error instanceof Error ? error.message : "网络错误，请检查连接后重试");
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (authBusy) {
      return;
    }

    sessionEpochRef.current += 1;
    persistContinuation(null);
    clearPendingAuthIntent();
    setDesktopRedirectUrl(null);
    setAuthBusy(true);
    setAuthError(null);

    try {
      await requestJson("/api/auth/sign-out", {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: JSON.stringify({})
      });
    } catch {
      // Ignore transport issues and clear local state anyway.
    } finally {
      setAuthBusy(false);
    }

    setUser(null);
    setAuthToken(null);
    setHydratedSession({ token: null });
    setDesktopRedirectUrl(null);
    setDesktopRedirectAttempted(false);
    setAuthMode("sign-up");
    setEmail("");
    setAuthName("");
    setPassword("");
    setAuthInfo(getAuthInfoForMode("sign-up"));
    resetPosthogUser();
    trackPosthogEvent("den_signout_completed", { method: "manual" });

    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
      window.sessionStorage.removeItem(PENDING_ORG_INVITATION_STORAGE_KEY);
      window.sessionStorage.removeItem(PENDING_WORKSPACE_CLAIM_STORAGE_KEY);
    }
  }

  async function updateUserProfile(input: { firstName: string; lastName: string }) {
    const { response, payload } = await requestJson(
      "/v1/me/profile",
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
      12000,
    );

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, `无法更新个人资料（${response.status}）。`));
    }

    const nextUser = getUser(payload);
    if (!nextUser) {
      throw new Error("个人资料更新响应中缺少用户信息。");
    }

    setUser(nextUser);
    identifyPosthogUser(nextUser);
    return nextUser;
  }

  function retryMemberAuthCheck() {
    resetRuntimeConfig();
    setRuntimeConfig(EMPTY_RUNTIME_CONFIG);
    setRuntimeConfigLoaded(false);
    setHydratedSession(null);
    setMemberAuthCheckError(null);
    setMemberAuthCheckStatus("checking");
    setMemberAuthCheckAttempt((current) => current + 1);
  }

  useEffect(() => {
    let cancelled = false;

    void getRuntimeConfig().then((config) => {
      if (cancelled) return;
      if (config === EMPTY_RUNTIME_CONFIG) {
        setMemberAuthCheckError("无法加载工作区配置，请重试。");
        setMemberAuthCheckStatus("error");
        return;
      }
      setRuntimeConfig(config);
      setRuntimeConfigLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [memberAuthCheckAttempt]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const requestedMode = normalizeAuthModeParam(params.get("mode"));
    if (requestedMode) {
      setAuthMode(requestedMode);
    }

    const stored = parseSetupContinuation(window.sessionStorage.getItem(SETUP_CONTINUATION_KEY));
    persistContinuation(params.get("desktopAuth") === "1"
      ? { userId: stored?.userId ?? null, setup: stored?.setup ?? null, at: Date.now(),
          desktopScheme: "openwork" }
      : stored);
    setWebAuthRequested(params.get("webAuth") === "1");
    const requestedWebReturnUrl = params.get("webAuthReturn")?.trim() ?? "";
    setWebAuthReturnUrl(requestedWebReturnUrl || null);

    const invitationId = params.get("invite")?.trim() ?? "";
    if (invitationId) {
      window.sessionStorage.setItem(PENDING_ORG_INVITATION_STORAGE_KEY, invitationId);
    }

    const requestedIntent = normalizeAuthIntentParam(params.get("intent"));
    if (requestedIntent) {
      window.sessionStorage.setItem(PENDING_AUTH_INTENT_STORAGE_KEY, requestedIntent);
    }
  }, []);

  useEffect(() => {
    // Left behind by the removed cloud worker screen; clear them from browsers that still have them.
    window.localStorage.removeItem("openwork:web:last-worker");
    window.localStorage.removeItem("openwork:web:onboarding-intent");
  }, []);

  useEffect(() => {
    if (authToken) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  }, [authToken]);

  useEffect(() => {
    if (!runtimeConfigLoaded) {
      return;
    }

    let cancelled = false;
    setHydratedSession(null);
    setMemberAuthCheckError(null);
    setMemberAuthCheckStatus("checking");

    const hydrateSession = async () => {
      const epoch = sessionEpochRef.current;
      try {
        await refreshSession(true, () => !cancelled);
        if (!cancelled && epoch === sessionEpochRef.current) {
          setHydratedSession({ token: authToken });
          setMemberAuthCheckStatus("ready");
        }
      } catch {
        if (!cancelled && epoch === sessionEpochRef.current) {
          setMemberAuthCheckError("无法检查登录状态，请重试。");
          setMemberAuthCheckStatus("error");
        }
      }
    };

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [authToken, runtimeConfigLoaded]);

  useEffect(() => {
    if (!user) {
      return;
    }

    identifyPosthogUser(user);
  }, [user?.id]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      return;
    }

    const pendingSocialSignup = window.sessionStorage.getItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
    if (pendingSocialSignup !== "github" && pendingSocialSignup !== "google") {
      return;
    }
    if (socialSignupHandledRef.current === user.id) {
      return;
    }

    socialSignupHandledRef.current = user.id;
    window.sessionStorage.removeItem(PENDING_SOCIAL_SIGNUP_STORAGE_KEY);
    trackPosthogEvent("den_signup_completed", {
      mode: "sign-up",
      method: pendingSocialSignup,
      email_domain: getEmailDomain(user.email)
    });
  }, [user?.id]);

  useEffect(() => {
    if (!runtimeConfigLoaded || !sessionHydrated || !user || !continuation) return;
    if (continuation.userId && continuation.userId !== user.id) {
      persistContinuation(null);
      setDesktopRedirectUrl(null);
      setDesktopRedirectAttempted(false);
      clearPendingAuthIntent();
    } else if (!continuation.userId) {
      persistContinuation({ ...continuation, userId: user.id });
    }
  }, [runtimeConfigLoaded, sessionHydrated, user?.id, continuation]);

  useEffect(() => {
    const current = continuationRef.current;
    if (!runtimeConfigLoaded || !sessionHydrated || !user || current?.userId !== user.id || !current.setup) return;
    if (["/dashboard/onboarding/people", "/dashboard/onboarding/tools", "/dashboard/onboarding"].includes(pathname)
      && current.setup.route !== pathname) {
      persistContinuation({ ...current, setup: { ...current.setup, route: pathname } });
    }
  }, [pathname, user?.id, runtimeConfigLoaded, sessionHydrated]);

  useEffect(() => {
    if (!runtimeConfigLoaded || !sessionHydrated || authBusy || !desktopAuthRequested || !user || continuation?.userId !== user.id
      || setupPending || desktopRedirectUrl || desktopRedirectBusy || desktopRedirectAttempted) return;
    // Invitation acceptance and workspace claims own their explicit handoffs.
    if (pathname === "/join-org" || pathname === "/workspace-claim") return;
    const pendingClaim = getPendingWorkspaceClaimToken();
    const pendingInvitation = getPendingOrgInvitationId();
    if (pendingClaim) {
      router.replace(getWorkspaceClaimRoute(pendingClaim));
      return;
    }
    if (pendingInvitation) {
      router.replace(getJoinOrgRoute(pendingInvitation));
      return;
    }
    // Failed config fetches return the single-org fallback, not a deployment decision.
    if (runtimeConfig === EMPTY_RUNTIME_CONFIG) {
      setAuthError("无法加载工作区配置，请刷新后重试。");
      setDesktopRedirectAttempted(true);
      return;
    }
    let cancelled = false;
    const current = continuationRef.current;
    const epoch = sessionEpochRef.current;
    void loadOrgDirectory().then((directory) => {
      if (cancelled || epoch !== sessionEpochRef.current || continuationRef.current !== current || getPendingOrgInvitationId() || getPendingWorkspaceClaimToken()) return;
      if (directory.orgs.length === 0) {
        if (!isSingleOrgMode) {
          persistContinuation({ userId: user.id, desktopScheme: desktopAuthScheme, setup: { organizationId: null, route: "/organization" }, at: Date.now() });
        }
        router.replace("/organization");
        return;
      }
      void completeDesktopAuthHandoff();
    }).catch((error: unknown) => {
      if (!cancelled && epoch === sessionEpochRef.current) {
        setAuthError(error instanceof Error ? error.message : "无法加载组织，请重试。");
        setDesktopRedirectAttempted(true);
      }
    });
    return () => { cancelled = true; };
  }, [runtimeConfig, runtimeConfigLoaded, isSingleOrgMode, sessionHydrated, authBusy, desktopAuthRequested, user?.id, authToken, continuation?.userId, setupPending, pathname, desktopRedirectUrl, desktopRedirectBusy, desktopRedirectAttempted, desktopAuthScheme]);

  useEffect(() => {
    if (!runtimeConfigLoaded || !sessionHydrated || !webAuthRequested || !user || webRedirectBusy || webRedirectAttempted
      || pathname === "/join-org" || pathname === "/workspace-claim"
      || getPendingOrgInvitationId() || getPendingWorkspaceClaimToken()) {
      return;
    }

    void completeWebAuthHandoff();
  }, [runtimeConfigLoaded, sessionHydrated, webAuthRequested, webAuthReturnUrl, user?.id, authToken, webRedirectBusy, webRedirectAttempted, pathname]);

  const showAuthFeedback = authInfo !== getAuthInfoForMode(authMode) || authError !== null;

  const value: DenFlowContextValue = {
    authMode,
    setAuthMode,
    email,
    setEmail,
    authName,
    setAuthName,
    password,
    setPassword,
    verificationCode,
    setVerificationCode,
    verificationRequired,
    authBusy,
    authInfo,
    authError,
    signupPasswordFeedback,
    user,
    sessionHydrated,
    memberAuthCheckStatus,
    memberAuthCheckError,
    retryMemberAuthCheck,
    desktopAuthRequested,
    desktopAuthScheme,
    setupPending,
    setupOrganizationId: setupPending ? continuation?.setup?.organizationId ?? null : null,
    continueSetup,
    completeSetup,
    webAuthRequested,
    desktopRedirectUrl,
    desktopRedirectBusy,
    retryDesktopAuthHandoff: () => {
      if (handoffBusyRef.current || setupPending) return;
      setAuthError(null);
      setDesktopRedirectAttempted(false);
    },
    showAuthFeedback,
    submitAuth,
    submitVerificationCode,
    resendVerificationCode,
    cancelVerification,
    beginSocialAuth,
    signOut,
    revalidateSession: () => refreshSession(true),
    updateUserProfile,
    resolveUserLandingRoute,
    runtimeConfig,
    runtimeConfigLoaded,
  };

  return createElement(DenFlowContext.Provider, { value }, children);
}

export function useDenFlow() {
  const value = useContext(DenFlowContext);
  if (!value) {
    throw new Error("useDenFlow must be used within DenFlowProvider.");
  }
  return value;
}
