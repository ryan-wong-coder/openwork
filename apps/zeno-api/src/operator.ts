import { readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync, lstatSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveFeature, type FeatureKey, type FeatureOverrides } from "@openwork/features";

export const operatorKeySchema = z.enum(["zenoAccounts", "personalCalendar", "fitnessTracking", "localScheduledTasks"]);
export type OperatorKey = z.infer<typeof operatorKeySchema>;
export const operatorUpdateSchema = z.object({ key: operatorKeySchema, enabled: z.boolean() }).strict();
export const operatorProfileSchema = z.object({ features: z.object({ zenoAccounts: z.boolean().optional(), personalCalendar: z.boolean().optional(), fitnessTracking: z.boolean().optional(), localScheduledTasks: z.boolean().optional() }).strict() }).strict();
export function readOperatorProfile(path: string): FeatureOverrides {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return {};
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error("Invalid operator profile file");
  return operatorProfileSchema.parse(JSON.parse(readFileSync(path, "utf8"))).features;
}
export function operatorFeatureEnabled(key: FeatureKey, locks: FeatureOverrides): boolean {
  return resolveFeature(key, { deployment: "self_hosted", locks, overrides: {}, rollouts: {} }).enabled;
}
export function createOperatorResolver(path: string): (key: FeatureKey) => boolean {
  return key => {
    try { return operatorFeatureEnabled(key, readOperatorProfile(path)); }
    catch { return false; } // An invalid profile closes the feature without exposing file contents.
  };
}
export function setOperatorFeature(path: string, keyInput: string, enabledInput: string) {
  const key = operatorKeySchema.parse(keyInput); const enabled = z.enum(["true", "false"]).parse(enabledInput) === "true";
  const current = readOperatorProfile(path);
  const next = operatorProfileSchema.parse({ features: { ...current, [key]: enabled } });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path); chmodSync(path, 0o600);
  return { feature: key, enabled };
}
