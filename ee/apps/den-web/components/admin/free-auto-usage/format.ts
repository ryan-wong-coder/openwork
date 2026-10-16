import { DEFAULT_DEN_LOCALE } from "../../../app/_lib/locale";
const usd = new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const preciseUsd = new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const whole = new Intl.NumberFormat(DEFAULT_DEN_LOCALE);
const compact = new Intl.NumberFormat(DEFAULT_DEN_LOCALE, { notation: "compact", maximumFractionDigits: 1 });

/** Micro-USD to dollars. Small non-zero amounts keep enough digits to stay visible. */
export function formatUsd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  return dollars > 0 && dollars < 0.01 ? preciseUsd.format(dollars) : usd.format(dollars);
}

export function formatCount(value: number): string {
  return whole.format(value);
}

export function formatTokens(value: number): string {
  return value < 10_000 ? whole.format(value) : compact.format(value);
}

/** "12%" of a whole; empty wholes read as a dash rather than 0%. */
export function formatShare(part: number, total: number): string {
  if (total <= 0) return "—";
  const share = part / total;
  return share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return "从未";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "未知";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return days === 1 ? "昨天" : `${days} 天前`;
}
