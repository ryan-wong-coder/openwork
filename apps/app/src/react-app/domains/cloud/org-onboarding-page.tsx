/** @jsxImportSource react */
import { t } from "@/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  ArrowUpRightIcon,
  Check,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";
import {
  BuildingOffice2Icon,
  CloudIcon,
  Square3Stack3DIcon,
} from "@heroicons/react/24/solid";

import {
  createDenClient,
  readDenBootstrapConfig,
  readDenSettings,
  resolveDenBaseUrls,
  setDenBootstrapConfig,
  writeDenSettings,
  type DenDesktopConfig,
  type DenOrgLlmProvider,
  type DenOrgMarketplace,
  type DenOrgSummary,
} from "@/app/lib/den";
import { applyBrandAppName, applyBrandIcon, relaunchDesktopApp } from "@/app/lib/desktop";
import {
  isAlphaChannelAllowedByDesktopConfig,
  isAlphaUpdateAllowed,
  resolveFreshStableDesktopUpdate,
} from "@/app/lib/version-gate";
import {
  DEN_HANDOFF_AUTO_CONTINUE_KEY,
  exchangeHandoffAndSignIn,
} from "@/app/lib/den-handoff";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { parseManualAuthInput } from "@/app/lib/manual-auth-input";
import { clearOrgSelectionPending, readOrgSelectionPending } from "@/app/lib/den-sign-in-intent";
import { usePlatform } from "../../kernel/platform";
import { useBootState } from "../../shell/boot-state";
import { resolveModelDisplayName, resolveProviderDisplayName } from "@/app/utils";
import { ProviderIcon } from "../../design-system/provider-icon";
import { writeStoredDefaultModel } from "../../kernel/model-config";
import { orgOnboardingVisibilityEvent } from "../../shell/reload-coordinator";
import {
  Page,
  PageBackground,
  PageContainer,
  PageContent,
  PageDescription,
  PageFooter,
  PageHeader,
  PageLoading,
  PageLoadingDescription,
  PageLoadingSpinner,
  PageTitle,
  PageTitlebarRegion,
} from "@/components/page";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import { useOrgListWindow } from "./use-org-list-window";
import { useDesktopConfig } from "./desktop-config-provider";
import {
  hasWorkspaceBranding,
  workspaceBrandingFingerprint,
} from "./workspace-branding-restart";

const RELOAD_AFTER_ONBOARDING_KEY = "openwork.reloadAfterOrgOnboarding";
const APPLIED_BRANDING_FINGERPRINT_KEY = "openwork.den.appliedBrandingFingerprint";
const BRANDING_RESTART_RESUME_KEY = "openwork.den.brandingRestartResume";

type BrandingRestartState = {
  fingerprint: string;
  updateReady: boolean;
  warning: string | null;
};

type OnboardingUpdaterBridge = NonNullable<Window["__OPENWORK_ELECTRON__"]>["updater"];

declare global {
  interface Window {
    __openworkOnboardingUpdaterEvalBridge?: OnboardingUpdaterBridge;
  }
}

function onboardingUpdaterBridge(): OnboardingUpdaterBridge | undefined {
  if (import.meta.env.DEV && window.__openworkOnboardingUpdaterEvalBridge) {
    return window.__openworkOnboardingUpdaterEvalBridge;
  }
  return window.__OPENWORK_ELECTRON__?.updater;
}

async function stageOnboardingUpdate(
  desktopConfig: DenDesktopConfig,
): Promise<boolean> {
  const updater = onboardingUpdaterBridge();
  if (!updater?.getChannel || !updater.check || !updater.download) return false;

  const channelState = await updater.getChannel();
  if (
    channelState.channel === "alpha" &&
    !isAlphaChannelAllowedByDesktopConfig(desktopConfig)
  ) {
    await updater.setChannel?.("stable");
    return false;
  }
  let targetVersion: string | undefined;
  if (channelState.channel === "stable") {
    const selection = await resolveFreshStableDesktopUpdate({
      currentVersion: channelState.currentVersion,
      refreshDesktopConfig: async () => desktopConfig,
    });
    if (selection?.kind !== "update") return false;
    targetVersion = selection.targetVersion;
  }

  const update = await updater.check(channelState.channel, targetVersion);
  if (!update.available || update.reason) return false;
  if (
    channelState.channel === "alpha" &&
    update.latestVersion &&
    !(await isAlphaUpdateAllowed(
      update.latestVersion,
      desktopConfig,
      channelState.currentVersion,
    ))
  ) {
    return false;
  }

  const download = await updater.download();
  return download.ok;
}

function subscribeToDenSettings(onStoreChange: () => void) {
  window.addEventListener(denSettingsChangedEvent, onStoreChange);
  return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
}

function readDenSettingsSnapshot() {
  const settings = readDenSettings();
  return JSON.stringify({
    baseUrl: settings.baseUrl,
    authToken: settings.authToken ?? "",
    activeOrgId: settings.activeOrgId ?? "",
    activeOrgName: settings.activeOrgName ?? "",
  });
}

function useDenClient() {
  const settingsSnapshot = useSyncExternalStore(
    subscribeToDenSettings,
    readDenSettingsSnapshot,
    readDenSettingsSnapshot,
  );
  const settings = useMemo(() => readDenSettings(), [settingsSnapshot]);
  const authToken = settings.authToken ?? "";
  const denClient = useMemo(
    () =>
      createDenClient({
        baseUrl: settings.baseUrl,
        token: settings.authToken,
      }),
    [authToken, settings.baseUrl],
  );

  return {
    authToken,
    denClient,
    orgId: settings.activeOrgId ?? "",
    orgName: settings.activeOrgName ?? "",
    settings,
  };
}

/**
 * When an agent-first install prepared this desktop, read the non-secret
 * prepared summary so the onboarding payoff can greet the
 * user with "Setup complete" instead of a generic resource list.
 */
type PreparedBootstrapSummary = {
  orgName: string;
  skillTitle: string;
  claimLinks: Array<{ id: string; role: string; url: string; expiresAt: string }>;
};

function usePreparedBootstrap() {
  const bootstrap = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener(denSettingsChangedEvent, onStoreChange);
      return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
    },
    readDenBootstrapConfig,
    readDenBootstrapConfig,
  );

  return useMemo<PreparedBootstrapSummary | null>(() => {
    if (!bootstrap.prepared?.skillTitle) return null;
    return {
      orgName: bootstrap.prepared.orgName || t("ui_extra.your_workspace"),
      skillTitle: bootstrap.prepared.skillTitle,
      claimLinks: bootstrap.claimLinks ?? [],
    };
  }, [bootstrap]);
}

function PreparedWorkspacePage({ prepared }: { prepared: PreparedBootstrapSummary }) {
  const platform = usePlatform();
  const navigate = useNavigate();
  const ownerClaim = prepared.claimLinks.find((link) => link.role === "owner") ?? null;
  const [showSignInCode, setShowSignInCode] = useState(false);
  const [signInCode, setSignInCode] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const submitSignInCode = useCallback(async () => {
    // The claim page hands over a full `openwork://den-auth?grant=…` link;
    // accept that as well as a bare code, like the main sign-in page does.
    const parsed = parseManualAuthInput(signInCode);
    if (!parsed || signInBusy) {
      if (!parsed) setSignInError(t("ui_extra.valid_signin_code"));
      return;
    }

    const settings = readDenSettings();
    setSignInBusy(true);
    setSignInError(null);

    try {
      const result = await exchangeHandoffAndSignIn(parsed.grant, {
        baseUrl: settings.baseUrl,
        // A pasted one-time code is a desktop-initiated sign-in.
        desktopInitiated: true,
      });
      if (!result.ok) setSignInError(result.error);
    } finally {
      setSignInBusy(false);
    }
  }, [signInBusy, signInCode]);

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <div
            data-openwork-prepared="true"
            data-openwork-provisional="true"
            className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11"
          >
            <CheckCircle2 className="size-3.5" />{t("interface.setup_complete_openwork_is_ready")} </div>
          <PageTitle>{prepared.orgName}</PageTitle>
        </PageHeader>

        <PageContent>
          <div className="mx-auto grid w-full max-w-md gap-3">
            <div
              data-openwork-prepared-skill="true"
              className="flex min-h-10 items-center justify-between gap-3 border-y border-dls-border py-2 text-sm"
            >
              <span className="text-muted-foreground">{t("interface.first_skill_ready")}</span>
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                <Check className="size-4 shrink-0 text-green-11" />
                <span className="truncate">{prepared.skillTitle}</span>
              </span>
            </div>
          </div>
        </PageContent>

        {ownerClaim ? (
          <PageContent>
            <div className="mx-auto grid w-full max-w-md gap-3">
              <Button
                type="button"
                onClick={() => platform.openLink(ownerClaim.url)}
                className="w-full sm:w-auto"
              >{t("interface.claim_workspace_and_continue")} <ArrowUpRightIcon data-icon="inline-end" />
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowSignInCode((visible) => !visible);
                  setSignInError(null);
                }}
              >
                {showSignInCode ? t("den.hide_signin_code") : t("den.paste_signin_code")}
              </Button>

              {showSignInCode ? (
                <div className="grid gap-3 rounded-2xl border border-dls-border bg-dls-surface p-4">
                  <Input
                    aria-label={t("interface.one_time_sign_in_code")}
                    value={signInCode}
                    onChange={(event) => setSignInCode(event.currentTarget.value)}
                    placeholder={t("interface.paste_the_code_from_your_browser")}
                    disabled={signInBusy}
                  />
                  <Button
                    type="button"
                    onClick={() => void submitSignInCode()}
                    disabled={signInBusy || !signInCode.trim()}
                  >
                    {signInBusy ? t("interface.signing_in") : t("interface.sign_in_to_this_workspace")}
                  </Button>
                </div>
              ) : null}

              {signInError ? (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{signInError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </PageContent>
        ) : null}

        <PageFooter>
          <Button
            type="button"
            variant="link"
            className="mx-auto"
            onClick={() => navigate("/signin")}
          >{t("interface.sign_in_with_an_existing_account")} </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

function markProvidersSeen(providers: ReadonlyArray<{ id: string }>) {
  if (providers.length === 0) return;

  try {
    const raw = window.localStorage.getItem("openwork.seenProviderIds");
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const ids = new Set(existing);
    for (const provider of providers) ids.add(provider.id);
    window.localStorage.setItem("openwork.seenProviderIds", JSON.stringify([...ids]));
  } catch {}
}

type OrgOnboardingInitialSelectionState = {
  hasSelectedOrganization: boolean;
  autoContinueResources: boolean;
};

export function initialOrgOnboardingSelectionState(): OrgOnboardingInitialSelectionState {
  return {
    hasSelectedOrganization: false,
    autoContinueResources: false,
  };
}

type OrgOnboardingPostListStep =
  | { kind: "auto-select-single-org"; organization: DenOrgSummary }
  | { kind: "choose-org"; defaultOrganization: DenOrgSummary }
  | { kind: "resources"; autoContinue: boolean };

export function resolveOrgOnboardingPostListStep({
  orgs,
  activeOrgId,
  hasSelectedOrganization,
  autoContinueResources,
  autoSelectFailedOrgId,
}: {
  orgs: DenOrgSummary[];
  activeOrgId: string;
  hasSelectedOrganization: boolean;
  autoContinueResources: boolean;
  autoSelectFailedOrgId: string | null;
}): OrgOnboardingPostListStep {
  const singleOrg = orgs.length === 1 ? orgs[0] : null;

  if (orgs.length > 0 && !hasSelectedOrganization) {
    if (singleOrg && autoSelectFailedOrgId !== singleOrg.id) {
      return { kind: "auto-select-single-org", organization: singleOrg };
    }

    return {
      kind: "choose-org",
      defaultOrganization: orgs.find((org) => org.id === activeOrgId) ?? orgs[0],
    };
  }

  return {
    kind: "resources",
    autoContinue: autoContinueResources || orgs.length <= 1,
  };
}

/**
 * Full-screen onboarding page shown after sign-in + org selection.
 * Fetches all org resources (providers, marketplaces, skills)
 * and shows them so the user knows what their org provides.
 *
 * Route: /onboarding
 */
export function OrgOnboardingPage() {
  const navigate = useNavigate();
  const { authToken, denClient, orgId, settings } = useDenClient();
  const { markRouteReady } = useBootState();
  const prepared = usePreparedBootstrap();
  const initialSelectionState = initialOrgOnboardingSelectionState();
  const [hasSelectedOrganization, setHasSelectedOrganization] = useState(
    initialSelectionState.hasSelectedOrganization,
  );
  const [autoContinueResources, setAutoContinueResources] = useState(
    initialSelectionState.autoContinueResources,
  );
  const [autoSelectFailedOrgId, setAutoSelectFailedOrgId] = useState<string | null>(null);
  const autoSelectingOrgIdRef = useRef<string | null>(null);
  // A desktop-initiated sign-in parks the exchange-reported org here instead
  // of committing it; the chooser pre-highlights it as its default.
  const [suggestedOrgId] = useState(() => readOrgSelectionPending().suggestion?.id ?? "");

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(orgOnboardingVisibilityEvent, { detail: { visible: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent(orgOnboardingVisibilityEvent, { detail: { visible: false } }));
    };
  }, []);

  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken && !prepared) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, prepared]);

  useEffect(() => {
    if (authToken && orgId && prepared) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, orgId, prepared]);

  useEffect(() => {
    if (!authToken || !orgId) return;
    if (window.localStorage.getItem(BRANDING_RESTART_RESUME_KEY) !== orgId) return;
    window.localStorage.removeItem(BRANDING_RESTART_RESUME_KEY);
    navigate("/session", { replace: true });
  }, [authToken, navigate, orgId]);

  const { data, error, isPending } = useQuery({
    queryKey: ["den-org-onboarding", settings.baseUrl, "orgs"],
    enabled: Boolean(authToken),
    queryFn: () => denClient.listOrgs(),
  });
  const orgs = data?.orgs ?? [];
  const postListStep = resolveOrgOnboardingPostListStep({
    orgs,
    activeOrgId: orgId || suggestedOrgId,
    hasSelectedOrganization,
    autoContinueResources,
    autoSelectFailedOrgId,
  });
  const autoSelectOrg = postListStep.kind === "auto-select-single-org"
    ? postListStep.organization
    : null;

  useEffect(() => {
    if (!authToken || !autoSelectOrg) return;
    if (autoSelectingOrgIdRef.current === autoSelectOrg.id) return;

    let cancelled = false;
    autoSelectingOrgIdRef.current = autoSelectOrg.id;
    void denClient
      .setActiveOrganization({ organizationId: autoSelectOrg.id })
      .then(() => {
        if (cancelled) return;
        clearOrgSelectionPending();
        writeDenSettings({
          ...settings,
          authToken: authToken || null,
          activeOrgId: autoSelectOrg.id,
          activeOrgSlug: autoSelectOrg.slug,
          activeOrgName: autoSelectOrg.name,
        });
        setAutoContinueResources(true);
        setHasSelectedOrganization(true);
      })
      .catch(() => {
        if (!cancelled) setAutoSelectFailedOrgId(autoSelectOrg.id);
      })
      .finally(() => {
        if (autoSelectingOrgIdRef.current === autoSelectOrg.id) {
          autoSelectingOrgIdRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, autoSelectOrg, denClient, settings]);

  if (!authToken) {
    return prepared ? <PreparedWorkspacePage prepared={prepared} /> : null;
  }

  if (isPending) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("interface.your_organization")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("interface.loading_organizations")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("interface.choose_your_organization")}</PageTitle>
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error ? error.message : t("interface.unable_to_load_organizations")}
              </AlertDescription>
            </Alert>
          </PageHeader>
        </PageContainer>
      </Page>
    );
  }

  if (postListStep.kind === "auto-select-single-org") {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("interface.your_organization")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("interface.loading_organizations")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  if (postListStep.kind === "choose-org") {
    return (
      <OrganizationSelectionPage
        orgs={orgs}
        defaultOrganization={postListStep.defaultOrganization}
        onContinue={() => {
          setAutoContinueResources(false);
          setHasSelectedOrganization(true);
        }}
      />
    );
  }

  return (
    <ResourceSelectionPage
      autoContinue={postListStep.autoContinue}
    />
  );
}

export function ResourceSelectionPage({ autoContinue = false }: { autoContinue?: boolean }) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const { markRouteReady } = useBootState();
  const { authToken, denClient, orgId, orgName, settings } = useDenClient();
  const { refreshFresh } = useDesktopConfig();

  const prepared = usePreparedBootstrap();

  const [selectedDefault, setSelectedDefault] = useState<{
    providerId: string;
    modelId: string;
    label: string;
  } | null>(null);
  const [preparingBranding, setPreparingBranding] = useState(false);
  const [brandingRestart, setBrandingRestart] = useState<BrandingRestartState | null>(null);
  const autoContinueAttemptedRef = useRef(false);

  // Redirect if no auth or no org — can't show onboarding without them
  useEffect(() => {
    markRouteReady();
  }, [markRouteReady]);

  useEffect(() => {
    if (!authToken || !orgId) {
      navigate("/session", { replace: true });
    }
  }, [authToken, navigate, orgId]);

  const { providers, gatewayProviders, marketplaces, loading, error } = useQueries({
    queries: [
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "providers"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgLlmProviders(orgId),
      },
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "gateway-providers"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgGatewayProviders(orgId),
      },
      {
        queryKey: ["den-org-onboarding", settings.baseUrl, orgId, "marketplaces"],
        enabled: Boolean(authToken && orgId),
        queryFn: () => denClient.listOrgMarketplaces(orgId),
      },
    ],
    combine: ([providersQuery, gatewayProvidersQuery, marketplacesQuery]) => ({
      providers: providersQuery.data ?? [],
      gatewayProviders: gatewayProvidersQuery.data ?? [],
      marketplaces: marketplacesQuery.data ?? [],
      loading: providersQuery.isPending || gatewayProvidersQuery.isPending || marketplacesQuery.isPending,
      error: providersQuery.error?.message ?? gatewayProvidersQuery.error?.message ?? marketplacesQuery.error?.message ?? null,
    }),
  });

  const finishOnboarding = useCallback((optionsArg?: { requestReload?: boolean }) => {
    // If user picked a default model, write it
    if (selectedDefault) {
      writeStoredDefaultModel({
        providerID: selectedDefault.providerId,
        modelID: selectedDefault.modelId,
      });
    }
    // Mark all providers shown on this page as "seen" so the global
    // toast doesn't re-fire for them on the next sync interval.
    markProvidersSeen([...providers, ...gatewayProviders]);
    try {
      window.sessionStorage.removeItem(DEN_HANDOFF_AUTO_CONTINUE_KEY);
    } catch {}
    if ((providers.length > 0 || gatewayProviders.length > 0) && optionsArg?.requestReload !== false) {
      try {
        window.localStorage.setItem(RELOAD_AFTER_ONBOARDING_KEY, "1");
      } catch {}
    }
    navigate("/session", { replace: true });
  }, [gatewayProviders, navigate, providers, selectedDefault]);

  const handleContinue = useCallback(async (optionsArg?: { requestReload?: boolean }) => {
    if (!window.__OPENWORK_ELECTRON__?.shell?.relaunch) {
      finishOnboarding({ requestReload: optionsArg?.requestReload });
      return;
    }

    setPreparingBranding(true);
    try {
      const desktopConfig = await refreshFresh();
      if (!hasWorkspaceBranding(desktopConfig)) {
        finishOnboarding({ requestReload: optionsArg?.requestReload });
        return;
      }

      const fingerprint = workspaceBrandingFingerprint(orgId, desktopConfig);
      if (window.localStorage.getItem(APPLIED_BRANDING_FINGERPRINT_KEY) === fingerprint) {
        finishOnboarding({ requestReload: optionsArg?.requestReload });
        return;
      }

      const bootstrap = readDenBootstrapConfig();
      await setDenBootstrapConfig({
        ...bootstrap,
        brandAppName: desktopConfig.brandAppName ?? null,
        brandLogoUrl: desktopConfig.brandLogoUrl ?? null,
        brandIconUrl: desktopConfig.brandIconUrl ?? null,
      });
      const [, iconResult] = await Promise.all([
        applyBrandAppName(desktopConfig.brandAppName ?? null),
        applyBrandIcon(desktopConfig.brandIconUrl ?? null),
      ]);

      let updateReady = false;
      let warning = desktopConfig.brandIconUrl && !iconResult.ok
        ? t("ui_extra.workspace_icon_prepare_failed")
        : null;
      try {
        updateReady = await stageOnboardingUpdate(desktopConfig);
      } catch (error) {
        warning ??= error instanceof Error ? error.message : t("ui_extra.app_update_prepare_failed");
      }
      setBrandingRestart({ fingerprint, updateReady, warning });
    } catch (error) {
      setBrandingRestart({
        fingerprint: workspaceBrandingFingerprint(orgId, {}),
        updateReady: false,
        warning: error instanceof Error ? error.message : t("ui_extra.workspace_brand_prepare_failed"),
      });
    } finally {
      setPreparingBranding(false);
    }
  }, [finishOnboarding, orgId, refreshFresh]);

  useEffect(() => {
    if (!autoContinue || autoContinueAttemptedRef.current) return;
    if (loading || error || preparingBranding || brandingRestart) return;

    autoContinueAttemptedRef.current = true;
    void handleContinue({ requestReload: false });
  }, [autoContinue, brandingRestart, error, handleContinue, loading, preparingBranding]);

  const restartWithBranding = useCallback(async () => {
    if (!brandingRestart) return;
    window.localStorage.setItem(APPLIED_BRANDING_FINGERPRINT_KEY, brandingRestart.fingerprint);
    window.localStorage.setItem(BRANDING_RESTART_RESUME_KEY, orgId);
    if (brandingRestart.updateReady) {
      const result = await onboardingUpdaterBridge()?.installAndRestart?.();
      if (result?.ok) return;
    }
    await relaunchDesktopApp();
  }, [brandingRestart, orgId]);

  const continueWithoutRestart = useCallback(() => {
    if (brandingRestart) {
      window.localStorage.setItem(APPLIED_BRANDING_FINGERPRINT_KEY, brandingRestart.fingerprint);
    }
    finishOnboarding();
  }, [brandingRestart, finishOnboarding]);

  const openworkProviders = providers.filter((provider) => provider.source === "openwork");
  const legacyProviders = providers.filter((provider) => provider.source !== "openwork");
  const totalModels = legacyProviders.reduce((sum, provider) => sum + provider.models.length, 0);
  const hasResources = providers.length > 0 || gatewayProviders.length > 0 || marketplaces.length > 0;
  const autoContinuePending =
    autoContinue && !loading && !error && !brandingRestart;

  if (preparingBranding) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("interface.preparing_workspace_identity")}</PageTitle>
            <PageDescription>{t("interface.applying")} {orgName || t("interface.your_workspace")}{t("interface.apos_s_branding_and_checking_for_an_application_update")} </PageDescription>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("interface.preparing_workspace")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  if (brandingRestart) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{t("interface.workspace_identity_is_ready")}</PageTitle>
            <PageDescription>{t("interface.restart_openwork_once_to_finish_applying")} {orgName || t("interface.your_workspace")}{t("interface.apos_s_name_and_app_icon_everywhere")} </PageDescription>
            {brandingRestart.updateReady ? (
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11">
                <CheckCircle2 className="size-3.5" />{t("interface.application_update_downloaded")} </div>
            ) : null}
            {brandingRestart.warning ? (
              <Alert>
                <CircleAlert />
                <AlertDescription>
                  {brandingRestart.warning}{t("interface.you_can_still_continue_to_the_workspace")} </AlertDescription>
              </Alert>
            ) : null}
          </PageHeader>
          <PageContent>
            <details className="mx-auto w-full max-w-md rounded-xl border border-dls-border bg-dls-surface px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium">{t("interface.why_restart")}</summary>
              <p className="mt-2 text-muted-foreground">{t("interface.restarting_refreshes_the_workspace_name_and_icon_across_your_operating_system_and_installs_the_prepa")} </p>
            </details>
          </PageContent>
          <PageFooter>
            <Button type="button" variant="outline" onClick={continueWithoutRestart}>{t("interface.continue_without_restarting")} </Button>
            <Button type="button" size="lg" onClick={() => void restartWithBranding()}>{t("interface.restart_openwork")} <ArrowRight data-icon="inline-end" />
            </Button>
          </PageFooter>
        </PageContainer>
      </Page>
    );
  }

  if (autoContinuePending) {
    return (
      <Page>
        <PageBackground />
        <PageTitlebarRegion />
        <PageContainer>
          <PageHeader>
            <PageTitle>{orgName || t("interface.your_organization")}</PageTitle>
          </PageHeader>
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("interface.loading_available_resources")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        </PageContainer>
      </Page>
    );
  }

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />

      <PageContainer>
        {/* Header */}
        <PageHeader>
          {prepared ? (
            <div
              data-openwork-prepared="true"
              className="mx-auto flex w-fit items-center gap-2 rounded-full border border-green-6/30 bg-green-2/30 px-3 py-1 text-xs font-semibold text-green-11"
            >
              <CheckCircle2 className="size-3.5" />{t("interface.setup_complete_openwork_prepared_this_workspace")} </div>
          ) : null}
          <PageTitle>
            {orgName || t("interface.your_organization")}
          </PageTitle>
          {loading ? (
            null
          ) : error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : hasResources ? (
            <PageDescription>{t("interface.you_have_access_to_the_following_resources")} </PageDescription>
          ) : null}
        </PageHeader>

        {loading ? (
          <PageContent>
            <PageLoading>
              <PageLoadingSpinner />
              <PageLoadingDescription>{t("interface.loading_available_resources")}</PageLoadingDescription>
            </PageLoading>
          </PageContent>
        ) : error && !hasResources ? null : !hasResources ? (
          <PageContent>
            <Empty className="h-fit flex-none">
              <EmptyHeader>
                <EmptyTitle>{t("interface.no_resources_have_been_configured_for_this_organization_yet")}</EmptyTitle>
                <EmptyDescription>{t("interface.add_ai_providers_or_marketplaces_from_the_openwork_cloud_dashboard")} </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => platform.openLink(resolveDenBaseUrls(settings.baseUrl).baseUrl)}
                >{t("interface.open_openwork_cloud")} <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </EmptyContent>
            </Empty>
          </PageContent>
        ) : (
          <PageContent>
            <ScrollArea className="px-2.5">
              <ScrollAreaViewport>
                <Accordion
                  multiple
                  className="rounded-2xl border border-border bg-transparent shadow-none before:hidden"
                >
                  {openworkProviders.length > 0 ? (
                    <Section
                      icon={<CloudIcon className="size-5 text-foreground/60" />}
                      title={t("interface.openwork_models")}
                      description={t("interface.managed_models_available_through_your_organization")}
                    >
                      {openworkProviders.map((provider) => (
                        <ProviderAccessCard key={provider.id} provider={provider} />
                      ))}
                    </Section>
                  ) : null}

                  {gatewayProviders.length > 0 ? (
                    <Section
                      icon={<CloudIcon className="size-5 text-foreground/60" />}
                      title={t("interface.ai_gateway")}
                      description={t("interface.ai_providers_you_have_access_to_through_your_organization")}
                      count={`${gatewayProviders.length} AI provider${gatewayProviders.length === 1 ? "" : "s"}`}
                    >
                      {gatewayProviders.map((provider) => (
                        <ProviderAccessCard key={provider.id} provider={provider} />
                      ))}
                    </Section>
                  ) : null}

                  {legacyProviders.length > 0 ? (
                    <Section
                      icon={<CloudIcon className="size-5 text-foreground/60" />}
                      title={t("interface.ai_providers")}
                      description={t("interface.models_you_can_use_in_your_workspace")}
                      count={`${totalModels} model${totalModels === 1 ? "" : "s"}`}
                    >
                      {legacyProviders.map((provider) => (
                        <ProviderCard
                          key={provider.id}
                          provider={provider}
                          selectedDefault={selectedDefault}
                          onSelectDefault={setSelectedDefault}
                        />
                      ))}
                    </Section>
                  ) : null}

                  {/* Marketplaces */}
                  {marketplaces.length > 0 ? (
                    <Section
                      icon={<Square3Stack3DIcon className="size-5 text-foreground/60" />}
                      title={t("settings.tab_cloud_marketplaces")}
                      description={t("interface.app_stores_with_extensions_and_plugins_for_your_workspace")}
                      count={`${marketplaces.length} marketplace${marketplaces.length === 1 ? "" : "s"}`}
                    >
                      {marketplaces.map((mp) => (
                        <MarketplaceCard key={mp.id} marketplace={mp} />
                      ))}
                    </Section>
                  ) : null}

                </Accordion>
              </ScrollAreaViewport>
            </ScrollArea>
            {/* Selected default indicator */}
            {selectedDefault ? (
              <div className="rounded-xl border border-green-6/30 bg-green-2/30 px-4 py-3 text-center text-sm text-green-11">
                <Check size={14} className="mr-1 inline" />
                {selectedDefault.label}{t("interface.will_be_set_as_your_default_model")} </div>
            ) : null}
          </PageContent>
        )}

        <PageFooter>
          {/* Footer hint */}
          {!loading && !error && hasResources ? (
            <p className="text-center text-xs text-muted-foreground text-balance leading-relaxed tracking-wide">{t("interface.available_providers_appear_in_ai_providers_some_may_require_sign_in_collections_are_available_from_c")} </p>
          ) : null}
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={() => void handleContinue()}
            disabled={loading || preparingBranding}
          >
            {preparingBranding
              ? t("interface.preparing_workspace")
              : hasResources
                ? t("interface.continue_to_workspace")
                : t("extensions.mcp_check_continue")}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

function ProviderAccessCard({ provider }: { provider: Pick<DenOrgLlmProvider, "providerId" | "name"> }) {
  return (
    <div className="-mx-2 flex items-center gap-4.5 rounded-xl border border-border px-3 py-3">
      <ProviderIcon
        providerId={provider.providerId}
        providerName={provider.name}
        size={20}
        className="text-foreground"
      />
      <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
        {provider.name}
      </div>
    </div>
  );
}

interface MarketplaceCardProps {
  marketplace: DenOrgMarketplace;
}

function MarketplaceCard({ marketplace }: MarketplaceCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 -mx-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{marketplace.name}</div>
        {marketplace.description ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {marketplace.description}
          </div>
        ) : null}
      </div>
        <span className="shrink-0 text-xs text-muted-foreground">
        {marketplace.pluginCount}{t("interface.plugin")}{marketplace.pluginCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  count?: string;
  children: React.ReactNode;
}

function Section({ icon, title, description, count, children }: SectionProps) {
  return (
    <AccordionItem value={title}>
      <AccordionTrigger className="items-center px-5 py-4 gap-4.75 hover:no-underline">
        {icon}

        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <h3 className="flex items-center gap-2 font-medium tracking-wide">
            {title}
            {count ? <span className="text-muted-foreground text-xs uppercase">{count}</span> : null}
          </h3>
          <p className="text-sm font-normal normal-case tracking-normal text-muted-foreground">
            {description}
          </p>
        </div>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-2 pb-2">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

/* ------------------------------------------------------------------ */
/*  Provider card with "Use as default" option                         */
/* ------------------------------------------------------------------ */

interface ProviderCardProps {
  provider: DenOrgLlmProvider;
  selectedDefault: { providerId: string; modelId: string } | null;
  onSelectDefault: (value: {
    providerId: string;
    modelId: string;
    label: string;
  } | null) => void;
}

function ProviderCard({ provider, selectedDefault, onSelectDefault }: ProviderCardProps) {
  // The local provider ID matches the cloud provider's org-level ID
  const localProviderId = provider.id.trim();
  const firstModel = provider.models[0] ?? null;
  const isSelected = selectedDefault?.providerId === localProviderId;

  const handleUseAsDefault = () => {
    if (!firstModel) return;
    if (isSelected) {
      onSelectDefault(null);
    } else {
      onSelectDefault({
        providerId: localProviderId,
        modelId: firstModel.id,
        label: `${resolveProviderDisplayName(provider.name || provider.providerId)} · ${firstModel.name || resolveModelDisplayName(firstModel.id)}`,
      });
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-3 transition-colors -mx-2",
        isSelected ? "border-green-6" : "border-border",
      )}
    >
      <div className="flex items-center gap-4.5">
        <ProviderIcon
          providerId={provider.providerId}
          providerName={provider.name}
          size={20}
          className="text-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {resolveProviderDisplayName(provider.name || provider.providerId)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {provider.models.length === 1
              ? t("interface.1_model")
              : `${provider.models.length} models`}
          </div>
        </div>
        {firstModel ? (
          <button
            type="button"
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              isSelected
                ? "bg-green-3 text-green-11"
                : "border border-border text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
            onClick={handleUseAsDefault}
          >
            {isSelected ? t("settings.server_endpoints_source_default") : t("interface.use_as_default")}
          </button>
        ) : (
          <Check size={16} className="shrink-0 text-green-11" />
        )}
      </div>
      {provider.models.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provider.models.slice(0, 5).map((model) => (
            <span
              key={model.id}
              className="inline-flex items-center rounded-md border border-border bg-hover px-2 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {model.name || resolveModelDisplayName(model.id)}
            </span>
          ))}
          {provider.models.length > 5 ? (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs text-muted-foreground">
              +{provider.models.length - 5}{t("interface.more")} </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface OrganizationSelectionPageProps {
  orgs: DenOrgSummary[];
  defaultOrganization: DenOrgSummary;
  onContinue: () => void;
}

function OrganizationSelectionPage({
  orgs,
  defaultOrganization,
  onContinue,
}: OrganizationSelectionPageProps) {
  const { authToken, denClient, settings } = useDenClient();
  const [selected, setSelected] = useState(defaultOrganization);
  const { error, isPending, mutate } = useMutation({
    mutationFn: async (nextOrg: DenOrgSummary) => {
      await denClient.setActiveOrganization({ organizationId: nextOrg.id });
      return nextOrg;
    },
    onSuccess: (nextOrg) => {
      clearOrgSelectionPending();
      writeDenSettings({
        ...settings,
        authToken: authToken || null,
        activeOrgId: nextOrg.id,
        activeOrgSlug: nextOrg.slug,
        activeOrgName: nextOrg.name,
      });

      onContinue();
    },
  });

  return (
    <Page>
      <PageBackground />
      <PageTitlebarRegion />
      <PageContainer>
        <PageHeader>
          <PageTitle>{t("interface.choose_your_organization")}</PageTitle>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>
                {error instanceof Error ? error.message : t("interface.unable_to_select_organization")}
              </AlertDescription>
            </Alert>
          ) : (
            <PageDescription>{t("interface.select_the_organization_whose_cloud_resources_should_be_connected_to_this_workspace")} </PageDescription>
          )}
        </PageHeader>

        <PageContent>
          <OrganizationList
            orgs={orgs}
            value={selected}
            onValueChange={setSelected}
          />
        </PageContent>

        <PageFooter>
          <Button
            className="w-fit"
            type="button"
            size="lg"
            onClick={() => mutate(selected)}
            disabled={isPending}
          >
            {isPending ? t("workspace_list.connecting") : t("interface.continue_with_organization")}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </PageFooter>
      </PageContainer>
    </Page>
  );
}

interface OrganizationListProps {
  orgs: DenOrgSummary[];
  value: DenOrgSummary;
  onValueChange: (value: DenOrgSummary) => void;
}

export function OrganizationList({ orgs, value, onValueChange }: OrganizationListProps) {
  const { filtered, query, showMore, updateQuery, visible } = useOrgListWindow(orgs);
  const hasMore = visible.length < filtered.length;

  return (
    <div className="flex flex-col gap-3">
      {orgs.length > 10 ? (
        <Input
          aria-label={t("interface.search_organizations")}
          placeholder={t("interface.search_organizations_873aee3f")}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
        />
      ) : null}

      <RadioGroup
        value={value.id}
        onValueChange={(nextOrgId) => {
          const nextOrg = orgs.find((org) => org.id === nextOrgId);
          if (nextOrg) onValueChange(nextOrg);
        }}
        aria-label={t("interface.organizations")}
      >
        {visible.map((org) => {
          const fieldId = `organization-${org.id}`;

          return (
            <FieldLabel
              key={org.id}
              htmlFor={fieldId}
              className="p-0! transition-colors hover:bg-input/10"
            >
              <Field orientation="horizontal">
                <FieldTitle className="flex min-w-0 items-center gap-4">
                  <BuildingOffice2Icon className="size-6 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col items-start">
                    <span className="max-w-full truncate text-sm font-semibold">
                      {org.name}
                    </span>
                    <span className="max-w-full truncate text-muted-foreground text-xs">
                      {org.slug}
                    </span>
                  </div>
                </FieldTitle>
                <RadioGroupItem
                  value={org.id}
                  id={fieldId}
                  className="group-hover/field-label:bg-foreground/25"
                />
              </Field>
            </FieldLabel>
          );
        })}
      </RadioGroup>

      {filtered.length === 0 && query.trim() ? (
        <div className="text-sm text-muted-foreground">{t("interface.no_organizations_match_your_search")} </div>
      ) : null}

      {hasMore ? (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" size="sm" onClick={showMore}>{t("workspace_list.show_more_fallback")} </Button>
          <div className="text-xs text-muted-foreground">{t("interface.showing")} {visible.length}{t("interface.of")} {filtered.length}{t("interface.organizations_f8a665a9")} </div>
        </div>
      ) : null}
    </div>
  )
}
