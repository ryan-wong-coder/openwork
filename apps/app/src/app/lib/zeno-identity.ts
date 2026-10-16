import { localClientFeatureEnabled } from "./local-client-features";

export const ZENO_PRODUCT_NAME = "Zeno";

export function isZenoInterfaceEnabled(): boolean {
  return localClientFeatureEnabled("zenoInterface");
}
