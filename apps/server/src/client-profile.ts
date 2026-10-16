import type { ServerConfig } from "./types.js";

export type ServerClientProfile = "local-gateway" | "connected";

/** Trusted CLI/embedding input only. Never read this choice from workspace JSON. */
export function resolveServerClientProfile(requested: string | undefined): ServerClientProfile {
  const value = requested?.trim().toLowerCase();
  if (!value || value === "local-gateway") return "local-gateway";
  if (value === "connected") return "connected";
  throw new Error("OPENWORK_CLIENT_PROFILE must be local-gateway or connected");
}

export function isIndependentClient(config: Pick<ServerConfig, "clientProfile"> | undefined): boolean {
  return config?.clientProfile === "local-gateway";
}

export function isOpenworkManagedMcp(name: string): boolean {
  return name === "openwork-cloud" || name.startsWith("openwork-connect-")
    || name.startsWith("openwork-direct-") || name.startsWith("openwork-app-host-connect-");
}

export function independentMcpMap(config: Pick<ServerConfig, "clientProfile"> | undefined, mcp: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  if (!isIndependentClient(config)) return mcp;
  return Object.fromEntries(Object.entries(mcp).filter(([name]) => !isOpenworkManagedMcp(name)));
}

/** Disabled overlays also stop a lower-priority legacy engine file from re-enabling Connect. */
export function independentRuntimeMcpMap(config: Pick<ServerConfig, "clientProfile"> | undefined, mcp: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  if (!isIndependentClient(config)) return mcp;
  return Object.fromEntries(Object.entries(mcp).map(([name, value]) => [name, isOpenworkManagedMcp(name)
    ? { type: value.type, ...(value.type === "local" ? { command: value.command } : { url: value.url }), enabled: false }
    : value]));
}

/** Keep operator-defined providers and model gateways; suppress retained Den imports. */
export function independentProviderMap<T>(config: Pick<ServerConfig, "clientProfile"> | undefined, providers: Record<string, T>): Record<string, T> {
  if (!isIndependentClient(config)) return providers;
  return Object.fromEntries(Object.entries(providers).filter(([id]) => !/^(?:lpr_|ipr_|openwork$|openwork-free$)/i.test(id)));
}
