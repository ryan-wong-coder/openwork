import { z } from "zod";
import { accountSessionSchema, personalFeaturesSchema, type AccountSession, type PersonalFeatures } from "@zeno/core";

const hintSchema = z.object({ session: accountSessionSchema, features: personalFeaturesSchema.nullable(), verifiedAt: z.number() });
function key(baseUrl: string) { return "zeno.personal.account-hint:" + new URL(baseUrl || "/", location.href).href.replace(/\/$/, ""); }
/** Identity metadata only. It grants access to cached records, never server access. */
export function readAccountHint(baseUrl: string) { try { const parsed = hintSchema.safeParse(JSON.parse(localStorage.getItem(key(baseUrl)) ?? "null")); return parsed.success ? parsed.data : null; } catch { return null; } }
export function writeAccountHint(baseUrl: string, session: AccountSession, features: PersonalFeatures | null = null) {
  try { const previous = readAccountHint(baseUrl); localStorage.setItem(key(baseUrl), JSON.stringify({ session: { user: session.user }, features: features ?? (previous?.session.user.id === session.user.id ? previous.features : null), verifiedAt: Date.now() })); } catch { /* A denied convenience cache does not affect authentication. */ }
}
export function clearAccountHint(baseUrl: string) { try { localStorage.removeItem(key(baseUrl)); } catch { /* No hint remains usable in this mounted page. */ } }
export function isAccountSignedOut(baseUrl: string) { try { return localStorage.getItem(key(baseUrl) + ":signed-out") === "true"; } catch { return false; } }
export function markAccountSignedOut(baseUrl: string) { try { localStorage.setItem(key(baseUrl) + ":signed-out", "true"); } catch { /* The mounted page still enforces explicit sign-out. */ } }
export function clearAccountSignedOut(baseUrl: string) { try { localStorage.removeItem(key(baseUrl) + ":signed-out"); } catch { /* Sign-in remains authoritative for the mounted page. */ } }

const fieldLabels: Record<string, string> = { title: "名称", name: "名称", description: "说明", instructions: "执行内容", startAt: "开始", endAt: "结束", timeZone: "时区", allDay: "全天", location: "地点", recurrence: "重复", exceptions: "例外", reminders: "提醒", status: "状态", category: "分类", enabled: "启用", unit: "单位", exercises: "动作与训练组", progression: "进阶", week: "每周安排", rotation: "轮换", position: "轮换位置", time: "时间", restDays: "休息日", durationMinutes: "时长", at: "记录时间", weightKg: "体重", circumferences: "围度", photoMediaIds: "照片", notes: "备注", schedule: "执行时间", model: "模型", workspaceId: "工作区", deviceId: "电脑", finishedAt: "完成时间", startedAt: "开始时间", bodyFatPercent: "体脂率", goalWeightKg: "目标体重", code: "会员码", format: "格式", expiresAt: "到期时间" };
function fieldValue(key: string, value: unknown): string {
  if (value === undefined || value === null) return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && ["at", "startAt", "endAt", "startedAt", "finishedAt", "expiresAt"].includes(key)) return new Date(value).toLocaleString("zh-CN");
  return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value, null, 2);
}
export function conflictFields(local: unknown, remote: unknown): { key: string; label: string; local: string; remote: string }[] {
  if (!local || typeof local !== "object" || !remote || typeof remote !== "object") { const value = local && typeof local === "object" ? local : remote && typeof remote === "object" ? remote : {}; return Object.entries(value).map(([key, content]) => ({ key, label: fieldLabels[key] ?? key, local: local === null ? "已删除" : fieldValue(key, content), remote: remote === null ? "已删除" : fieldValue(key, content) })); }
  const left = new Map(Object.entries(local)); const right = new Map(Object.entries(remote));
  return [...new Set([...left.keys(), ...right.keys()])].filter(key => JSON.stringify(left.get(key)) !== JSON.stringify(right.get(key))).map(key => ({ key, label: fieldLabels[key] ?? key, local: fieldValue(key, left.get(key)), remote: fieldValue(key, right.get(key)) }));
}
