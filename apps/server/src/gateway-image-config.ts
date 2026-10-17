import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { gatewayImageMetadata, type GatewayImageMetadata } from "./gateway-image-capabilities.js";
import { gatewayNativeModelDefaults, gatewayReasoningMetadata } from "./gateway-model-capabilities.js";

export type GatewayImageConfig = {
  attachment: boolean;
  modalities: { input: string[]; output: string[] };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaults(baseURL: string, id: string, declared: GatewayImageMetadata, previous?: GatewayImageConfig): GatewayImageConfig {
  const capability = gatewayImageMetadata(baseURL, id, declared).image;
  if (capability === undefined && previous) return previous;
  const image = capability === true;
  return { attachment: image, modalities: { input: image ? ["text", "image"] : ["text"], output: ["text"] } };
}

/** The previous releases generated this exact text-only shape for every model.
 * Extra settings or different capability values are explicit configuration. */
function generatedShape(baseURL: string, id: string, model: Record<string, unknown>, image: GatewayImageConfig): boolean {
  if (typeof model.name !== "string" || model.tool_call !== true || model.attachment !== image.attachment
    || !isDeepStrictEqual(model.modalities, image.modalities)) return false;
  const expected: Record<string, unknown> = {
    name: model.name, tool_call: true, ...image,
    ...gatewayNativeModelDefaults(baseURL, id), ...gatewayReasoningMetadata(baseURL, id, {}),
  };
  return Object.entries(model).every(([key, value]) => Object.hasOwn(expected, key) && isDeepStrictEqual(value, expected[key]));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  return record(value) ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, stable(entry)])) : value;
}

/** Bind ownership to the surrounding model config, so switching SDKs or adding
 * explicit settings cannot silently change its retained input capabilities. */
export function gatewayImageModelSignature(model: Record<string, unknown>): string {
  const settings = Object.fromEntries(Object.entries(model).filter(([key]) => !["name", "attachment", "modalities"].includes(key)));
  return createHash("sha256").update(JSON.stringify(stable(settings))).digest("hex");
}

/** Private generated-default snapshots distinguish later local edits from
 * managed capabilities. This is a provider option, never upstream body data. */
export function readGatewayImageDefaults(options: unknown): Record<string, GatewayImageConfig> {
  const snapshot = record(options) ? options.gatewayImageCapabilities : undefined;
  if (!record(snapshot) || snapshot.version !== 1 || !record(snapshot.models) || Object.keys(snapshot.models).length > 5000) return {};
  return Object.fromEntries(Object.entries(snapshot.models).flatMap(([id, value]): Array<[string, GatewayImageConfig]> => {
    if (!record(value) || typeof value.attachment !== "boolean") return [];
    const expected = { attachment: value.attachment,
      modalities: { input: value.attachment ? ["text", "image"] : ["text"], output: ["text"] } };
    return isDeepStrictEqual(value, expected) ? [[id, expected]] : [];
  }));
}

export function readGatewayImageOverrides(options: unknown): Set<string> {
  const snapshot = record(options) ? options.gatewayImageCapabilities : undefined;
  if (!record(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.explicit) || snapshot.explicit.length > 5000) return new Set();
  return new Set(snapshot.explicit.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256));
}

export function readGatewayImageSignatures(options: unknown): Record<string, string> {
  const snapshot = record(options) ? options.gatewayImageCapabilities : undefined;
  if (!record(snapshot) || snapshot.version !== 1 || !record(snapshot.signatures) || Object.keys(snapshot.signatures).length > 5000) return {};
  return Object.fromEntries(Object.entries(snapshot.signatures).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[a-f0-9]{64}$/.test(entry[1])));
}

export function gatewayImageBindingMatches(options: unknown, binding: string): boolean {
  const snapshot = record(options) ? options.gatewayImageCapabilities : undefined;
  // Pre-fix profiles have no provenance. They migrate through the exact legacy
  // shape guard; all newly materialized production profiles write a binding.
  return !record(snapshot) || snapshot.binding === undefined || snapshot.binding === binding;
}

export function resolveGatewayImageConfig(baseURL: string, id: string, declared: GatewayImageMetadata,
  existing?: Record<string, unknown>, previousDefault?: GatewayImageConfig, explicit = false, previousSignature?: string): {
    fields: { attachment: unknown; modalities: unknown };
    owned?: GatewayImageConfig;
  } {
  const next = defaults(baseURL, id, declared, previousDefault);
  const unchanged = !explicit && existing && previousDefault && (previousSignature
    ? gatewayImageModelSignature(existing) === previousSignature : generatedShape(baseURL, id, existing, previousDefault)) && isDeepStrictEqual({
    attachment: existing.attachment, modalities: existing.modalities,
  }, previousDefault);
  if (!existing || unchanged || (!explicit && !previousDefault && generatedShape(baseURL, id, existing,
    { attachment: false, modalities: { input: ["text"], output: ["text"] } }))
    || (existing.attachment === undefined && existing.modalities === undefined)) {
    return { fields: next, owned: next };
  }
  // An explicit local input list or attachment switch wins. Do not repair a
  // customized model by silently replacing its capability declaration.
  return { fields: {
    attachment: existing.attachment !== undefined ? existing.attachment : next.attachment,
    modalities: existing.modalities !== undefined ? existing.modalities : (existing.attachment === false
      ? { input: ["text"], output: ["text"] } : next.modalities),
  } };
}

export function gatewayImageDefaultsOption(models: Record<string, GatewayImageConfig>, explicit: string[], signatures: Record<string, string>, binding?: string) {
  return { version: 1, models, explicit, signatures, ...(binding === undefined ? {} : { binding }) };
}
