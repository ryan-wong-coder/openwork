import assert from "node:assert/strict";
import test from "node:test";
import { registerUpdaterIpc } from "../electron/updater.mjs";

test("Zeno updater and recovery never load an updater, inspect a feed or download", async () => {
  const handlers = new Map();
  let externalCalls = 0;
  const forbidden = () => { externalCalls += 1; throw new Error("independent distribution must stay offline"); };
  const { ensureAutoUpdater } = registerUpdaterIpc({
    app: { isPackaged: true, getVersion: () => "1.0.0", getPath: forbidden },
    updatesEnabled: false,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    getMainWindow: () => null,
    loadAutoUpdater: forbidden,
    electronNet: { fetch: forbidden },
    shell: { openExternal: forbidden, openPath: forbidden },
  });
  assert.equal(await ensureAutoUpdater(), null);
  for (const name of ["check", "download", "installAndRestart", "getChannel", "setChannel"]) {
    const result = await handlers.get(`openwork:updater:${name}`)(null, "alpha");
    assert.ok(result.reason);
  }
  for (const name of ["recordHealthy", "list", "use", "restorePrevious"]) {
    assert.equal((await handlers.get(`openwork:recovery:${name}`)(null, { versions: ["2.0.0"] })).ok, false);
  }
  assert.equal(externalCalls, 0);
});
