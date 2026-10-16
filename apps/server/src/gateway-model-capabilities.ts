export type GatewayReasoningMetadata = {
  reasoning?: boolean;
  interleaved?: { field: "reasoning_content" | "reasoning_details" };
  variants?: Record<string, { reasoningEffort?: string; effort?: string; thinking?: { type: "adaptive"; display: "summarized" }; disabled?: boolean }>;
};

const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const MODELHELM_URL = "https://api.modelhelm.com/v1";
const MODELHELM_CLAUDE_MODELS = new Set([
  "anthropic/claude-fable-5", "anthropic/claude-opus-5", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5",
]);
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
function adaptiveThinking(): { type: "adaptive"; display: "summarized" } {
  return { type: "adaptive", display: "summarized" };
}

/** Only local, verified protocol mappings may select a native SDK or route. */
export function isModelHelmClaudeModel(baseURL: string, modelId: string): boolean {
  return baseURL.replace(/\/+$/, "") === MODELHELM_URL && MODELHELM_CLAUDE_MODELS.has(modelId);
}

/** An explicit local model SDK remains authoritative, including a deliberate
 * compatible/custom adapter instead of this installation's native default. */
export function canUseModelHelmClaudeSdk(baseURL: string, modelId: string, model: Record<string, unknown>): boolean {
  if (!isModelHelmClaudeModel(baseURL, modelId)) return false;
  if (model.provider === undefined) return true;
  return record(model.provider) && (model.provider.npm === undefined || model.provider.npm === "@ai-sdk/anthropic");
}

/** Executable/provider settings are locally allowlisted, never catalog data. */
export function gatewayNativeModelDefaults(baseURL: string, modelId: string): {
  provider?: { npm: "@ai-sdk/anthropic" };
  options?: { thinking: { type: "adaptive"; display: "summarized" } };
} {
  return isModelHelmClaudeModel(baseURL, modelId)
    ? { provider: { npm: "@ai-sdk/anthropic" }, options: { thinking: adaptiveThinking() } } : {};
}

// Offline, exact routing IDs only. The gateway's standard /models response
// currently has no capabilities. Never infer support from substrings or apply
// this table to a custom gateway with potentially different model aliases.
// DeepSeek's Chat Completions contract (including none to disable thinking):
// https://api-docs.deepseek.com/api/create-chat-completion/
// OpenCode's model catalog entries specify their actual effort sets:
// https://github.com/anomalyco/models.dev/tree/dev/providers/openai/models
// GPT-6.1 Sol's exact efforts (none/minimal are unsupported):
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// MiniMax M2 is a reasoning model without an exposed effort dial:
// https://platform.minimax.io/docs/api-reference/text-openai-api
const KNOWN_EFFORTS: Record<string, readonly string[]> = {
  "deepseek/deepseek-v4-flash": ["none", "low", "high", "max"],
  "deepseek/deepseek-v4-pro": ["none", "low", "high", "max"],
  "openai/gpt-5.4": ["none", "low", "medium", "high", "xhigh"],
  "openai/gpt-5.4-mini": ["none", "low", "medium", "high", "xhigh"],
  "openai/gpt-5.5": ["none", "low", "medium", "high", "xhigh"],
  "openai/gpt-5.6-luna": ["none", "low", "medium", "high", "xhigh", "max"],
  "openai/gpt-5.6-sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "openai/gpt-5.6-terra": ["none", "low", "medium", "high", "xhigh", "max"],
  "openai/gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
  "minimax/minimax-m2": [],
  "minimax/minimax-m2.1": [],
  "minimax/minimax-m2.5": [],
  "minimax/minimax-m2.7": [],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function effort(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(value);
}

function exactVariants(values: readonly string[], nativeClaude = false): NonNullable<GatewayReasoningMetadata["variants"]> {
  // v1 merges variants with its inferred defaults. Explicit disabled entries
  // prevent it from inventing medium/xhigh for a provider that excludes them.
  return {
    ...Object.fromEntries(EFFORTS.map(value => [value, { disabled: true }])),
    ...Object.fromEntries(values.map(value => [value, nativeClaude
      ? { effort: value, thinking: adaptiveThinking() } : { reasoningEffort: value }])),
  };
}

/** Preserve supported effort metadata, never arbitrary remote config options. */
export function parseGatewayReasoningMetadata(value: Record<string, unknown>): GatewayReasoningMetadata {
  const capabilities = record(value.capabilities) ? value.capabilities : {};
  const interleaved = record(value.interleaved) ? value.interleaved : {};
  const base: GatewayReasoningMetadata = interleaved.field === "reasoning_content" || interleaved.field === "reasoning_details"
    ? { interleaved: { field: interleaved.field } } : {};
  const reasoning = typeof value.reasoning === "boolean" ? value.reasoning
    : typeof capabilities.reasoning === "boolean" ? capabilities.reasoning : undefined;
  if (reasoning === false) return { ...base, reasoning: false, variants: exactVariants([]) };

  if (record(value.variants)) {
    const parsed: Array<[string, NonNullable<GatewayReasoningMetadata["variants"]>[string]]> = [];
    for (const [id, variant] of Object.entries(value.variants)) {
      if (!id.trim() || id.length > 128 || !record(variant)) continue;
      if (variant.disabled === true) { parsed.push([id, { disabled: true }]); continue; }
      // Discovery stores a protocol-neutral effort vocabulary. Only the local
      // known-Claude branch may turn it into native SDK `effort`/thinking.
      const selected = variant.reasoningEffort ?? variant.reasoning_effort ?? variant.effort;
      if (effort(selected)) parsed.push([id, { reasoningEffort: selected }]);
    }
    const supported = parsed.some(([, variant]) => typeof variant.reasoningEffort === "string" || typeof variant.effort === "string");
    return { ...base, ...(reasoning === undefined && !supported ? {} : { reasoning: reasoning ?? true }), variants: {
      ...exactVariants([]), ...Object.fromEntries(parsed),
    } };
  }

  const details = record(value.reasoning) ? value.reasoning : {};
  const effortDetails = record(value.effort) ? value.effort : {};
  const options = Array.isArray(value.reasoning_options) ? value.reasoning_options : [];
  const declared = [value.reasoning_efforts, details.supported_efforts, details.supported_levels, effortDetails.supported_levels,
    ...options.filter(option => record(option) && option.type === "effort").map(option => record(option) ? option.values : undefined)]
    .find(Array.isArray);
  if (declared) return { ...base, reasoning: reasoning ?? true, variants: exactVariants(declared.filter(effort)) };
  // A reasoning model without a documented dial is built in, not adjustable.
  return reasoning === true ? { ...base, reasoning: true, variants: exactVariants([]) } : base;
}

export function gatewayReasoningMetadata(baseURL: string, modelId: string, declared: GatewayReasoningMetadata): GatewayReasoningMetadata {
  const metadata: GatewayReasoningMetadata = {
    ...(declared.reasoning === undefined ? {} : { reasoning: declared.reasoning }),
    ...(declared.variants === undefined ? {} : { variants: declared.variants }),
    ...(declared.interleaved === undefined ? {} : { interleaved: declared.interleaved }),
  };
  if (isModelHelmClaudeModel(baseURL, modelId)) {
    // Native effort is a different wire contract. Convert only the sanitized
    // remote capability vocabulary, never arbitrary SDK/provider configuration.
    if (metadata.variants !== undefined) {
      metadata.variants = Object.fromEntries(Object.entries(metadata.variants).map(([id, variant]) => {
        if (variant.disabled === true) return [id, { disabled: true }];
        const selected = variant.effort ?? variant.reasoningEffort;
        return [id, typeof selected === "string" && CLAUDE_EFFORTS.includes(selected)
          ? { effort: selected, thinking: adaptiveThinking() } : { disabled: true }];
      }));
    }
    if (metadata.reasoning !== undefined || metadata.variants !== undefined) return metadata;
    return { reasoning: true, variants: exactVariants(CLAUDE_EFFORTS, true), ...metadata };
  }
  const known = baseURL.replace(/\/+$/, "") === MODELHELM_URL && Object.hasOwn(KNOWN_EFFORTS, modelId);
  const interleaved: GatewayReasoningMetadata = known && (modelId === "deepseek/deepseek-v4-flash" || modelId === "deepseek/deepseek-v4-pro")
    ? { interleaved: { field: "reasoning_content" } } : {};
  if (metadata.reasoning !== undefined || metadata.variants !== undefined) return { ...interleaved, ...metadata };
  if (!known) return metadata;
  return { reasoning: true, variants: exactVariants(KNOWN_EFFORTS[modelId]),
    ...interleaved,
    ...metadata,
  };
}

/** Local runtime config is already explicit user configuration, not remote
 * discovery data. Fill missing fields without sanitizing or rewriting it. */
export function fillGatewayRuntimeModelMetadata(baseURL: string, modelId: string, model: Record<string, unknown>) {
  const conflictingSdk = isModelHelmClaudeModel(baseURL, modelId) && !canUseModelHelmClaudeSdk(baseURL, modelId, model);
  const native: ReturnType<typeof gatewayNativeModelDefaults> = conflictingSdk ? {} : gatewayNativeModelDefaults(baseURL, modelId);
  // A different explicit adapter must not acquire native defaults or let an
  // engine invent controls. Existing user variants still override this guard.
  const fallback: GatewayReasoningMetadata = conflictingSdk ? { variants: exactVariants([]) }
    : model.reasoning === false ? { reasoning: false, variants: exactVariants([]) }
    : gatewayReasoningMetadata(baseURL, modelId, {});
  return { ...fallback, ...native, ...(model.reasoning === true && fallback.variants === undefined
    ? { variants: exactVariants([]) } : {}), ...model,
    ...(native.provider && (model.provider === undefined || record(model.provider))
      ? { provider: { ...native.provider, ...(record(model.provider) ? model.provider : {}) } } : {}),
    ...(native.options && (model.options === undefined || record(model.options))
      ? { options: { ...native.options, ...(record(model.options) ? model.options : {}) } } : {}),
    ...(conflictingSdk && model.variants === undefined ? { variants: exactVariants([]) } : {}),
  };
}
