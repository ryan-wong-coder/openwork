/** @jsxImportSource react */
import { t } from "@/i18n";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import {
  buildDenAuthUrl,
  readDenBootstrapConfig,
  setDenBootstrapConfig,
} from "@/app/lib/den";
import { exchangeHandoffAndSignIn } from "@/app/lib/den-handoff";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { markDesktopSignInInitiated } from "@/app/lib/den-sign-in-intent";
import { enterpriseActivationRequired } from "@/app/lib/enterprise-activation";
import { readDesktopDistributionInfo } from "@/app/lib/desktop";
import { parseManualAuthInput } from "@/app/lib/manual-auth-input";
import { normalizeOrganizationServerInput } from "@/app/lib/organization-server-input";
import { DitherBackdrop } from "@/components/dither-backdrop";
import { PageTitlebarRegion } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import { tryOpenBrowserAuthUrl } from "./open-browser-auth";

function subscribeToBootstrap(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(denSettingsChangedEvent, onStoreChange);
  return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
}

type PendingServerConfirmation =
  | { kind: "browser"; baseUrl: string }
  | { kind: "manual"; baseUrl: string; grant: string };

export function useEnterpriseActivationRequired() {
  const bootstrap = useSyncExternalStore(
    subscribeToBootstrap,
    readDenBootstrapConfig,
    readDenBootstrapConfig,
  );
  return enterpriseActivationRequired(readDesktopDistributionInfo(), bootstrap);
}

function EnterpriseActivationPage() {
  const [serverInput, setServerInput] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingServerConfirmation | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const submitServer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // The address field quietly accepts a pasted openwork:// sign-in link as
    // the recovery path when the browser round trip cannot come back.
    const pastedLink = parseManualAuthInput(serverInput);
    if (pastedLink?.baseUrl && pastedLink.grant) {
      const linkBaseUrl = normalizeOrganizationServerInput(pastedLink.baseUrl);
      if (linkBaseUrl) {
        setPendingConfirmation({ kind: "manual", baseUrl: linkBaseUrl, grant: pastedLink.grant });
        setServerError(null);
        setAuthError(null);
        setStatusMessage(t("ui_extra.confirm_server", { server: linkBaseUrl }));
        return;
      }
    }

    const baseUrl = normalizeOrganizationServerInput(serverInput);
    if (!baseUrl) {
      setServerError(t("ui_extra.valid_server_address"));
      return;
    }

    setServerInput(baseUrl);
    setPendingConfirmation({ kind: "browser", baseUrl });
    setServerError(null);
    setAuthError(null);
    setStatusMessage(t("ui_extra.confirm_server", { server: baseUrl }));
  };

  const exchangeConfirmedGrant = async (grant: string, baseUrl: string) => {
    setAuthBusy(true);
    setAuthError(null);
    setServerError(null);
    setStatusMessage(t("ui_extra.enterprise_signin_finishing"));
    try {
      // The confirmed server, session, and activation stamp commit in one
      // handoff transaction, so activation can never leave the bootstrap and
      // the session pointing at different servers.
      const result = await exchangeHandoffAndSignIn(grant, {
        baseUrl,
        desktopInitiated: true,
        fallbackErrorMessage: t("ui_extra.enterprise_session_missing"),
        bootstrap: {
          requireSignin: true,
          enterpriseActivation: {
            activatedAt: new Date().toISOString(),
            denBaseUrl: baseUrl,
          },
        },
      });
      if (!result.ok) {
        setStatusMessage(null);
        setAuthError(result.error);
        return;
      }
    } catch (error) {
      setStatusMessage(null);
      setAuthError(
        error instanceof Error ? error.message : t("ui_extra.enterprise_signin_failed"),
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const confirmServer = async () => {
    const pending = pendingConfirmation;
    if (!pending || browserBusy || authBusy) return;

    setPendingConfirmation(null);
    setServerInput(pending.baseUrl);
    if (pending.kind === "manual") {
      await exchangeConfirmedGrant(pending.grant, pending.baseUrl);
      return;
    }

    setBrowserBusy(true);
    setServerError(null);
    setAuthError(null);
    try {
      await setDenBootstrapConfig({ baseUrl: pending.baseUrl, requireSignin: true });
      markDesktopSignInInitiated();
      const opened = await tryOpenBrowserAuthUrl(buildDenAuthUrl(pending.baseUrl, "sign-in"));
      if (!opened) {
        setStatusMessage(null);
        setAuthError(t("ui_extra.enterprise_browser_failed"));
        return;
      }
      setStatusMessage(t("ui_extra.enterprise_browser_signin"));
    } catch (error) {
      setStatusMessage(null);
      setServerError(
        error instanceof Error ? error.message : t("ui_extra.enterprise_server_save_failed"),
      );
    } finally {
      setBrowserBusy(false);
    }
  };

  // While the origin confirmation is on screen it is the only decision; the
  // redundant "Confirm X before continuing" status would repeat its question.
  const liveMessage = serverError ?? authError ?? (pendingConfirmation ? null : statusMessage);

  return (
    <div
      className="relative min-h-dvh bg-background text-foreground"
      data-state="enterprise-activation"
      data-testid="enterprise-activation-root"
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-[0.1] dark:invert"
        data-testid="enterprise-activation-background"
      >
        <DitherBackdrop />
      </div>

      <PageTitlebarRegion />

      <div
        className="relative z-10 flex min-h-dvh items-center justify-center px-6 py-16"
        data-testid="enterprise-activation-foreground"
      >
        <section
          className="w-full max-w-[720px] rounded-3xl border border-border bg-background px-8 pb-12 pt-10 sm:px-16 sm:pb-16 sm:pt-14"
          data-testid="enterprise-activation-card"
        >
          <div className="flex items-center gap-2.5">
            <img
              src={resolveExtensionIconSrc("/openwork-mark.svg")}
              alt=""
              width={26}
              height={26}
              className="max-h-[26px] shrink-0 object-contain object-left dark:invert"
              aria-hidden="true"
            />
            <span className="text-[15px] font-semibold tracking-tight text-foreground">{t("interface.openwork_enterprise")} </span>
          </div>

          <div className="mt-10 flex flex-col gap-2.5 sm:mt-14">
            <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.03em] text-foreground sm:text-[38px] sm:leading-[46px]">{t("interface.link_this_app_to_your_organization")} </h1>
            <p className="text-[15px] leading-[23px] text-muted-foreground">{t("interface.enter_your_workspace_address_the_page_where_you_downloaded_this_app_sign_in_finishes_in_your_browser")} </p>
          </div>

          <div className="mt-11 flex flex-col gap-4">
            {pendingConfirmation ? null : (
              <form className="space-y-2" onSubmit={submitServer}>
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="organization-server-input"
                >{t("interface.workspace_address")} </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="organization-server-input"
                    data-testid="organization-server-input"
                    value={serverInput}
                    onChange={(event) => setServerInput(event.currentTarget.value)}
                    placeholder={t("interface.openwork_acme_com")}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={browserBusy || authBusy}
                    aria-invalid={serverError ? true : undefined}
                  />
                  <Button
                    type="submit"
                    className="sm:min-w-40"
                    disabled={browserBusy || authBusy}
                    data-testid="organization-server-continue"
                  >{t("extensions.mcp_check_continue")} </Button>
                </div>
              </form>
            )}

            {pendingConfirmation ? (
              <section className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-sm leading-6 text-foreground">{t("interface.connect_this_app_to")} <strong className="break-all font-semibold">{pendingConfirmation.baseUrl}</strong>{t("interface.this_signs_you_in_with_that_organization_and_binds_openwork_enterprise_to_it")} </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPendingConfirmation(null);
                      setStatusMessage(null);
                    }}
                    disabled={browserBusy || authBusy}
                  >{t("dashboard.modal_back")} </Button>
                  <Button
                    type="button"
                    onClick={() => void confirmServer()}
                    disabled={browserBusy || authBusy}
                    data-testid="organization-server-confirm"
                  >
                    {pendingConfirmation.kind === "browser"
                      ? t("interface.continue_in_browser")
                      : t("interface.confirm_and_finish_sign_in")}
                  </Button>
                </div>
              </section>
            ) : null}

            <div className="min-h-5 text-xs leading-5" aria-live="polite" role="status">
              {liveMessage ? (
                <span className={serverError || authError ? "text-destructive" : "text-muted-foreground"}>
                  {liveMessage}
                </span>
              ) : null}
            </div>

          </div>
        </section>
      </div>
    </div>
  );
}

export function EnterpriseActivationGate({ children }: { children: ReactNode }) {
  return useEnterpriseActivationRequired()
    ? <EnterpriseActivationPage />
    : children;
}
