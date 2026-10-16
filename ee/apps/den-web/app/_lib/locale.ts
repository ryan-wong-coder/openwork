/** One fixed locale for server rendering, browser rendering and exported labels. */
export const DEFAULT_DEN_LOCALE = "zh-CN";

const STATUS_LABELS: Record<string, string> = {
  active: "有效", trialing: "试用中", past_due: "已逾期", unpaid: "未支付",
  paid: "已支付", canceled: "已取消", cancelled: "已取消", incomplete: "未完成",
  incomplete_expired: "未完成且已过期", paused: "已暂停", pending: "待处理",
  running: "运行中", queued: "排队中", succeeded: "成功", failed: "失败",
  approved: "已批准", denied: "已拒绝", rejected: "已拒绝", expired: "已过期", skipped: "已跳过", blocked: "已阻止",
  test: "测试", live: "正式", scheduled: "计划", manual: "手动", free: "免费", enterprise: "企业版", pro: "专业版",
  enabled: "已启用", resolved: "已解决", draft: "草稿", archived: "已归档", deleted: "已删除",
  stopped: "已停止", ready: "已就绪", unknown: "未知", disabled: "已禁用",
};

export function denStatusLabel(status: string): string {
  return STATUS_LABELS[status.trim().toLowerCase()] ?? status;
}

const BILLING_INTERVAL_LABELS: Record<string, string> = { day: "天", week: "周", month: "月", year: "年" };

export function denBillingIntervalLabel(interval: string): string {
  return BILLING_INTERVAL_LABELS[interval] ?? interval;
}
