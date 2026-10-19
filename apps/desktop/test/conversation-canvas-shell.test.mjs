import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANVAS_SHELL_URL, canvasShellResponse, installCanvasShellProtocol, prepareCanvasShellProtocol } from "../electron/conversation-canvas-shell.mjs";

test("enables the native network policy before ready while preserving existing switches", () => {
  const switches = new Map([["enable-features", "ExistingFeature"]]);
  let registered;
  const app = { isReady: () => false, commandLine: {
    getSwitchValue: key => switches.get(key) ?? "", appendSwitch: (key, value) => switches.set(key, value),
  } };
  const protocol = { registerSchemesAsPrivileged: schemes => { registered = schemes; } };
  assert.equal(prepareCanvasShellProtocol(app, protocol), true);
  assert.equal(switches.get("enable-features"), "ExistingFeature,ConnectionAllowlists,OverrideConnectionAllowlistOriginTrial");
  assert.equal(registered[0].scheme, "zeno-canvas");
  assert.equal(registered[0].privileges.bypassCSP, undefined);
  switches.set("disable-features", "ConnectionAllowlists");
  assert.equal(prepareCanvasShellProtocol(app, protocol), false);
  assert.equal(prepareCanvasShellProtocol({ ...app, isReady: () => true }, protocol), false);
});

test("serves a fixed trusted document with a deny-all header and validates every URL component", async () => {
  const source = '<meta name="zeno-canvas-shell" content="1">';
  const response = canvasShellResponse(new Request(`${CANVAS_SHELL_URL}?instance=${"a".repeat(48)}`), source);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Connection-Allowlist"), "()");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), source);
  assert.equal(await canvasShellResponse(new Request(CANVAS_SHELL_URL, { method: "HEAD" }), source).text(), "");
  for (const url of ["zeno-canvas://other/zeno-canvas-shell.html", "zeno-canvas://shell/other.html", `${CANVAS_SHELL_URL}?source=untrusted`, `${CANVAS_SHELL_URL}?instance=bad`, `${CANVAS_SHELL_URL}?instance=${"a".repeat(48)}&instance=${"b".repeat(48)}`]) {
    assert.equal(canvasShellResponse(new Request(url), source).status, 404);
  }
  assert.equal(canvasShellResponse(new Request(CANVAS_SHELL_URL, { method: "POST" }), source).status, 405);
});

test("advertises native support only after trusted shell installation and supported policy setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "zeno-canvas-protocol-"));
  const shellPath = join(root, "shell.html");
  const handlers = new Map();
  const protocol = { handle: (scheme, handler) => handlers.set(scheme, handler) };
  try {
    await writeFile(shellPath, '<meta name="zeno-canvas-shell" content="1"><p>Trusted fixture</p>');
    for (const chromiumVersion of ["149.0", "unknown", ""]) {
      assert.equal(await installCanvasShellProtocol({ protocol, shellPath, prepared: true, chromiumVersion }), null);
    }
    assert.equal(await installCanvasShellProtocol({ protocol, shellPath, prepared: false, chromiumVersion: "150.0" }), null);
    const capability = await installCanvasShellProtocol({ protocol, shellPath, prepared: true, chromiumVersion: "150.0" });
    assert.deepEqual(capability, { shellUrl: CANVAS_SHELL_URL, networkPolicy: "connection-allowlist" });
    assert.equal(Object.isFrozen(capability), true);
    assert.equal(handlers.get("zeno-canvas")(new Request(CANVAS_SHELL_URL)).headers.get("Connection-Allowlist"), "()");
    await writeFile(shellPath, "<!doctype html><p>Wrong document</p>");
    assert.equal(await installCanvasShellProtocol({ protocol, shellPath, prepared: true, chromiumVersion: "150.0" }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
