import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdtempSync, realpathSync, mkdirSync, readFileSync, renameSync, truncateSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './zeno-update-runtime-fixture.test.mjs';
import YAML from 'yaml';
import asar from '@electron/asar';
import { assertPortableHostedRunner, assertPrivatePath, validatePortableHistorical, validatePortableTarget, nsisPayloadPath,
  portableErrorMetadata, portableDiagnosticState, windowsProcessPathCommand, decodeWindowsProcessPath, until,
  portableHttpEndpoint, validWorkspaceSessionList, effectivePortableProfileMatches, finishPortableRun,
  safePortableFailureState, hasExactProcessArgument, windowsFailureProbeScript, portableDownloadRetries,
  snapshotDownloadLogs, inspectDownloadLogWindow, resetOnlyDownloadLogText, runPortableDownloadAttempts,
  readPortableArchiveMetadata, inspectPortableArchive, readPortablePageList, windowsOwnedListenerProbeScript, verifyNativeV1HistorySetting } from '../scripts/zeno-update-portable-smoke.mjs';
import { numericDownloadProgress, safeUpdateFailureSignals } from '../scripts/zeno-update-smoke.mjs';
import { windowsProfileMode, windowsNativeLeaf, nativeWindowsPackageIdentity, windowsNativePlan, nativeDefaultsEnvironment,
  sameWindowsPath, windowsNativeRootsScript, windowsNativePristineScript, windowsNativeInstallationScript, decodeNativeWindowsWire,
  assertNativePristineLeaves, assertNativeOwnedPath, assertNativeEffectiveProfile, assertNativeEnvironmentRoots,
  inspectNativePristineLeaves, safeNativePrerequisite, verifyNativePrerequisites } from '../scripts/zeno-windows-native-defaults.mjs';

const origin = 'https://www.zeno.ryan-wong.cn';
const sha256 = 'a'.repeat(64); const sha512 = Buffer.alloc(64, 2).toString('base64');
const env = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', GITHUB_RUN_ID: '12', GITHUB_REF: 'refs/heads/personal', RUNNER_TEMP: '/tmp/runner', DISPLAY: ':99', ZENO_UPDATE_BASELINE_DIR: '/tmp/runner/baseline', ZENO_UPDATE_TARGET_DIR: '/tmp/runner/target', ZENO_UPDATE_BASELINE_METADATA: '/tmp/runner/history/index.json' };

test('native entry guard rejects developer, self-hosted, mismatched CPU and path escapes', () => {
  assertPortableHostedRunner(env, 'linux', 'x64');
  for (const [key, value] of [['CI', ''], ['RUNNER_ENVIRONMENT', 'self-hosted'], ['GITHUB_REF', 'refs/heads/main'], ['DISPLAY', ''], ['ZENO_UPDATE_TARGET_DIR', '/tmp/other/target'], ['GITHUB_RUN_ID', 'x']]) assert.throws(() => assertPortableHostedRunner({ ...env, [key]: value }, 'linux', 'x64'));
  assert.throws(() => assertPortableHostedRunner(env, 'darwin', 'x64'));
  assert.throws(() => assertPortableHostedRunner(env, 'linux', 'arm64'));
  const windows = { ...env, RUNNER_OS: 'Windows', RUNNER_TEMP: 'D:\\a\\_temp', ZENO_UPDATE_BASELINE_DIR: 'D:\\a\\_temp\\baseline', ZENO_UPDATE_TARGET_DIR: 'D:\\a\\_temp\\target', ZENO_UPDATE_BASELINE_METADATA: 'D:\\a\\_temp\\history\\index.json' };
  assertPortableHostedRunner(windows, 'win32', 'x64');
  assert.throws(() => assertPortableHostedRunner({ ...windows, ZENO_UPDATE_TARGET_DIR: 'D:\\a\\_temp-old\\target' }, 'win32', 'x64'));
  assert.throws(() => assertPortableHostedRunner({ ...windows, ZENO_UPDATE_TARGET_DIR: 'C:\\elsewhere' }, 'win32', 'x64'));
});

function historical() {
  return { version: '1.0.0', platforms: ['darwin', 'win32', 'linux'].flatMap(platform => ['x64', 'arm64'].map(arch => {
    const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux';
    const ext = platform === 'win32' ? 'exe' : platform === 'darwin' ? 'zip' : 'AppImage';
    const name = `zeno-${os}-${arch}-1.0.0.${ext}`; const feedUrl = `${origin}/updates/${platform}/${arch}/`;
    return { platform, arch, version: '1.0.0', feedUrl, updatesEnabled: true, signing: platform === 'linux' ? 'none' : platform === 'win32' ? 'unsigned' : 'self-signed', files: [{ name, url: feedUrl + name, size: 100, sha256, sha512 }] };
  })) };
}

test('baseline installer is anchored to original public six-lane metadata with both hashes', () => {
  for (const platform of ['linux', 'win32']) {
    const value = historical(); const file = validatePortableHistorical(value, platform);
    assert.equal(file.sha512, Buffer.alloc(64, 2).toString('hex')); assert.equal(file.sha256, sha256);
    const selected = value.platforms.find(lane => lane.platform === platform && lane.arch === 'x64');
    selected.files[0].url += '?override=1'; assert.throws(() => validatePortableHistorical(value, platform));
  }
  const duplicate = historical(); duplicate.platforms[0] = duplicate.platforms[1]; assert.throws(() => validatePortableHistorical(duplicate, 'linux'));
  const disabled = historical(); disabled.platforms.find(lane => lane.platform === 'linux' && lane.arch === 'x64').updatesEnabled = false; assert.throws(() => validatePortableHistorical(disabled, 'linux'));
});

function target(platform) {
  const name = platform === 'win32' ? 'zeno-win-x64-1.1.0.exe' : 'zeno-linux-x64-1.1.0.AppImage';
  const artifact = { platform, arch: 'x64', name, url: '/downloads/1.1.0/' + name, format: name.split('.').at(-1), signature: 'unsigned', size: 100, sha256, sha512 };
  return { index: { version: '1.1.0', publishedAt: '2026-10-20T00:00:00Z', artifacts: [artifact, ...Array.from({ length: 9 }, () => ({ platform: 'other' }))] }, manifest: { version: '1.1.0', path: name, sha512, files: [{ url: name, sha512, size: 100 }] } };
}

test('native public manifest and target artifact must agree on exact lane, size, format and hashes', () => {
  for (const platform of ['linux', 'win32']) {
    const good = target(platform); assert.equal(validatePortableTarget(good.index, good.manifest, platform, '1.1.0').installer.sha256, sha256);
    for (const edit of [value => { value.manifest.files[0].url = 'https://outside.invalid/a.exe'; }, value => { value.manifest.files[0].url += '?fake=1'; }, value => { value.index.artifacts[0].url = '/downloads/1.0.0/old'; }, value => { value.manifest.files[0].size++; }, value => { value.manifest.files[0].sha512 = Buffer.alloc(64, 3).toString('base64'); }, value => { value.index.artifacts[0].arch = 'arm64'; }, value => { value.manifest.packages = { x64: {} }; }]) {
      const bad = target(platform); edit(bad); assert.throws(() => validatePortableTarget(bad.index, bad.manifest, platform, '1.1.0'));
    }
    assert.throws(() => validatePortableTarget(good.index, good.manifest, platform, '1.0.0'));
    assert.throws(() => validatePortableTarget(good.index, good.manifest, platform, '0.9.0'));
  }
});

test('private filesystem validation refuses traversal and a junction/symlink ancestor', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-portable-selftest-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-portable-outside-')));
  try {
    mkdirSync(join(root, 'child')); writeFileSync(join(root, 'child/fixture.json'), '{}');
    assert.equal(assertPrivatePath(root, join(root, 'child/fixture.json')), join(root, 'child/fixture.json'));
    assertPrivatePath(root, join(root, 'child/not-created-yet'));
    assert.throws(() => assertPrivatePath(root, outside)); assert.throws(() => assertPrivatePath(root, root));
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertPrivatePath(root, join(root, 'linked/fixture.json')));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('workflow selector derives only matching hosted runners and rejects injected values', () => {
  const workflow = YAML.parse(readFileSync(new URL('../../../.github/workflows/zeno-update-portable-smoke.yml', import.meta.url), 'utf8'));
  const input = workflow.on.workflow_dispatch.inputs;
  assert.equal(input.baseline_run_id.default, '38883434626'); assert.equal(input.platform.default, 'both'); assert.deepEqual(input.platform.options, ['both', 'win32', 'linux']);
  assert.equal(input.windows_download_retries.default, '0'); assert.deepEqual(input.windows_download_retries.options, ['0', '1', '2']);
  assert.equal(input.windows_profile_mode.default, 'isolated'); assert.deepEqual(input.windows_profile_mode.options, ['isolated', 'native-defaults']);
  const windowsStep = workflow.jobs['native-update'].steps.find(step => step.name === 'Run original NSIS update on hosted Windows');
  assert.equal(windowsStep.env.ZENO_SMOKE_WINDOWS_PROFILE_MODE, "${{ inputs.windows_profile_mode || 'isolated' }}");
  const selection = workflow.jobs['select-platforms'].steps.find(step => step.id === 'select').run;
  const source = /^node --input-type=module <<'JS'\n([\s\S]+)\nJS\n?$/.exec(selection)?.[1]; assert.ok(source);
  const root = mkdtempSync(join(tmpdir(), 'zeno-workflow-selftest-'));
  try {
    for (const selected of ['both', 'win32', 'linux', '', 'darwin', 'linux,win32', '__proto__']) for (const retries of ['0', '1', '2', '', '3', '1;exit']) for (const profile of ['isolated', 'native-defaults', '', 'native-defaults;exit']) {
      const output = join(root, 'matrix-' + selected.replaceAll(/[^a-z]/g, '_') + '-' + retries.replaceAll(/[^a-z0-9]/g, '_') + '-' + profile.replaceAll(/[^a-z]/g, '_'));
      const result = spawnSync(process.execPath, ['--input-type=module'], { input: source, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, SMOKE_PLATFORM: selected, SMOKE_WINDOWS_DOWNLOAD_RETRIES: retries, SMOKE_WINDOWS_PROFILE_MODE: profile } });
      if (['both', 'win32', 'linux'].includes(selected) && ['0', '1', '2'].includes(retries) && (selected !== 'linux' || retries === '0') && ['isolated', 'native-defaults'].includes(profile) && (profile === 'isolated' || selected === 'win32')) {
        assert.equal(result.status, 0);
        const expected = [{ platform: 'win32', runner: 'windows-2025' }, { platform: 'linux', runner: 'ubuntu-24.04' }].filter(item => selected === 'both' || item.platform === selected);
        assert.deepEqual(JSON.parse(readFileSync(output, 'utf8').trim().replace(/^matrix=/, '')), { include: expected });
      } else { assert.notEqual(result.status, 0); assert.equal(existsSync(output), false); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('whole-file retry selection defaults off and rejects non-Windows or unbounded overrides', () => {
  for (const platform of ['win32', 'linux']) assert.equal(portableDownloadRetries(platform), 0);
  for (const value of ['0', '1', '2']) assert.equal(portableDownloadRetries('win32', value), Number(value));
  for (const value of ['', '3', '-1', '01', '1.0', 'true', 1, null, {}, '2;exit']) assert.throws(() => portableDownloadRetries('win32', value));
  for (const platform of ['linux', 'darwin', 'unknown']) assert.throws(() => portableDownloadRetries(platform, '1'));
});

const nativeDistribution = readFileSync(new URL('../electron/desktop-distribution.mjs', import.meta.url), 'utf8');
const nativePackage = () => nativeWindowsPackageIdentity({ name: '@openwork/desktop', openworkBrand: 'zeno', openworkDistribution: 'public' },
  '@openworkdesktop-updater', nativeDistribution, ['泽诺 Zeno.exe']);
const nativeRoots = () => ({ home: 'C:\\Users\\fixture', roaming: 'C:\\Users\\fixture\\AppData\\Roaming', local: 'C:\\Users\\fixture\\AppData\\Local',
  programFiles: 'C:\\Users\\fixture\\AppData\\Local\\Programs', programData: 'C:\\ProgramData', programs: 'C:\\Users\\fixture\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
  desktop: 'C:\\Users\\fixture\\Desktop', commonPrograms: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs', commonDesktop: 'C:\\Users\\Public\\Desktop',
  temp: 'C:\\Users\\fixture\\AppData\\Local\\Temp', sid: 'S-1-5-21-100-200-300-1001' });

test('native-defaults mode is explicit Windows-only and derives the pinned NSIS identity from original package metadata', () => {
  for (const platform of ['linux', 'win32']) assert.equal(windowsProfileMode(platform), 'isolated');
  assert.equal(windowsProfileMode('win32', 'native-defaults'), 'native-defaults');
  for (const value of ['native', '', 'native-defaults;exit', true]) assert.throws(() => windowsProfileMode('win32', value));
  assert.throws(() => windowsProfileMode('linux', 'native-defaults'));
  assert.deepEqual(nativePackage(), { installationLeaf: '@openworkdesktop', cacheLeaf: '@openworkdesktop-updater', appId: 'com.differentai.openwork',
    protocol: 'openwork', appGuid: '29165f8a-586b-5470-a1cc-cfff30a85ed3', executableName: '泽诺 Zeno.exe' });
  for (const names of [[], ['Zeno.exe'], ['泽诺 Zeno.exe', 'other.exe']]) assert.throws(() => nativeWindowsPackageIdentity({ name: '@openwork/desktop', openworkBrand: 'zeno', openworkDistribution: 'public' }, '@openworkdesktop-updater', nativeDistribution, names));
  for (const name of ['../escape', '@scope/../escape', 'desktop', '@scope/name/extra']) assert.throws(() => nativeWindowsPackageIdentity({ name, openworkBrand: 'zeno', openworkDistribution: 'public' }, 'cache', nativeDistribution, ['泽诺 Zeno.exe']));
  assert.throws(() => nativeWindowsPackageIdentity({ name: '@openwork/desktop', openworkBrand: 'zeno', openworkDistribution: 'public' }, 'other-updater', nativeDistribution, ['泽诺 Zeno.exe']));
  assert.throws(() => nativeWindowsPackageIdentity({ name: '@openwork/desktop', openworkBrand: 'zeno', openworkDistribution: 'public' }, '@openworkdesktop-updater', nativeDistribution.replaceAll('com.differentai.openwork', 'com.invalid.example'), ['泽诺 Zeno.exe']));
  for (const leaf of ['', '.', '..', '../escape', 'C:\\escape', '\\\\server\\share', 'name:stream', 'name.', 'name ', 'NUL', 'COM1.txt', 'bad\nname']) assert.throws(() => windowsNativeLeaf(leaf));
  assert.equal(windowsNativeLeaf('中文 空格'), '中文 空格');
});

test('native ownership includes all exact default leaves and refuses redirected/overlapping roots without owning HOME', () => {
  const roots = nativeRoots(); const plan = windowsNativePlan(roots, nativePackage());
  assert.equal(plan.profile, roots.roaming + '\\com.differentai.openwork');
  assert.equal(plan.installation, roots.programFiles + '\\@openworkdesktop');
  assert.equal(plan.engineState, roots.roaming + '\\openwork\\engine-v2-preview.json');
  assert.equal(plan.leaves.length, 17); assert.equal(plan.shortcuts.length, 8);
  assert.deepEqual(plan.checkOnlyLeaves, [roots.programData + '\\opencode\\opencode.json', roots.programData + '\\opencode\\opencode.jsonc', roots.home + '\\.claude', roots.home + '\\.agents']);
  for (const path of plan.checkOnlyLeaves) assert.ok(!plan.leaves.includes(path));
  const projectPlan = windowsNativePlan(roots, nativePackage(), 'D:\\fixture\\workspace');
  for (const path of ['D:\\fixture\\workspace\\.agents', 'D:\\fixture\\.claude', 'D:\\opencode.jsonc']) assert.ok(projectPlan.checkOnlyLeaves.includes(path));
  assert.ok(projectPlan.checkOnlyLeaves.every(path => !sameWindowsPath(path, roots.programData)));
  assert.throws(() => windowsNativePlan(roots, nativePackage(), 'D:\\' + 'segment\\'.repeat(65) + 'workspace'));
  for (const path of [roots.home + '\\.config\\openwork', roots.home + '\\.config\\opencode', roots.home + '\\.opencode', roots.home + '\\.cache\\opencode', roots.home + '\\.local\\share\\opencode',
    roots.home + '\\.local\\state\\opencode', roots.home + '\\OpenWork Chat', roots.roaming + '\\opencode', roots.local + '\\opencode', roots.temp + '\\opencode']) assert.ok(plan.leaves.includes(path));
  for (const path of [roots.home, roots.roaming, roots.local, roots.temp, roots.programFiles]) assert.ok(!plan.leaves.includes(path));
  for (const key of ['home', 'roaming', 'local', 'programFiles', 'programs', 'sid']) assert.throws(() => windowsNativePlan({ ...roots, [key]: 'invalid' }, nativePackage()));
  assert.throws(() => windowsNativePlan({ ...roots, programFiles: 'D:\\redirected' }, nativePackage()));
  assert.throws(() => windowsNativePlan(roots, { ...nativePackage(), cacheLeaf: 'openwork' }));
  assert.equal(sameWindowsPath('C:\\Users\\fixture', 'c:\\users\\fixture'), true);
  assert.equal(sameWindowsPath('C:\\Users\\fixture', 'C:\\Users\\fixture-other'), false);
  const osEnv = { USERPROFILE: roots.home, HOME: roots.home, APPDATA: roots.roaming, LOCALAPPDATA: roots.local, ProgramData: roots.programData };
  assertNativeEnvironmentRoots(roots, osEnv);
  for (const name of Object.keys(osEnv)) assert.throws(() => assertNativeEnvironmentRoots(roots, { ...osEnv, [name]: 'D:\\redirected' }));
  assert.throws(() => assertNativeEnvironmentRoots(roots, { ...osEnv, ProgramData: undefined }));
  assert.throws(() => assertNativeEnvironmentRoots(roots, { ...osEnv, ProgramData: '' }));
  assert.throws(() => assertNativeEnvironmentRoots(roots, { APPDATA: 'relative' }));
});

test('native child environment retains original OS paths while stripping fixture, credential and storage overrides', () => {
  const roots = nativeRoots();
  const original = { USERPROFILE: roots.home, HOME: roots.home, APPDATA: roots.roaming, LOCALAPPDATA: roots.local, TEMP: roots.temp, PATH: 'synthetic-system-path', CI: 'true',
    OPENWORK_ELECTRON_USERDATA: 'private', OPENCODE_DB: 'private', XDG_CONFIG_HOME: 'private', ZENO_SMOKE_WINDOWS_PROFILE_MODE: 'native-defaults', GH_TOKEN: 'private', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: 'private' };
  const value = nativeDefaultsEnvironment(original);
  assert.deepEqual(value, { USERPROFILE: roots.home, HOME: roots.home, APPDATA: roots.roaming, LOCALAPPDATA: roots.local, TEMP: roots.temp, PATH: 'synthetic-system-path', CI: 'true' });
  assert.equal(original.ELECTRON_RUN_AS_NODE, '1');
  const text = JSON.stringify({ path: 'C:\\用户\\中文 目录', count: 1 });
  assert.deepEqual(decodeNativeWindowsWire(Buffer.from(text).toString('base64')), JSON.parse(text));
  for (const text of ['not base64', Buffer.from([255]).toString('base64'), Buffer.from('{').toString('base64')]) assert.throws(() => decodeNativeWindowsWire(text));
});

test('native filesystem diagnostics identify exact safe group/index/depth and retain unknown API failures without private strings', () => {
  const plan = { leaves: ['C:\\private-owned'], shortcuts: ['C:\\private-shortcut'], checkOnlyLeaves: ['C:\\private-config'] };
  const absent = () => { throw Object.assign(new Error('never-publish-private-value'), { code: 'ENOENT' }); };
  const clean = inspectNativePristineLeaves(plan, absent);
  assert.equal(safeNativePrerequisite(clean, 'node', plan).passed, true);
  for (const [check, path] of [['owned-leaf', plan.leaves[0]], ['shortcut', plan.shortcuts[0]], ['check-only', plan.checkOnlyLeaves[0]]]) {
    const fact = inspectNativePristineLeaves(plan, value => value === path ? { isSymbolicLink: () => false } : absent());
    assert.deepEqual(fact, { engine: 'node', passed: false, check, index: 0, ancestorDepth: 0, reason: 'existing-state' });
    assert.equal(JSON.stringify(safeNativePrerequisite(fact, 'node', plan)).includes('private'), false);
  }
  const linked = inspectNativePristineLeaves(plan, value => value === 'C:\\' ? { isSymbolicLink: () => true } : absent());
  assert.deepEqual(linked, { engine: 'node', passed: false, check: 'owned-leaf', index: 0, ancestorDepth: 1, reason: 'reparse' });
  for (const code of ['EACCES', 'EPERM', 'private-api-code']) {
    const fact = inspectNativePristineLeaves(plan, () => { throw Object.assign(new Error('private-api-message'), { code }); });
    assert.equal(fact.reason, 'api-error'); assert.equal(fact.code, code === 'private-api-code' ? 'unknown' : code);
    assert.equal(JSON.stringify(fact).includes('private'), false);
  }
  const getter = new Error('private'); Object.defineProperty(getter, 'code', { get() { throw Error('must-not-read-private-code'); } });
  assert.equal(inspectNativePristineLeaves(plan, () => { throw getter; }).code, 'unknown');
});

test('native prerequisite serialization admits only fixed enums and bounded indices, and malformed success fails closed', () => {
  const plan = windowsNativePlan(nativeRoots(), nativePackage());
  const clear = { engine: 'powershell', passed: true, pristine: true, check: 'complete', reason: 'clear',
    nativeLeavesChecked: plan.leaves.length, shortcutsChecked: plan.shortcuts.length, checkOnlyLeavesChecked: plan.checkOnlyLeaves.length,
    environmentScopesChecked: 3, registryViewsChecked: 4 };
  assert.deepEqual(safeNativePrerequisite(clear, 'powershell', plan), clear);
  const negative = { engine: 'powershell', passed: false, check: 'environment', reason: 'scoped-environment', scope: 'machine', variable: 'node-path',
    rawPath: 'C:\\private', rawValue: 'never-publish-private', privateUnknownKey: 'never-publish-private' };
  assert.deepEqual(safeNativePrerequisite(negative, 'powershell', plan), { engine: 'powershell', passed: false, check: 'environment', reason: 'scoped-environment', scope: 'machine', variable: 'node-path' });
  for (const fact of [{ ...negative, variable: 'PRIVATE_KEY_NAME' }, { ...negative, scope: 'PRIVATE_SCOPE' }, { ...negative, index: -1 },
    { ...negative, ancestorDepth: 513 }, { ...negative, processCount: Infinity }, { ...clear, passed: 'true' }, { ...clear, registryViewsChecked: 3 },
    { ...clear, nativeLeavesChecked: 1 }, { ...clear, rawValue: 'private' }, { ...clear, code: 'EPERM' },
    { engine: 'node', passed: false, check: 'check-only', reason: 'existing-state', index: plan.checkOnlyLeaves.length }]) {
    assert.deepEqual(safeNativePrerequisite(fact, fact.engine, plan), { engine: fact.engine, passed: false, check: 'invalid-response', reason: 'invalid-response' });
  }
  for (const fact of [
    { engine: 'powershell', passed: false, check: 'registry', reason: 'existing-registration', hive: 'current-user', view: 'registry64', registryKind: 'protocol' },
    { engine: 'powershell', passed: false, check: 'known-folder-environment', reason: 'api-error', scope: 'user', variable: 'appdata' },
    { engine: 'powershell', passed: false, check: 'process', reason: 'existing-process', processCount: 512, countCapped: true },
  ]) assert.deepEqual(safeNativePrerequisite(fact, 'powershell', plan), fact);
});

test('native guards retain sanitized diagnostics before asserting failure and cannot reach installation after an unknown prerequisite', () => {
  const plan = windowsNativePlan(nativeRoots(), nativePackage()); const records = {}; let windowsReads = 0;
  const nodeClear = inspectNativePristineLeaves(plan, () => { throw Object.assign(new Error('private'), { code: 'ENOENT' }); });
  const nodeFailed = { engine: 'node', passed: false, check: 'owned-leaf', index: 2, ancestorDepth: 0, reason: 'existing-state' };
  const record = (engine, value) => { records[engine] = value; };
  assert.throws(() => verifyNativePrerequisites(plan, () => nodeFailed, () => { windowsReads++; }, record));
  assert.deepEqual(records.node, nodeFailed); assert.equal(windowsReads, 0);
  const windowsFailed = { engine: 'powershell', passed: false, check: 'environment', reason: 'scoped-environment', scope: 'machine', variable: 'node-path' };
  assert.throws(() => verifyNativePrerequisites(plan, () => nodeClear, () => windowsFailed, record)); assert.deepEqual(records.powershell, windowsFailed);
  assert.throws(() => verifyNativePrerequisites(plan, () => nodeClear, () => { throw Error('private path, environment or command'); }, record));
  assert.deepEqual(records.powershell, { engine: 'powershell', passed: false, check: 'powershell-launch', reason: 'api-error' });
  assert.equal(JSON.stringify(records).includes('private'), false);
  assert.throws(() => verifyNativePrerequisites(plan, () => nodeClear, () => ({ passed: true, privateValue: 'private' }), record));
  assert.equal(records.powershell.check, 'invalid-response');
});

test('Windows prerequisite API errors and variable classifications return fixed safe records without enumerating private environment', { skip: process.platform !== 'win32' }, () => {
  const source = windowsNativePristineScript();
  const malformed = Buffer.from('{never-publish-private-json').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { input: malformed, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0);
  assert.deepEqual(decodeNativeWindowsWire(result.stdout.trim()), { engine: 'powershell', passed: false, check: 'input', reason: 'api-error' });
  assert.equal((result.stdout + result.stderr).includes('never-publish-private'), false);
  const start = source.indexOf("$result=New-NativePrerequisite 'input'"); assert.ok(start > 0);
  const classify = source.slice(0, start) + "\n$result=@((Get-NativeVariableClass 'NODE_PATH'),(Get-NativeVariableClass 'OPENWORK_private_KEY'),(Get-NativeVariableClass 'OPENCODE_private_KEY'));[Console]::Write(($result|ConvertTo-Json -Compress))";
  const classified = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', classify], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(classified.status, 0); assert.deepEqual(JSON.parse(classified.stdout.trim()), ['node-path', 'openwork-prefix', 'opencode-prefix']);
  assert.equal((classified.stdout + classified.stderr).includes('private_KEY'), false);
});

test('native V1 history uses one real settings mutation before history and target only verifies the saved choice', async () => {
  const paths = []; let saved = false;
  const request = async (path, options = {}) => {
    paths.push([path, options]);
    if (options.method === 'PUT') { assert.deepEqual(JSON.parse(options.body), { chatRouting: false, enabled: false }); saved = true; }
    return { enabled: !saved, chatRouting: !saved };
  };
  let idleChecked = 0;
  const wait = async (read, predicate, timeout) => { idleChecked++; assert.equal(timeout, 30_000); assert.equal(predicate({ v1: { verdict: 'idle', busySessions: 0, waitingRequests: 0 }, v2: null }), true); assert.equal(predicate({ v1: { verdict: 'busy', busySessions: 1, waitingRequests: 0 }, v2: null }), false); await read(); };
  await verifyNativeV1HistorySetting(request, () => { assert.equal(saved, true); return { enabled: false, chatRouting: false }; }, wait, true);
  await verifyNativeV1HistorySetting(request, () => ({ enabled: false, chatRouting: false }), wait);
  assert.equal(paths.filter(([, options]) => options.method === 'PUT').length, 1); assert.equal(idleChecked, 2);
  await assert.rejects(verifyNativeV1HistorySetting(async () => ({ enabled: true, chatRouting: true }), () => ({}), wait));
  await assert.rejects(verifyNativeV1HistorySetting(request, () => ({ enabled: true, chatRouting: false }), wait));
});

test('native Windows prerequisite scripts parse without executing a fixture or exposing Unicode over the console', { skip: process.platform !== 'win32' }, () => {
  for (const source of [windowsNativeRootsScript(), windowsNativePristineScript(), windowsNativeInstallationScript()]) {
    const encoded = Buffer.from(source, 'utf8').toString('base64');
    const script = `$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));$tokens=$null;$parseErrors=$null;[void][Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors);if($parseErrors.Count -gt 0){exit 1}`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0);
  }
});

test('native owned leaves reject pre-existing data, outside paths and junction ancestors using disposable synthetic Windows paths', { skip: process.platform !== 'win32' }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-native-leaf-test-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-native-outside-test-')));
  const home = join(root, '用户 空格');
  const roots = { home, roaming: join(home, 'AppData/Roaming'), local: join(home, 'AppData/Local'), programFiles: join(home, 'AppData/Local/Programs'),
    programData: join(root, 'CommonData'), programs: join(home, 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs'), desktop: join(home, 'Desktop'), commonPrograms: join(root, 'CommonPrograms'), commonDesktop: join(root, 'CommonDesktop'), temp: join(root, 'Temp'), sid: nativeRoots().sid };
  const plan = windowsNativePlan(roots, nativePackage(), join(root, 'private/workspace'));
  try {
    mkdirSync(home); assertNativePristineLeaves(plan);
    const managedConfig = plan.checkOnlyLeaves[0]; mkdirSync(dirname(managedConfig), { recursive: true }); writeFileSync(managedConfig, '{}');
    assert.throws(() => assertNativePristineLeaves(plan)); rmSync(managedConfig); assertNativePristineLeaves(plan);
    const ancestorConfig = join(root, 'opencode.jsonc'); assert.ok(plan.checkOnlyLeaves.includes(ancestorConfig)); writeFileSync(ancestorConfig, '{}');
    assert.throws(() => assertNativePristineLeaves(plan)); rmSync(ancestorConfig); assertNativePristineLeaves(plan);
    mkdirSync(plan.profile, { recursive: true });
    assert.throws(() => assertNativePristineLeaves(plan));
    assert.equal(assertNativeOwnedPath(plan, plan.profile), plan.profile);
    assert.throws(() => assertNativeOwnedPath(plan, home)); assert.throws(() => assertNativeOwnedPath(plan, outside));
    assert.throws(() => assertNativeOwnedPath(plan, plan.checkOnlyLeaves[0]));
    const before = assertNativeEffectiveProfile(plan); assert.equal(sameWindowsPath(before, plan.profile), true);
    assert.equal(assertNativeEffectiveProfile(plan, before), before);
    assert.throws(() => assertNativeEffectiveProfile(plan, outside));
    rmSync(plan.profile, { recursive: true }); symlinkSync(outside, plan.profile, 'junction');
    assert.throws(() => assertNativeOwnedPath(plan, join(plan.profile, 'state.json')));
    assert.throws(() => assertNativePristineLeaves(plan));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

const resetLog = 'Error: Error: net::ERR_CONNECTION_RESET\n    at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:1:1)\n';

test('only complete actual reset error headers admit retry; mixed and unknown errors fail closed', () => {
  for (const header of ['Error: Error: net::ERR_CONNECTION_RESET', 'Error: net::ERR_CONNECTION_RESET']) {
    assert.equal(resetOnlyDownloadLogText(['', header + '\r\n    at synthetic (fixture:1:1)\r\n']), 'connection-reset');
  }
  for (const error of ['Error: network failed', 'Error: Error: net::ERR_TIMED_OUT', 'Error: EPIPE', 'Error: cancelled',
    'Error: sha512 checksum mismatch', 'ERR_UPDATER_INVALID_SIGNATURE', 'HttpError: 403 forbidden', 'TLS certificate problem',
    'Warning: disk full', 'Permission denied', 'integrity mismatch', 'fatal updater termination', 'TypeError: unexpected value',
    'TypeError [PRIVATE_CODE]: unexpected value', 'NetworkError: digest mismatch', 'ValidationError: denied', 'RuntimeException: unexpected',
    'Uncaught (in promise) synthetic', 'UnhandledPromiseRejectionWarning: unexpected', 'Error: ECONNRESET unrelated context', 'Error: Error: read ECONNRESET']) {
    assert.equal(resetOnlyDownloadLogText([resetLog, error + '\n']), 'non-reset-error');
  }
  for (const text of ['', 'Downloading update from synthetic-url\n']) {
    assert.equal(resetOnlyDownloadLogText([text, '']), 'no-reset-signal');
  }
  assert.equal(resetOnlyDownloadLogText(['Downloading https://fixture.invalid/ERR_CONNECTION_RESET\n', '']), 'non-reset-error');
  assert.equal(resetOnlyDownloadLogText(['    at synthetic (fixture:1:1)\n', resetLog]), 'log-window-invalid');
  for (const texts of [[], [''], [null, resetLog], ['', resetLog.trimEnd()]]) assert.equal(resetOnlyDownloadLogText(texts), 'log-window-invalid');
});

function withDownloadLogs(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-download-window-')));
  mkdirSync(join(root, 'logs'));
  const output = join(root, 'logs/electron.log'); const errors = join(root, 'logs/electron-error.log');
  writeFileSync(output, 'synthetic old output\n'); writeFileSync(errors, resetLog);
  try { return run({ root, output, errors }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('owned two-log offsets exclude a previous reset and cannot authorize a newer non-reset failure', () => {
  withDownloadLogs(({ root, output, errors }) => {
    const before = snapshotDownloadLogs(root); assert.ok(before);
    assert.equal(inspectDownloadLogWindow(root, before), 'no-reset-signal');
    appendFileSync(errors, 'Error: certificate verification failed\n');
    assert.equal(inspectDownloadLogWindow(root, before), 'non-reset-error');
    const next = snapshotDownloadLogs(root); appendFileSync(output, 'Downloading update from synthetic-url\n');
    appendFileSync(errors, resetLog);
    assert.equal(inspectDownloadLogWindow(root, next), 'connection-reset');
    const last = snapshotDownloadLogs(root);
    assert.equal(inspectDownloadLogWindow(root, last), 'no-reset-signal');
  });
});

test('log rotation, truncation, rewritten anchors, symlinks, oversized or incomplete UTF-8 windows reject', () => {
  const mutations = [
    ({ errors }) => truncateSync(errors, 0),
    ({ errors }) => { renameSync(errors, errors + '.old'); writeFileSync(errors, resetLog); },
    ({ errors }) => writeFileSync(errors, 'x'.repeat(resetLog.length) + '\n' + resetLog),
    ({ output }) => { renameSync(output, output + '.old'); symlinkSync(output + '.old', output); },
    ({ errors }) => appendFileSync(errors, 'x'.repeat(256 * 1024) + '\n' + resetLog),
    ({ errors }) => appendFileSync(errors, resetLog.trimEnd()),
    ({ errors }) => appendFileSync(errors, Buffer.from([255, 10])),
    ({ output }) => rmSync(output),
  ];
  for (const mutate of mutations) withDownloadLogs(fixture => {
    const before = snapshotDownloadLogs(fixture.root); assert.ok(before); mutate(fixture);
    assert.equal(inspectDownloadLogWindow(fixture.root, before), 'log-window-invalid');
  });
  withDownloadLogs(({ root, errors }) => {
    appendFileSync(errors, 'incomplete'); assert.equal(snapshotDownloadLogs(root), null);
    assert.equal(inspectDownloadLogWindow(root, null), 'log-window-invalid');
  });
});

test('default-off attempts stop once; opted-in attempts are bounded and retain separate sanitized failures', async () => {
  for (const retries of [0, 1, 2]) {
    const records = []; const calls = []; let downloaded = 0;
    const result = await runPortableDownloadAttempts({ platform: 'win32', additionalRetries: retries, records,
      begin: attempt => { calls.push(['begin', attempt]); return attempt; },
      download: async () => { downloaded++; return downloaded === 3 ? { ok: true, version: 'synthetic' } : { ok: false, reason: 'download-failed', privatePath: 'never-publish-fixture' }; },
      progress: () => ({ transferred: downloaded * 10, total: 100, token: 'never-publish-fixture' }),
      inspectFailure: attempt => { calls.push(['inspect', attempt]); return 'connection-reset'; },
      wait: milliseconds => { assert.equal(milliseconds, 500); },
    });
    assert.equal(result.ok, retries === 2); assert.equal(downloaded, retries + 1); assert.equal(records.length, retries + 1);
    assert.deepEqual(calls.filter(call => call[0] === 'begin').map(call => call[1]), Array.from({ length: retries + 1 }, (_, i) => i + 1));
    assert.deepEqual(records.map(record => record.retryRequested), Array.from({ length: retries + 1 }, (_, i) => i < retries));
    assert.equal(records[0].reason, 'download-failed'); assert.equal(records[0].signal, 'connection-reset');
    assert.deepEqual(records[0].progress, { transferred: 10, total: 100 });
    assert.equal(JSON.stringify(records).includes('never-publish-fixture'), false);
    for (const record of records) { assert.ok(Number.isFinite(Date.parse(record.startedAt))); assert.ok(Number.isFinite(Date.parse(record.finishedAt))); assert.ok(record.elapsedMs >= 0); }
    if (retries === 2) { assert.equal(records[2].outcome, 'downloaded'); assert.equal(records[2].signal, 'not-inspected'); }
  }
});

test('non-reset, stale, malformed signals, IPC rejection and thrown bridges never trigger another attempt', async () => {
  for (const signal of ['non-reset-error', 'no-reset-signal', 'log-window-invalid', 'ERR_CONNECTION_RESET', undefined]) {
    const records = []; let calls = 0;
    await runPortableDownloadAttempts({ platform: 'win32', additionalRetries: 2, records, begin: () => null,
      download: () => { calls++; return { ok: false, reason: 'download-failed' }; }, progress: () => ({}), inspectFailure: () => signal, wait: () => {},
    });
    assert.equal(calls, 1); assert.equal(records[0].retryRequested, false);
  }
  for (const thrown of [false, true]) {
    const records = []; let calls = 0; let inspected = false;
    const run = () => runPortableDownloadAttempts({ platform: 'win32', additionalRetries: 2, records, begin: () => null,
      download: () => { calls++; if (thrown) throw new Error('never-publish-fixture'); return { ok: false, reason: 'private-unknown-error' }; },
      progress: () => ({}), inspectFailure: () => { inspected = true; return 'connection-reset'; }, wait: () => {},
    });
    if (thrown) await assert.rejects(run); else await run();
    assert.equal(calls, 1); assert.equal(inspected, false); assert.equal(records[0].retryRequested, false);
    assert.equal(JSON.stringify(records).includes('never-publish-fixture'), false);
  }
});

test('retry identity rejection cannot issue a second download; Linux and invalid budgets cannot opt in', async () => {
  let calls = 0; const records = [];
  await assert.rejects(runPortableDownloadAttempts({ platform: 'win32', additionalRetries: 2, records,
    begin: attempt => { if (attempt > 1) throw Error('synthetic baseline identity changed'); },
    download: () => { calls++; return { ok: false, reason: 'download-failed' }; }, progress: () => ({}),
    inspectFailure: () => 'connection-reset', wait: () => {},
  }));
  assert.equal(calls, 1); assert.equal(records.length, 1); assert.equal(records[0].retryRequested, true);
  for (const [platform, additionalRetries] of [['linux', 1], ['win32', 3], ['win32', -1], ['win32', 1.5], ['win32', '1']]) {
    await assert.rejects(runPortableDownloadAttempts({ platform, additionalRetries, records: [], begin: () => { throw Error('must not begin'); } }),
      error => !error.message.includes('must not begin'));
  }
  const linuxRecords = [];
  await runPortableDownloadAttempts({ platform: 'linux', additionalRetries: 0, records: linuxRecords, begin: () => {},
    download: () => ({ ok: false, reason: 'download-failed' }), progress: () => ({}), inspectFailure: () => 'connection-reset', wait: () => {},
  });
  assert.equal(linuxRecords.length, 1); assert.equal(linuxRecords[0].retryRequested, false);
});

test('shared failure diagnostics and progress never expose paths, URLs or unknown values', () => {
  const privateMarker = 'never-retain-private-fixture';
  const signals = safeUpdateFailureSignals(`ERR_CONNECTION_RESET https://fixture.invalid/${privateMarker} D:\\${privateMarker} ERR_PRIVATE_${privateMarker}`);
  assert.deepEqual(signals, [{ code: 'ERR_CONNECTION_RESET', classification: 'connection-reset' }]);
  const progress = numericDownloadProgress({ transferred: 123, total: 456, percent: 27, bytesPerSecond: 100, path: privateMarker, token: privateMarker });
  assert.deepEqual(progress, { transferred: 123, total: 456, percent: 27, bytesPerSecond: 100 });
  assert.ok(!JSON.stringify({ signals, progress }).includes(privateMarker));
});

test('NSIS resource reference selects one exact x64 payload without traversal or wildcard extraction', () => {
  assert.equal(nsisPayloadPath('Path = installer.exe\r\nPath = $PLUGINSDIR\\app-64.7z\r\nPath = $PLUGINSDIR\\other.dll\r\n'), '$PLUGINSDIR\\app-64.7z');
  assert.equal(nsisPayloadPath('Path = app-64.zip\n'), 'app-64.zip');
  for (const listing of ['Path = app-arm64.7z\n', 'Path = ../app-64.7z\n', 'Path = C:\\app-64.7z\n', 'Path = $PLUGINSDIR\\app-64.7z\nPath = app-64.zip\n']) assert.throws(() => nsisPayloadPath(listing));
});

test('owned Windows executable path preserves Chinese and spaces over an ASCII Base64 UTF-8 wire', () => {
  for (const path of ['D:\\runner\\private fixture\\泽诺 Zeno.exe', 'C:\\临时目录\\测试 🧪\\泽诺 Zeno.exe']) {
    const wire = Buffer.from(path, 'utf8').toString('base64');
    assert.match(wire, /^[\x00-\x7f]+$/);
    assert.equal(decodeWindowsProcessPath(wire), path);
  }
  const script = windowsProcessPathCommand(123);
  assert.match(script, /Get-Process -Id 123/); assert.match(script, /ToBase64String\(\[Text.Encoding\]::UTF8.GetBytes\(\$p\)\)/);
  assert.match(script, /^[\x00-\x7f]+$/);
  for (const pid of [0, 1, -3, 1.5, '123;exit']) assert.throws(() => windowsProcessPathCommand(pid));
  for (const value of ['', 'not-base64?', 'YQ==', Buffer.from([255]).toString('base64'), Buffer.from('C:\\private\nfixture.exe').toString('base64')]) {
    assert.throws(() => decodeWindowsProcessPath(value), { message: 'Invalid encoded owned Windows executable path.' });
  }
});

test('Windows PowerShell executes the same ASCII encoder with a synthetic Chinese path', { skip: process.platform !== 'win32' }, () => {
  const path = 'D:\\synthetic 测试\\泽诺 Zeno.exe';
  const wire = Buffer.from(path, 'utf8').toString('base64');
  const script = windowsProcessPathCommand(123).replace('(Get-Process -Id 123 -ErrorAction Stop).Path',
    `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${wire}'))`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(decodeWindowsProcessPath(result.stdout.trim()), path);
});

test('checkpoint diagnostics allowlist names/codes and never access private error fields', () => {
  const privateMarker = 'never-publish-private-fixture';
  const error = { name: 'AssertionError', code: 'ERR_ASSERTION' };
  for (const key of ['message', 'actual', 'expected', 'path', 'token', 'stack']) Object.defineProperty(error, key, { get() { throw Error(privateMarker); } });
  assert.deepEqual(portableErrorMetadata(error), { errorKind: 'AssertionError', code: 'ERR_ASSERTION' });
  assert.deepEqual(portableErrorMetadata({ name: privateMarker, code: privateMarker, message: privateMarker }), { errorKind: 'UnknownError' });
  const diagnostics = portableDiagnosticState(); diagnostics.enter('attach-windows-executable'); diagnostics.readError(error);
  const safe = diagnostics.snapshot({ name: 'Error', code: privateMarker, message: privateMarker });
  assert.deepEqual(safe, { activeCheck: 'attach-windows-executable', errorKind: 'Error', lastReadError: { errorKind: 'AssertionError', code: 'ERR_ASSERTION' } });
  assert.equal(JSON.stringify(safe).includes(privateMarker), false);
  assert.throws(() => diagnostics.enter(privateMarker), { message: 'Unknown native diagnostic checkpoint.' });
  diagnostics.enter('baseline-workspace-identity');
  assert.deepEqual(diagnostics.snapshot(error), { activeCheck: 'baseline-workspace-identity', errorKind: 'AssertionError', code: 'ERR_ASSERTION' });
});

test('fetch diagnostics retain only an own allowlisted cause code, never messages, paths or getters', () => {
  const privateMarker = 'never-publish-private-cause';
  const cause = { code: 'ECONNREFUSED' };
  for (const key of ['message', 'path', 'stack', 'token']) Object.defineProperty(cause, key, { get() { throw Error(privateMarker); } });
  const error = new TypeError(privateMarker, { cause });
  assert.deepEqual(portableErrorMetadata(error), { errorKind: 'TypeError', causeCode: 'ECONNREFUSED' });
  assert.deepEqual(portableErrorMetadata(new TypeError(privateMarker, { cause: { code: privateMarker } })), { errorKind: 'TypeError' });
  const getterCause = new TypeError(privateMarker); Object.defineProperty(getterCause, 'cause', { get() { throw Error(privateMarker); } });
  assert.deepEqual(portableErrorMetadata(getterCause), { errorKind: 'TypeError' });
  const getterCode = {}; Object.defineProperty(getterCode, 'code', { get() { throw Error(privateMarker); } });
  assert.deepEqual(portableErrorMetadata(new TypeError(privateMarker, { cause: getterCode })), { errorKind: 'TypeError' });
  const diagnostics = portableDiagnosticState(); diagnostics.enter('attach-page-list'); diagnostics.readError(error);
  assert.deepEqual(diagnostics.snapshot(new Error()), { activeCheck: 'attach-page-list', errorKind: 'Error', lastReadError: { errorKind: 'TypeError', causeCode: 'ECONNREFUSED' } });
  assert.equal(JSON.stringify(diagnostics.snapshot(error)).includes(privateMarker), false);
});

test('page-list diagnostics distinguish HTTP, malformed JSON and non-array shapes without serializing bodies', async () => {
  const diagnostics = portableDiagnosticState(); diagnostics.enter('attach-page-list');
  const cases = [
    [503, '{"private":"never-publish-private-page"}', 'unexpected-http-status'],
    [200, '{"private":"never-publish-private-page"}', 'non-array'],
    [200, 'null', 'non-array'], [200, 'invalid-private-json', 'invalid-json'],
  ];
  for (const [status, body, shape] of cases) {
    await assert.rejects(readPortablePageList(new Response(body, { status }), diagnostics));
    assert.deepEqual(diagnostics.snapshot(new Error()).lastPageList, { status, shape });
    assert.equal(JSON.stringify(diagnostics.snapshot(new Error())).includes('private'), false);
  }
  diagnostics.readError(new TypeError('private', { cause: { code: 'ECONNREFUSED' } }));
  const list = [{ type: 'page', url: 'file:///synthetic-private/index.html' }];
  assert.deepEqual(await readPortablePageList(new Response(JSON.stringify(list)), diagnostics), list);
  assert.deepEqual(diagnostics.snapshot(new Error()), { activeCheck: 'attach-page-list', errorKind: 'Error', lastPageList: { status: 200, shape: 'array' } });
  diagnostics.cdpPageList(); assert.deepEqual(diagnostics.snapshot(new Error()).lastPageList, { shape: 'pending' });
  for (const [status, shape] of [[99, 'array'], [600, 'array'], [200, 'private'], [undefined, 'array']]) assert.throws(() => diagnostics.cdpPageList(status, shape));
});

test('installed ASAR replacement rereads real target headers and keeps raw hash independent of malformed metadata', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-asar-replacement-')));
  const installed = join(root, 'installed.asar'); const target = join(root, 'target.asar');
  const oldSource = join(root, 'old'); const targetSource = join(root, 'target'); const malformedSource = join(root, 'malformed');
  try {
    for (const path of [oldSource, targetSource, malformedSource]) mkdirSync(path);
    writeFileSync(join(oldSource, 'package.json'), JSON.stringify({ version: '1.0.0', fixture: 'old' }));
    writeFileSync(join(targetSource, 'package.json'), JSON.stringify({ version: '1.1.2', fixture: 'new', differentHeader: 'x'.repeat(256) }));
    writeFileSync(join(targetSource, 'a-before-package.txt'), 'synthetic header shifts file offsets');
    await asar.createPackage(oldSource, installed); await asar.createPackage(targetSource, target);
    assert.equal(JSON.parse(asar.extractFile(installed, 'package.json').toString()).version, '1.0.0');
    copyFileSync(target, installed);
    const targetHash = createHash('sha256').update(readFileSync(target)).digest('hex');
    assert.equal(createHash('sha256').update(readFileSync(installed)).digest('hex'), targetHash);
    // This is the real pinned-library defect, before using the corrected reader.
    assert.throws(() => JSON.parse(asar.extractFile(installed, 'package.json').toString()), SyntaxError);
    assert.equal(readPortableArchiveMetadata(installed).version, '1.1.2');
    assert.deepEqual(inspectPortableArchive(installed, '1.1.2', targetHash), {
      diskReadSucceeded: true, archiveHashReadSucceeded: true, archiveMetadataReadSucceeded: true, publishedAsarOnDisk: true, targetVersionOnDisk: true,
    });
    assert.equal(inspectPortableArchive(installed, '1.0.0', '0'.repeat(64)).publishedAsarOnDisk, false);
    assert.equal(inspectPortableArchive(installed, '1.0.0', targetHash).targetVersionOnDisk, false);
    writeFileSync(join(malformedSource, 'package.json'), '{'); await asar.createPackage(malformedSource, target); copyFileSync(target, installed);
    const malformedHash = createHash('sha256').update(readFileSync(installed)).digest('hex');
    assert.deepEqual(inspectPortableArchive(installed, '1.1.2', malformedHash), {
      diskReadSucceeded: false, archiveHashReadSucceeded: true, archiveMetadataReadSucceeded: false, publishedAsarOnDisk: true,
    });
    assert.deepEqual(inspectPortableArchive(join(root, 'missing.asar'), '1.1.2', targetHash), {
      diskReadSucceeded: false, archiveHashReadSucceeded: false, archiveMetadataReadSucceeded: false,
    });
  } finally { for (const archive of [installed, target]) asar.uncache(archive); rmSync(root, { recursive: true, force: true }); }
});

test('polling retains only fixed last-read error metadata without changing its failure gate', async () => {
  const diagnostics = portableDiagnosticState(); diagnostics.enter('attach-page-list');
  const error = Object.assign(new TypeError('private URL/path/token must never be emitted'), { code: 'ECONNREFUSED' });
  let attempts = 0;
  await assert.rejects(until(async () => { attempts++; throw error; }, Boolean, 1, 'owned installed main renderer', diagnostics), timeout => {
    assert.equal(timeout.message, 'Timed out: owned installed main renderer.');
    assert.deepEqual(diagnostics.snapshot(timeout), { activeCheck: 'attach-page-list', errorKind: 'Error', lastReadError: { errorKind: 'TypeError', code: 'ECONNREFUSED' } });
    assert.equal(JSON.stringify(diagnostics.snapshot(timeout)).includes('private'), false);
    return true;
  });
  assert.equal(attempts, 1);
});

test('HTTP diagnostics retain only fixed endpoint categories and valid numeric status', () => {
  const mount = '/workspace/never-publish-private-fixture/opencode';
  assert.equal(portableHttpEndpoint('/workspaces'), 'workspace-registry-read');
  assert.equal(portableHttpEndpoint('/workspaces/local', 'POST'), 'workspace-registry-create');
  assert.equal(portableHttpEndpoint('/health'), 'server-health');
  assert.equal(portableHttpEndpoint(mount + '/session/status'), 'workspace-session-status');
  assert.equal(portableHttpEndpoint(mount + '/session', 'POST'), 'workspace-session-create');
  assert.equal(portableHttpEndpoint(mount + '/session'), 'workspace-session-list');
  assert.equal(portableHttpEndpoint(mount + '/session/private-session'), 'workspace-session-read');
  assert.equal(portableHttpEndpoint(mount + '/session/private-session/message'), 'workspace-message-read');
  assert.equal(portableHttpEndpoint(mount + '/session/private-session/message', 'POST'), 'workspace-message-write');
  assert.equal(portableHttpEndpoint('https://private.invalid/?token=never-publish-private-fixture'), 'unknown');
  const diagnostics = portableDiagnosticState(); diagnostics.enter('runtime-workspace-ready');
  diagnostics.http(portableHttpEndpoint(mount + '/session/status'), 502);
  const safe = diagnostics.snapshot(new Error('private URL/token/body'));
  assert.deepEqual(safe, { activeCheck: 'runtime-workspace-ready', errorKind: 'Error', lastHttp: { endpoint: 'workspace-session-status', status: 502 } });
  assert.equal(JSON.stringify(safe).includes('private'), false);
  for (const status of [NaN, Infinity, 0, 99, 600, '502']) assert.throws(() => diagnostics.http('workspace-session-status', status));
  assert.throws(() => diagnostics.http('never-publish-private-fixture', 200));
  diagnostics.http('workspace-session-status');
  assert.deepEqual(diagnostics.snapshot(new Error()).lastHttp, { endpoint: 'workspace-session-status' });
  for (const value of [null, {}, 'ready', 200, false, [null], [[]], [{}], [{ id: '' }], [{ id: ' ' }], [{ id: 123 }], [{ error: 'unreachable' }]]) assert.equal(validWorkspaceSessionList(value), false);
  for (const value of [[], [{ id: 'synthetic-owned-session' }]]) assert.equal(validWorkspaceSessionList(value), true);
});

test('native profile identity reads the actual main-process directory and rejects a different or malformed discovery path', async () => {
  const profile = join(tmpdir(), 'synthetic owned profile');
  for (const value of [
    { OPENWORK_UI_CONTROL_DISCOVERY: join(profile, 'openwork-ui-control.json') },
    { OPENWORK_UI_CONTROL_DISCOVERY: join(profile, 'other.json') },
    { OPENWORK_UI_CONTROL_DISCOVERY: join(profile, '..', 'openwork-ui-control.json') },
    { OPENWORK_ELECTRON_USERDATA: profile }, null, [], 'ready', {},
  ]) {
    const operations = [];
    const matched = await effectivePortableProfileMatches(async (...args) => { operations.push(args); return value; }, profile);
    assert.equal(matched, value !== null && value.OPENWORK_UI_CONTROL_DISCOVERY === join(profile, 'openwork-ui-control.json'));
    assert.deepEqual(operations, [['getOpenworkUiMcpEnvironment']]);
  }
  await assert.rejects(effectivePortableProfileMatches(async () => { throw new Error('synthetic unavailable bridge'); }, profile));
});

test('only a completed failed verdict requests explicit exit; success remains natural', () => {
  const exits = [];
  finishPortableRun(true, code => exits.push(code)); assert.deepEqual(exits, []);
  finishPortableRun(false, code => exits.push(code)); assert.deepEqual(exits, [1]);
  assert.throws(() => finishPortableRun(undefined, code => exits.push(code)));
});

test('failed verifier exits despite a pending child-process handle after synchronous evidence is written', () => {
  const moduleUrl = new URL('../scripts/zeno-update-portable-smoke.mjs', import.meta.url).href;
  const source = `import {spawn} from 'node:child_process';import {writeSync} from 'node:fs';import {finishPortableRun} from ${JSON.stringify(moduleUrl)};
    const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore',detached:true,windowsHide:true});
    writeSync(1,'synthetic evidence written synchronously');finishPortableRun(false,code=>process.exit(code));`;
  const result = spawnSync(process.execPath, ['--input-type=module'], { input: source, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1);
  assert.equal(result.stdout, 'synthetic evidence written synchronously');
});

test('real native entry refuses a developer invocation before any installation or app launch', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/zeno-update-portable-smoke.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', RUNNER_ENVIRONMENT: 'developer' },
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported native platform|CI-only native validation/);
});

test('failure process/disk facts contain only allowlisted booleans and bounded counts', () => {
  const value = { collected: true, diskReadSucceeded: true, publishedAsarOnDisk: false, oldBrowserPidAbsent: true,
    samePrivateMainProcessCount: 2, mainHasExpectedDebugArgument: false, userProfileEnvironmentMatches: true };
  for (const key of ['argv', 'path', 'token', 'environment', 'oldPid', 'actual', 'expected', 'observedBrowserPid', 'observedBrowserResources']) Object.defineProperty(value, key, { get() { throw Error('private fixture accessed'); } });
  assert.deepEqual(safePortableFailureState(value), { collected: true, diskReadSucceeded: true, publishedAsarOnDisk: false,
    oldBrowserPidAbsent: true, mainHasExpectedDebugArgument: false, userProfileEnvironmentMatches: true, samePrivateMainProcessCount: 2 });
  for (const count of [-1, 1.5, Infinity, 1025, '2']) assert.deepEqual(safePortableFailureState({ samePrivateMainProcessCount: count, targetVersionOnDisk: 'private-path' }), {});
  assert.deepEqual(safePortableFailureState({ observedBrowserPidKnown: true, observedBrowserPrivateExecutableMatches: true,
    observedBrowserDetailsReadable: true, observedBrowserProfileEnvironmentMatches: false, observedBrowserDebugEnvironmentMatches: true,
    observedBrowserEffectiveProfileMatches: false, observedBrowserPid: 12345, observedBrowserResources: 'never-publish-private-fixture' }), {
    observedBrowserPidKnown: true, observedBrowserPrivateExecutableMatches: true, observedBrowserDetailsReadable: true,
    observedBrowserDebugEnvironmentMatches: true, observedBrowserProfileEnvironmentMatches: false, observedBrowserEffectiveProfileMatches: false,
  });
  assert.deepEqual(safePortableFailureState({ archiveHashReadSucceeded: true, archiveMetadataReadSucceeded: false,
    ownedMainListenerProbeSucceeded: true, ownedMainExpectedPortListening: false, port: 1234, listenerPid: 12345 }), {
    archiveHashReadSucceeded: true, archiveMetadataReadSucceeded: false, ownedMainListenerProbeSucceeded: true, ownedMainExpectedPortListening: false,
  });
});

test('expected process arguments require exact values, including Unicode and spaces', () => {
  const profile = 'D:\\synthetic 私有目录\\profile';
  assert.equal(hasExactProcessArgument(['app', '--user-data-dir=' + profile], '--user-data-dir', profile), true);
  assert.equal(hasExactProcessArgument(['app', '--user-data-dir', profile], '--user-data-dir', profile), true);
  assert.equal(hasExactProcessArgument(['app', '--user-data-dir=' + profile + '-other'], '--user-data-dir', profile), false);
  assert.equal(hasExactProcessArgument(['app', '--remote-debugging-port=12345'], '--remote-debugging-port', '1234'), false);
  assert.equal(hasExactProcessArgument(['app', '--remote-debugging-port', '1234'], '--remote-debugging-port', '1234'), true);
});

test('hosted Windows failure probe filters one exact private exe and emits no raw process/registry values',
  { skip: process.platform !== 'win32' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' }, () => {
    const input = Buffer.from(JSON.stringify({ executable: 'C:\\zeno-synthetic-fixture\\泽诺 Zeno.exe',
      profile: 'C:\\zeno-synthetic-fixture\\profile', port: 1234, oldPid: process.pid }), 'utf8').toString('base64');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsFailureProbeScript()], { input, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0);
    const value = JSON.parse(result.stdout.trim());
    assert.deepEqual(value, safePortableFailureState(value));
    assert.equal(value.processScanCompleted, true); assert.equal(value.samePrivateMainProcessCount, 0);
    assert.equal(value.oldPidKnown, true); assert.equal(value.oldBrowserPidAbsent, false);
    assert.equal(value.mainHasExpectedDebugArgument, false); assert.equal(value.mainHasExpectedProfileArgument, false);
    assert.equal(typeof value.userDebugEnvironmentMatches, 'boolean'); assert.equal(typeof value.userProfileEnvironmentMatches, 'boolean');
    assert.equal(result.stdout.includes('zeno-synthetic-fixture'), false);
  });

test('Windows listener probe validates the same process identity and reports only owned expected-port booleans',
  { skip: process.platform !== 'win32' }, async () => {
    const server = createServer();
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    try {
      const port = server.address().port;
      const script = `$ErrorActionPreference='Stop'\n${windowsOwnedListenerProbeScript()}\n$owned=Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.pid}' -ErrorAction Stop\n$good=Read-OwnedListenerFact $owned ${port}\n$wrongPort=Read-OwnedListenerFact $owned 1\n$changed=[pscustomobject]@{ProcessId=$owned.ProcessId;ExecutablePath=$owned.ExecutablePath;CreationDate=$owned.CreationDate.AddMilliseconds(1)}\n$changedIdentity=Read-OwnedListenerFact $changed ${port}\n[ordered]@{good=$good;wrongPort=$wrongPort;changedIdentity=$changedIdentity}|ConvertTo-Json -Depth 3 -Compress`;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 15_000 });
      assert.equal(result.status, 0);
      const value = JSON.parse(result.stdout.trim());
      assert.deepEqual(value.good, { ownedMainListenerProbeSucceeded: true, ownedMainExpectedPortListening: true });
      assert.deepEqual(value.wrongPort, { ownedMainListenerProbeSucceeded: true, ownedMainExpectedPortListening: false });
      assert.deepEqual(value.changedIdentity, { ownedMainListenerProbeSucceeded: false });
      assert.equal(result.stdout.includes('ExecutablePath'), false); assert.equal(result.stdout.includes(String(process.pid)), false);
    } finally { await new Promise(done => server.close(done)); }
  });
