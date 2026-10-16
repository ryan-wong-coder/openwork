export const ZENO_DESKTOP_APP_NAME = "泽诺 Zeno";

/** Presentation only: never derive identifiers, protocols or profile paths here. */
export function zenoDesktopIdentityEnabled({ isPackaged, packageBrand, distribution, requestedProfile, bootstrap }) {
  if (distribution.flavor !== "public" || distribution.requireSignin || distribution.requireActivation) return false;
  if (bootstrap?.requireSignin || bootstrap?.requireActivation) return false;
  if (requestedProfile?.trim().toLowerCase() === "connected") return false;
  return isPackaged ? packageBrand === "zeno" : true;
}
