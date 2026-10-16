"use client";

import { DenButton, buttonVariants } from "../../app/(den)/_components/ui/button";
import type { AdminAccess } from "./admin-request";

export function AdminAccessScreen({ state, message, onRetry }: {
  state: Exclude<AdminAccess, "ready"> | "checking";
  message?: string;
  onRetry?: () => void;
}) {
  const title = state === "signed-out" ? "需要登录"
    : state === "forbidden" ? "需要管理员权限"
    : state === "checking" ? "正在检查管理员权限"
    : "管理后台不可用";
  const detail = state === "signed-out" ? "请使用 OpenWork 管理员账户登录后继续。"
    : state === "forbidden" ? "此账户不在 OpenWork 管理员允许名单中。"
    : state === "checking" ? undefined
    : message ?? "无法连接管理后台，请重试以检查访问权限。";

  return (
    <section data-testid="admin-access-screen" className="rounded-2xl border border-gray-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-gray-900" role={state === "checking" ? "status" : undefined}>{title}</h1>
      {detail ? <p className="mt-3 text-sm text-gray-600">{detail}</p> : null}
      {state !== "checking" ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/" className={buttonVariants()}>打开登录页面</a>
          {onRetry ? <DenButton variant="secondary" onClick={onRetry}>重试</DenButton> : null}
        </div>
      ) : null}
    </section>
  );
}
