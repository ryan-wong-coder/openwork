import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import { assertPortableHostedRunner, assertPrivatePath, validatePortableHistorical, validatePortableTarget, nsisPayloadPath } from '../scripts/zeno-update-portable-smoke.mjs';
import { numericDownloadProgress, safeUpdateFailureSignals } from '../scripts/zeno-update-smoke.mjs';

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
  const selection = workflow.jobs['select-platforms'].steps.find(step => step.id === 'select').run;
  const source = /^node --input-type=module <<'JS'\n([\s\S]+)\nJS\n?$/.exec(selection)?.[1]; assert.ok(source);
  const root = mkdtempSync(join(tmpdir(), 'zeno-workflow-selftest-'));
  try {
    for (const selected of ['both', 'win32', 'linux', '', 'darwin', 'linux,win32', '__proto__']) {
      const output = join(root, 'matrix-' + selected.replaceAll(/[^a-z]/g, '_'));
      const result = spawnSync(process.execPath, ['--input-type=module'], { input: source, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, SMOKE_PLATFORM: selected } });
      if (['both', 'win32', 'linux'].includes(selected)) {
        assert.equal(result.status, 0);
        const expected = [{ platform: 'win32', runner: 'windows-2025' }, { platform: 'linux', runner: 'ubuntu-24.04' }].filter(item => selected === 'both' || item.platform === selected);
        assert.deepEqual(JSON.parse(readFileSync(output, 'utf8').trim().replace(/^matrix=/, '')), { include: expected });
      } else { assert.notEqual(result.status, 0); assert.equal(existsSync(output), false); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
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
