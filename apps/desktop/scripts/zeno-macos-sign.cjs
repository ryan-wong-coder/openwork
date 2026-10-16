const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const builderRequire = createRequire(require.resolve("electron-builder"));
const appBuilderRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { signAsync } = appBuilderRequire("@electron/osx-sign");

// Squirrel validates the next bundle against this bundle's designated requirement.
// Pin the persistent private certificate, never an ad-hoc cdhash or Apple identity.
module.exports = async function sign(options) {
  const identity = process.env.ZENO_MAC_CERT_SHA1;
  const keychain = process.env.ZENO_MAC_KEYCHAIN;
  if (!identity || !/^[A-F0-9]{40}$/.test(identity) || !keychain) throw new Error("Persistent Zeno self-signing identity is unavailable.");
  await signAsync({
    ...options,
    identity,
    keychain,
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: (file) => ({
      ...options.optionsForFile(file),
      timestamp: "none",
      ...(file === options.app ? { requirements: `=designated => identifier "com.differentai.openwork" and certificate leaf = H"${identity}"` } : {}),
    }),
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--all-architectures", options.app], { stdio: "inherit" });
};
