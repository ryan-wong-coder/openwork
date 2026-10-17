export type GatewayImageMetadata = { image?: boolean };

const MODELHELM_URL = "https://api.modelhelm.com/v1";
const INPUT_MODALITIES = new Set(["text", "image", "audio", "video", "pdf", "file"]);

// Exact routing IDs only. Each entry has primary vendor evidence recorded in
// test/fixtures/gateway-image-capabilities-sources.md. These are input-image
// capabilities, not image generation, PDF, video, or gateway availability claims.
const MODELHELM_IMAGE_MODELS = new Set([
  "anthropic/claude-fable-5",
  "anthropic/claude-opus-5",
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.5",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-6-astra",
  "openai/gpt-6-luna",
  "openai/gpt-6-sol",
  "openai/gpt-6.1-sol",
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "qwen/qwen3.6-27b",
  "qwen/qwen3.6-35b-a3b",
  "qwen/qwen3.6-flash",
  "qwen/qwen3.6-plus",
  "qwen/qwen3.7-plus",
  "qwen/qwen3.8-flash",
  "qwen/qwen3.8-max",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k3",
  "z-ai/glm-4.5v",
  "z-ai/glm-4.6v",
  "z-ai/glm-5v-turbo",
  "x-ai/grok-4.5",
  "x-ai/grok-4.6",
  "minimax/minimax-m3",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function inputImageSupport(value: unknown): boolean | undefined {
  if (record(value)) {
    const image = own(value, "image");
    return typeof image === "boolean" ? image : undefined;
  }
  // A complete, valid modality list explicitly includes or excludes images.
  // Malformed lists are unknown rather than coerced into a capability claim.
  if (!Array.isArray(value) || value.length > 16
    || !value.every(item => typeof item === "string" && INPUT_MODALITIES.has(item))) return undefined;
  return value.includes("image");
}

/** Read only declared image-input capabilities, never executable catalog data.
 * `attachment` may mean PDFs or audio and does not establish image support.
 * Conflicting explicit declarations conservatively retain the negative one. */
export function parseGatewayImageMetadata(value: Record<string, unknown>): GatewayImageMetadata {
  const modalitiesValue = own(value, "modalities");
  const capabilitiesValue = own(value, "capabilities");
  const architectureValue = own(value, "architecture");
  const modalities = record(modalitiesValue) ? modalitiesValue : {};
  const capabilities = record(capabilitiesValue) ? capabilitiesValue : {};
  const architecture = record(architectureValue) ? architectureValue : {};
  const declarations = [
    own(value, "image"),
    own(value, "vision"),
    own(capabilities, "vision"),
    inputImageSupport(own(modalities, "input")),
    inputImageSupport(own(capabilities, "input")),
    inputImageSupport(own(value, "input_modalities")),
    inputImageSupport(own(architecture, "input_modalities")),
  ];
  if (declarations.includes(false)) return { image: false };
  return declarations.includes(true) ? { image: true } : {};
}

/** A catalog declaration wins over the narrowly scoped offline vendor table.
 * Custom gateways and unrecognized aliases must advertise their capabilities. */
export function gatewayImageMetadata(baseURL: string, modelId: string, declared: GatewayImageMetadata): GatewayImageMetadata {
  if (typeof declared.image === "boolean") return { image: declared.image };
  return baseURL.replace(/\/+$/, "") === MODELHELM_URL && MODELHELM_IMAGE_MODELS.has(modelId)
    ? { image: true } : {};
}
