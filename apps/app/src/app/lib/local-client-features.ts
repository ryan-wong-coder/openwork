import { resolveFeature, type FeatureKey } from "@openwork/features";
import { isLocalGatewayClient } from "./client-profile";

// This personal distribution is an operator-configured local installation.
// Connected/cloud distributions continue to follow their server's rollout.
const LOCAL_GATEWAY_OPERATOR_FEATURES = {
  zenoReleaseUpdates: true,
  zenoAbout: true,
  gatewayFirstRunSetup: true,
  zenoInterface: true,
  gatewayImageGeneration: true,
  visualConfiguration: true,
};

export function localClientFeatureEnabled(key: FeatureKey, connectedEnabled = false): boolean {
  return resolveFeature(key, {
    deployment: "self_hosted",
    locks: isLocalGatewayClient() ? LOCAL_GATEWAY_OPERATOR_FEATURES : {},
    overrides: {},
    rollouts: { [key]: { enabled: connectedEnabled, killed: false } },
  }).enabled;
}
