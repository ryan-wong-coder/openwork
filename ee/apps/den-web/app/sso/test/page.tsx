"use client";

import { DenStatusScreen } from "../../../components/den-status-screen";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getRuntimeConfig } from "../../(den)/_lib/runtime-config";
import { denApiCredentials, denBrowserEndpoint } from "../../(den)/_lib/den-api-origin";

function completionUrl(intentId: string, failed = false) {
  const url = new URL("/sso/test/complete", window.location.origin);
  url.searchParams.set("openworkSsoTest", intentId);
  if (failed) url.searchParams.set("failed", "1");
  return url.toString();
}

function SsoTestStartContent() {
  const searchParams = useSearchParams();
  const intentId = searchParams.get("intentId")?.trim() ?? "";
  const organizationId = searchParams.get("organizationId")?.trim() ?? "";
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!intentId || !organizationId) {
      setError("此 SSO 身份验证测试链接无效，请返回 SSO 设置重新测试。");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await getRuntimeConfig();
        const endpoint = denBrowserEndpoint(`/v1/sso/test/${encodeURIComponent(intentId)}/start`);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-openwork-legacy-org-id": organizationId,
          },
          credentials: denApiCredentials(endpoint),
          body: JSON.stringify({}),
        });
        const payload: unknown = await response.json().catch(() => null);
        const url = typeof payload === "object" && payload !== null && "url" in payload && typeof payload.url === "string"
          ? payload.url
          : null;
        if (!response.ok || !url) {
          throw new Error("无法开始 SSO 身份验证测试，请返回 SSO 设置重试。");
        }
        if (!cancelled) window.location.assign(url);
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : "无法开始 SSO 身份验证测试。");
        window.setTimeout(() => window.location.assign(completionUrl(intentId, true)), 1200);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [intentId, organizationId]);

  return (
    <DenStatusScreen
      title={error ? "无法开始测试" : "正在测试 SSO 连接"}
      description="此测试不会启用 SSO 或替换当前 OpenWork 会话。"
      status="正在准备组织登录页面…"
      error={error}
    />
  );
}

export default function SsoTestStartPage() {
  return <Suspense fallback={<DenStatusScreen title="正在测试 SSO 连接" description="正在准备组织登录页面…" />}><SsoTestStartContent /></Suspense>;
}
