import { isLocalGatewayClient } from "./client-profile";
import { localClientFeatureEnabled } from "./local-client-features";

export function isZenoAboutEnabled(): boolean {
  return isLocalGatewayClient() && localClientFeatureEnabled("zenoAbout");
}
