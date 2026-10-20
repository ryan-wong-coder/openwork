import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, realpathSync, mkdirSync, readFileSync, renameSync, truncateSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './zeno-update-runtime-fixture.test.mjs';
import YAML from 'yaml';
import { assertPortableHostedRunner, assertPrivatePath, validatePortableHistorical, validatePortableTarget, nsisPayloadPath,
  portableErrorMetadata, portableDiagnosticState, windowsProcessPathCommand, decodeWindowsProcessPath, until,
  portableHttpEndpoint, validWorkspaceSessionList, effectivePortableProfileMatches, finishPortableRun,
  safePortableFailureState, hasExactProcessArgument, windowsFailureProbeScript, portableDownloadRetries,
  snapshotDownloadLogs, inspectDownloadLogWindow, resetOnlyDownloadLogText, runPortableDownloadAttempts } from '../scripts/zeno-update-portable-smoke.mjs';
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
  assert.equal(input.windows_download_retries.default, '0'); assert.deepEqual(input.windows_download_retries.options, ['0', '1', '2']);
  const selection = workflow.jobs['select-platforms'].steps.find(step => step.id === 'select').run;
  const source = /^node --input-type=module <<'JS'\n([\s\S]+)\nJS\n?$/.exec(selection)?.[1]; assert.ok(source);
  const root = mkdtempSync(join(tmpdir(), 'zeno-workflow-selftest-'));
  try {
    for (const selected of ['both', 'win32', 'linux', '', 'darwin', 'linux,win32', '__proto__']) for (const retries of ['0', '1', '2', '', '3', '1;exit']) {
      const output = join(root, 'matrix-' + selected.replaceAll(/[^a-z]/g, '_') + '-' + retries.replaceAll(/[^a-z0-9]/g, '_'));
      const result = spawnSync(process.execPath, ['--input-type=module'], { input: source, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, SMOKE_PLATFORM: selected, SMOKE_WINDOWS_DOWNLOAD_RETRIES: retries } });
      if (['both', 'win32', 'linux'].includes(selected) && ['0', '1', '2'].includes(retries) && (selected !== 'linux' || retries === '0')) {
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
