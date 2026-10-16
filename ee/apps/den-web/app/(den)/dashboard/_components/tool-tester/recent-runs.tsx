import { DenSectionHeader } from "../../../_components/ui/section-header";
import type { McpToolCallOutcome } from "./tool-call-inspector";

type StoredRunBase = {
  id: string;
  connectionId: string;
  toolName: string;
  argumentsText: string;
  createdAt: number;
};

export type StoredToolRun = StoredRunBase & (
  | { status: "completed" | "failed"; outcome: McpToolCallOutcome }
  | { status: "policy_blocked"; message: string; disabledBy: string | null; disabledAt: string | null }
);

function runAge(createdAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`;
}

export function RecentToolRuns({
  runs,
  caption,
  onLoad,
}: {
  runs: StoredToolRun[];
  caption: string;
  onLoad: (run: StoredToolRun) => void;
}) {
  return (
    <section className="space-y-3 pt-2">
      <DenSectionHeader
        title="近期运行"
        description={caption}
      />
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
        {runs.length === 0 ? (
          <p className="px-4 py-5 text-[12px] text-gray-500">运行工具后，可在此查看本次会话的历史。</p>
        ) : runs.map((run) => {
          const summary = run.status === "completed"
            ? "已完成"
            : run.status === "policy_blocked"
              ? "已阻止 · 组织策略已禁用工具"
              : run.outcome.failureAttribution?.summary ?? run.outcome.errorMessage ?? "工具调用失败";
          const duration = run.status === "policy_blocked" ? "—" : `${run.outcome.durationMs} ms`;
          return (
            <div key={run.id} className="flex min-w-[620px] items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
              <span className={`h-2 w-2 shrink-0 rounded-full ${run.status === "completed" ? "bg-emerald-500" : "bg-red-400"}`} aria-hidden="true" />
              <span className="w-[140px] shrink-0 truncate font-mono text-[11px] text-gray-700">{run.toolName}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-gray-600">{summary}</span>
              <span className="w-16 shrink-0 text-right font-mono text-[10px] text-gray-500">{duration}</span>
              <span className="w-[72px] shrink-0 text-right text-[11px] text-gray-400">{runAge(run.createdAt)}</span>
              <button type="button" className="w-12 shrink-0 text-right text-[11px] font-medium text-gray-700 hover:text-gray-950" onClick={() => onLoad(run)}>加载</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
