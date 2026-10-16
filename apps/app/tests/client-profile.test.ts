import { describe, expect, test } from "bun:test";
import { resolveClientProfile } from "../src/app/lib/client-profile";

describe("local gateway client profile", () => {
  test("public desktop defaults to local without a control plane", () => {
    expect(resolveClientProfile({ deployment: "desktop", distribution: { flavor: "public" } })).toBe("local-gateway");
  });

  test("connected profile restores the original client", () => {
    expect(resolveClientProfile({ requestedProfile: "connected" })).toBe("connected");
  });

  test("web, hosted gateway and managed installs retain authentication", () => {
    const managedInputs = [
      { deployment: "web" },
      { gatewayRuntime: true },
      { distribution: { flavor: "cloud" } },
      { distribution: { flavor: "enterprise" } },
      { distribution: { flavor: "public", requireSignin: true } },
      { bootstrap: { requireSignin: true } },
      { bootstrap: { requireActivation: true } },
      { buildRequiresSignin: true },
    ];
    for (const input of managedInputs) {
      expect(resolveClientProfile({ ...input, requestedProfile: "local-gateway" })).toBe("connected");
    }
  });
});
