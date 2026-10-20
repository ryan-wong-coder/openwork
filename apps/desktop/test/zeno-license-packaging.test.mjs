import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';
import YAML from 'yaml';
import { stageZenoLicenses, zenoLicenseInputs } from '../scripts/prepare-zeno-runtime.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const repository = resolve(desktop, '../..');
// Invoke the same pinned file matcher, directory walker and archive writer as
// electron-builder. A hand-built @electron/asar fixture missed this regression.
const buildArchive = `
  import assert from 'node:assert/strict';
  import { createRequire } from 'node:module';
  import { join } from 'node:path';
  const { desktop, project, destination, resourcePath, mappings, root } = JSON.parse(process.argv[1]);
  const require = createRequire(join(desktop, 'package.json'));
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const { getFileMatchers } = builderRequire('app-builder-lib/out/fileMatcher');
  const { computeFileSets } = builderRequire('app-builder-lib/out/util/appFileCopier');
  const { AsarPackager } = builderRequire('app-builder-lib/out/asar/asarUtil');
  const platformPackager = { info: { areNodeModulesHandledExternally: true, getWorkspaceRoot: async () => root }, config: {} };
  const matchers = getFileMatchers({ files: mappings }, 'files', destination, { macroExpander: value => value, customBuildOptions: {}, globalOutDir: resourcePath, defaultSrc: project });
  const fileSets = await computeFileSets(matchers, null, platformPackager, false);
  assert.equal(fileSets.length, 1);
  assert.equal(fileSets[0].files.length, 5, 'Builder silently omitted a legal input.');
  await new AsarPackager(platformPackager, { resourcePath, defaultDestination: destination, options: { smartUnpack: false } }).pack(fileSets);
`;
const expectedNames = ['OpenWork-MIT.txt', 'Zeno-NOTICE.md', 'openGym-AGPL-3.0.txt', 'openGym-NOTICE.md', 'openGym-source-manifest.json'].sort();

async function fixture(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-builder-license-')));
  const project = join(root, 'desktop'), source = join(root, 'repository'), outputDirectory = join(project, '.electron-runtime/licenses');
  mkdirSync(project, { recursive: true });
  const originals = new Map();
  for (const input of zenoLicenseInputs) {
    const bytes = readFileSync(resolve(repository, input.source)); originals.set(input.name, bytes);
    const target = resolve(source, input.source); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  try { await run({ root, project, source, outputDirectory, originals }); }
  finally { asar.uncacheAll(); rmSync(root, { recursive: true, force: true }); }
}

test('real electron-builder collection and AsarPackager include five complete original licenses', async () => fixture(async ({ root, project, source, outputDirectory, originals }) => {
  assert.deepEqual(zenoLicenseInputs.map(input => input.name).sort(), expectedNames);
  assert.deepEqual(stageZenoLicenses({ repositoryRoot: source, outputDirectory }).sort(), expectedNames);
  const config = YAML.parse(readFileSync(join(desktop, 'electron-builder.zeno.yml'), 'utf8'));
  const mappings = config.files.filter(entry => typeof entry === 'object' && (entry.to === 'licenses' || entry.to?.startsWith('licenses/')));
  assert.equal(mappings.length, 1, 'Licenses must be collected as one staged directory, never single-file from mappings.');
  assert.equal(mappings[0].from, '.electron-runtime/licenses'); assert.equal(mappings[0].to, 'licenses');
  const destination = join(root, 'application'), resourcePath = join(root, 'resources'); mkdirSync(resourcePath);
  // asar 3.4.1 resolves pack() before its final write stream emits finish.
  // A real CLI process must drain that stream before exit. Match that lifecycle
  // without sleeps, writer mocks, or relaxing byte-for-byte archive assertions.
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', buildArchive, JSON.stringify({ desktop, project, destination, resourcePath, mappings, root })], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, 'Actual electron-builder collection/archive child failed: ' + child.stderr);
  const archive = join(resourcePath, 'app.asar');
  for (const name of expectedNames) assert.equal(asar.extractFile(archive, join('licenses', name)).equals(originals.get(name)), true, 'Archived license bytes differ from the original source: ' + name);
  const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'));
  assert.equal(entries.filter(name => name.startsWith('/licenses/')).length, 5);
}));

test('missing or empty input fails before producing any partial license staging directory', async () => fixture(async ({ root, source, originals }) => {
  for (const [index, input] of zenoLicenseInputs.entries()) {
    const file = resolve(source, input.source), outputDirectory = join(root, 'missing-' + index);
    rmSync(file); assert.throws(() => stageZenoLicenses({ repositoryRoot: source, outputDirectory }));
    assert.throws(() => readdirSync(outputDirectory), { code: 'ENOENT' });
    writeFileSync(file, Buffer.alloc(0)); assert.throws(() => stageZenoLicenses({ repositoryRoot: source, outputDirectory }), /license input is empty/);
    assert.throws(() => readdirSync(outputDirectory), { code: 'ENOENT' });
    writeFileSync(file, originals.get(input.name));
  }
}));

test('repeat staging removes stale files and preserves all source bytes without text normalization', async () => fixture(async ({ source, outputDirectory, originals }) => {
  stageZenoLicenses({ repositoryRoot: source, outputDirectory });
  writeFileSync(join(outputDirectory, 'stale-public-fixture.txt'), 'must not ship');
  stageZenoLicenses({ repositoryRoot: source, outputDirectory });
  assert.deepEqual(readdirSync(outputDirectory).sort(), expectedNames);
  for (const name of expectedNames) assert.deepEqual(readFileSync(join(outputDirectory, name)), originals.get(name));
}));
