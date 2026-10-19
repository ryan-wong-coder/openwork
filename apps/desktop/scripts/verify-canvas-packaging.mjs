import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import asar from "@electron/asar";

function requireMarkers(source, markers, label) {
  if (!source || markers.some(marker => !source.includes(marker))) throw new Error(`Packaged canvas ${label} is missing or incomplete.`);
}

/** Presence and wiring checks; real browser/network isolation has separate QA. */
export function verifyCanvasPackaging({ archive, resources }) {
  const archived = name => asar.extractFile(archive, name.split("/").join(process.platform === "win32" ? "\\" : "/")).toString("utf8");
  const shell = readFileSync(join(resources, "app-dist", "zeno-canvas-shell.html"), "utf8");
  requireMarkers(shell, ['<meta name="zeno-canvas-shell" content="1">', "shell-ready", "event.source===parent", "frame-src about:"], "trusted shell");
  requireMarkers(archived("electron/conversation-canvas-shell.mjs"), ["ConnectionAllowlists", "OverrideConnectionAllowlistOriginTrial", '"Connection-Allowlist": "()"', "protocol.handle", "connection-allowlist"], "native network policy");
  requireMarkers(archived("electron/main.mjs"), ["prepareCanvasShellProtocol(app, protocol)", "await installCanvasShellProtocol", '"zeno-canvas-shell.html"', "openwork:conversation-canvas-shell-sync"], "main wiring");
  requireMarkers(archived("electron/preload.mjs"), ["openwork:conversation-canvas-shell-sync", "conversationCanvas", "process.isMainFrame"], "preload capability");
  requireMarkers(archived("server/dist/conversation-canvas-prompt.js"), ["zeno-html", "ant-chart", "ZenoCharts"], "prompt protocol");
  requireMarkers(archived("server/dist/openwork-agent-prompt.js"), ["CONVERSATION_CANVAS_INSTRUCTION", "localOperatorFeatureEnabled", "conversationCanvas"], "V1 prompt wiring");
  requireMarkers(archived("server/dist/opencode-v2-instructions.js"), ["buildOpenWorkAgentPrompt"], "V2 prompt wiring");
  for (const name of ["index", "resolve"]) requireMarkers(archived(`node_modules/@openwork/features/${name}.js`), ["conversationCanvas", "localOperatorFeatureEnabled"], "shared feature runtime");

  const directory = join(resources, "app-dist", "assets");
  const assets = readdirSync(directory).filter(name => name.endsWith(".js"));
  const runtimes = assets.filter(name => /^_virtual_zeno-canvas-chart-runtime-[A-Za-z0-9_-]+\.js$/.test(name));
  if (runtimes.length !== 1) throw new Error("Packaged canvas requires exactly one lazy Ant Design Charts runtime.");
  const runtimeName = runtimes[0];
  const runtime = readFileSync(join(directory, runtimeName));
  const source = runtime.toString("utf8");
  if (runtime.length < 100_000) throw new Error("Packaged canvas Ant Design Charts runtime is truncated.");
  requireMarkers(source, ["window.ZenoCharts=Object.freeze", "2.6.5", "zeno-charts-ready", "FlowGraph", "OrganizationChart"], "offline Ant Design Charts runtime");
  if (!assets.some(name => name !== runtimeName && readFileSync(join(directory, name), "utf8").includes(runtimeName))) {
    throw new Error("Packaged canvas lazy chart runtime is unreachable from renderer assets.");
  }
  return { scope: "packaged-presence-and-wiring", shell: true, nativeBridge: true, promptV1V2: true, sharedFeature: true,
    offlineAntRuntime: { bytes: runtime.length, sha256: createHash("sha256").update(runtime).digest("hex") } };
}
