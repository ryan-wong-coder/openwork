/** @jsxImportSource react */
import { t } from "@/i18n";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/app/lib/desktop";
import type {
  DesktopIntegrationResult,
  DesktopIntegrationStatus,
} from "@/app/lib/desktop-types";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
} from "./settings-layout";

function statusDescription(status: DesktopIntegrationStatus) {
  if (status.state === "integrated") {
    return t("settings_extra.openwork_is_in_your_application_launcher_and_handles_openwork_browser_callbacks");
  }
  if (status.state === "managed_externally") {
    return t("settings_extra.this_appimage_is_integrated_by_another_app_openwork_will_leave_its_launcher_untouched");
  }
  if (status.state === "needs_repair" && status.ownership === "external") {
    return status.issues.includes("desktop-entry")
      ? t("settings_extra.the_manager_owned_launcher_cannot_accept_browser_callbacks_re_integrate_this_appimage")
      : t("settings_extra.another_app_manages_this_appimage_select_its_launcher_for_openwork_browser_callbacks");
  }
  if (status.state === "needs_repair") {
    return t("settings_extra.the_appimage_moved_or_its_launcher_icon_or_browser_callback_needs_repair");
  }
  return t("settings_extra.add_this_appimage_to_your_application_launcher_and_enable_browser_sign_in_callbacks");
}

function statusLabel(status: DesktopIntegrationStatus) {
  if (status.state === "integrated") return t("settings_extra.integrated");
  if (status.state === "managed_externally") return t("settings_extra.managed_by_another_app");
  if (status.state === "needs_repair") return t("settings_extra.needs_repair");
  return t("settings_extra.not_integrated");
}

export function DesktopIntegrationSection() {
  const [status, setStatus] = useState<DesktopIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStatus(await desktopBridge.desktopIntegrationStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (action: () => Promise<DesktopIntegrationResult>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setStatus(result.status);
      if (!result.ok) setError(result.error ?? t("settings_extra.desktop_integration_failed"));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!status?.supported) return null;

  const externallyManaged = status.ownership === "external";
  const openworkManaged = status.ownership === "openwork";

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("interface.appimage_desktop_integration")}</LayoutSectionTitle>
        <LayoutSectionDescription>{t("interface.control_the_launcher_icon_and_openwork_callback_for_this_appimage")} </LayoutSectionDescription>
      </LayoutSectionHeader>

      <LayoutSectionItem>
        <LayoutSectionItemHeader>
          <LayoutSectionItemTitle>{statusLabel(status)}</LayoutSectionItemTitle>
          <LayoutSectionItemDescription>{statusDescription(status)}</LayoutSectionItemDescription>
          <LayoutSectionItemHeaderActions>
            {status.ownership === "none" ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run(() => desktopBridge.desktopIntegrationInstall())}
              >{t("interface.integrate")} </Button>
            ) : null}
            {openworkManaged ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => desktopBridge.desktopIntegrationInstall())}
                >{t("interface.repair")} </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => desktopBridge.desktopIntegrationRemove())}
                >{t("skills.uninstall")} </Button>
              </>
            ) : null}
            {externallyManaged && status.state === "needs_repair" ? (
              <Button
                size="sm"
                disabled={busy || status.issues.includes("desktop-entry")}
                onClick={() => void run(() => (
                  desktopBridge.desktopIntegrationInstall({ useExternalLauncher: true })
                ))}
              >{t("interface.use_manager_launcher")} </Button>
            ) : null}
            {externallyManaged ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{t("interface.recheck")} </Button>
            ) : null}
          </LayoutSectionItemHeaderActions>
        </LayoutSectionItemHeader>
        <p className="break-all text-xs text-muted-foreground">{status.appImagePath}</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </LayoutSectionItem>
    </LayoutSection>
  );
}
