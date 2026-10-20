import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const DESKTOP = resolve(dirname(SCRIPT), '..');
const ORIGIN = 'https://fixture.zeno.invalid';
const PREFIX = '/api/zeno/v1';
const USER = 'synthetic-user';
const DEVICE = 'synthetic-device';
const REPORT_FIELDS = ['encryptionAvailable', 'encryptedFileNoPlaintext', 'sameProcessReload', 'newProcessReload', 'ownerFence', 'identityFence', 'authorizedHeaders', 'disconnectRevoked', 'disconnectDeleted', 'noWindow', 'privatePosixModes'];
const BACKENDS = ['unavailable', 'keychain', 'dpapi', 'gnome_libsecret'];
const FAILURE_STAGES = ['initialization', 'write-launch', 'read-launch', 'ready', 'backend', 'pairing', 'ciphertext', 'same-process-reload', 'new-process-reload', 'owner-fence', 'disconnect', 'cleanup'];

export function assertStorageHostedRunner(env, platform, arch) {
  assert.ok(['darwin', 'win32', 'linux'].includes(platform), 'Unsupported hosted platform.');
  assert.ok(platform === 'darwin' ? ['x64', 'arm64'].includes(arch) : arch === 'x64', 'Unsupported native architecture.');
  assert.equal(env.CI, 'true', 'Refusing developer machine.');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'GitHub Actions only.');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Refusing self-hosted runner.');
  assert.equal(env.RUNNER_OS, { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[platform]);
  assert.equal(env.RUNNER_ARCH, arch === 'arm64' ? 'ARM64' : 'X64');
  assert.equal(env.GITHUB_REF, 'refs/heads/personal');
  assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9]\d*$/);
  assert.ok(isAbsolute(env.RUNNER_TEMP ?? ''), 'Missing runner private directory.');
  if (platform === 'linux') {
    assert.match(env.DISPLAY ?? '', /^:\d+(?:\.\d+)?$/, 'A hosted Xvfb display is required.');
    assert.ok(env.DBUS_SESSION_BUS_ADDRESS?.startsWith('unix:'), 'An isolated D-Bus session is required.');
  }
}

function privatePath(root, path) {
  const child = relative(root, path);
  assert.ok(child && !isAbsolute(child) && !child.split(/[\\/]/).includes('..'), 'Private path escaped runner root.');
  let ancestor = root; assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  for (const part of child.split(sep)) {
    ancestor = join(ancestor, part);
    if (existsSync(ancestor)) assert.ok(!lstatSync(ancestor).isSymbolicLink(), 'Refusing a private-path symlink.');
  }
  return path;
}

export function safeStorageBackend(storage, platform) {
  assert.equal(storage.isEncryptionAvailable(), true, 'OS encryption is unavailable.');
  if (platform === 'darwin') return 'keychain';
  if (platform === 'win32') return 'dpapi';
  assert.equal(platform, 'linux');
  const backend = storage.getSelectedStorageBackend?.();
  assert.equal(backend, 'gnome_libsecret', 'A real Linux libsecret backend is required; plaintext/unknown is refused.');
  return backend;
}

export function safeStorageReport(input) {
  const versions = {};
  for (const key of ['electron', 'node', 'chrome', 'zeno']) {
    const version = input.version?.[key];
    assert.equal(typeof version, 'string'); assert.match(version, /^\d+\.\d+\.\d+(?:\.\d+)?$/);
    versions[key] = version;
  }
  assert.ok(BACKENDS.includes(input.backend));
  assert.ok(['darwin', 'win32', 'linux'].includes(input.platform)); assert.ok(['x64', 'arm64'].includes(input.arch));
  const checks = Object.fromEntries(REPORT_FIELDS.map(key => [key, input.checks?.[key] === true]));
  const report = { passed: input.passed === true, platform: input.platform, arch: input.arch, backend: input.backend, version: versions, checks,
    scope: { realOsSafeStorage: input.scope?.realOsSafeStorage === true, productionServiceSource: input.scope?.productionServiceSource === true, syntheticTransportOnly: true, noModelCalls: true, productionSignedAppIdentityTested: false, realAccountPairingTested: false, windowsAclAudit: false },
    temporaryFilesRemoved: input.temporaryFilesRemoved === true };
  if (FAILURE_STAGES.includes(input.failedCheck)) report.failedCheck = input.failedCheck;
  return report;
}

function versionInfo(electron = '0.0.0') {
  return { electron, node: process.versions.node, chrome: process.versions.chrome ?? '0.0.0', zeno: JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version };
}

function fixtureTransport(credential, counters) {
  const response = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  let challenge;
  const session = { user: { id: USER, email: 'fixture@example.invalid', name: 'Fixture', role: 'user' }, deviceId: DEVICE, expiresAt: credential.expiresAt };
  return async (rawUrl, init) => {
    const url = new URL(rawUrl); assert.equal(url.origin, ORIGIN); assert.equal(init.redirect, 'error'); counters.requests++;
    if (url.pathname === PREFIX + '/devices/authorization') {
      assert.equal(init.method, 'POST'); const body = JSON.parse(init.body); challenge = body.codeChallenge;
      assert.match(challenge, /^[A-Za-z\d_-]{43}$/); assert.equal(body.codeVerifier, undefined);
      return response({ deviceCode: 'synthetic-device-code', verificationUriComplete: ORIGIN + '/app/device?user_code=fixture', expiresAt: Date.now() + 300_000 });
    }
    if (url.pathname === PREFIX + '/devices/token') {
      assert.equal(init.method, 'POST'); const body = JSON.parse(init.body);
      assert.equal(createHash('sha256').update(body.codeVerifier).digest('base64url'), challenge);
      assert.equal(body.deviceCode, 'synthetic-device-code'); counters.paired = true;
      return response({ deviceId: DEVICE, accessToken: credential.accessToken, expiresAt: credential.expiresAt });
    }
    assert.equal(init.headers.Authorization, 'Bearer ' + credential.accessToken);
    if (init.headers['X-Zeno-Account'] === USER) counters.ownerHeader = true;
    if (url.pathname === PREFIX + '/me' && init.method === 'GET') return response(session);
    if (url.pathname === PREFIX + '/devices/' + DEVICE && init.method === 'DELETE') {
      assert.equal(init.headers['X-Zeno-Account'], USER); counters.revoked = true; return response({ ok: true });
    }
    throw new Error('Unexpected synthetic service request.');
  };
}

async function bounded(promise, milliseconds = 15_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic service deadline.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function electronMain() {
  assertStorageHostedRunner(process.env, process.platform, process.arch);
  assert.equal(process.type, 'browser', 'Normal Electron main process required.');
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined, 'Node-only mode cannot prove OS safeStorage.');
  const stage = process.env.ZENO_SAFE_STORAGE_STAGE; assert.ok(['write', 'read'].includes(stage));
  const runner = realpathSync(process.env.RUNNER_TEMP);
  const root = privatePath(runner, resolve(process.env.ZENO_SAFE_STORAGE_ROOT ?? ''));
  assert.match(process.env.ZENO_SAFE_STORAGE_ID ?? '', /^[a-f\d]{64}$/);
  assert.equal(readFileSync(privatePath(root, join(root, '.probe-id')), 'utf8'), process.env.ZENO_SAFE_STORAGE_ID);
  const profile = privatePath(root, join(root, 'electron-user-data')); const serviceRoot = privatePath(root, join(root, 'service'));
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  // Resolve Electron synchronously before its ready event; OS cryptography must
  // initialize against this probe's private userData, never a default profile.
  const { app, BrowserWindow, safeStorage } = createRequire(import.meta.url)('electron');
  assert.equal(app.isReady(), false, 'Private userData must be configured before Electron readiness.');
  app.setName('Zeno OS storage CI'); app.setPath('userData', profile);
  if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
  const report = { passed: false, platform: process.platform, arch: process.arch, backend: 'unavailable', version: versionInfo(process.versions.electron), checks: {}, scope: { realOsSafeStorage: false } };
  let service; let reloaded; let failureStage = 'ready';
  try {
    await app.whenReady(); assert.equal(BrowserWindow.getAllWindows().length, 0);
    failureStage = 'backend'; report.backend = safeStorageBackend(safeStorage, process.platform);
    report.checks.encryptionAvailable = true; report.scope.realOsSafeStorage = true;
    const { createZenoPersonalService } = await import('../electron/zeno-personal.mjs');
    report.scope.productionServiceSource = true;
    const file = join(serviceRoot, 'device.bin');
    let credential;
    if (stage === 'write') credential = { origin: ORIGIN, deviceId: DEVICE, accessToken: 'synthetic-' + randomBytes(32).toString('hex'), expiresAt: Date.now() + 3_600_000, userId: USER };
    else {
      credential = JSON.parse(safeStorage.decryptString(readFileSync(file)));
      assert.equal(credential.origin, ORIGIN); assert.equal(credential.userId, USER); assert.equal(credential.deviceId, DEVICE);
      assert.match(credential.accessToken, /^synthetic-[a-f\d]{64}$/); assert.ok(credential.expiresAt > Date.now());
    }
    const counters = { requests: 0, paired: false, revoked: false, ownerHeader: false };
    let paired; const pairedPromise = new Promise(done => { paired = done; });
    const options = { root: serviceRoot, origin: ORIGIN, safeStorage, isWindowOpen: () => true, name: 'Synthetic CI device', platform: process.platform,
      openExternal: async value => { const url = new URL(value); assert.equal(url.origin, ORIGIN); assert.equal(url.pathname, '/app/device'); },
      fetchImpl: fixtureTransport(credential, counters), onChanged: () => paired() };
    service = createZenoPersonalService(options);
    if (stage === 'write') {
      failureStage = 'pairing'; await service.connect(); await bounded(pairedPromise); assert.equal(counters.paired, true);
    } else failureStage = 'new-process-reload';
    const identity = await service.identity(); assert.equal(identity?.userId, USER); assert.equal(identity?.deviceId, DEVICE);
    assert.equal((await service.getSession())?.user.id, USER);
    if (stage === 'read') report.checks.newProcessReload = true;
    failureStage = 'ciphertext'; const bytes = readFileSync(file);
    for (const marker of [credential.accessToken, USER, DEVICE, ORIGIN, JSON.stringify(credential)]) assert.equal(bytes.includes(Buffer.from(marker)), false);
    assert.equal(safeStorage.decryptString(bytes), JSON.stringify(credential)); report.checks.encryptedFileNoPlaintext = true;
    if (process.platform !== 'win32') {
      assert.equal(lstatSync(file).mode & 0o777, 0o600); assert.equal(lstatSync(serviceRoot).mode & 0o777, 0o700); report.checks.privatePosixModes = true;
    }
    failureStage = 'same-process-reload'; service.dispose(); service = null;
    reloaded = createZenoPersonalService(options);
    assert.equal((await reloaded.identity())?.userId, USER); assert.equal((await reloaded.getSession())?.deviceId, DEVICE); report.checks.sameProcessReload = true;
    failureStage = 'owner-fence'; const current = await reloaded.identity(); const before = counters.requests;
    const owner = await reloaded.internalRequest('GET', '/me', undefined, { ...current, userId: 'different-synthetic-user' });
    assert.equal(owner.status, 409); assert.equal(owner.body.code, 'account_changed'); assert.equal(counters.requests, before); report.checks.ownerFence = true;
    for (const stale of [{ ...current, generation: current.generation + 1 }, { ...current, deviceId: 'different-synthetic-device' }]) {
      const blocked = await reloaded.internalRequest('GET', '/me', undefined, stale); assert.equal(blocked.status, 409); assert.equal(counters.requests, before);
    }
    report.checks.identityFence = true;
    assert.equal((await reloaded.internalRequest('GET', '/me', undefined, current)).status, 200); assert.equal(counters.ownerHeader, true); report.checks.authorizedHeaders = true;
    if (stage === 'read') {
      failureStage = 'disconnect'; await reloaded.disconnect(); assert.equal(counters.revoked, true); assert.equal(await reloaded.identity(), null);
      report.checks.disconnectRevoked = true; assert.equal(existsSync(file), false); report.checks.disconnectDeleted = true;
      const empty = createZenoPersonalService(options); try { assert.equal(await empty.identity(), null); } finally { empty.dispose(); }
    }
    assert.equal(BrowserWindow.getAllWindows().length, 0); report.checks.noWindow = true; report.passed = true;
  } catch { report.failedCheck = failureStage; }
  finally {
    service?.dispose(); reloaded?.dispose();
    writeFileSync(join(root, `report-${stage}.json`), JSON.stringify(safeStorageReport(report)), { mode: 0o600 });
    process.exitCode = report.passed ? 0 : 1;
    app.quit();
  }
}

export function isolatedStorageEnvironment(env, values) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) if (/^(?:OPENWORK_|OPENCODE_|DEN_|MODELHELM_|VITE_|ZENO_|ELECTRON_|NODE_OPTIONS$|NODE_PATH$)/.test(key) || /(?:TOKEN|PASSWORD|SECRET|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)/i.test(key)) delete clean[key];
  return { ...clean, ...values };
}

function launcher() {
  assertStorageHostedRunner(process.env, process.platform, process.arch);
  const runner = realpathSync(process.env.RUNNER_TEMP); const root = mkdtempSync(join(runner, 'zeno-os-storage-'));
  const evidence = join(runner, 'zeno-safe-storage-evidence'); mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const id = randomBytes(32).toString('hex'); writeFileSync(join(root, '.probe-id'), id, { mode: 0o600 });
  const require = createRequire(join(DESKTOP, 'package.json'));
  const electronVersion = require('electron/package.json').version;
  const report = { passed: false, platform: process.platform, arch: process.arch, backend: 'unavailable', version: versionInfo(electronVersion), checks: {}, scope: { realOsSafeStorage: false } };
  let stage = 'initialization';
  try {
    const executable = require('electron'); assert.equal(typeof executable, 'string'); assert.ok(isAbsolute(executable) && lstatSync(executable).isFile());
    const reports = [];
    for (const phase of ['write', 'read']) {
      stage = phase === 'write' ? 'write-launch' : 'read-launch';
      const environment = isolatedStorageEnvironment(process.env, { ZENO_SAFE_STORAGE_ROOT: root, ZENO_SAFE_STORAGE_ID: id, ZENO_SAFE_STORAGE_STAGE: phase });
      const child = spawnSync(executable, [SCRIPT], { env: environment, cwd: DESKTOP, stdio: 'ignore', timeout: 120_000 });
      const file = join(root, `report-${phase}.json`);
      if (existsSync(file)) {
        const value = safeStorageReport(JSON.parse(readFileSync(privatePath(root, file), 'utf8'))); reports.push(value);
        Object.assign(report, { backend: value.backend, version: value.version, scope: value.scope }); Object.assign(report.checks, Object.fromEntries(Object.entries(value.checks).filter(([, passed]) => passed)));
        if (!value.passed && value.failedCheck) stage = value.failedCheck;
      }
      assert.ok(!child.error && child.status === 0 && reports.at(-1)?.passed === true, 'Hosted Electron safeStorage phase failed.');
      assert.equal(reports.at(-1).version.electron, electronVersion, 'A different Electron runtime was executed.');
    }
    assert.equal(reports.length, 2); assert.equal(reports[0].backend, reports[1].backend);
    for (const key of REPORT_FIELDS.filter(key => key !== 'privatePosixModes' || process.platform !== 'win32')) assert.equal(report.checks[key], true);
    report.passed = true;
  } catch { report.failedCheck = stage; }
  finally {
    try { rmSync(privatePath(runner, root), { recursive: true, force: true }); report.temporaryFilesRemoved = true; }
    catch { report.passed = false; report.failedCheck = 'cleanup'; }
    writeFileSync(join(evidence, 'report.json'), JSON.stringify(safeStorageReport(report), null, 2) + '\n', { mode: 0o600 });
    console.log(`[zeno-safe-storage] ${report.passed ? 'passed' : 'failed'}; sanitized report written.`);
    if (!report.passed) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  const refused = () => {
    console.error('[zeno-safe-storage] Refused unsafe environment or invalid probe configuration.'); process.exitCode = 1;
    if (process.type === 'browser') createRequire(import.meta.url)('electron').app.exit(1);
  };
  try {
    assert.equal(process.argv.length, 2, 'No Electron or storage overrides are accepted.');
    // electronMain configures private userData synchronously before its first
    // await. Do not hold ESM entry evaluation open while awaiting app readiness.
    if (process.env.ZENO_SAFE_STORAGE_STAGE) void electronMain().catch(refused); else launcher();
  } catch { refused(); }
}
