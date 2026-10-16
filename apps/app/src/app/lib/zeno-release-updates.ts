import { isLocalGatewayClient } from "./client-profile";
import { localClientFeatureEnabled } from "./local-client-features";
import { isElectronRuntime } from "../utils";

export function isZenoReleaseUpdatesEnabled(): boolean {
  return isLocalGatewayClient() && isElectronRuntime() && localClientFeatureEnabled("zenoReleaseUpdates");
}
