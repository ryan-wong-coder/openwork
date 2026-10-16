import { isOpenworkGatewayRuntime } from "./gateway-runtime";
import { getOpenWorkDeployment } from "./openwork-deployment";

export type ClientProfile = "local-gateway" | "connected";
export const LOCAL_GATEWAY_PROVIDER_ID = "modelhelm";
export const DEFAULT_LOCAL_GATEWAY_CHAT_MODEL = "anthropic/claude-sonnet-5";

type ClientBootstrap = {
  requireSignin?: boolean;
  requireActivation?: boolean;
};

type ClientProfileInput = {
  deployment?: string;
  gatewayRuntime?: boolean;
  distribution?: ClientBootstrap & { flavor?: string };
  bootstrap?: ClientBootstrap | null;
  requestedProfile?: string;
  buildRequiresSignin?: boolean;
};

/** The local profile never overrides an install's authentication requirements. */
export function resolveClientProfile(input: ClientProfileInput): ClientProfile {
  if (
    input.deployment === "web"
    || input.gatewayRuntime
    || (input.distribution?.flavor !== undefined && input.distribution.flavor !== "public")
    || input.distribution?.requireSignin
    || input.distribution?.requireActivation
    || input.bootstrap?.requireSignin
    || input.bootstrap?.requireActivation
    || input.buildRequiresSignin
    || input.requestedProfile?.trim().toLowerCase() === "connected"
  ) return "connected";
  return "local-gateway";
}

// Den updates this after an authoritative shell read. Keeping the small
// requirement snapshot here avoids importing Den into its own dependencies.
let resolvedBootstrap: ClientBootstrap | null = null;

export function setClientProfileBootstrap(bootstrap: ClientBootstrap): void {
  resolvedBootstrap = {
    requireSignin: bootstrap.requireSignin,
    requireActivation: bootstrap.requireActivation,
  };
}

export function getClientProfile(): ClientProfile {
  const meta = typeof window === "undefined" ? undefined : window.__OPENWORK_ELECTRON__?.meta;
  return resolveClientProfile({
    deployment: getOpenWorkDeployment(),
    gatewayRuntime: isOpenworkGatewayRuntime(),
    distribution: meta?.distribution,
    bootstrap: resolvedBootstrap ?? meta?.desktopBootstrap,
    requestedProfile: import.meta.env?.VITE_OPENWORK_CLIENT_PROFILE,
    buildRequiresSignin: /^(1|true|yes|on)$/i.test(String(import.meta.env?.VITE_DEN_REQUIRE_SIGNIN ?? "").trim()),
  });
}

export function isLocalGatewayClient(): boolean {
  return getClientProfile() === "local-gateway";
}

export function clientWorkspaceVisible(workspace: { workspaceType?: string | null }): boolean {
  return !isLocalGatewayClient() || workspace.workspaceType !== "remote";
}

export function clientModelVisible(model: { providerID: string }): boolean {
  return !isLocalGatewayClient() || model.providerID === LOCAL_GATEWAY_PROVIDER_ID;
}
