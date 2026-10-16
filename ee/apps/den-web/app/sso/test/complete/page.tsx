"use client";

import { DenStatusScreen } from "../../../../components/den-status-screen";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function CompleteContent() {
  const searchParams = useSearchParams();
  const [{ intentId, failed }] = useState(() => ({
    intentId: searchParams.get("openworkSsoTest") ?? "",
    failed: searchParams.has("error") || searchParams.has("failed"),
  }));

  useEffect(() => {
    window.history.replaceState(null, "", "/sso/test/complete");
    if (!window.opener) return;
    window.opener.postMessage(
      { type: "openwork:sso-test-complete", intentId, failed },
      window.location.origin,
    );
    window.close();
  }, [failed, intentId]);

  return (
    <DenStatusScreen
      title={failed ? "身份验证测试失败" : "身份验证测试已完成"}
      description="返回 SSO 设置以查看结果，你可以关闭此窗口。"
    />
  );
}

export default function SsoTestCompletePage() {
  return <Suspense fallback={<DenStatusScreen title="正在完成 SSO 测试" description="正在准备身份验证结果…" />}><CompleteContent /></Suspense>;
}
