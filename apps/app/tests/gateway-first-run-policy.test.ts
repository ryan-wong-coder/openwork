import { expect, test } from "bun:test";
import { gatewayEngineModelReady, shouldShowGatewayFirstRun } from "../src/react-app/domains/settings/pages/gateway-first-run-policy";

const firstRun = {
  enabled: true,
  hasClient: true,
  configured: false,
  skipped: false,
  conversation: false,
  otherSurface: false,
};
const fullModelId = "anthropic/claude-sonnet-5";

test("first run appears only after an enabled client confirms the gateway is unconfigured", () => {
  expect(shouldShowGatewayFirstRun(firstRun)).toBe(true);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: null })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: true })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, enabled: false })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, hasClient: false })).toBe(false);
});

test("skip, existing conversations and other app surfaces keep their current destination", () => {
  expect(shouldShowGatewayFirstRun({ ...firstRun, skipped: true })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, conversation: true })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, otherSurface: true })).toBe(false);
});

test("late status and a newly selected backend must be confirmed independently", () => {
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: null })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: false })).toBe(true);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: true })).toBe(false);
  // Switching the client resets its status while the new backend is checked.
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: null })).toBe(false);
  // A late negative result cannot replace a chat or undo the person's skip.
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: false, conversation: true })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: false, skipped: true })).toBe(false);
});

test("an explicitly pending setup stays visible through configuration and engine confirmation", () => {
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: true, pending: true })).toBe(true);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: null, pending: true })).toBe(true);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: true, pending: false })).toBe(false);
  expect(shouldShowGatewayFirstRun({ ...firstRun, configured: null, pending: false })).toBe(false);
  for (const constraint of [
    { skipped: true }, { hasClient: false }, { enabled: false }, { conversation: true }, { otherSurface: true },
  ]) {
    expect(shouldShowGatewayFirstRun({ ...firstRun, configured: true, pending: true, ...constraint })).toBe(false);
  }
});

test("model readiness requires the live gateway provider and its exact full model id", () => {
  const all = [{ id: "modelhelm", models: { [fullModelId]: { name: "Conversation model" } } }];
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all }, fullModelId)).toBe(true);
  expect(gatewayEngineModelReady({ connected: [], all }, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["another-provider"], all }, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all }, "claude-sonnet-5")).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all }, "openai/gpt-image-2")).toBe(false);
});

test("missing and stale catalogs cannot establish engine readiness", () => {
  expect(gatewayEngineModelReady(null, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady(undefined, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all: [] }, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all: [{ id: "modelhelm" }] }, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all: [{ id: "another-provider", models: { [fullModelId]: {} } }] }, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all: [{ id: "modelhelm", models: {} }] }, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady({ connected: ["modelhelm"], all: [{ id: "modelhelm", models: { [fullModelId]: {} } }] }, "")).toBe(false);
});

test("model keys must belong to the gateway's own catalog rather than its prototype", () => {
  const models: Record<string, unknown> = {};
  Object.setPrototypeOf(models, { [fullModelId]: { name: "Inherited model" } });
  const catalog = { connected: ["modelhelm"], all: [{ id: "modelhelm", models }] };
  expect(gatewayEngineModelReady(catalog, fullModelId)).toBe(false);
  expect(gatewayEngineModelReady(catalog, "constructor")).toBe(false);
  models[fullModelId] = { name: "Verified model" };
  expect(gatewayEngineModelReady(catalog, fullModelId)).toBe(true);
});
