"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { DenStatusScreen } from "../../../components/den-status-screen";
import {
  describeMcpAuthorizationFailure,
  parseMcpAuthorizationTabState,
  type McpAuthorizationDebugDetails,
} from "../../(den)/dashboard/_components/mcp-authorization-url";

function detailRows(details: McpAuthorizationDebugDetails): { label: string; value: string }[] {
  const rows: { label: string; value: string | number | boolean | undefined }[] = [
    {
      label: "HTTP 状态",
      value: details.httpStatus === "unavailable"
        ? "不可用 · 浏览器无法读取响应"
        : details.httpStatus,
    },
    { label: "错误代码", value: details.errorCode },
    { label: "诊断代码", value: details.diagnosticCode },
    { label: "诊断引用", value: details.diagnosticReference },
    { label: "重定向 URI", value: details.redirectUri },
    { label: "客户端元数据地址", value: details.clientMetadataUrl },
    { label: "握手阶段", value: details.phase },
    { label: "已通过的最高步骤", value: details.highestPassed },
    { label: "类别", value: details.category },
    { label: "可重试", value: details.retryable },
    { label: "操作负责人", value: details.actionOwner },
    { label: "建议操作", value: details.operatorAction },
    { label: "提供商状态", value: details.providerStatus },
    { label: "提供商请求 ID", value: details.providerRequestId },
    { label: "提供商代码", value: details.providerCode },
  ];
  return rows.flatMap((row) => row.value === undefined
    ? []
    : [{ label: row.label, value: String(row.value) }]);
}

function fallbackCopy(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.className = "fixed left-0 top-0 opacity-0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function OAuthFailure({
  connectionName,
  message,
  details,
}: {
  connectionName: string;
  message: string;
  details?: McpAuthorizationDebugDetails;
}) {
  const failure = describeMcpAuthorizationFailure({ connectionName, message, details });
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);

  async function copyValue(label: string, value: string) {
    setCopyError(false);
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      } else if (!fallbackCopy(value)) {
        setCopyError(true);
        return;
      }
      setCopiedLabel(label);
    } catch {
      if (fallbackCopy(value)) {
        setCopiedLabel(label);
      } else {
        setCopyError(true);
      }
    }
  }

  return (
    <DenStatusScreen title={failure.title} description={failure.description} error={message}>
      {failure.advice.length > 0 ? (
        <div className="mt-8">
          <h2 className="text-[14px] font-semibold">下一步</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] leading-5 text-[var(--dls-text-secondary)]">
            {failure.advice.map((advice) => <li key={advice}>{advice}</li>)}
          </ul>
        </div>
      ) : null}

      {failure.copyable.length > 0 ? (
        <div className="mt-8 space-y-3">
          {failure.copyable.map((item) => (
            <div key={item.label} className="rounded-xl border border-[var(--dls-border)] bg-[var(--dls-hover)] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold text-[var(--dls-text-secondary)]">{item.label}</span>
                <button
                  type="button"
                  onClick={() => void copyValue(item.label, item.value)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--dls-border)] bg-[var(--dls-surface)] px-2.5 py-1.5 text-[12px] font-medium hover:bg-[var(--dls-active)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  aria-label={`复制 ${item.label}`}
                >
                  {copiedLabel === item.label ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
                  {copiedLabel === item.label ? "已复制" : "复制"}
                </button>
              </div>
              <code className="mt-2 block break-all text-[12px] leading-5 text-[var(--dls-text-primary)] select-all">{item.value}</code>
            </div>
          ))}
          {copyError ? <p role="status" className="text-[12px] text-[var(--dls-text-secondary)]">复制失败，请选中此值后手动复制。</p> : null}
        </div>
      ) : null}

      {details ? (
        <details className="mt-8 rounded-xl border border-[var(--dls-border)]">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">技术详情</summary>
          <dl className="border-t border-[var(--dls-border)] px-4 py-2">
            {detailRows(details).map((row) => (
              <div key={row.label} className="grid gap-1 border-b border-[var(--dls-border)] py-3 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4">
                <dt className="text-[12px] text-[var(--dls-text-secondary)]">{row.label}</dt>
                <dd className="m-0 break-all font-mono text-[12px] leading-5 select-all">{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--dls-border)] pt-6 text-[13px] text-[var(--dls-text-secondary)]">
        <span>可以关闭此标签页。</span>
        <Link href="/dashboard/your-connections" className="font-medium text-[var(--dls-text-primary)] underline underline-offset-4">
          返回你的连接
        </Link>
      </div>
    </DenStatusScreen>
  );
}

function OAuthPageContent() {
  const searchParams = useSearchParams();
  const state = useMemo(
    () => parseMcpAuthorizationTabState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  useEffect(() => {
    document.title = state.outcome === "failed"
      ? "连接失败 · OpenWork"
      : "正在连接 · OpenWork";
  }, [state.outcome]);

  if (state.outcome === "failed" && state.failure) {
    return (
      <OAuthFailure
        connectionName={state.connectionName}
        message={state.failure.message}
        details={state.failure.details}
      />
    );
  }

  return (
    <DenStatusScreen
      title={`正在连接 ${state.connectionName}…`}
      description={`OpenWork 正在准备安全登录。请保持此标签页打开，稍后将跳转至 ${state.connectionName}。`}
      status={`正在联系 ${state.connectionName}…`}
    />
  );
}

export default function OAuthPage() {
  return (
    <Suspense fallback={<DenStatusScreen title="正在连接…" description="OpenWork 正在准备安全登录。" status="正在联系提供商…" />}>
      <OAuthPageContent />
    </Suspense>
  );
}
