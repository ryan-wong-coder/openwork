import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { assertStorageHostedRunner, isolatedStorageEnvironment, safeStorageBackend, safeStorageReport } from '../scripts/zeno-safe-storage-probe.mjs';
import { createZenoPersonalService } from '../electron/zeno-personal.mjs';

const env = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'macOS', RUNNER_ARCH: 'ARM64', GITHUB_REF: 'refs/heads/personal', GITHUB_RUN_ID: '12', RUNNER_TEMP: tmpdir() };

test('OS probe guard refuses developer, self-hosted, wrong branch and wrong native lane', () => {
  assertStorageHostedRunner(env, 'darwin', 'arm64');
  for (const [key, value] of [['CI', ''], ['GITHUB_ACTIONS', ''], ['RUNNER_ENVIRONMENT', 'self-hosted'], ['GITHUB_REF', 'refs/heads/main'], ['GITHUB_RUN_ID', 'invalid'], ['RUNNER_TEMP', 'relative']]) assert.throws(() => assertStorageHostedRunner({ ...env, [key]: value }, 'darwin', 'arm64'));
  assert.throws(() => assertStorageHostedRunner(env, 'darwin', 'x64'));
  const windows = { ...env, RUNNER_OS: 'Windows', RUNNER_ARCH: 'X64' }; assertStorageHostedRunner(windows, 'win32', 'x64');
  assert.throws(() => assertStorageHostedRunner(windows, 'win32', 'arm64'));
  const linux = { ...env, RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', DISPLAY: ':99', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/synthetic/session' };
  assertStorageHostedRunner(linux, 'linux', 'x64');
  assert.throws(() => assertStorageHostedRunner({ ...linux, DISPLAY: '' }, 'linux', 'x64'));
  assert.throws(() => assertStorageHostedRunner({ ...linux, DBUS_SESSION_BUS_ADDRESS: 'tcp:host=outside.invalid' }, 'linux', 'x64'));
});

test('normal Node developer entry exits before importing or launching normal Electron', () => {
  const script = fileURLToPath(new URL('../scripts/zeno-safe-storage-probe.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5000, env: { ...process.env, CI: 'false', ZENO_SAFE_STORAGE_STAGE: '' } });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), '[zeno-safe-storage] Refused unsafe environment or invalid probe configuration.');
});

test('real backend eligibility rejects basic_text, unknown and unavailable encryption', () => {
  assert.equal(safeStorageBackend({ isEncryptionAvailable: () => true }, 'darwin'), 'keychain');
  assert.equal(safeStorageBackend({ isEncryptionAvailable: () => true }, 'win32'), 'dpapi');
  assert.equal(safeStorageBackend({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux'), 'gnome_libsecret');
  for (const backend of ['basic_text', 'unknown', undefined, 'synthetic-backend']) assert.throws(() => safeStorageBackend({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend }, 'linux'));
  assert.throws(() => safeStorageBackend({ isEncryptionAvailable: () => false }, 'darwin'));
});

test('current source service refuses unavailable and basic_text before requesting or persisting credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zeno-storage-unavailable-'));
  let requests = 0; let opened = 0; let encrypted = 0;
  try {
    for (const storage of [{ isEncryptionAvailable: () => false }, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }]) {
      const service = createZenoPersonalService({ root, origin: 'https://fixture.zeno.invalid', safeStorage: { ...storage, encryptString: () => { encrypted++; throw new Error('must not encrypt'); } },
        isWindowOpen: () => true, name: 'Synthetic', platform: 'linux', openExternal: async () => { opened++; }, fetchImpl: async () => { requests++; throw new Error('must not request'); } });
      try { assert.equal(await service.identity(), null); await assert.rejects(service.connect(), /安全储存/); }
      finally { service.dispose(); }
    }
    assert.equal(requests, 0); assert.equal(opened, 0); assert.equal(encrypted, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Electron child environment strips credentials, product runtime overrides and Node injection', () => {
  const clean = isolatedStorageEnvironment({ ...env, DISPLAY: ':99', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/synthetic', NODE_OPTIONS: '--import=private', NODE_PATH: '/private', ELECTRON_RUN_AS_NODE: '1', ELECTRON_EXTRA_LAUNCH_ARGS: '--no-sandbox', OPENWORK_ENV_STORE: '/private', OPENCODE_AUTH: 'private', GH_TOKEN: 'private', AWS_SECRET_ACCESS_KEY: 'private', MODELHELM_KEY: 'private', ZENO_OLD_OVERRIDE: '/private' }, { ZENO_SAFE_STORAGE_STAGE: 'write' });
  assert.equal(clean.CI, 'true'); assert.equal(clean.DISPLAY, ':99'); assert.equal(clean.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/synthetic'); assert.equal(clean.ZENO_SAFE_STORAGE_STAGE, 'write');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_EXTRA_LAUNCH_ARGS', 'OPENWORK_ENV_STORE', 'OPENCODE_AUTH', 'GH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'MODELHELM_KEY', 'ZENO_OLD_OVERRIDE']) assert.equal(clean[key], undefined);
});

test('evidence sanitizer retains only fixed booleans, known backend and runtime versions', () => {
  const marker = 'private-fixture-never-retain';
  const report = safeStorageReport({ passed: true, platform: 'linux', arch: 'x64', backend: 'gnome_libsecret', version: { electron: '43.7.7', node: '24.21.0', chrome: '150.0.1.2', zeno: '1.1.0', secret: marker }, checks: { noWindow: true, secret: marker, ownerFence: 'true' }, scope: { realOsSafeStorage: true }, failedCheck: marker, token: marker, path: marker, url: marker });
  assert.equal(report.checks.noWindow, true); assert.equal(report.checks.ownerFence, false); assert.equal(report.failedCheck, undefined);
  assert.equal(report.scope.productionSignedAppIdentityTested, false); assert.equal(report.scope.realAccountPairingTested, false);
  assert.ok(!JSON.stringify(report).includes(marker));
  assert.throws(() => safeStorageReport({ ...report, backend: marker }));
  assert.throws(() => safeStorageReport({ ...report, version: { ...report.version, electron: marker } }));
});

test('hosted workflow uses four native lanes and explicitly starts private Linux libsecret', () => {
  const workflow = YAML.parse(readFileSync(new URL('../../../.github/workflows/zeno-safe-storage-smoke.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['os-storage'];
  assert.equal(job.if, "github.ref == 'refs/heads/personal'"); assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix.include, [{ runner: 'macos-15-intel', platform: 'darwin', arch: 'x64' }, { runner: 'macos-15', platform: 'darwin', arch: 'arm64' }, { runner: 'windows-2025', platform: 'win32', arch: 'x64' }, { runner: 'ubuntu-24.04', platform: 'linux', arch: 'x64' }]);
  const linux = job.steps.find(step => step.name === 'Exercise actual libsecret in a private hosted D-Bus session').run;
  assert.match(linux, /dbus-run-session -- xvfb-run/); assert.match(linux, /gnome-keyring-daemon --unlock --components=secrets/); assert.match(linux, /XDG_DATA_HOME/);
  assert.equal(spawnSync('bash', ['-n'], { input: linux }).status, 0);
  assert.ok(!linux.includes('--no-sandbox')); assert.ok(!linux.includes('password-store=basic'));
  const upload = job.steps.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.with.path, '${{ runner.temp }}/zeno-safe-storage-evidence/report.json');
});
