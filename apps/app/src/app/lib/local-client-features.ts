import { localOperatorFeatureEnabled, type FeatureKey } from "@openwork/features";
import { isLocalGatewayClient } from "./client-profile";

// This personal distribution is an operator-configured local installation.
// Connected/cloud distributions continue to follow their server's rollout.
export function localClientFeatureEnabled(key: FeatureKey, connectedEnabled = false): boolean {
  return localOperatorFeatureEnabled(key, isLocalGatewayClient(), connectedEnabled);
}
