import { DEFAULT_DEN_LOCALE } from "../../../_lib/locale";
import { ChevronDown } from "lucide-react";
import type { GatewayUsageResponse } from "@openwork/types/den/gateway-usage";

const docsUrl = "https://openworklabs.com/docs/ai-gateway/counting-usage#uncountable-items";
const categories: { outcome: keyof NonNullable<GatewayUsageResponse["usage"]["uncountableRequests"]>; label: string }[] = [
  { outcome: "upstream_error", label: "提供商错误" },
  { outcome: "upstream_unreachable", label: "连接失败" },
  { outcome: "client_aborted", label: "取消与中断" },
  { outcome: "rejected", label: "被拒绝的请求" },
  { outcome: "ok", label: "已完成但未报告用量" },
];

export function GatewayUsageCoverageNotice({ usage }: { usage: GatewayUsageResponse["usage"] }) {
  if (usage.unreportedRequests === 0) return null;
  const counts = usage.uncountableRequests;
  return <div className="mt-5 text-xs leading-5 text-gray-500">
    <p>数据不包含无法计数的查询， <a href={docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-gray-900">在此了解详情</a>.</p>
    <details className="group mt-1">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        无法计数的查询详情
      </summary>
      <div className="mt-2 max-w-sm pl-5">
        {counts ? <dl className="space-y-1">
          {categories.map(({ outcome, label }) => {
            const count = counts[outcome];
            return <div key={outcome} className="flex items-baseline justify-between gap-4">
              <dt>{label}</dt>
              <dd className="tabular-nums">{count === null ? "不可用" : count.toLocaleString(DEFAULT_DEN_LOCALE)}</dd>
            </div>;
          })}
        </dl> : null}
        {!counts || Object.values(counts).some((count) => count === null)
          ? <p className="mt-2">部分旧记录未保留按结果分类的明细。{usage.unreportedRequests !== null ? `本周期有 ${usage.unreportedRequests.toLocaleString(DEFAULT_DEN_LOCALE)} 条无法计量的查询。` : " 其总数也不可用。"}</p> : null}
        {usage.groupBy === "team" ? <p className="mt-2">统计按当前团队成员关系计算，同一查询可能出现在多个团队中。</p> : null}
      </div>
    </details>
  </div>;
}
