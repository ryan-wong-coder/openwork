"use client";

import Link from "next/link";
import { DenStatusScreen } from "../../../components/den-status-screen";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getSocialCallbackUrl, requestJson } from "../../(den)/_lib/den-flow";

export default function OrganizationSsoSignInPage() {
  const params = useParams<{ orgSlug: string }>();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const orgSlug = typeof params?.orgSlug === "string" ? params.orgSlug : "";

  const callbackURL = useMemo(() => searchParams.get("callbackURL") || getSocialCallbackUrl(), [searchParams]);
  const errorCallbackURL = useMemo(() => searchParams.get("errorCallbackURL") || undefined, [searchParams]);
  const loginHint = useMemo(() => searchParams.get("loginHint") || undefined, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRedirectUrl(null);

    void (async () => {
      try {
        const { response, payload } = await requestJson("/api/auth/sign-in/sso", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            organizationSlug: orgSlug,
            callbackURL,
            errorCallbackURL,
            loginHint,
          }),
        });

        if (!response.ok) {
          throw new Error(
            payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
              ? payload.message
              : `无法启动单点登录（${response.status}）。`,
          );
        }

        const nextUrl = payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : "";
        if (!nextUrl) {
          throw new Error("SSO 登录已开始，但缺少重定向地址。");
        }

        if (!cancelled) {
          setRedirectUrl(nextUrl);
          window.location.assign(nextUrl);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "开始 SSO 登录失败，请重试。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [callbackURL, errorCallbackURL, loginHint, orgSlug, attempt]);

  return (
    <DenStatusScreen
      title={error ? "无法完成登录" : "正在跳转到组织身份提供商"}
      description={error ? "请重试、返回登录，或联系组织管理员。" : ""}
      error={error}
    >
      {redirectUrl ? (
        <p className="mt-6 text-[13px] text-[var(--dls-text-secondary)]">
          如果页面未打开， <a href={redirectUrl} className="font-medium text-[var(--dls-text-primary)] underline underline-offset-4">请重新打开</a>.
        </p>
      ) : null}
      {error ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="den-button-secondary mt-6" onClick={() => setAttempt((value) => value + 1)}>
            重试
          </button>
          <Link href="/" className="mt-6 inline-flex h-10 items-center justify-center rounded-full border border-[var(--dls-border)] px-4 text-[13px] font-medium transition-colors hover:bg-[var(--dls-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dls-accent)]">
            返回登录
          </Link>
        </div>
      ) : null}
    </DenStatusScreen>
  );
}
