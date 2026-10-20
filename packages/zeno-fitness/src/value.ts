/** Unknown values enter only at imported JSON and the preserved upstream JS boundary. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
export function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
export function finite(value: unknown, fallback = 0): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
export function numberMap(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
}
export function stringList(value: unknown): string[] { return list(value).filter((entry): entry is string => typeof entry === "string"); }
export function isoDate(value: unknown, fallback = "1970-01-01T00:00:00.000Z"): string {
  const parsed = typeof value === "number" || typeof value === "string" ? new Date(value) : new Date(NaN);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}
export const kgOf = (weight: number, unit: string): number => unit === "lb" ? weight * 0.45359237 : weight;
export const weightOf = (kg: number, unit: string): number => unit === "lb" ? kg / 0.45359237 : kg;
