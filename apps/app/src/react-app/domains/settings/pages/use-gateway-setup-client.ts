import { useRef } from "react";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";

type GatewaySetupConnection = {
  client: OpenworkServerClient | null;
  baseUrl: string;
  token: string;
  hostToken?: string | null;
  generation?: number | null;
};

type GatewaySetupClientSnapshot = {
  client: OpenworkServerClient;
  baseUrl: string;
  token: string;
  hostToken: string | null;
  generation: number | null;
};

/** Route refreshes may recreate an API client without changing its connection. */
export function useGatewaySetupClient(input: GatewaySetupConnection): OpenworkServerClient | null {
  const retained = useRef<GatewaySetupClientSnapshot | null>(null);
  if (!input.client) {
    retained.current = null;
    return null;
  }
  const hostToken = input.hostToken ?? null;
  const generation = input.generation ?? null;
  const previous = retained.current;
  if (previous
    && previous.baseUrl === input.baseUrl
    && previous.token === input.token
    && previous.hostToken === hostToken
    && previous.generation === generation) {
    return previous.client;
  }
  retained.current = {
    client: input.client,
    baseUrl: input.baseUrl,
    token: input.token,
    hostToken,
    generation,
  };
  return input.client;
}
