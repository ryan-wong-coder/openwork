import assert from "node:assert/strict"
import test from "node:test"
import { FEATURES, LOCAL_GATEWAY_OPERATOR_FEATURES, localOperatorFeatureEnabled, resolveFeature } from "@openwork/features"

test("conversation canvas is off on fresh installs and unavailable on cloud", () => {
  assert.equal(FEATURES.conversationCanvas.default, false)
  for (const deployment of ["cloud", "self_hosted"]) {
    const result = resolveFeature("conversationCanvas", { deployment: deployment === "cloud" ? "cloud" : "self_hosted", locks: {}, overrides: {}, rollouts: {} })
    assert.equal(result.enabled, false)
  }
  assert.equal(resolveFeature("conversationCanvas", { deployment: "cloud", locks: { conversationCanvas: true }, overrides: {}, rollouts: {} }).source, "unavailable")
})

test("only the independent installation receives its explicit operator rollout", () => {
  assert.equal(localOperatorFeatureEnabled("conversationCanvas", true), true)
  assert.equal(localOperatorFeatureEnabled("conversationCanvas", false), false)
  assert.equal(localOperatorFeatureEnabled("conversationCanvas", false, true), true)
  for (const key of ["zenoReleaseUpdates", "zenoAbout", "gatewayFirstRunSetup", "zenoInterface", "gatewayImageGeneration", "visualConfiguration"]) {
    assert.equal(Object.entries(LOCAL_GATEWAY_OPERATOR_FEATURES).find(([id]) => id === key)?.[1], true)
  }
})

test("an operator rollback and the registry kill switch both disable the canvas", () => {
  const original = LOCAL_GATEWAY_OPERATOR_FEATURES.conversationCanvas
  try {
    LOCAL_GATEWAY_OPERATOR_FEATURES.conversationCanvas = false
    assert.equal(localOperatorFeatureEnabled("conversationCanvas", true, true), false)
  } finally { LOCAL_GATEWAY_OPERATOR_FEATURES.conversationCanvas = original }
  assert.equal(resolveFeature("conversationCanvas", { deployment: "self_hosted", locks: LOCAL_GATEWAY_OPERATOR_FEATURES,
    overrides: {}, rollouts: { conversationCanvas: { enabled: true, killed: true } } }).enabled, false)
})
