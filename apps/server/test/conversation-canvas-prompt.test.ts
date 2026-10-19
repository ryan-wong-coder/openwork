import { expect, spyOn, test } from "bun:test";
import { LOCAL_GATEWAY_OPERATOR_FEATURES, localOperatorFeatureEnabled } from "@openwork/features";
import { CONVERSATION_CANVAS_INSTRUCTION } from "../src/conversation-canvas-prompt";
import { buildOpenWorkAgentPrompt, OPENWORK_AGENT_PROMPT, ZENO_AGENT_PROMPT } from "../src/openwork-agent-prompt";
import { buildOpenWorkV2Instructions } from "../src/opencode-v2-instructions";
import { buildOpenworkRuntimeConfigObjectFromSnapshot } from "../src/openwork-runtime-config";

test("V1 runtime config and V2 request instructions advertise the same local renderer capability without network reads", () => {
  const fetched = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external request"));
  try {
    const snapshot = { model: "synthetic/model", instructions: ["preserved-guide.md"] };
    const before = JSON.stringify(snapshot);
    const runtime = buildOpenworkRuntimeConfigObjectFromSnapshot(snapshot, { clientProfile: "local-gateway" });
    expect(JSON.stringify(runtime)).toContain("Interactive visuals in this conversation");
    expect(runtime.model).toBe(snapshot.model);
    expect(runtime.instructions).toEqual(snapshot.instructions);
    expect(JSON.stringify(snapshot)).toBe(before);
    const v1 = buildOpenWorkAgentPrompt("local-gateway");
    const v2 = buildOpenWorkV2Instructions(false, "local-gateway").operatingInstructions;
    expect(v1).toBe(`${ZENO_AGENT_PROMPT}\n\n${CONVERSATION_CANVAS_INSTRUCTION}`);
    expect(v2).toBe(v1);
    expect(localOperatorFeatureEnabled("conversationCanvas", true)).toBe(true);
    expect(fetched).not.toHaveBeenCalled();
  } finally { fetched.mockRestore(); }
});

test("unknown and connected renderers preserve their prior prompt unless explicitly supported", () => {
  for (const profile of ["connected", "unknown", ""]) {
    expect(buildOpenWorkAgentPrompt(profile)).toBe(OPENWORK_AGENT_PROMPT);
    expect(buildOpenWorkV2Instructions(true, profile).operatingInstructions).not.toContain(CONVERSATION_CANVAS_INSTRUCTION);
  }
  expect(buildOpenWorkAgentPrompt("connected", { conversationCanvas: true })).toContain(CONVERSATION_CANVAS_INSTRUCTION);
});

test("an explicitly disabled renderer removes only the visual guidance for both engines", () => {
  expect(buildOpenWorkAgentPrompt("local-gateway", { conversationCanvas: false })).toBe(ZENO_AGENT_PROMPT);
  expect(buildOpenWorkV2Instructions(false, "local-gateway", { conversationCanvas: false }).operatingInstructions).toBe(ZENO_AGENT_PROMPT);
  expect(buildOpenWorkAgentPrompt("connected", { conversationCanvas: false })).toBe(OPENWORK_AGENT_PROMPT);
  expect(ZENO_AGENT_PROMPT).not.toContain("ant-chart");
});

test("the shared installation rollback disables the frontend resolver and both prompt paths", () => {
  const original = LOCAL_GATEWAY_OPERATOR_FEATURES.conversationCanvas;
  try {
    LOCAL_GATEWAY_OPERATOR_FEATURES.conversationCanvas = false;
    expect(localOperatorFeatureEnabled("conversationCanvas", true)).toBe(false);
    expect(buildOpenWorkAgentPrompt("local-gateway")).toBe(ZENO_AGENT_PROMPT);
    expect(buildOpenWorkAgentPrompt("local-gateway", { conversationCanvas: true })).toBe(ZENO_AGENT_PROMPT);
    expect(buildOpenWorkV2Instructions(false, "local-gateway").operatingInstructions).toBe(ZENO_AGENT_PROMPT);
    const runtime = buildOpenworkRuntimeConfigObjectFromSnapshot({}, { clientProfile: "local-gateway" });
    expect(JSON.stringify(runtime)).not.toContain("Interactive visuals in this conversation");
  } finally { LOCAL_GATEWAY_OPERATOR_FEATURES.conversationCanvas = original; }
});

test("the protocol guidance uses inline charts and meaningful Chinese visuals without vendor accounts", () => {
  for (const text of ["zeno-html", "ant-chart", "ZenoCharts.ready", "ZenoCharts.render(element, config)", "update(config)", "destroy()",
    "Column", "FlowGraph", "Chinese", "inline", "keyboard", "verified", "single fact", "real workspace files", "No network requests"]) {
    expect(CONVERSATION_CANVAS_INSTRUCTION).toContain(text);
  }
  for (const text of ["openwork-cloud", "openworklabs.com", "apiKey:", "https://", "fetch("]) expect(CONVERSATION_CANVAS_INSTRUCTION).not.toContain(text);
});
