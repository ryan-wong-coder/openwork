import assert from "node:assert/strict";
import test from "node:test";
import { resolveDesktopDistribution } from "../electron/desktop-distribution.mjs";
import { resolveUserDataPath } from "../electron/dev-profile.mjs";
import { zenoDesktopIdentityEnabled } from "../electron/zeno-identity.mjs";

const publicDistribution = resolveDesktopDistribution({ isPackaged: true, packageFlavor: "public" });

test("the personal package changes presentation without changing the profile identity", () => {
  assert.equal(zenoDesktopIdentityEnabled({ isPackaged: true, packageBrand: "zeno", distribution: publicDistribution }), true);
  assert.equal(publicDistribution.appIdentifier, "com.differentai.openwork");
  assert.equal(publicDistribution.protocolScheme, "openwork");
  assert.equal(resolveUserDataPath({ appDataPath: "/profiles", appIdentifier: publicDistribution.appIdentifier }), "/profiles/com.differentai.openwork");
  assert.equal(resolveUserDataPath({ appDataPath: "/profiles", appIdentifier: publicDistribution.appIdentifier, userDataOverride: "/existing" }), "/existing");
});

test("normal packaged, connected and managed distributions keep their branding", () => {
  assert.equal(zenoDesktopIdentityEnabled({ isPackaged: true, distribution: publicDistribution }), false);
  assert.equal(zenoDesktopIdentityEnabled({ isPackaged: true, packageBrand: "zeno", distribution: publicDistribution, requestedProfile: "connected" }), false);
  for (const packageFlavor of ["cloud", "enterprise"]) {
    const distribution = resolveDesktopDistribution({ isPackaged: true, packageFlavor });
    assert.equal(zenoDesktopIdentityEnabled({ isPackaged: true, packageBrand: "zeno", distribution }), false);
  }
  for (const bootstrap of [{ requireSignin: true }, { requireActivation: true }]) {
    assert.equal(zenoDesktopIdentityEnabled({ isPackaged: true, packageBrand: "zeno", distribution: publicDistribution, bootstrap }), false);
  }
});

test("local development follows the requested profile", () => {
  assert.equal(zenoDesktopIdentityEnabled({ isPackaged: false, distribution: publicDistribution }), true);
  assert.equal(zenoDesktopIdentityEnabled({ isPackaged: false, distribution: publicDistribution, requestedProfile: "connected" }), false);
});
