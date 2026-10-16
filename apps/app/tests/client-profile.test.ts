import { describe, expect, test } from "bun:test";
import { resolveClientProfile } from "../src/app/lib/client-profile";

describe("local gateway client profile", () => {
  test("public desktop defaults to local without a control plane", () => {
    expect(resolveClientProfile({ deployment: "desktop", distribution: { flavor: "public" } })).toBe("local-gateway");
  });

  test("connected profile restores the original client", () => {
    expect(resolveClientProfile({ requestedProfile: "connected" })).toBe("connected");
  });

  test("self-hosted web defaults to an independent gateway client", () => {
    expect(resolveClientProfile({ deployment: "web" })).toBe("local-gateway");
    expect(resolveClientProfile({ deployment: "web", gatewayRuntime: true })).toBe("local-gateway");
    expect(resolveClientProfile({ deployment: "web", gatewayRuntime: true, requestedProfile: "local-gateway" })).toBe("local-gateway");
  });

  test("managed installs and explicit requirements retain authentication on web and desktop", () => {
    const managedInputs = [
      { distribution: { flavor: "cloud" } },
      { distribution: { flavor: "enterprise" } },
      { distribution: { flavor: "public", requireSignin: true } },
      { distribution: { flavor: "public", requireActivation: true } },
      { bootstrap: { requireSignin: true } },
      { bootstrap: { requireActivation: true } },
      { buildRequiresSignin: true },
    ];
    for (const input of managedInputs) {
      for (const deployment of ["desktop", "web"]) {
        expect(resolveClientProfile({ ...input, deployment, gatewayRuntime: true, requestedProfile: "local-gateway" })).toBe("connected");
      }
    }
  });

  test("an explicitly connected self-hosted web build stays connected", () => {
    expect(resolveClientProfile({ deployment: "web", gatewayRuntime: true, requestedProfile: "connected" })).toBe("connected");
  });
});
