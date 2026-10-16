import { loopbackFetch } from "./server-fetch.js";
import { isIndependentClient } from "./client-profile.js";
import type { ServerConfig } from "./types.js";

const LOCAL_MODELS_URL = "http://localhost:8791/models";
const PRODUCTION_MODELS_URL = "https://models.openworklabs.com/";

type ResolveOpencodeModelsUrlOptions = {
  config?: Pick<ServerConfig, "clientProfile">;
  env?: NodeJS.ProcessEnv;
  fetchModels?: (input: string, init?: RequestInit) => Promise<{ ok: boolean }>;
};

export async function resolveOpencodeModelsUrl(
  options: ResolveOpencodeModelsUrlOptions = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const override = env.OPENCODE_MODELS_URL?.trim();
  if (override) {
    // An inherited upstream mirror must not opt an independent installation
    // back into OpenWork services. Operator-owned catalog mirrors still work.
    let upstreamMirror = false;
    try { upstreamMirror = new URL(override).hostname === new URL(PRODUCTION_MODELS_URL).hostname; } catch { /* The engine reports invalid operator overrides. */ }
    if (!isIndependentClient(options.config) || !upstreamMirror) return override;
  }
  if (isIndependentClient(options.config)) return undefined;
  if (env.OPENWORK_DEV_MODE !== "1") return PRODUCTION_MODELS_URL;

  try {
    const response = await (options.fetchModels ?? loopbackFetch)(`${LOCAL_MODELS_URL}/api.json`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (response.ok) return LOCAL_MODELS_URL;
  } catch {
    // A standalone desktop dev session does not run the local inference stack.
  }

  return PRODUCTION_MODELS_URL;
}

export async function managedEngineModelsEnvironment(config: Pick<ServerConfig, "clientProfile">, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const url = await resolveOpencodeModelsUrl({ config, env });
  const configuredDisable = env.OPENCODE_DISABLE_MODELS_FETCH?.trim();
  return {
    ...(url ? { OPENCODE_MODELS_URL: url } : {}),
    // Confirmed in the installed OpenCode binary's ModelsDev.populate and
    // refresh implementation. No fake/empty URL or external fallback is used.
    ...(isIndependentClient(config) && !url ? { OPENCODE_DISABLE_MODELS_FETCH: "1" }
      : configuredDisable ? { OPENCODE_DISABLE_MODELS_FETCH: configuredDisable } : {}),
  };
}
