import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import asar from "@electron/asar";
import { verifyCanvasPackaging } from "../scripts/verify-canvas-packaging.mjs";

const runtimeName = "_virtual_zeno-canvas-chart-runtime-fixture.js";
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "zeno-canvas-package-"));
  const source = join(root, "source"); const resources = join(root, "resources"); const archive = join(resources, "app.asar");
  const files = {
    "electron/conversation-canvas-shell.mjs": await readFile(new URL("../electron/conversation-canvas-shell.mjs", import.meta.url)),
    "electron/main.mjs": await readFile(new URL("../electron/main.mjs", import.meta.url)),
    "electron/preload.mjs": await readFile(new URL("../electron/preload.mjs", import.meta.url)),
    "server/dist/conversation-canvas-prompt.js": "export const CONVERSATION_CANVAS_INSTRUCTION='zeno-html ant-chart ZenoCharts';",
    "server/dist/openwork-agent-prompt.js": "export const prompt='CONVERSATION_CANVAS_INSTRUCTION localOperatorFeatureEnabled conversationCanvas';",
    "server/dist/opencode-v2-instructions.js": "export const buildOpenWorkAgentPrompt=()=>'';",
    "node_modules/@openwork/features/index.js": "export const conversationCanvas=false;export const localOperatorFeatureEnabled=()=>false;",
    "node_modules/@openwork/features/resolve.js": "export const conversationCanvas=false;export const localOperatorFeatureEnabled=()=>false;",
  };
  const store = async (path, bytes) => { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, bytes); };
  for (const [name, bytes] of Object.entries(files)) await store(join(source, name), bytes);
  await store(join(resources, "app-dist", "zeno-canvas-shell.html"), await readFile(new URL("../../app/public/zeno-canvas-shell.html", import.meta.url)));
  // A large inert fixture tests archive/resource plumbing; real Ant rendering
  // and CSP/UDP checks have their own headless browser fixtures.
  const runtime = "export default 'window.ZenoCharts=Object.freeze 2.6.5 zeno-charts-ready FlowGraph OrganizationChart" + " ".repeat(100_000) + "';";
  await store(join(resources, "app-dist", "assets", runtimeName), runtime);
  await store(join(resources, "app-dist", "assets", "app-fixture.js"), `export const load=()=>import('./${runtimeName}');`);
  await asar.createPackage(source, archive);
  const repack = async () => { asar.uncacheAll(); await rm(archive); await asar.createPackage(source, archive); };
  try { await run({ root, source, resources, archive, repack, store }); }
  finally { asar.uncacheAll(); await rm(root, { recursive: true, force: true }); }
}

test("accepts actual native wiring and static shell in an ASAR/resource layout, including an off feature", async () => fixture(async ({ archive, resources }) => {
  const report = verifyCanvasPackaging({ archive, resources });
  assert.equal(report.scope, "packaged-presence-and-wiring");
  assert.equal(report.promptV1V2, true); assert.equal(report.sharedFeature, true);
  assert.ok(report.offlineAntRuntime.bytes > 100_000); assert.match(report.offlineAntRuntime.sha256, /^[a-f0-9]{64}$/);
}));

test("rejects a missing/mismatched shell, truncated or unreferenced runtime and stale duplicate chunks", async () => fixture(async ({ archive, resources, store }) => {
  const shellPath = join(resources, "app-dist", "zeno-canvas-shell.html"); const shell = await readFile(shellPath);
  await rm(shellPath); assert.throws(() => verifyCanvasPackaging({ archive, resources }), /ENOENT/);
  await store(shellPath, "<!doctype html><p>Wrong document</p>"); assert.throws(() => verifyCanvasPackaging({ archive, resources }), /trusted shell/);
  await store(shellPath, shell);
  const runtimePath = join(resources, "app-dist", "assets", runtimeName); const runtime = await readFile(runtimePath);
  await store(runtimePath, "export default 'ZenoCharts';"); assert.throws(() => verifyCanvasPackaging({ archive, resources }), /truncated/);
  await store(runtimePath, runtime);
  await store(join(resources, "app-dist", "assets", "app-fixture.js"), "export const load=()=>null;"); assert.throws(() => verifyCanvasPackaging({ archive, resources }), /unreachable/);
  await store(join(resources, "app-dist", "assets", "app-fixture.js"), `import('./${runtimeName}');`);
  await store(join(resources, "app-dist", "assets", "_virtual_zeno-canvas-chart-runtime-stale.js"), runtime);
  assert.throws(() => verifyCanvasPackaging({ archive, resources }), /exactly one/);
}));

test("rejects omitted native policy, preload wiring and backend instructions instead of silently shipping code-only", async () => fixture(async ({ source, archive, resources, repack, store }) => {
  for (const name of ["electron/conversation-canvas-shell.mjs", "electron/preload.mjs", "server/dist/conversation-canvas-prompt.js", "node_modules/@openwork/features/index.js"]) {
    const path = join(source, name); const original = await readFile(path);
    await store(path, "export default {};"); await repack();
    assert.throws(() => verifyCanvasPackaging({ archive, resources }), /missing or incomplete/);
    await store(path, original); await repack();
  }
  assert.equal(verifyCanvasPackaging({ archive, resources }).nativeBridge, true);
}));
