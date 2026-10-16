export function shouldShowGatewayFirstRun(input: {
  enabled: boolean;
  hasClient: boolean;
  configured: boolean | null;
  pending?: boolean;
  skipped: boolean;
  conversation: boolean;
  otherSurface: boolean;
}): boolean {
  return input.enabled
    && input.hasClient
    && (input.configured === false || input.pending === true)
    && !input.skipped
    && !input.conversation
    && !input.otherSurface;
}

export function gatewayEngineModelReady(catalog: {
  connected: string[];
  all: Array<{ id: string; models?: Record<string, unknown> }>;
} | null | undefined, modelId: string): boolean {
  if (!catalog || !modelId || !catalog.connected.includes("modelhelm")) return false;
  return catalog.all.some((provider) => provider.id === "modelhelm"
    && provider.models !== undefined
    && Object.hasOwn(provider.models, modelId));
}
