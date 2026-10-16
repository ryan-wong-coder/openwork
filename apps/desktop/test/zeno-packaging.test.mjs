import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { zenoPackagingPlan } from "../scripts/package-zeno.mjs";
const require = createRequire(import.meta.url);
const { targetTriple } = require("../scripts/electron-after-pack.cjs");

test("each release lane prepares matching sidecars and a separate output", () => {
  for (const platform of ["darwin", "win32", "linux"]) for (const arch of ["x64", "arm64"]) {
    const plan = zenoPackagingPlan([`--${arch}`], platform, "x64", {});
    assert.equal(plan.target, targetTriple(platform, arch));
    assert.ok(plan.builderArgs.includes(`-c.directories.output=dist-zeno/${platform}/${arch}`));
    assert.deepEqual(plan.builderArgs.slice(plan.builderArgs.indexOf("--publish"), plan.builderArgs.indexOf("--publish") + 2), ["--publish", "never"]);
  }
});

test("persistent self-signing enables mac updates while ad-hoc packaging cannot", () => {
  const signed = zenoPackagingPlan([], "darwin", "arm64", {});
  assert.equal(signed.signing, "self-signed");
  assert.ok(signed.builderArgs.includes("-c.mac.sign=scripts/zeno-macos-sign.cjs"));
  assert.ok(signed.builderArgs.includes("-c.extraMetadata.zenoReleaseUpdatesEnabled=true"));
  const adhoc = zenoPackagingPlan([], "darwin", "arm64", { ZENO_MAC_SIGNING: "adhoc" });
  assert.ok(adhoc.builderArgs.includes("-c.extraMetadata.zenoReleaseUpdatesEnabled=false"));
});

test("Windows update signature verification follows actual signing mode", () => {
  assert.ok(zenoPackagingPlan([], "win32", "x64", {}).builderArgs.includes("-c.win.verifyUpdateCodeSignature=false"));
  assert.ok(zenoPackagingPlan([], "win32", "arm64", { ZENO_WINDOWS_SIGNING: "certificate" }).builderArgs.includes("-c.win.verifyUpdateCodeSignature=true"));
});

test("publishing, mixed architectures, foreign platforms and unknown signing modes fail closed", () => {
  for (const args of [["--publish", "always"], ["--x64", "--arm64"], ["--win"], ["--config", "electron-builder.yml"]]) {
    assert.throws(() => zenoPackagingPlan(args, "darwin", "arm64", {}));
  }
  assert.throws(() => zenoPackagingPlan([], "darwin", "arm64", { ZENO_MAC_SIGNING: "unknown" }));
});

test("numeric electron-builder architecture values select the actual target", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    assert.equal(targetTriple(platform, 1), targetTriple(platform, "x64"));
    assert.equal(targetTriple(platform, 3), targetTriple(platform, "arm64"));
  }
  assert.equal(targetTriple("darwin", 0), null);
});
