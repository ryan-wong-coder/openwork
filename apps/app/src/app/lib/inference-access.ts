import { currentLocale, t } from "@/i18n";
import { z } from "zod";
import type { ModelRef } from "../types";
import { AUTO_MODEL_ID, AUTO_PROVIDER_ID, isAutoModel } from "@/react-app/domains/models/model-catalog";

export const desktopFreeAccessStatusSchema = z.object({
  state: z.enum(["ready", "update_required", "unavailable", "exhausted"]),
  code: z.string().nullable(),
  currentVersion: z.string(),
  minimumVersion: z.string().nullable(),
  providerID: z.string(),
  modelID: z.string(),
  allowance: z.object({ resetsAt: z.string(), limitUsd: z.number().finite().nonnegative(), usedUsd: z.number().finite().nonnegative(), remainingUsd: z.number().finite().nonnegative() }).nullable(),
  defaultPinned: z.boolean().optional(),
  // The desktop server has already verified the version floor for guests; signed-in members have none.
}).refine((status) => status.state !== "ready" || Boolean(status.allowance), "Ready Auto access requires a verified allowance");
export type DesktopFreeAccessStatus = z.infer<typeof desktopFreeAccessStatusSchema>;
export const autoAccessWallSchema = z.object({ state: z.enum(["limit", "update", "unavailable", "sync", "not_offered"]), resetsAt: z.string().optional(), minimumVersion: z.string().optional(), code: z.string().optional(),
  /** The gateway's own words, shown only under Technical details. */
  message: z.string().max(2000).optional() });
export type AutoAccessWall = z.infer<typeof autoAccessWallSchema>;
export function messageAutoAccessWall(metadata: unknown) {
  const parsed = autoAccessWallSchema.safeParse(metadata && typeof metadata === "object" ? Reflect.get(metadata, "autoAccessWall") : null);
  return parsed.success ? parsed.data : null;
}
export type AutoAccessBlock = { outcome: "blocked"; reason: "auto-access"; wall: AutoAccessWall };
export class AutoAccessRejected extends Error {
  constructor(readonly wall: AutoAccessWall) { super("Auto access blocked"); }
}
export const autoAccessRefreshEvent = "openwork.auto-access-refresh";
export const openComposerModelPickerEvent = "openwork-open-composer-model-picker";

export function unavailableDesktopFreeStatus(): DesktopFreeAccessStatus {
  return { state: "unavailable", code: null, currentVersion: "", minimumVersion: null,
    providerID: AUTO_PROVIDER_ID, modelID: AUTO_MODEL_ID, allowance: null };
}

export function autoAccessWall(status: DesktopFreeAccessStatus): AutoAccessWall | null {
  if (status.state === "ready") return null;
  if (autoNotOffered(status)) return { state: "not_offered", code: status.code ?? undefined };
  return { state: status.state === "exhausted" ? "limit" : status.state === "update_required" ? "update" : "unavailable",
    resetsAt: status.allowance?.resetsAt, minimumVersion: status.minimumVersion ?? undefined, code: status.code ?? undefined };
}

/**
 * Free Auto is switched off for the whole service, not merely down. Until an operator turns it on, the app shows no
 * trace of Auto: no picker row, no Settings row, no first-use caption.
 */
export function freeAutoSwitchedOff(status: { code?: string | null } | null | undefined): boolean {
  return status?.code === "free_disabled" || status?.code === "inference_disabled";
}

const NOT_OFFERED_CODES = ["free_not_enrolled", "free_not_offered", "admin_disabled", "not_eligible", "member_free_policy_denied", "managed_models_disabled_for_dpa", "desktop_build_unverified"];
/** Auto is running, but not for this account or organization. The row stays visible and says why. */
export function autoNotOffered(status: { code?: string | null } | null | undefined): boolean {
  return typeof status?.code === "string" && NOT_OFFERED_CODES.includes(status.code);
}
const QUIET_CODES = ["desktop_build_unverified", "desktop_update_required"];
/**
 * Auto is not served to this client, but there is nothing the person can do about it. The picker, footer and
 * first-use caption stay as if Auto were fine; only a send says so, in the chat.
 */
export function autoQuietlyUnavailable(status: { code?: string | null } | null | undefined): boolean {
  return typeof status?.code === "string" && QUIET_CODES.includes(status.code);
}
function notOfferedCopy(code?: string | null) {
  switch (code) {
    case "free_not_enrolled": return { subtitle: t("settings_extra.not_on_for_your_organization_yet"), detail: t("settings_extra.your_organization_hasn_t_turned_on_auto_yet_an_admin_can_turn_it_on_other_models_stil") };
    case "free_not_offered": case "admin_disabled": return { subtitle: t("settings_extra.turned_off_by_your_organization"), detail: t("settings_extra.your_organization_has_turned_off_auto_other_models_still_work") };
    case "managed_models_disabled_for_dpa": return { subtitle: t("settings_extra.not_available_for_your_organization"), detail: t("settings_extra.auto_isn_t_available_under_your_organization_s_data_agreement_other_models_still_work") };
    default: return { subtitle: t("settings_extra.not_available_for_this_account"), detail: t("settings_extra.auto_isn_t_available_for_this_account_other_models_still_work") };
  }
}

/** New tasks cannot inherit a switched-off starter; saved conversation identities stay intact. */
export function modelForNewTask(model: ModelRef | null, status: { code?: string | null } | null | undefined, pending = false): ModelRef | null {
  return model && isAutoModel(model) && (pending || freeAutoSwitchedOff(status) || autoNotOffered(status)) ? null : model;
}

export function autoAccessWallFromError(value: unknown, model?: ModelRef | null, depth = 0): AutoAccessWall | null {
  if ((model && !isAutoModel(model)) || depth > 6 || value == null) return null;
  if (typeof value === "string") {
    if (value.length > 65_536 || !value.trimStart().startsWith("{")) return null;
    try { return autoAccessWallFromError(JSON.parse(value), model, depth + 1); } catch { return null; }
  }
  if (typeof value !== "object") return null;
  const parsed = desktopFreeAccessStatusSchema.safeParse(value);
  if (parsed.success) return autoAccessWall(parsed.data);
  const code = Reflect.get(value, "code");
  const rawMessage = Reflect.get(value, "message");
  const known = typeof code === "string" ? { code, ...(typeof rawMessage === "string" && rawMessage.trim() ? { message: rawMessage.trim().slice(0, 2000) } : {}) } : {};
  if (code === "desktop_update_required") {
    const minimumVersion = Reflect.get(value, "minimumVersion");
    return typeof minimumVersion === "string" && minimumVersion.trim() ? { state: "update", minimumVersion, ...known } : { state: "update", ...known };
  }
  // `anonymous_new_identity_capped` came from gateways that capped new machines per IP; it reads as the free limit.
  if (["anonymous_limit_exceeded", "free_allowance_exhausted", "anonymous_new_identity_capped"].includes(code)) return { state: "limit", ...known };
  if (["anonymous_capacity_exceeded", "anonymous_unavailable", "free_auto_busy"].includes(code)) return { state: "unavailable", ...known };
  // These codes also come from other providers, so they are Auto's only when the send is known to be on Auto.
  if (model && isAutoModel(model)) {
    // Our capacity or an upstream hiccup, including a member key swapped mid-send when an organization's trial or
    // subscription ends (the app fetches a new one on its own): Auto is busy, try again in a bit.
    if (["free_member_unavailable", "free_inference_upstream_error", "free_inference_upstream_unavailable", "request_log_unavailable",
      "managed_models_policy_unavailable", "invalid_api_key"].includes(code)) return { state: "unavailable", ...known };
    // Turned off for this person after the send started: reads as the free limit, like any other switch-off.
    if (["inference_disabled", "free_principal_rejected", "free_disabled"].includes(code)) return { state: "not_offered", ...known };
  }
  if (code === "model_sync_pending") return { state: "sync", ...known };
  if (typeof code === "string" && autoNotOffered({ code })) return { state: "not_offered", ...known };
  for (const key of ["details", "error", "data", "responseBody", "message", "cause"]) {
    const wall = autoAccessWallFromError(Reflect.get(value, key), model, depth + 1);
    if (wall) return wall;
  }
  return null;
}

export async function preflightAutoSubmission(input: {
  model: ModelRef;
  client: { desktopFreePreflight: () => Promise<DesktopFreeAccessStatus> };
  isCurrent: () => boolean;
}): Promise<AutoAccessBlock | { outcome: "cancelled"; reason: "context_changed" } | null> {
  if (input.model.providerID !== AUTO_PROVIDER_ID || !isAutoModel(input.model)) return null;
  if (!input.isCurrent()) return { outcome: "cancelled", reason: "context_changed" };
  const status = await input.client.desktopFreePreflight().catch(() => unavailableDesktopFreeStatus());
  if (!input.isCurrent()) return { outcome: "cancelled", reason: "context_changed" };
  const wall = autoAccessWall(status);
  return wall ? { outcome: "blocked", reason: "auto-access", wall } : null;
}

export type AutoPickerState = "ready" | "exhausted" | "update_required" | "unavailable" | "sync" | "not_offered";
/** "v0.18.51 or newer" when the gateway told us the lowest version it accepts. */
export function autoUpdateTarget(minimumVersion?: string | null) {
  const version = minimumVersion?.trim().replace(/^v/, "");
  return version ? t("settings_extra.openwork_v_version_or_newer", { version }) : "OpenWork";
}
export function autoPickerCopy(state: AutoPickerState, signedIn: boolean, minimumVersion?: string | null, code?: string | null, resetsAt?: string | null) {
  switch (state) {
    case "not_offered": return { ...notOfferedCopy(code), action: null };
    case "exhausted": {
      const back = autoResetPhrase(resetsAt ?? undefined)?.replace(/^on /, "");
      return { subtitle: back ? t("settings_extra.limit_used_up_resets_time", { time: back }) : t("ui.model_limit_used"),
        detail: signedIn ? t("settings_extra.this_week_s_free_limit_is_used_up_pick_another_model_to_keep_going") : t("settings_extra.this_week_s_free_limit_is_used_up_sign_in_for_a_larger_free_limit"),
        action: signedIn ? null : t("den.signin_button") };
    }
    case "update_required": return { subtitle: t("settings_extra.needs_an_openwork_update"), detail: minimumVersion?.trim() ? t("settings_extra.update_to_version_to_keep_using_auto_your_draft_is_kept", { version: autoUpdateTarget(minimumVersion) }) : t("settings_extra.update_openwork_to_keep_using_auto_your_draft_is_kept"), action: t("extensions.update_button") };
    case "unavailable": return { subtitle: t("settings_extra.temporarily_unavailable"), detail: t("settings_extra.auto_is_having_trouble_right_now_other_models_still_work"), action: t("activity.retry") };
    case "sync": return { subtitle: t("settings_extra.finishing_setup"), detail: t("settings_extra.auto_is_almost_ready_reload_the_workspace_if_it_doesn_t_appear"), action: t("interface.reload") };
    case "ready": return { subtitle: t("ui.model_auto_picks"), detail: t("settings_extra.free_access_ready"), action: null };
  }
}

/** "in 3 hours", "in 20 minutes", "on Monday": when a free window ends, from the gateway's resetsAt. */
export function autoResetPhrase(resetsAt: string | undefined, now = Date.now()): string | null {
  const at = resetsAt ? Date.parse(resetsAt) : NaN;
  if (!Number.isFinite(at) || at <= now) return null;
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes < 60) return t("settings_extra.auto_reset_minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("settings_extra.auto_reset_hours", { count: hours });
  return t("settings_extra.on_weekday", { weekday: new Date(at).toLocaleDateString(currentLocale(), { weekday: "long" }) });
}

const NEXT_STEP_KEY = "settings_extra.pick_another_model_to_keep_going";
/** Codes with their own words; anything else that keeps Auto from this person reads as the free limit. */
function limitCopy(wall: AutoAccessWall, signedIn: boolean, now: number) {
  const back = wall.state === "limit" ? autoResetPhrase(wall.resetsAt, now) : null;
  const nextStep = signedIn ? t(NEXT_STEP_KEY) : t("settings_extra.sign_in_for_more_free_use_or_pick_another_model");
  return {
    title: back ? t("settings_extra.you_ve_used_your_free_auto_for_now") : t("settings_extra.you_ve_reached_the_free_auto_limit"),
    detail: back ? t("settings_extra.it_s_back_time_nextstep", { time: back, nextStep }) : nextStep,
  };
}

/**
 * What the chat says when Auto refuses a send. Calm, short, one next step; never "not processed" or anything about
 * builds, versions, budgets or configuration. The gateway's code and message stay under Technical details.
 */
export function autoWallCopy(wall: AutoAccessWall, signedIn: boolean, now = Date.now()) {
  const technicalDetails = [wall.code ? `Code: ${wall.code}` : null, wall.message ? `Message: ${wall.message}` : null,
    wall.resetsAt ? `Resets: ${wall.resetsAt}` : null, wall.minimumVersion ? `Minimum version: ${wall.minimumVersion}` : null]
    .filter(Boolean).join("\n") || null;
  const copy = (() => {
    switch (wall.state) {
      case "unavailable": return { title: t("settings_extra.auto_is_busy_right_now"), detail: t("settings_extra.pick_another_model_to_keep_going_or_try_auto_again_in_a_bit") };
      case "sync": return { title: t("settings_extra.auto_is_still_getting_ready"), detail: t("settings_extra.wait_a_moment_or_pick_another_model_to_keep_going") };
      case "not_offered":
        if (wall.code === "free_not_enrolled") return { title: t("settings_extra.auto_isn_t_on_for_your_organization_yet"), detail: t("settings_extra.an_admin_can_turn_it_on_nextstep", { nextStep: t(NEXT_STEP_KEY) }) };
        if (wall.code === "managed_models_disabled_for_dpa") return { title: t("settings_extra.auto_isn_t_available_for_your_organization"), detail: t(NEXT_STEP_KEY) };
        return limitCopy(wall, signedIn, now);
      case "limit": case "update": return limitCopy(wall, signedIn, now);
    }
  })();
  return { ...copy, technicalDetails };
}

export function openAlternativeModelPicker(sessionId: string) {
  window.dispatchEvent(new CustomEvent(openComposerModelPickerEvent, { detail: { sessionId, focusAlternative: true } }));
}
