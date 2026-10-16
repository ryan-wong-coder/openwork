type SmallModelConfig = { small_model?: string };
type SmallModelProvider = { id: string; models: Record<string, unknown> };

/**
 * Native title generation asks for a small model using the conversation's
 * provider, but a global small_model bypasses that provider entirely. Keep
 * that preference only within the provider that owns it. The engine can then
 * use its own available small model, or the conversation model, otherwise.
 * Explicit agent.title.model choices bypass this hook and remain untouched.
 */
export function createTitleModelRouting(clientProfile: string | undefined) {
  const independent = clientProfile?.trim().toLowerCase() === "local-gateway";
  let preferred: { providerID: string; modelID: string } | undefined;
  return {
    config: async (config: SmallModelConfig) => {
      if (!independent) return;
      const value = config.small_model;
      if (typeof value !== "string") return;
      const separator = value.indexOf("/");
      preferred = separator > 0 && separator < value.length - 1
        ? { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
        : undefined;
      // Mutate only this engine instance's merged config, never its files.
      delete config.small_model;
    },
    "experimental.provider.small_model": async (
      { provider }: { provider: SmallModelProvider },
      output: { model?: unknown },
    ) => {
      if (!independent || preferred?.providerID !== provider.id) return;
      // The native provider catalog has already applied auth and model filters.
      if (Object.hasOwn(provider.models, preferred.modelID)) output.model = provider.models[preferred.modelID];
    },
  };
}
