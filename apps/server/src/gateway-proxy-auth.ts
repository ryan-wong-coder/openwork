import { createHmac } from "node:crypto";
import type { ServerConfig } from "./types.js";

export const GATEWAY_PROXY_TOKEN_ENV = "OPENWORK_GATEWAY_PROXY_TOKEN";

/** A process/profile-scoped chat credential with no host or management authority. */
export function gatewayProxyToken(config: ServerConfig): string {
  return createHmac("sha256", config.hostToken)
    .update("openwork.gateway.proxy.v1\0").update(config.token)
    .update("\0").update(config.configPath ?? "").digest("base64url");
}

export function gatewayProxyBaseURL(config: Pick<ServerConfig, "port">): string {
  return `http://127.0.0.1:${config.port}/gateway/openai`;
}
