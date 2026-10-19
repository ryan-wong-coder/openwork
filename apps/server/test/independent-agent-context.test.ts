import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { buildOpenWorkAgentPrompt } from "../src/openwork-agent-prompt";
import { buildOpenWorkV2Instructions } from "../src/opencode-v2-instructions";
import { OpenWorkCapabilitiesKnowledge } from "../src/opencode-plugins/openwork-capabilities-knowledge";
import { OpenWorkExtensionsPreview } from "../src/opencode-plugins/openwork-extensions-preview";
import { buildOpenworkProviderContributions } from "../src/opencode-plugins/openwork-provider-adapters";
import { registerCloudSkillDiscovery } from "../src/opencode-plugins/openwork-cloud-skills-v2";
import { resolveOpenWorkAutomationInstruction, resolveOpenWorkConnectSkillInstruction, resolveOpenWorkExtensionDiscoveryInstruction } from "../src/opencode-plugins/openwork-extensions-preview-steering";
import { createV2ContextBridge } from "../src/opencode-v2-context-bridge";

let previousProfile: string | undefined;
beforeEach(() => { previousProfile = process.env.OPENWORK_CLIENT_PROFILE; process.env.OPENWORK_CLIENT_PROFILE = "local-gateway"; });
afterEach(() => { if (previousProfile === undefined) delete process.env.OPENWORK_CLIENT_PROFILE; else process.env.OPENWORK_CLIENT_PROFILE = previousProfile; });

function expectIndependentPrompt(prompt: string) {
  expect(prompt).toContain("Zeno");
  expect(prompt).not.toContain("OpenWork Cloud");
  expect(prompt).not.toContain("openwork-cloud_");
  expect(prompt).not.toContain("openwork-cloud.");
  expect(prompt).not.toContain("openworklabs.com");
  expect(prompt).not.toContain("createCloudAutomation");
  expect(prompt).not.toContain("Settings → Connect");
  expect(prompt).toContain("OAuth");
  expect(prompt).toContain("MCP");
  expect(prompt).toContain("openwork_image_generate");
}

test("the actual V1 system transforms retain user capabilities without vendor-account instructions", async () => {
  const system = [buildOpenWorkAgentPrompt("local-gateway")];
  const knowledge = await OpenWorkCapabilitiesKnowledge();
  const extensions = await OpenWorkExtensionsPreview();
  try {
    await knowledge["experimental.chat.system.transform"]({}, { system });
    await extensions["experimental.chat.system.transform"]({}, { system });
    expect(system).toHaveLength(1);
    expectIndependentPrompt(system.join("\n"));
    expect(system.join("\n")).toContain("Interactive visuals in this conversation");
    expect(Object.keys(knowledge.tool)).toEqual([]);
    expect(extensions.tool).toHaveProperty("openwork_image_generate");
    expect(extensions.tool).toHaveProperty("openwork_context");
    expect(extensions.tool).not.toHaveProperty("drive_pull_file");
    expect(extensions.tool).not.toHaveProperty("drive_push_file");
    await expect(extensions.tool.openwork_execute.execute({ id: "automation.propose", args: {} }, {})).rejects.toThrow("no built-in hosted scheduler");
  } finally { await extensions.dispose(); }
});

test("V2 instructions use the trusted standalone profile even if a stale Connect is reported ready", () => {
  expectIndependentPrompt(JSON.stringify(buildOpenWorkV2Instructions(true, "local-gateway")));
  expect(JSON.stringify(buildOpenWorkV2Instructions(true, "connected"))).toContain("OpenWork Connect tools are connected");
  expect(buildOpenWorkAgentPrompt("connected")).toContain("openwork-cloud_search_capabilities");
});

test("explicit connected engines retain the legacy knowledge and supported Cloud tool guidance", async () => {
  process.env.OPENWORK_CLIENT_PROFILE = "connected";
  const system = [buildOpenWorkAgentPrompt("connected")];
  const knowledge = await OpenWorkCapabilitiesKnowledge();
  const extensions = await OpenWorkExtensionsPreview();
  try {
    await knowledge["experimental.chat.system.transform"]({}, { system });
    await extensions["experimental.chat.system.transform"]({}, { system });
    expect(system.join("\n")).toContain("OpenWork Cloud");
    expect(knowledge.tool).toHaveProperty("openwork_docs_search");
    expect(extensions.tool).toHaveProperty("drive_pull_file");
    expect(JSON.stringify(buildOpenworkProviderContributions([], [{ name: "openwork-cloud", status: "connected" }]))).toContain("automation.propose");
  } finally { await extensions.dispose(); }
});

test("discovery context keeps user MCP servers and omits managed catalogs and hosted scheduling", () => {
  const contributions = buildOpenworkProviderContributions([], [
    { name: "my-files", status: "connected" }, { name: "my-oauth-service", status: "connected" },
    { name: "openwork-cloud", status: "connected" }, { name: "openwork-direct-calendar", status: "connected" },
  ], true);
  const serialized = JSON.stringify(contributions);
  expect(serialized).toContain("my-files");
  expect(serialized).toContain("my-oauth-service");
  expect(serialized).not.toContain("openwork-cloud");
  expect(serialized).not.toContain("openwork-direct-calendar");
  expect(serialized).not.toContain("automation.propose");
});

test("standalone steering never probes Connect or starts V2 cloud-skill discovery", async () => {
  const fetched = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected discovery request"));
  const intervals = spyOn(globalThis, "setInterval");
  let engineProbes = 0;
  try {
    expect(await resolveOpenWorkConnectSkillInstruction()).toBe("");
    expect(await resolveOpenWorkAutomationInstruction()).toBe("");
    expect(await resolveOpenWorkExtensionDiscoveryInstruction({}, fetch, { client: { mcp: { status: async () => { engineProbes++; return {}; } } } })).not.toContain("OpenWork Cloud");
    const stop = await registerCloudSkillDiscovery({ options: { url: "http://127.0.0.1:1/read", token: "fixture" }, skill: {
      transform: async () => { throw new Error("Must not touch native local skills"); }, reload: async () => { throw new Error("Must not reload native local skills"); },
    } });
    await stop();
    expect(engineProbes).toBe(0);
    expect(fetched).not.toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();
  } finally { fetched.mockRestore(); intervals.mockRestore(); }
});

test("the V2 read bridge uses its trusted host profile without querying a remote catalog", async () => {
  // The host can be configured through CLI while its own process env remains unset.
  delete process.env.OPENWORK_CLIENT_PROFILE;
  const paths: string[] = [];
  const bridge = await createV2ContextBridge(async (path) => {
    paths.push(path);
    if (path === "/experimental/ui-control/request") return { context: { availableAffordances: [] } };
    throw new Error(`Unexpected host read ${path}`);
  }, { clientProfile: "local-gateway" });
  try {
    const call = async (name: string) => fetch(bridge.url, { method: "POST", headers: { Authorization: `Bearer ${bridge.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name, input: {} }) });
    const response = await call("openwork_context");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("automation.propose");
    expect(text).not.toContain("openwork-cloud");
    expect(paths).toEqual(["/experimental/ui-control/request"]);
    expect(await (await call("openwork_skills")).json()).toEqual({ skills: [], instruction: "" });
    expect(paths).toHaveLength(1);
  } finally { await bridge.close(); }
});
