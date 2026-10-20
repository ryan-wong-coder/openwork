import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, basename, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';
import YAML from 'yaml';
import { copyVerifiedArtifact, numericDownloadProgress, privateUpdateFailureDiagnostics } from './zeno-update-smoke.mjs';
import { compareStableVersions } from '../electron/recovery.mjs';

// This entry point refuses developer machines and self-hosted runners. Linux
// uses the hosted VM's Xvfb; Windows uses its disposable hosted desktop. Only
// the historical installer is launched by the harness. The updater alone may
// install and relaunch the target. Extracting target code is a hash reference,
// never evidence that an upgrade or relaunch occurred.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TARGET = JSON.parse(readFileSync(join(REPO, 'apps/desktop/package.json'), 'utf8')).version;
const BASELINE = '1.0.0';
const ORIGIN = 'https://www.zeno.ryan-wong.cn';
const PRODUCT = '泽诺 Zeno';
const pause = ms => new Promise(done => setTimeout(done, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const lane = platform => {
  assert.ok(['win32', 'linux'].includes(platform), 'Unsupported native platform.');
  return platform === 'win32' ? { os: 'win', suffix: 'exe', manifest: 'latest.yml', signing: 'unsigned' }
    : { os: 'linux', suffix: 'AppImage', manifest: 'latest-linux.yml', signing: 'none' };
};

export function assertPortableHostedRunner(env, platform, arch) {
  lane(platform);
  assert.equal(arch, 'x64', 'Only native x64 runners are supported.');
  for (const key of ['CI', 'GITHUB_ACTIONS']) assert.equal(env[key], 'true', 'CI-only native validation.');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'Refusing developer and self-hosted machines.');
  assert.equal(env.RUNNER_OS, platform === 'win32' ? 'Windows' : 'Linux');
  assert.equal(env.GITHUB_REF, 'refs/heads/personal');
  assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9]\d*$/);
  const paths = platform === 'win32' ? win32 : { isAbsolute, relative };
  assert.ok(paths.isAbsolute(env.RUNNER_TEMP ?? ''), 'Missing private runner temporary root.');
  for (const key of ['ZENO_UPDATE_BASELINE_DIR', 'ZENO_UPDATE_TARGET_DIR', 'ZENO_UPDATE_BASELINE_METADATA']) {
    assert.ok(paths.isAbsolute(env[key] ?? ''), 'Missing explicit release artifact path.');
    const child = paths.relative(env.RUNNER_TEMP, env[key]);
    assert.ok(child && !paths.isAbsolute(child) && !child.split(/[\\/]/).includes('..'), 'Artifact path escaped runner temporary root.');
  }
  if (platform === 'linux') assert.match(env.DISPLAY ?? '', /^:\d+(?:\.\d+)?$/, 'Linux native UI must use a private Xvfb display.');
}

function sha512(value) {
  assert.equal(typeof value, 'string', 'Missing SHA-512.');
  assert.match(value, /^(?:[a-f\d]{128}|[A-Za-z\d+/]{86}==)$/i, 'Invalid SHA-512.');
  return value.length === 128 ? value.toLowerCase() : Buffer.from(value, 'base64').toString('hex');
}

function fileMetadata(file, name, url) {
  assert.equal(file.name, name, 'Unexpected installer name.');
  assert.equal(file.url, url, 'Unexpected installer URL.');
  assert.ok(Number.isSafeInteger(file.size) && file.size > 0, 'Missing installer size.');
  assert.match(file.sha256 ?? '', /^[a-f\d]{64}$/i, 'Missing installer SHA-256.');
  return { name, size: file.size, sha256: file.sha256.toLowerCase(), sha512: sha512(file.sha512) };
}

export function validatePortableHistorical(index, platform) {
  const spec = lane(platform);
  assert.equal(index?.version, BASELINE);
  assert.equal(index.platforms?.length, 6, 'Historical release must include all six lanes.');
  const lanes = new Set();
  for (const item of index.platforms) {
    assert.ok(['darwin', 'win32', 'linux'].includes(item.platform) && ['x64', 'arm64'].includes(item.arch));
    assert.equal(item.version, BASELINE); const key = `${item.platform}/${item.arch}`;
    assert.ok(!lanes.has(key)); lanes.add(key);
  }
  const selected = index.platforms.find(item => item.platform === platform && item.arch === 'x64');
  assert.ok(selected); assert.equal(selected.updatesEnabled, true); assert.equal(selected.signing, spec.signing);
  const feed = `${ORIGIN}/updates/${platform}/x64/`;
  assert.equal(selected.feedUrl, feed);
  const name = `zeno-${spec.os}-x64-${BASELINE}.${spec.suffix}`;
  const files = selected.files.filter(file => file.name === name); assert.equal(files.length, 1);
  return fileMetadata(files[0], name, feed + name);
}

export function validatePortableTarget(index, manifest, platform, version = TARGET) {
  const spec = lane(platform); const feed = `${ORIGIN}/updates/${platform}/x64/`;
  assert.match(version, /^\d+\.\d+\.\d+$/); assert.equal(compareStableVersions(version, BASELINE), 1);
  assert.equal(index?.version, version); assert.ok(Number.isFinite(Date.parse(index.publishedAt)));
  assert.equal(index.artifacts?.length, 10, 'Public release must contain ten native installers.');
  assert.equal(manifest?.version, version); assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  assert.ok(!manifest.packages || Object.keys(manifest.packages).length === 0);
  const seen = new Set(); let installer;
  for (const item of manifest.files) {
    assert.equal(typeof item.url, 'string');
    const url = new URL(item.url, feed); const name = decodeURIComponent(url.pathname.split('/').at(-1));
    assert.equal(url.origin, ORIGIN); assert.ok(!url.username && !url.password && !url.search && !url.hash);
    assert.equal(url.href, feed + name, 'Native feed escaped its exact public lane.');
    assert.match(name, new RegExp(`^zeno-${spec.os}-x64-${version.replaceAll('.', '\\.')}\\.(?:${platform === 'win32' ? 'exe' : 'AppImage|deb'})$`));
    assert.ok(!seen.has(name)); seen.add(name);
    const matches = index.artifacts.filter(file => file.platform === platform && file.arch === 'x64' && file.name === name);
    assert.equal(matches.length, 1); const record = matches[0];
    assert.equal(record.signature, 'unsigned'); assert.equal(record.size, item.size);
    assert.equal(record.format, name.split('.').at(-1)); assert.equal(sha512(record.sha512), sha512(item.sha512));
    const verified = fileMetadata(record, name, `/downloads/${version}/${name}`);
    if (name.endsWith('.' + spec.suffix)) installer = verified;
  }
  assert.ok(installer, 'The feed must contain its native installer.');
  if (manifest.path) assert.ok(seen.has(manifest.path), 'Unexpected top-level feed path.');
  if (manifest.sha512) assert.equal(sha512(manifest.sha512), installer.sha512);
  return { feed, installer };
}

export function assertPrivatePath(root, file) {
  assert.ok(isAbsolute(root) && isAbsolute(file)); const child = relative(root, file);
  assert.ok(child && !isAbsolute(child) && !child.split(/[\\/]/).includes('..'), 'Private path escaped its root.');
  let current = root; assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  for (const part of child.split(sep)) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    assert.ok(!lstatSync(current).isSymbolicLink(), 'Private path contains a symlink.');
  }
  if (existsSync(file)) {
    const actual = relative(realpathSync(root), realpathSync(file));
    assert.ok(actual && !isAbsolute(actual) && !actual.split(/[\\/]/).includes('..'));
  }
  return file;
}

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 300_000, maxBuffer: 16 * 1024 * 1024, ...options });
  assert.ok(!result.error && result.status === 0, `Native validation command failed: ${basename(executable)}.`);
  return result.stdout.trim();
}

function sevenZip() {
  const executable = join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe');
  assert.ok(existsSync(executable), 'Hosted Windows runner must provide 7-Zip.'); return executable;
}

export function nsisPayloadPath(listing) {
  const names = [...listing.matchAll(/^Path = (.+)\r?$/gm)].map(match => match[1].replace(/\r$/, ''));
  const payloads = names.filter(name => /^(?:\$PLUGINSDIR[\\/])?app-64\.(?:7z|zip)$/.test(name));
  assert.equal(payloads.length, 1, 'Original NSIS payload is missing or ambiguous.');
  return payloads[0];
}

function referenceResources(installer, destination, platform) {
  mkdirSync(destination);
  if (platform === 'linux') {
    chmodSync(installer, 0o755);
    command(installer, ['--appimage-extract', 'resources/*'], { cwd: destination });
    return join(destination, 'squashfs-root', 'resources');
  }
  const zip = sevenZip();
  // Extract only the embedded app payload, then its resources. Neither the
  // installer nor target executable is run for this reference-code check.
  const payload = nsisPayloadPath(command(zip, ['l', '-slt', installer]));
  command(zip, ['e', '-y', '-bso0', '-bsp0', `-o${destination}`, installer, payload]);
  const payloads = readdirSync(destination).filter(name => /^app-64\.(7z|zip)$/.test(name));
  assert.equal(payloads.length, 1, 'Original NSIS payload is missing or ambiguous.');
  command(zip, ['x', '-y', '-bso0', '-bsp0', `-o${join(destination, 'app')}`, join(destination, payloads[0]), 'resources\\*']);
  return join(destination, 'app', 'resources');
}

function verifyResources(resources, version, feed, platform) {
  const archive = join(resources, 'app.asar');
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(metadata.version, version); assert.equal(metadata.openworkBrand, 'zeno'); assert.equal(metadata.openworkDistribution, 'public');
  assert.equal(metadata.zenoReleaseUpdatesEnabled, true); assert.equal(metadata.zenoReleaseSigning, lane(platform).signing);
  const config = YAML.parse(readFileSync(join(resources, 'app-update.yml'), 'utf8'));
  assert.equal(config.provider, 'generic'); assert.equal(config.url, feed);
  assert.match(config.updaterCacheDirName ?? '', /^@?[\w][\w.-]{0,255}$/);
  return { archiveSha256: hash(readFileSync(archive)), updaterCacheDirName: config.updaterCacheDirName };
}

async function until(read, accept, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await read(); if (accept(value)) return value; } catch {} await pause(250); }
  throw new Error(`Timed out: ${label}.`);
}

async function publicResponse(url) {
  assert.equal(new URL(url).origin, ORIGIN);
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, 'Pinned public release is unavailable.'); return response;
}

async function freePort() {
  const server = createServer(); await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}

async function connect(url, events = () => {}) {
  const parsed = new URL(url); assert.equal(parsed.protocol, 'ws:'); assert.equal(parsed.hostname, '127.0.0.1');
  const socket = new WebSocket(url); const pending = new Map(); let next = 0;
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('Private CDP connection failed.')); });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data); if (!event.id) { events(event); return; }
    const request = pending.get(event.id); if (!request) return; pending.delete(event.id); clearTimeout(request.timer);
    event.error ? request.fail(new Error('Private CDP operation failed.')) : request.done(event.result);
  };
  socket.onclose = () => { for (const item of pending.values()) { clearTimeout(item.timer); item.fail(new Error('Private CDP closed.')); } pending.clear(); };
  return { socket, send(method, params = {}, timeout = 30_000) { return new Promise((done, fail) => {
    const id = ++next; const timer = setTimeout(() => { pending.delete(id); fail(new Error('Private CDP operation timed out.')); }, timeout);
    pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); } };
}

function pageResources(target, platform, installation, root) {
  if (target?.type !== 'page') return null;
  try {
    const url = new URL(target.url); if (url.protocol !== 'file:' || url.host || url.username || url.password) return null;
    const file = fileURLToPath(url); if (basename(file) !== 'index.html' || basename(dirname(file)) !== 'app-dist') return null;
    const resources = dirname(dirname(file));
    if (platform === 'win32') return resolve(resources) === resolve(installation, 'resources') ? resources : null;
    // AppImage extract-and-run creates a fresh private TMPDIR child per launch.
    // The next attach also verifies its real browser PID's environment and exe.
    assertPrivatePath(join(root, 'tmp'), resources); return resources;
  } catch { return null; }
}

async function attach(port, platform, installation, root, profile, exceptions, origins) {
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
    return targets.find(item => pageResources(item, platform, installation, root));
  }, Boolean, 180_000, 'owned installed main renderer');
  const client = await connect(target.webSocketDebuggerUrl, event => {
    if (event.method === 'Runtime.exceptionThrown') exceptions.push('renderer-exception');
    if (event.method === 'Network.requestWillBeSent') try { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol)) origins.add(url.origin); } catch {}
  });
  await client.send('Runtime.enable'); await client.send('Network.enable');
  const evaluate = async (expression, timeout = 30_000) => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
    assert.ok(!result.exceptionDetails, 'Owned renderer operation failed.'); return result.result.value;
  };
  const browserInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).json();
  const browser = await connect(browserInfo.webSocketDebuggerUrl);
  const processes = await browser.send('SystemInfo.getProcessInfo'); const pid = processes.processInfo.find(item => item.type === 'browser')?.id;
  assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid, 'Missing actual browser PID.');
  const resources = pageResources(target, platform, installation, root);
  if (platform === 'linux') {
    const environment = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    assert.ok(environment.includes(`OPENWORK_ELECTRON_USERDATA=${profile}`), 'CDP process does not own the isolated profile.');
    assert.equal(realpathSync(`/proc/${pid}/exe`), join(dirname(resources), 'openwork'), 'CDP process is outside its original AppImage runtime.');
  } else {
    const executable = command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::Write((Get-Process -Id ${pid} -ErrorAction Stop).Path)`]);
    assert.equal(resolve(executable).toLowerCase(), resolve(installation, PRODUCT + '.exe').toLowerCase(), 'CDP process is outside its private NSIS installation.');
  }
  await until(() => evaluate('Boolean(window.__OPENWORK_ELECTRON__?.updater)'), Boolean, 30_000, 'native updater bridge');
  return { ...client, browser, pid, resources, evaluate, invoke: (name, ...args) => evaluate(`window.__OPENWORK_ELECTRON__.invokeDesktop(${JSON.stringify(name)},...${JSON.stringify(args)})`, 120_000) };
}

async function runtime(client, workspace) {
  await client.invoke('engineStart', workspace, { workspacePaths: [workspace] });
  return until(async () => {
    const info = await client.invoke('openworkServerInfo'); assert.equal(info.running, true);
    const url = new URL(info.baseUrl); assert.equal(url.protocol, 'http:'); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.ok(!url.username && !url.password); const token = info.clientToken || info.ownerToken; assert.ok(token);
    const request = async (path, options = {}) => {
      const response = await fetch(url.href.replace(/\/$/, '') + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
      assert.equal(response.status, 200, 'Owned embedded runtime request failed.'); return response.json();
    };
    assert.equal((await request('/health')).ok, true); return { request };
  }, Boolean, 120_000, 'installed embedded server');
}

function isolatedEnvironment(root, port) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:OPENWORK_|OPENCODE_|DEN_|VITE_|ZENO_|CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$|ELECTRON_|APPIMAGE|NODE_OPTIONS$|NODE_PATH$)/.test(key)) delete env[key];
  return { ...env, OPENWORK_DEV_MODE: '0', VITE_OPENWORK_CLIENT_PROFILE: 'local-gateway', OPENWORK_CLIENT_PROFILE: 'local-gateway', OPENWORK_AUTOMATION_RUNNER: 'off',
    OPENWORK_ELECTRON_USERDATA: join(root, 'profile'), OPENWORK_ELECTRON_REMOTE_DEBUG_PORT: String(port), OPENWORK_ELECTRON_DISABLE_PROTOCOL_REGISTRATION: '1', OPENWORK_ELECTRON_USE_MOCK_KEYCHAIN: '1',
    OPENWORK_DESKTOP_BOOTSTRAP_PATH: join(root, 'state/desktop-bootstrap.json'), OPENWORK_DESKTOP_WORKSPACE_STATE_PATH: join(root, 'profile/openwork-workspaces.json'),
    OPENWORK_SERVER_TOKEN_STORE_PATH: join(root, 'state/server-tokens.json'), OPENWORK_SERVER_CONFIG: join(root, 'state/server.json'), OPENWORK_RUNTIME_DB: join(root, 'state/runtime.sqlite'),
    OPENWORK_ENV_STORE: join(root, 'state/env.json'), OPENWORK_TOKEN_STORE: join(root, 'state/tokens.json'), OPENWORK_DATA_DIR: join(root, 'data'), OPENWORK_ENGINE_V2_PREVIEW: '0',
    OPENCODE_CONFIG_DIR: join(root, 'config/opencode'), OPENCODE_DB: join(root, 'data/opencode.db'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
    XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: join(root, 'tmp'), TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'), NODE_OPTIONS: '', NODE_PATH: '',
    ...(process.platform === 'linux' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : {}) };
}

function windowsPristineInstallation() {
  // NSIS remembers its old install directory in the native uninstall registry.
  // Refuse a runner that could silently uninstall somebody else's copy.
  const count = command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; $n=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^(OpenWork|泽诺 Zeno)( |$)' }).Count; [Console]::Write($n)"]);
  assert.equal(count, '0', 'A pre-existing OpenWork/Zeno installation is registered.');
}

function publishWindowsRelaunchEnvironment(environment, root) {
  const allowed = /^(?:OPENWORK_|OPENCODE_|XDG_|VITE_OPENWORK_CLIENT_PROFILE$|NODE_OPTIONS$|NODE_PATH$|TMPDIR$|TMP$|TEMP$)/;
  const values = Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.test(key)));
  for (const [key, value] of Object.entries(values)) {
    assert.ok(allowed.test(key));
    if (isAbsolute(value)) assertPrivatePath(root, value);
  }
  // ExecShellAsUser may use Explorer's token/environment rather than inheriting
  // NSIS's parent. Publish ONLY non-secret isolated paths/flags to this fresh
  // hosted login, notify Explorer, and restore the previous values on exit.
  const script = "$ErrorActionPreference='Stop'; $map=ConvertFrom-Json ([Console]::In.ReadToEnd()); $old=@{}; foreach($p in $map.PSObject.Properties){ $old[$p.Name]=[Environment]::GetEnvironmentVariable($p.Name,'User'); [Environment]::SetEnvironmentVariable($p.Name,$p.Value,'User') }; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ZenoEnvBroadcast { [DllImport(\"user32.dll\", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,uint flags,uint timeout,out UIntPtr result); }'; $r=[UIntPtr]::Zero; [void][ZenoEnvBroadcast]::SendMessageTimeout([IntPtr]65535,26,[UIntPtr]::Zero,'Environment',2,5000,[ref]$r); [Console]::Write(($old|ConvertTo-Json -Compress))";
  const update = input => JSON.parse(command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: JSON.stringify(input) }));
  const previous = update(values);
  return () => { update(previous); };
}

async function main() {
  assertPortableHostedRunner(process.env, process.platform, process.arch);
  assert.notEqual(process.getuid?.(), 0, 'Refusing native desktop execution as root.');
  const platform = process.platform; const spec = lane(platform); const runner = realpathSync(process.env.RUNNER_TEMP);
  const root = mkdtempSync(join(runner, 'zeno-portable-update-')); const evidence = join(runner, 'zeno-portable-update-evidence'); mkdirSync(evidence, { recursive: true });
  const report = { passed: false, baseline: BASELINE, target: TARGET, platform, arch: 'x64', phases: [], nativeUpdateExecuted: false,
    scope: { originalBaseline: false, originalTarget: false, realPublicFeed: false, installedUpgrade: false, automaticRelaunch: false, historicalChatPreservation: false, accountPairingTested: false, osCredentialStorageTested: false, aiRequested: false },
    isolation: 'ephemeral GitHub-hosted VM; private installation, Electron profile, workspace, XDG data and temporary runtime', publicOrigin: ORIGIN };
  const phase = (name, values = {}) => { report.phases.push({ name, at: new Date().toISOString(), ...values }); console.log(`[zeno-portable-update] ${name}`); };
  let client; let child; let oldPid; let cleanupAllowed = false; let failure = false; let restoreEnvironment;
  const exceptions = []; const origins = new Set();
  try {
    const historicalFile = assertPrivatePath(runner, resolve(process.env.ZENO_UPDATE_BASELINE_METADATA));
    assert.ok(lstatSync(historicalFile).isFile());
    const baseline = validatePortableHistorical(JSON.parse(readFileSync(historicalFile, 'utf8')), platform);
    const index = await (await publicResponse(ORIGIN + '/api/releases/latest.json')).json();
    const feed = `${ORIGIN}/updates/${platform}/x64/`;
    const selected = validatePortableTarget(index, YAML.parse(await (await publicResponse(feed + spec.manifest)).text()), platform);
    report.scope.realPublicFeed = true;
    const baselineFile = join(root, baseline.name); const targetFile = join(root, selected.installer.name);
    for (const directory of [process.env.ZENO_UPDATE_BASELINE_DIR, process.env.ZENO_UPDATE_TARGET_DIR]) assertPrivatePath(runner, resolve(directory));
    await copyVerifiedArtifact(process.env.ZENO_UPDATE_BASELINE_DIR, runner, baseline, baselineFile);
    await copyVerifiedArtifact(process.env.ZENO_UPDATE_TARGET_DIR, runner, selected.installer, targetFile);
    report.scope.originalBaseline = true; report.scope.originalTarget = true;
    phase('original-installers-verified', { baselineSha256: baseline.sha256, targetSha256: selected.installer.sha256, baselineBytes: baseline.size, targetBytes: selected.installer.size });
    const reference = referenceResources(targetFile, join(root, 'reference-only'), platform);
    const targetCode = verifyResources(reference, TARGET, feed, platform); rmSync(join(root, 'reference-only'), { recursive: true, force: true });
    for (const name of ['installation', 'profile', 'workspace', 'state', 'data', 'config', 'cache', 'logs', 'tmp']) mkdirSync(join(root, name));
    const installation = join(root, 'installation'); const profile = join(root, 'profile'); const workspace = join(root, 'workspace'); const port = await freePort();
    const environment = isolatedEnvironment(root, port);
    writeFileSync(join(profile, 'openwork-workspaces.json'), JSON.stringify({ selectedId: '', activeId: null, watchedId: null, workspaces: [] }));
    const marker = 'zeno-update-fixture-' + randomBytes(16).toString('hex'); writeFileSync(join(workspace, 'update-smoke-marker.txt'), marker);
    let executable;
    if (platform === 'win32') {
      windowsPristineInstallation();
      restoreEnvironment = publishWindowsRelaunchEnvironment(environment, root);
      command(baselineFile, ['/S', `/D=${installation}`], { env: environment });
      executable = join(installation, PRODUCT + '.exe'); assert.ok(existsSync(executable), 'NSIS did not install into its private directory.');
      const installed = verifyResources(join(installation, 'resources'), BASELINE, feed, platform);
      assert.equal(installed.updaterCacheDirName, targetCode.updaterCacheDirName);
      phase('original-nsis-installed', { privateDirectory: true, noResigning: true });
    } else {
      executable = join(installation, 'Zeno.AppImage');
      // A versionless filename is a supported AppImageUpdater installation;
      // native replacement retains this exact user-chosen executable path.
      await copyVerifiedArtifact(process.env.ZENO_UPDATE_BASELINE_DIR, runner, baseline, executable); chmodSync(executable, 0o755);
      phase('original-appimage-installed', { privateDirectory: true, unchangedExecutableBytes: hash(readFileSync(executable)) === baseline.sha256 });
    }
    const output = openSync(join(root, 'logs/electron.log'), 'a', 0o600); const errors = openSync(join(root, 'logs/electron-error.log'), 'a', 0o600);
    child = spawn(executable, [], { env: environment, cwd: workspace, stdio: ['ignore', output, errors], detached: true });
    child.on('error', () => {}); closeSync(output); closeSync(errors);
    client = await attach(port, platform, installation, root, profile, exceptions, origins); oldPid = client.pid;
    const baselineCode = verifyResources(client.resources, BASELINE, feed, platform); assert.equal(baselineCode.updaterCacheDirName, targetCode.updaterCacheDirName);
    assert.equal((await client.invoke('appBuildInfo')).version, BASELINE);
    const channel = await client.evaluate('window.__OPENWORK_ELECTRON__.updater.getChannel()');
    assert.equal(channel.supported, true); assert.equal(channel.product, 'zeno'); assert.equal(channel.feedUrl, feed); assert.equal(channel.currentVersion, BASELINE);
    const created = await client.invoke('workspaceCreate', { folderPath: workspace, name: 'Zeno update fixture' });
    const workspaceRecord = created.workspaces.find(item => item.path === workspace); assert.ok(workspaceRecord?.id);
    const before = await runtime(client, workspace); const mount = `/workspace/${encodeURIComponent(workspaceRecord.id)}/opencode`;
    const session = await before.request(mount + '/session', { method: 'POST', body: JSON.stringify({ title: marker }) }); assert.ok(session.id);
    await before.request(`${mount}/session/${encodeURIComponent(session.id)}/message`, { method: 'POST', body: JSON.stringify({ noReply: true, parts: [{ type: 'text', text: marker }] }) });
    const hasMarker = messages => messages.some(message => message.parts?.some(part => part.type === 'text' && part.text === marker));
    assert.ok(hasMarker(await before.request(`${mount}/session/${encodeURIComponent(session.id)}/message`)));
    await client.evaluate(`localStorage.setItem('zeno.update.smoke',${JSON.stringify(marker)})`);
    phase('baseline-native-history-created', { installedVersion: BASELINE, workspace: true, storedSession: true, storedMessage: true, noModelCall: true });
    const checked = await client.evaluate("window.__OPENWORK_ELECTRON__.updater.check('stable')", 120_000);
    assert.equal(checked.available, true); assert.equal(checked.latestVersion, TARGET); assert.equal(checked.feedUrl, feed); assert.equal(checked.totalBytes, selected.installer.size);
    try { report.downloadProgress = { subscriptionSupported: await client.evaluate(`(()=>{window.__zenoSmokeDownloadProgress={};const updater=window.__OPENWORK_ELECTRON__.updater;if(typeof updater.onDownloadProgress!=='function')return false;const numeric=${numericDownloadProgress.toString()};updater.onDownloadProgress(value=>window.__zenoSmokeDownloadProgress={...window.__zenoSmokeDownloadProgress,...numeric(value)});return true})()`, 2000) === true }; } catch { report.downloadProgress = { subscriptionSupported: false }; }
    phase('native-public-download-started', { bytes: selected.installer.size, installer: spec.suffix });
    const downloaded = await client.evaluate('window.__OPENWORK_ELECTRON__.updater.download()', 1_800_000);
    assert.equal(downloaded.ok, true, 'Real public native download failed.'); assert.equal(downloaded.version, TARGET);
    phase('native-public-download-completed', { version: TARGET });
    await until(() => before.request('/experimental/engine-v2-preview/activity'), value => value.v1?.verdict === 'idle' && value.v1.busySessions === 0 && value.v1.waitingRequests === 0 && (value.v2 === null || value.v2?.verdict === 'idle'), 30_000, 'idle historical engine');
    await client.evaluate('(()=>{window.__zenoInstallResult=null;window.__OPENWORK_ELECTRON__.updater.installAndRestart().then(value=>{window.__zenoInstallResult=value});return true})()');
    await until(() => child.exitCode ?? child.signalCode, value => value !== null, 120_000, 'baseline process exits naturally');
    client.socket.close(); client.browser.socket.close(); client = null;
    // No spawn, installer command, Browser.close or kill is permitted between
    // admission above and these actual target/restart/preservation assertions.
    client = await attach(port, platform, installation, root, profile, exceptions, origins);
    assert.notEqual(client.pid, oldPid, 'The target was not automatically relaunched in a new native process.');
    const afterCode = verifyResources(client.resources, TARGET, feed, platform); assert.equal(afterCode.archiveSha256, targetCode.archiveSha256, 'Installed ASAR differs from the frozen published target.');
    if (platform === 'linux') assert.equal(hash(readFileSync(executable)), selected.installer.sha256, 'Native AppImage replacement differs from the original published installer.');
    assert.equal((await client.invoke('appBuildInfo')).version, TARGET);
    report.nativeUpdateExecuted = true; Object.assign(report.scope, { installedUpgrade: true, automaticRelaunch: true });
    phase('original-target-installed-and-automatically-relaunched', { installedVersion: TARGET, publishedAsar: true, actualProcessChanged: true });
    assert.equal(await client.evaluate("localStorage.getItem('zeno.update.smoke')"), marker, 'Chromium state was lost.');
    assert.equal(readFileSync(join(workspace, 'update-smoke-marker.txt'), 'utf8'), marker, 'Workspace contents were lost.');
    const retained = await client.invoke('workspaceBootstrap'); assert.ok(retained.workspaces.some(item => item.id === workspaceRecord.id && item.path === workspace), 'Workspace identity was lost.');
    const after = await runtime(client, workspace);
    assert.equal((await after.request(`${mount}/session/${encodeURIComponent(session.id)}`)).title, marker);
    assert.ok(hasMarker(await after.request(`${mount}/session/${encodeURIComponent(session.id)}/message`)), 'Historical native conversation was lost.');
    assert.equal(exceptions.length, 0, 'An installed renderer exception occurred.');
    assert.ok([...origins].every(origin => !/openworklabs\.com|github\.com/.test(origin)), 'Unexpected upstream renderer connection.');
    const image = await client.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(evidence, 'updated-app.png'), Buffer.from(image.data, 'base64'));
    report.scope.historicalChatPreservation = true;
    phase('real-native-upgrade-and-preservation-verified', { installedVersion: TARGET, publishedAsar: true, actualProcessChanged: true, chromiumProfile: true, workspaceIdentity: true, workspaceFile: true, historicalSession: true, historicalMessage: true, embeddedServer: true });
    cleanupAllowed = true; report.passed = true;
  } catch {
    failure = true; report.failure = { classification: 'native-update-validation-failed', lastPhase: report.phases.at(-1)?.name ?? 'initialization' };
    try { if (client) report.downloadProgress = { ...report.downloadProgress, ...numericDownloadProgress(await client.evaluate('window.__zenoSmokeDownloadProgress', 2000)) }; } catch {}
    report.failureDiagnostics = privateUpdateFailureDiagnostics(root);
    // Never publish assertion values, private paths, runtime tokens or raw logs.
  } finally {
    if (client) { try { await client.browser.send('Browser.close', {}, 5000).catch(() => {}); } catch {} client.socket.close(); client.browser.socket.close(); }
    try { restoreEnvironment?.(); } catch { report.environmentCleanup = 'private hosted environment restoration failed; VM disposal required'; report.passed = false; failure = true; }
    if (cleanupAllowed) {
      // All important assertions precede cleanup. Failure files and processes
      // stay private until this disposable hosted VM is destroyed.
      await pause(1500);
      try { rmSync(root, { recursive: true, force: true }); report.cleanup = 'verified private installation/profile removed'; }
      catch { report.cleanup = 'private files retained for hosted runner disposal'; }
    } else report.cleanup = 'failed attempt private files retained for hosted runner disposal';
    report.rendererNetworkScope = { observedOrigins: origins.size, upstreamObserved: [...origins].some(origin => /openworklabs\.com|github\.com/.test(origin)), monitoring: 'renderer CDP only; not a system network audit' };
    writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(`[zeno-portable-update] ${report.passed ? 'passed' : 'failed'}; sanitized report written.`);
    if (failure) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'No native execution or feed overrides are accepted.');
  await main();
}
