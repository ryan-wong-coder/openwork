import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import asar from '@electron/asar';
import { personalRuntimeSmokeSource, verifyPersonalPackaging } from '../scripts/verify-personal-packaging.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const repo = resolve(desktop, '../..');
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'zeno-personal-package-'));
  const source = join(root, 'source'), archive = join(root, 'app.asar');
  const store = async (name, value) => { await mkdir(dirname(join(source, name)), { recursive: true }); await writeFile(join(source, name), value); };
  await store('package.json', JSON.stringify({ name: 'synthetic-zeno-package', type: 'module' }));
  for (const name of ['main', 'preload', 'zeno-personal', 'zeno-personal-tools', 'zeno-scheduler', 'session-runner-adapter', 'automation-runner']) await store(`electron/${name}.mjs`, await readFile(join(desktop, 'electron', name + '.mjs')));
  const packageRoot = join(source, 'node_modules/@zeno/core'); await mkdir(packageRoot, { recursive: true });
  await cp(join(repo, 'packages/zeno-core/dist'), join(packageRoot, 'dist'), { recursive: true });
  await cp(join(repo, 'packages/zeno-core/package.json'), join(packageRoot, 'package.json'));
  const notices = {
    'openGym-AGPL-3.0.txt': 'packages/zeno-fitness/LICENSE', 'openGym-NOTICE.md': 'packages/zeno-fitness/UPSTREAM-NOTICE.md',
    'openGym-source-manifest.json': 'packages/zeno-fitness/upstream-manifest.json', 'OpenWork-MIT.txt': 'LICENSE', 'Zeno-NOTICE.md': 'apps/app/THIRD_PARTY_NOTICES.md',
  };
  for (const [name, path] of Object.entries(notices)) await store('licenses/' + name, await readFile(join(repo, path)));
  const repack = async () => { asar.uncacheAll(); await rm(archive, { force: true }); await asar.createPackage(source, archive); };
  await repack();
  try { await run({ root, source, archive, store, repack }); }
  finally { asar.uncacheAll(); await rm(root, { recursive: true, force: true }); }
}

test('personal ASAR gate accepts actual modules, compiled core and upstream notices', async () => fixture(async ({ archive }) => {
  assert.deepEqual(verifyPersonalPackaging({ archive }), { scope: 'packaged-presence-and-wiring', modules: true, compiledCore: true, mainIpcBoundary: true, accountBinding: true, licensesAndNotices: true });
}));

test('personal ASAR gate rejects TS exports and missing account/IPC/license safeguards', async () => fixture(async ({ source, archive, repack, store }) => {
  const manifestPath = 'node_modules/@zeno/core/package.json'; const manifest = JSON.parse(await readFile(join(source, manifestPath), 'utf8'));
  await store(manifestPath, JSON.stringify({ ...manifest, exports: { ...manifest.exports, '.': './src/index.ts' } })); await repack();
  assert.throws(() => verifyPersonalPackaging({ archive }), /compiled JavaScript/); await store(manifestPath, JSON.stringify(manifest));
  for (const [name, marker] of [['electron/zeno-personal.mjs', 'X-Zeno-Account'], ['electron/main.mjs', 'event.senderFrame !== mainWindow.webContents.mainFrame'], ['licenses/openGym-AGPL-3.0.txt', 'GNU AFFERO GENERAL PUBLIC LICENSE']]) {
    const original = await readFile(join(source, name), 'utf8'); await store(name, original.replaceAll(marker, 'omitted-synthetic-marker')); await repack();
    assert.throws(() => verifyPersonalPackaging({ archive }), /missing or incomplete/); await store(name, original);
  }
  await repack(); assert.equal(verifyPersonalPackaging({ archive }).compiledCore, true);
}));

// This optional local fixture uses an installed Electron binary in Node mode.
// Release CI runs the same smoke against each actual packaged native archive.
const electron = process.env.ZENO_PACKAGING_TEST_ELECTRON;
test('shipping Electron Node executes real compiled personal modules from a synthetic ASAR without GUI or AI', { skip: !electron || !existsSync(electron) }, async () => fixture(async ({ root, source, archive, store, repack }) => {
  for (const name of ['zod', '@opencode-ai/sdk']) {
    const destination = join(source, 'node_modules', name); await mkdir(dirname(destination), { recursive: true });
    await cp(await realpath(join(desktop, 'node_modules', name)), destination, { recursive: true, filter: path => !path.split(/[\\/]/).includes('.git') });
  }
  for (const [name, folder] of [['headless-threads', 'headless-threads'], ['remote-sessions', 'remote-sessions']]) {
    const destination = join(source, 'node_modules/@openwork', name); await mkdir(destination, { recursive: true });
    await cp(join(repo, 'packages', folder, 'dist'), join(destination, 'dist'), { recursive: true });
    await cp(join(repo, 'packages', folder, 'package.json'), join(destination, 'package.json'));
  }
  await repack(); assert.equal(verifyPersonalPackaging({ archive }).compiledCore, true);
  const script = join(root, 'smoke.mjs');
  await writeFile(script, "import assert from 'node:assert/strict';import{createRequire}from'node:module';import{pathToFileURL}from'node:url';const archive=process.env.ZENO_SMOKE_ARCHIVE;const require=createRequire(pathToFileURL(archive+'/package.json'));\n" + personalRuntimeSmokeSource);
  const result = spawnSync(electron, [script], { timeout: 30000, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', NODE_PATH: '', ZENO_SMOKE_ARCHIVE: archive, ZENO_SMOKE_PERSONAL_ROOT: join(root, 'synthetic-personal') } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"packagedPersonal":true/); assert.match(result.stdout, /"safeStorageScope":"synthetic-only-not-os-validation"/);
}));
