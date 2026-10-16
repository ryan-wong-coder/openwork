import { currentLocale, t } from "@/i18n";
import type { DenExternalMcpConnection } from "../../../app/lib/den";

export function recordedConnectorState(connection: DenExternalMcpConnection) {
  if (connection.readiness === undefined) return null;
  if (connection.setupRequired || connection.issuerReviewRequired || (connection.credentialMode === "shared" && !connection.connected)) return t("extensions.row_action_set_up");
  if (connection.needsReconnect || (connection.credentialMode === "per_member" && !connection.connectedForMe)) return t("den.signin_button");
  return connection.readiness?.status === "ready" ? t("connect.diagnostics_connection_ready") : t("settings_extra.couldn_t_verify");
}

export function recordedConnectorNote(connection: DenExternalMcpConnection) {
  if (recordedConnectorState(connection) === t("connect.diagnostics_connection_ready") && connection.readiness) {
    return t("settings_extra.checked_time", { time: new Date(connection.readiness.checkedAt).toLocaleString(currentLocale(), { dateStyle: "short", timeStyle: "short" }) });
  }
  const reason = connection.readiness?.reason ?? t("settings_extra.not_checked_yet");
  const lastReady = connection.readiness?.lastSuccessfulAt;
  return lastReady ? t("settings_extra.reason_last_ready_time", { reason, time: new Date(lastReady).toLocaleString(currentLocale(), { dateStyle: "short", timeStyle: "short" }) }) : reason;
}
