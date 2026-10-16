"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { DenStatusScreen } from "../../../components/den-status-screen";
import { describeOAuthError, type OAuthErrorPageState } from "./describe-oauth-error";

export function OAuthErrorContent({ state }: { state: OAuthErrorPageState }) {
  return (
    <DenStatusScreen title={state.title} description={state.description} error={state.detail ?? "应用无法完成登录。"}>
      <div className="mt-8">
        <h2 className="text-[14px] font-semibold">下一步</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] leading-5 text-[var(--dls-text-secondary)]">
          {state.advice.map((advice) => <li key={advice}>{advice}</li>)}
        </ul>
      </div>

      <details className="mt-8 rounded-xl border border-[var(--dls-border)]">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">技术详情</summary>
        <dl className="border-t border-[var(--dls-border)] px-4 py-2">
          <div className="grid gap-1 border-b border-[var(--dls-border)] py-3 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-[12px] text-[var(--dls-text-secondary)]">错误代码</dt>
            <dd className="m-0 break-all font-mono text-[12px] leading-5 select-all">{state.code}</dd>
          </div>
          {state.detail ? (
            <div className="grid gap-1 border-b border-[var(--dls-border)] py-3 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
              <dt className="text-[12px] text-[var(--dls-text-secondary)]">说明</dt>
              <dd className="m-0 break-all font-mono text-[12px] leading-5 select-all">{state.detail}</dd>
            </div>
          ) : null}
        </dl>
      </details>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--dls-border)] pt-6 text-[13px] text-[var(--dls-text-secondary)]">
        <span>可以关闭此标签页。</span>
        <Link href="/" className="font-medium text-[var(--dls-text-primary)] underline underline-offset-4">
          返回 OpenWork
        </Link>
      </div>
    </DenStatusScreen>
  );
}

function OAuthErrorFromQuery() {
  const searchParams = useSearchParams();
  const state = useMemo(() => describeOAuthError(new URLSearchParams(searchParams.toString())), [searchParams]);
  return <OAuthErrorContent state={state} />;
}

export function OAuthErrorScreen() {
  return (
    <Suspense fallback={<OAuthErrorContent state={describeOAuthError(new URLSearchParams())} />}>
      <OAuthErrorFromQuery />
    </Suspense>
  );
}
