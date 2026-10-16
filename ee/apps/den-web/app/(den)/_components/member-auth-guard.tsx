"use client";

import { useEffect, type ReactNode } from "react";
import { getSocialCallbackUrl } from "../_lib/den-flow";
import { resolveMemberAuthGuardDecision, type MemberRoute, type SetupBootstrapStatus } from "../_lib/member-auth-routing";
import { useDenFlow } from "../_providers/den-flow-provider";
import { DenButton } from "./ui/button";

export function MemberAuthCheckError() {
  const { memberAuthCheckError, retryMemberAuthCheck } = useDenFlow();
  return (
    <div className="grid gap-5" data-testid="member-auth-check-error">
      <h1 className="den-title-lg">无法检查登录状态</h1>
      <p className="den-copy" role="alert">{memberAuthCheckError ?? "无法检查登录状态，请重试。"}</p>
      <DenButton type="button" onClick={retryMemberAuthCheck}>重试</DenButton>
    </div>
  );
}

export function MemberAuthGuard({
  route,
  setupStatus = "complete",
  children,
}: {
  route: MemberRoute;
  setupStatus?: SetupBootstrapStatus;
  children: ReactNode;
}) {
  const {
    user,
    runtimeConfig,
    memberAuthCheckStatus,
  } = useDenFlow();
  const decision = resolveMemberAuthGuardDecision({
    route,
    setupStatus,
    authCheckStatus: memberAuthCheckStatus,
    signedIn: Boolean(user),
    singleOrgSsoConfigured: runtimeConfig.orgMode === "single_org" && runtimeConfig.singleOrgSsoConfigured,
    singleOrgSlug: runtimeConfig.singleOrgSlug,
  });

  useEffect(() => {
    if (decision === "sso") {
      const nextUrl = new URL(`/sso/${encodeURIComponent(runtimeConfig.singleOrgSlug.trim())}`, window.location.origin);
      nextUrl.searchParams.set("callbackURL", getSocialCallbackUrl(runtimeConfig.openworkAuthCallbackUrl, route));
      window.location.replace(nextUrl.toString());
      return;
    }
    if (decision === "sign-in") {
      const nextUrl = new URL(getSocialCallbackUrl(window.location.origin, route));
      nextUrl.searchParams.set("mode", "sign-in");
      window.location.replace(nextUrl.toString());
    }
  }, [decision, route, runtimeConfig.openworkAuthCallbackUrl, runtimeConfig.singleOrgSlug]);

  if (decision === "render") {
    return children;
  }
  if (decision === "wait") {
    return (
      <section className="den-page flex min-h-[calc(100vh-2.5rem)] w-full items-center justify-center py-3 sm:py-4">
        <div className="den-frame mx-auto w-full max-w-[520px] p-5 text-center sm:p-8" role="status">
          正在检查登录状态…
        </div>
      </section>
    );
  }
  if (decision === "error") {
    return (
      <section className="den-page flex min-h-[calc(100vh-2.5rem)] w-full items-center justify-center py-3 sm:py-4">
        <div className="den-frame mx-auto w-full max-w-[520px] p-5 text-center sm:p-8">
          <MemberAuthCheckError />
        </div>
      </section>
    );
  }
  return null;
}
