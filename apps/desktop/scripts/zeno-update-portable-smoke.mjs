import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, basename, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';
import YAML from 'yaml';
import { runtime, until } from './zeno-update-runtime-fixture.mjs';
export { runtime, until, portableHttpEndpoint, portableServerWorkspace, validWorkspaceSessionList } from './zeno-update-runtime-fixture.mjs';
import { copyVerifiedArtifact, numericDownloadProgress, privateUpdateFailureDiagnostics } from './zeno-update-smoke.mjs';
import { compareStableVersions } from '../electron/recovery.mjs';
import { verifyPackagedNavigation, workspaceSessionIdentitySnapshot, assertWorkspaceSessionsUnchanged } from './zeno-packaged-navigation-probe.mjs';
import { windowsProfileMode, nativeWindowsPackageIdentity, windowsNativePlan, assertNativeOwnedPath,
  assertNativePristineLeaves, nativeDefaultsEnvironment, windowsNativeRootsScript, windowsNativePristineScript,
  windowsNativeInstallationScript, decodeNativeWindowsWire, assertNativeEffectiveProfile, sameWindowsPath, assertNativeEnvironmentRoots } from './zeno-windows-native-defaults.mjs';

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

const ACTIVE_CHECKS = new Set(['initialization', 'release-metadata', 'artifact-copy', 'target-reference', 'private-directories',
  'windows-pristine-installation', 'windows-relaunch-environment', 'windows-native-reference', 'windows-native-pristine', 'windows-native-ports',
  'windows-native-installation', 'baseline-native-v1-setting', 'target-native-v1-setting', 'baseline-nsis-install', 'baseline-resource-verification',
  'baseline-appimage-install', 'baseline-app-launch', 'attach-page-list', 'attach-page-cdp', 'attach-domains',
  'attach-browser-version', 'attach-browser-cdp', 'attach-browser-pid', 'attach-profile-identity', 'attach-private-executable', 'attach-profile-environment', 'attach-windows-executable', 'attach-effective-profile',
  'attach-updater-bridge', 'baseline-build-info', 'baseline-updater-channel', 'baseline-workspace-create',
  'baseline-workspace-identity', 'runtime-engine-start', 'runtime-server-info', 'runtime-server-health',
  'runtime-workspace-registry', 'runtime-workspace-register', 'runtime-workspace-registry-identity', 'runtime-workspace-ready',
  'baseline-session-create', 'baseline-session-identity', 'baseline-message-create', 'baseline-message-read', 'baseline-profile-marker',
  'update-check', 'update-download', 'update-idle', 'update-install', 'update-process-exit', 'target-code-verification',
  'target-build-info', 'target-profile-marker', 'target-workspace-file', 'target-workspace-identity',
  'target-session-read', 'target-message-read', 'target-renderer', 'target-screenshot', 'target-navigation']);
const ERROR_KINDS = new Set(['Error', 'AssertionError', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError']);
const ERROR_CODES = new Set(['ERR_ASSERTION', 'ENOENT', 'EACCES', 'EPERM', 'EINVAL', 'ENOTDIR', 'EISDIR', 'ETIMEDOUT',
  'ECONNREFUSED', 'ECONNRESET', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ABORT_ERR',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']);
const HTTP_ENDPOINTS = new Set(['server-health', 'workspace-registry-read', 'workspace-registry-create', 'workspace-session-status', 'workspace-session-create', 'workspace-session-list',
  'workspace-session-read', 'workspace-message-read', 'workspace-message-write', 'engine-activity', 'unknown']);

export function portableDownloadRetries(platform, value = '0') {
  assert.ok(['win32', 'linux'].includes(platform), 'Unsupported download retry platform.');
  assert.ok(['0', '1', '2'].includes(value), 'Download retries must be an explicit 0, 1 or 2.');
  assert.ok(platform === 'win32' || value === '0', 'Download retries are Windows-only.');
  return Number(value);
}

const DOWNLOAD_LOGS = ['electron.log', 'electron-error.log'];
const DOWNLOAD_LOG_LIMIT = 256 * 1024;
function ownedDownloadLog(root, name, inspect) {
  let descriptor;
  try {
    const path = assertPrivatePath(root, join(root, 'logs', name));
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor, { bigint: true });
    assert.ok(info.isFile() && info.nlink === 1n && info.ino > 0n && info.size <= BigInt(Number.MAX_SAFE_INTEGER));
    const result = inspect(descriptor, info);
    const after = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    assert.ok(!current.isSymbolicLink() && current.dev === info.dev && current.ino === info.ino
      && current.birthtimeNs === info.birthtimeNs && after.size === info.size && current.size === info.size);
    return result;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function exactLogBytes(descriptor, start, length) {
  const bytes = Buffer.alloc(length); let read = 0;
  while (read < length) {
    const count = readSync(descriptor, bytes, read, length - read, start + read);
    assert.ok(count > 0, 'Incomplete owned download log window.'); read += count;
  }
  return bytes;
}

export function snapshotDownloadLogs(root) {
  try {
    return DOWNLOAD_LOGS.map(name => ownedDownloadLog(root, name, (descriptor, info) => {
      const offset = Number(info.size); const length = Math.min(offset, 64);
      const anchor = exactLogBytes(descriptor, offset - length, length);
      assert.ok(!length || anchor.at(-1) === 10, 'Download log offset is not a complete line.');
      return { name, dev: info.dev, ino: info.ino, birthtimeNs: info.birthtimeNs, offset, anchor };
    }));
  } catch { return null; } // Unknown ownership/boundaries can never authorize a retry.
}

export function resetOnlyDownloadLogText(texts) {
  if (!Array.isArray(texts) || texts.length !== 2 || texts.some(text => typeof text !== 'string')) return 'log-window-invalid';
  let reset = false;
  for (const text of texts) {
    if (text && !text.endsWith('\n')) return 'log-window-invalid';
    let resetBlock = false;
    for (const line of text.split(/\r?\n/)) {
      if (!line) { resetBlock = false; continue; }
      // Pinned electron-updater's default console logger emits Error: followed
      // by error.stack. A code mentioned in a URL/info line is not an error.
      if (/^Error: (?:Error: )?net::ERR_CONNECTION_RESET$/.test(line)) { reset = true; resetBlock = true; continue; }
      if (/\b(?:ERR_[A-Z0-9_]+|E[A-Z]{2,}[A-Z0-9_]*)\b/.test(line)) return 'non-reset-error';
      if (/^\s+at\s/.test(line)) { if (!resetBlock) return 'log-window-invalid'; continue; }
      resetBlock = false;
      if (/\b(?:[A-Za-z_$][\w$]*(?:Error|Exception|Failure)|Uncaught|Unhandled\w*)\b/.test(line)) return 'non-reset-error';
      if (/\b(?:error|warn(?:ing)?|exception|fail(?:ed|ure)?|cancel(?:led|ed)?|abort(?:ed)?|checksum|signature|sha512|hash|digest|integrity|mismatch|HTTP(?:Error)?|certificate|TLS|cannot|permission|denied|fatal|panic)\b/i.test(line)) return 'non-reset-error';
    }
  }
  return reset ? 'connection-reset' : 'no-reset-signal';
}

export function inspectDownloadLogWindow(root, snapshots) {
  try {
    assert.ok(Array.isArray(snapshots) && snapshots.length === 2);
    const texts = DOWNLOAD_LOGS.map((name, index) => ownedDownloadLog(root, name, (descriptor, info) => {
      const before = snapshots[index];
      assert.ok(before.name === name && before.dev === info.dev && before.ino === info.ino && before.birthtimeNs === info.birthtimeNs);
      const length = Number(info.size) - before.offset;
      assert.ok(Number.isSafeInteger(length) && length >= 0 && length <= DOWNLOAD_LOG_LIMIT);
      assert.ok(exactLogBytes(descriptor, before.offset - before.anchor.length, before.anchor.length).equals(before.anchor));
      return new TextDecoder('utf-8', { fatal: true }).decode(exactLogBytes(descriptor, before.offset, length));
    }));
    return resetOnlyDownloadLogText(texts);
  } catch { return 'log-window-invalid'; }
}

export async function runPortableDownloadAttempts({ platform, additionalRetries, records, begin, download, progress, inspectFailure, wait = pause }) {
  assert.ok(Number.isInteger(additionalRetries) && additionalRetries >= 0 && additionalRetries <= 2);
  const retries = portableDownloadRetries(platform, String(additionalRetries));
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const snapshot = await begin(attempt);
    const started = Date.now();
    const record = { attempt, startedAt: new Date(started).toISOString(), finishedAt: null, elapsedMs: 0,
      outcome: 'failed', reason: 'bridge-threw', signal: 'not-inspected', progress: {}, retryRequested: false };
    records.push(record);
    let result;
    try { result = await download(); }
    finally {
      record.finishedAt = new Date().toISOString(); record.elapsedMs = Math.max(0, Date.now() - started);
      try { record.progress = numericDownloadProgress(await progress()); } catch { /* Unknown progress is not evidence. */ }
    }
    if (result?.ok === true) { record.outcome = 'downloaded'; record.reason = 'download-completed'; return result; }
    record.reason = result?.ok === false && result.reason === 'download-failed' ? 'download-failed' : 'updater-rejected';
    if (record.reason === 'download-failed') {
      await wait(500); // Bounded log flush, not a network timeout override.
      const signal = await inspectFailure(snapshot);
      record.signal = ['connection-reset', 'non-reset-error', 'no-reset-signal', 'log-window-invalid'].includes(signal) ? signal : 'log-window-invalid';
    }
    if (platform !== 'win32' || attempt > retries || record.signal !== 'connection-reset') return result;
    record.retryRequested = true;
  }
  throw new Error('Download attempt bound exceeded.');
}

export async function effectivePortableProfileMatches(invoke, profile) {
  // This read-only IPC exists in the original 1.0.0 main process and returns
  // app.getPath('userData') directly. It does not derive the path from env,
  // change settings, open a terminal, or execute a reset/cleanup operation.
  const value = await invoke('getOpenworkUiMcpEnvironment');
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.OPENWORK_UI_CONTROL_DISCOVERY === join(profile, 'openwork-ui-control.json');
}

export function finishPortableRun(passed, exit) {
  assert.equal(typeof passed, 'boolean', 'Missing completed native verification verdict.');
  if (!passed) exit(1);
}

export function safePortableFailureState(value) {
  const booleans = ['collected', 'diskReadSucceeded', 'archiveHashReadSucceeded', 'archiveMetadataReadSucceeded', 'targetVersionOnDisk', 'publishedAsarOnDisk', 'publishedAppImageOnDisk',
    'oldPidKnown', 'oldBrowserPidAbsent', 'spawnedBaselineProcessExited', 'processScanCompleted',
    'mainHasExpectedDebugArgument', 'mainHasExpectedProfileArgument', 'mainHasExpectedDebugEnvironment',
    'mainHasExpectedProfileEnvironment', 'mainHasExpectedAppImageEnvironment', 'userDebugEnvironmentMatches', 'userProfileEnvironmentMatches',
    'observedBrowserPidKnown', 'observedBrowserPrivateExecutableMatches', 'observedBrowserDetailsReadable',
    'observedBrowserDebugEnvironmentMatches', 'observedBrowserProfileEnvironmentMatches', 'observedBrowserAppImageEnvironmentMatches',
    'observedBrowserDebugArgumentMatches', 'observedBrowserProfileArgumentMatches', 'observedBrowserEffectiveProfileMatches',
    'ownedMainListenerProbeSucceeded', 'ownedMainExpectedPortListening'];
  return Object.fromEntries([...booleans.filter(key => typeof value?.[key] === 'boolean').map(key => [key, value[key]]),
    ...(Number.isSafeInteger(value?.samePrivateMainProcessCount) && value.samePrivateMainProcessCount >= 0 && value.samePrivateMainProcessCount <= 1024
      ? [['samePrivateMainProcessCount', value.samePrivateMainProcessCount]] : [])]);
}

export function hasExactProcessArgument(argv, name, value) {
  return argv.some((argument, index) => argument === name + '=' + value || argument === name && argv[index + 1] === value);
}

export function readPortableArchiveMetadata(archive) {
  // NSIS replaces this exact path in place. @electron/asar otherwise reuses
  // the baseline header/offsets when reading the new installed file's bytes.
  asar.uncache(archive);
  return JSON.parse(asar.extractFile(archive, 'package.json').toString());
}

export function inspectPortableArchive(archive, targetVersion, targetSha256) {
  const facts = { diskReadSucceeded: false, archiveHashReadSucceeded: false, archiveMetadataReadSucceeded: false };
  try {
    facts.publishedAsarOnDisk = hash(readFileSync(archive)) === targetSha256;
    facts.archiveHashReadSucceeded = true;
  } catch { /* A metadata failure must not erase an independent byte hash. */ }
  try {
    const metadata = readPortableArchiveMetadata(archive);
    assert.ok(metadata && typeof metadata.version === 'string');
    facts.targetVersionOnDisk = metadata.version === targetVersion;
    facts.archiveMetadataReadSucceeded = true;
  } catch { /* Unknown metadata is distinct from a known version mismatch. */ }
  facts.diskReadSucceeded = facts.archiveHashReadSucceeded && facts.archiveMetadataReadSucceeded;
  return facts;
}

export function windowsOwnedListenerProbeScript() {
  return `function Read-OwnedListenerFact($owned,$port){
$fact=[ordered]@{ownedMainListenerProbeSucceeded=$false}
try {
  if($owned.ProcessId -le 1 -or $port -lt 1 -or $port -gt 65535){return $fact}
  $connections=@(Get-NetTCPConnection -OwningProcess ([uint32]$owned.ProcessId) -ErrorAction Stop)
  $current=@(Get-CimInstance Win32_Process -Filter ('ProcessId = '+[string]$owned.ProcessId) -ErrorAction Stop)
  if($current.Count -ne 1 -or $current[0].CreationDate -ne $owned.CreationDate -or -not [string]::Equals($current[0].ExecutablePath,$owned.ExecutablePath,[StringComparison]::OrdinalIgnoreCase)){return $fact}
  $listening=@($connections | Where-Object { $_.OwningProcess -eq $owned.ProcessId -and $_.LocalPort -eq $port -and [string]$_.State -ceq 'Listen' })
  $fact['ownedMainListenerProbeSucceeded']=$true
  $fact['ownedMainExpectedPortListening']=$listening.Count -gt 0
} catch { }
return $fact
}`;
}

export function windowsFailureProbeScript() {
  return `$ErrorActionPreference='Stop'
${windowsOwnedListenerProbeScript()}
$v=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())))
$escaped=$v.executable.Replace('\\','\\\\').Replace("'","\\'")
$items=@(Get-CimInstance Win32_Process -Filter ("ExecutablePath = '"+$escaped+"'") -ErrorAction Stop | Where-Object { [string]::Equals($_.ExecutablePath,$v.executable,[StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -notmatch '(?:^|\\s)--type(?:=|\\s)' })
$debug=$false; $profile=$false
foreach($item in $items){$line=$item.CommandLine.Replace('"','');$debug=$debug -or [regex]::IsMatch($line,'(?:^|\\s)--remote-debugging-port='+[regex]::Escape([string]$v.port)+'(?:\\s|$)');$profile=$profile -or [regex]::IsMatch($line,'(?:^|\\s)--user-data-dir='+[regex]::Escape($v.profile)+'(?:\\s|$)')}
$known=$v.oldPid -gt 1; $absent=$false
if($known){$absent=@(Get-CimInstance Win32_Process -Filter ('ProcessId = '+[string]$v.oldPid) -ErrorAction Stop).Count -eq 0}
$facts=[ordered]@{processScanCompleted=$true;samePrivateMainProcessCount=$items.Count;oldPidKnown=[bool]$known;oldBrowserPidAbsent=[bool]$absent;mainHasExpectedDebugArgument=[bool]$debug;mainHasExpectedProfileArgument=[bool]$profile;userDebugEnvironmentMatches=([Environment]::GetEnvironmentVariable('OPENWORK_ELECTRON_REMOTE_DEBUG_PORT','User') -ceq [string]$v.port);userProfileEnvironmentMatches=([Environment]::GetEnvironmentVariable('OPENWORK_ELECTRON_USERDATA','User') -ceq $v.profile)}
if($items.Count -eq 1){$listener=Read-OwnedListenerFact $items[0] ([int]$v.port);foreach($key in $listener.Keys){$facts[$key]=$listener[$key]}}
$facts|ConvertTo-Json -Compress`;
}

function collectPortableFailureState(context, oldPid, child) {
  // This is only called after the guarded hosted verifier has failed, before
  // its finally block restores the User environment or disposes private data.
  if (!context) return { collected: false };
  assertPortableHostedRunner(process.env, process.platform, process.arch);
  const { platform, root, installation, profile, port, executable, targetAsarSha256, targetInstallerSha256 } = context;
  for (const value of [installation, profile, executable]) {
    if (context.nativeDefaults) assertNativeOwnedPath(context.nativeDefaults, value); else assertPrivatePath(root, value);
  }
  const facts = { collected: true, diskReadSucceeded: false, processScanCompleted: false,
    oldPidKnown: Number.isSafeInteger(oldPid) && oldPid > 1,
    observedBrowserPidKnown: Number.isSafeInteger(context.observedBrowserPid) && context.observedBrowserPid > 1,
    spawnedBaselineProcessExited: Boolean(child && (child.exitCode !== null || child.signalCode !== null)) };
  if (typeof context.observedBrowserEffectiveProfileMatches === 'boolean') facts.observedBrowserEffectiveProfileMatches = context.observedBrowserEffectiveProfileMatches;
  try {
    if (platform === 'win32') {
      const archive = join(installation, 'resources/app.asar');
      if (context.nativeDefaults) assertNativeOwnedPath(context.nativeDefaults, archive); else assertPrivatePath(root, archive);
      Object.assign(facts, inspectPortableArchive(archive, TARGET, targetAsarSha256));
    } else {
      facts.publishedAppImageOnDisk = hash(readFileSync(executable)) === targetInstallerSha256;
      facts.diskReadSucceeded = true;
    }
  } catch { /* Unknown disk state is separate from a known target mismatch. */ }
  try {
    if (platform === 'win32') {
      const input = Buffer.from(JSON.stringify({ executable, profile, port, oldPid: facts.oldPidKnown ? oldPid : 0 }), 'utf8').toString('base64');
      Object.assign(facts, safePortableFailureState(JSON.parse(command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsFailureProbeScript()], { input, timeout: 10_000 }))));
    } else {
      facts.oldBrowserPidAbsent = facts.oldPidKnown && !existsSync('/proc/' + oldPid);
      // This PID came from the actual connected CDP browser, not from the
      // broader private-executable candidate scan. Never serialize it.
      if (facts.observedBrowserPidKnown) {
        facts.observedBrowserDetailsReadable = false;
        try {
          const expected = join(dirname(context.observedBrowserResources), 'openwork');
          assertPrivatePath(join(root, 'tmp'), expected);
          facts.observedBrowserPrivateExecutableMatches = realpathSync('/proc/' + context.observedBrowserPid + '/exe') === expected;
          if (facts.observedBrowserPrivateExecutableMatches) {
            const argv = readFileSync('/proc/' + context.observedBrowserPid + '/cmdline', 'utf8').split('\0');
            const env = readFileSync('/proc/' + context.observedBrowserPid + '/environ', 'utf8').split('\0');
            facts.observedBrowserDebugEnvironmentMatches = env.includes('OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=' + port);
            facts.observedBrowserProfileEnvironmentMatches = env.includes('OPENWORK_ELECTRON_USERDATA=' + profile);
            facts.observedBrowserAppImageEnvironmentMatches = env.includes('APPIMAGE=' + executable);
            facts.observedBrowserDebugArgumentMatches = hasExactProcessArgument(argv, '--remote-debugging-port', String(port));
            facts.observedBrowserProfileArgumentMatches = hasExactProcessArgument(argv, '--user-data-dir', profile);
            facts.observedBrowserDetailsReadable = true;
          }
        } catch { /* Missing or mismatched browser details remain unknown. */ }
      }
      facts.samePrivateMainProcessCount = 0;
      facts.processScanCompleted = true;
      for (const pid of readdirSync('/proc').filter(name => /^[1-9]\d*$/.test(name))) {
        let privateProcess = false;
        try {
          const exe = realpathSync('/proc/' + pid + '/exe');
          if (basename(exe) !== 'openwork') continue;
          assertPrivatePath(join(root, 'tmp'), exe);
          privateProcess = true;
          const argv = readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0');
          if (argv.some(argument => /^--type(?:=|$)/.test(argument))) continue;
          // Only the exact private extracted executable may have its flags read.
          const environment = readFileSync('/proc/' + pid + '/environ', 'utf8').split('\0');
          facts.samePrivateMainProcessCount++;
          for (const [key, match] of Object.entries({
            mainHasExpectedDebugArgument: hasExactProcessArgument(argv, '--remote-debugging-port', String(port)),
            mainHasExpectedProfileArgument: hasExactProcessArgument(argv, '--user-data-dir', profile),
            mainHasExpectedDebugEnvironment: environment.includes('OPENWORK_ELECTRON_REMOTE_DEBUG_PORT=' + port),
            mainHasExpectedProfileEnvironment: environment.includes('OPENWORK_ELECTRON_USERDATA=' + profile),
            mainHasExpectedAppImageEnvironment: environment.includes('APPIMAGE=' + executable),
          })) facts[key] = facts[key] === true || match;
        } catch { if (privateProcess) facts.processScanCompleted = false; /* No details from other processes are read. */ }
      }
    }
  } catch { /* Do not replace the primary failure with a diagnostic failure. */ }
  return safePortableFailureState(facts);
}

export function portableErrorMetadata(error) {
  const value = error && typeof error === 'object' ? error : {};
  const cause = Object.getOwnPropertyDescriptor(value, 'cause')?.value;
  const causeCode = cause && typeof cause === 'object' ? Object.getOwnPropertyDescriptor(cause, 'code')?.value : undefined;
  return { errorKind: ERROR_KINDS.has(value.name) ? value.name : 'UnknownError',
    ...(ERROR_CODES.has(value.code) ? { code: value.code } : {}),
    ...(ERROR_CODES.has(causeCode) ? { causeCode } : {}) };
}

export function portableDiagnosticState() {
  let activeCheck = 'initialization'; let lastReadError; let lastHttp; let lastPageList;
  return {
    enter(check) { assert.ok(ACTIVE_CHECKS.has(check), 'Unknown native diagnostic checkpoint.'); activeCheck = check; lastReadError = undefined; lastPageList = undefined; },
    readError(error) { lastReadError = portableErrorMetadata(error); },
    cdpPageList(status, shape = 'pending') {
      assert.ok(['pending', 'unparsed', 'unexpected-http-status', 'invalid-json', 'non-array', 'array'].includes(shape));
      assert.ok(status === undefined && shape === 'pending' || Number.isSafeInteger(status) && status >= 100 && status <= 599);
      lastPageList = { ...(status === undefined ? {} : { status }), shape };
      if (shape === 'array') lastReadError = undefined; // A successful later read supersedes an earlier connection failure.
    },
    http(endpoint, status) {
      assert.ok(HTTP_ENDPOINTS.has(endpoint) && (status === undefined || Number.isSafeInteger(status) && status >= 100 && status <= 599), 'Invalid native HTTP diagnostic.');
      lastHttp = { endpoint, ...(status === undefined ? {} : { status }) };
    },
    snapshot(error) { return { activeCheck, ...portableErrorMetadata(error), ...(lastReadError ? { lastReadError } : {}), ...(lastHttp ? { lastHttp } : {}), ...(lastPageList ? { lastPageList } : {}) }; },
  };
}

export function windowsProcessPathCommand(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1, 'Invalid owned browser PID.');
  // The transport is ASCII Base64. Classic PowerShell's console code page
  // therefore cannot replace the Chinese executable name before Node decodes it.
  return `$ErrorActionPreference='Stop'; $p=(Get-Process -Id ${pid} -ErrorAction Stop).Path; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p)))`;
}

export function decodeWindowsProcessPath(value) {
  try {
    assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 262144);
    assert.ok(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));
    const bytes = Buffer.from(value, 'base64'); assert.ok(bytes.toString('base64') === value);
    const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert.ok(win32.isAbsolute(path) && !/[\0\r\n]/.test(path));
    return path;
  } catch { throw new Error('Invalid encoded owned Windows executable path.'); }
}

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

function referenceResources(installer, destination, platform, nativeDefaults = false) {
  mkdirSync(destination);
  if (platform === 'linux') {
    chmodSync(installer, 0o755);
    command(installer, ['--appimage-extract', 'resources/*'], { cwd: destination });
    return { resources: join(destination, 'squashfs-root', 'resources') };
  }
  const zip = sevenZip();
  // Extract only the embedded app payload, then its resources. Neither the
  // installer nor target executable is run for this reference-code check.
  const payload = nsisPayloadPath(command(zip, ['l', '-slt', installer]));
  command(zip, ['e', '-y', '-bso0', '-bsp0', `-o${destination}`, installer, payload]);
  const payloads = readdirSync(destination).filter(name => /^app-64\.(7z|zip)$/.test(name));
  assert.equal(payloads.length, 1, 'Original NSIS payload is missing or ambiguous.');
  let executableNames;
  if (nativeDefaults) executableNames = [...command(zip, ['l', '-slt', '-sccUTF-8', join(destination, payloads[0])]).matchAll(/^Path = (.+)\r?$/gm)]
    .map(match => match[1].replace(/\r$/, '')).filter(name => /^[^\\/]+\.exe$/i.test(name)).sort();
  command(zip, ['x', '-y', '-bso0', '-bsp0', `-o${join(destination, 'app')}`, join(destination, payloads[0]), 'resources\\*']);
  return { resources: join(destination, 'app', 'resources'), executableNames };
}

function verifyResources(resources, version, feed, platform, executableNames) {
  const archive = join(resources, 'app.asar');
  const metadata = readPortableArchiveMetadata(archive);
  assert.equal(metadata.version, version); assert.equal(metadata.openworkBrand, 'zeno'); assert.equal(metadata.openworkDistribution, 'public');
  assert.equal(metadata.zenoReleaseUpdatesEnabled, true); assert.equal(metadata.zenoReleaseSigning, lane(platform).signing);
  const config = YAML.parse(readFileSync(join(resources, 'app-update.yml'), 'utf8'));
  assert.equal(config.provider, 'generic'); assert.equal(config.url, feed);
  assert.match(config.updaterCacheDirName ?? '', /^@?[\w][\w.-]{0,255}$/);
  const nativeIdentity = executableNames === undefined ? undefined : nativeWindowsPackageIdentity(metadata, config.updaterCacheDirName,
    asar.extractFile(archive, 'electron/desktop-distribution.mjs').toString(), executableNames);
  return { archiveSha256: hash(readFileSync(archive)), updaterCacheDirName: config.updaterCacheDirName, ...(nativeIdentity ? { nativeIdentity } : {}) };
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

async function assertNativeCdpPortsFree() {
  // The unchanged production app chooses its first free native candidate. Do
  // not inject a port, hold one open or accept another port after a failure.
  for (const port of [9223, 9224, 9225, 9226, 9227]) {
    const server = createServer();
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
    await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  }
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
    // The next attach verifies its real browser PID's exe and the effective
    // Electron profile through the original app's read-only IPC.
    assertPrivatePath(join(root, 'tmp'), resources); return resources;
  } catch { return null; }
}

export async function readPortablePageList(response, diagnostics) {
  diagnostics?.cdpPageList(response.status, response.status === 200 ? 'unparsed' : 'unexpected-http-status');
  assert.equal(response.status, 200, 'Owned CDP page-list HTTP request failed.');
  let targets;
  try { targets = await response.json(); }
  catch (error) { diagnostics?.cdpPageList(response.status, 'invalid-json'); throw error; }
  diagnostics?.cdpPageList(response.status, Array.isArray(targets) ? 'array' : 'non-array');
  assert.ok(Array.isArray(targets), 'Owned CDP page-list response must be an array.');
  return targets;
}

async function attach(port, platform, installation, root, profile, exceptions, origins, diagnostics, failureContext) {
  if (failureContext) { delete failureContext.observedBrowserPid; delete failureContext.observedBrowserResources; delete failureContext.observedBrowserEffectiveProfileMatches; }
  diagnostics?.enter('attach-page-list');
  const target = await until(async () => {
    diagnostics?.cdpPageList();
    const targets = await readPortablePageList(await fetch(`http://127.0.0.1:${port}/json/list`, { redirect: 'error', signal: AbortSignal.timeout(1000) }), diagnostics);
    return targets.find(item => pageResources(item, platform, installation, root));
  }, Boolean, 180_000, 'owned installed main renderer', diagnostics);
  diagnostics?.enter('attach-page-cdp');
  const client = await connect(target.webSocketDebuggerUrl, event => {
    if (event.method === 'Runtime.exceptionThrown') exceptions.push('renderer-exception');
    if (event.method === 'Network.requestWillBeSent') try { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol)) origins.add(url.origin); } catch {}
  });
  diagnostics?.enter('attach-domains');
  await client.send('Runtime.enable'); await client.send('Network.enable');
  const evaluate = async (expression, timeout = 30_000) => {
    const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
    assert.ok(!result.exceptionDetails, 'Owned renderer operation failed.'); return result.result.value;
  };
  diagnostics?.enter('attach-browser-version');
  const browserInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).json();
  diagnostics?.enter('attach-browser-cdp');
  const browser = await connect(browserInfo.webSocketDebuggerUrl);
  diagnostics?.enter('attach-browser-pid');
  const processes = await browser.send('SystemInfo.getProcessInfo'); const pid = processes.processInfo.find(item => item.type === 'browser')?.id;
  assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid, 'Missing actual browser PID.');
  const resources = pageResources(target, platform, installation, root);
  if (failureContext) { failureContext.observedBrowserPid = pid; failureContext.observedBrowserResources = resources; }
  diagnostics?.enter('attach-profile-identity');
  if (platform === 'linux') {
    diagnostics?.enter('attach-private-executable');
    assert.equal(realpathSync(`/proc/${pid}/exe`), join(dirname(resources), 'openwork'), 'CDP process is outside its original AppImage runtime.');
    // /proc's environment remains a failure diagnostic. The live main process's
    // actual userData directory is checked below, after private exe ownership.
  } else {
    diagnostics?.enter('attach-windows-executable');
    const executable = decodeWindowsProcessPath(command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsProcessPathCommand(pid)]));
    assert.ok(resolve(executable).toLowerCase() === resolve(installation, PRODUCT + '.exe').toLowerCase(), 'CDP process is outside its private NSIS installation.');
  }
  diagnostics?.enter('attach-updater-bridge');
  await until(() => evaluate('Boolean(window.__OPENWORK_ELECTRON__?.updater)'), Boolean, 30_000, 'native updater bridge', diagnostics);
  const invoke = (name, ...args) => evaluate(`window.__OPENWORK_ELECTRON__.invokeDesktop(${JSON.stringify(name)},...${JSON.stringify(args)})`, 120_000);
  diagnostics?.enter('attach-effective-profile');
  const effectiveProfileMatches = await effectivePortableProfileMatches(invoke, profile);
  if (failureContext) failureContext.observedBrowserEffectiveProfileMatches = effectiveProfileMatches;
  assert.equal(effectiveProfileMatches, true, 'CDP process uses another Electron userData directory.');
  if (failureContext?.nativeDefaults) {
    const actual = assertNativeEffectiveProfile(failureContext.nativeDefaults, failureContext.baselineProfileRealpath);
    failureContext.baselineProfileRealpath ??= actual;
  }
  return { ...client, browser, pid, resources, evaluate, invoke };
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

function nativeWindowsRead(script, input) {
  return decodeNativeWindowsWire(command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { ...(input === undefined ? {} : { input: Buffer.from(JSON.stringify(input), 'utf8').toString('base64') }), timeout: 30_000 }));
}

export async function verifyNativeV1HistorySetting(request, readSavedState, waitUntil, select = false) {
  if (select) {
    const initial = await request('/experimental/engine-v2-preview/status');
    assert.equal(initial.enabled, true); assert.equal(initial.chatRouting, true);
    const status = await request('/experimental/engine-v2-preview', { method: 'PUT', body: JSON.stringify({ chatRouting: false, enabled: false }) });
    assert.equal(status.enabled, false); assert.equal(status.chatRouting, false);
  }
  const status = await request('/experimental/engine-v2-preview/status');
  assert.equal(status.enabled, false); assert.equal(status.chatRouting, false);
  const saved = readSavedState(); assert.equal(saved.enabled, false); assert.equal(saved.chatRouting, false);
  await waitUntil(() => request('/experimental/engine-v2-preview/activity'),
    value => value.v1?.verdict === 'idle' && value.v1.busySessions === 0 && value.v1.waitingRequests === 0
      && (value.v2 === null || value.v2?.verdict === 'idle'), 30_000, 'saved native V1 setting and idle historical engine');
}

async function main() {
  assertPortableHostedRunner(process.env, process.platform, process.arch);
  const additionalRetries = portableDownloadRetries(process.platform, process.env.ZENO_SMOKE_WINDOWS_DOWNLOAD_RETRIES);
  const profileMode = windowsProfileMode(process.platform, process.env.ZENO_SMOKE_WINDOWS_PROFILE_MODE);
  assert.notEqual(process.getuid?.(), 0, 'Refusing native desktop execution as root.');
  const platform = process.platform; const spec = lane(platform); const runner = realpathSync(process.env.RUNNER_TEMP);
  const root = mkdtempSync(join(runner, 'zeno-portable-update-')); const evidence = join(runner, 'zeno-portable-update-evidence'); mkdirSync(evidence, { recursive: true });
  const report = { passed: false, baseline: BASELINE, target: TARGET, platform, arch: 'x64', phases: [], nativeUpdateExecuted: false,
    downloadPolicy: { additionalRetries, mode: 'whole-file; same baseline session; no resume; reset-only retry' }, downloadAttempts: [],
    scope: { originalBaseline: false, originalTarget: false, realPublicFeed: false, installedUpgrade: false, automaticRelaunch: false, historicalChatPreservation: false, accountPairingTested: false, osCredentialStorageTested: false, aiRequested: false },
    windowsProfileMode: profileMode,
    isolation: profileMode === 'native-defaults' ? 'ephemeral GitHub-hosted Windows account; pristine exact native leaves; no injected paths; VM disposal'
      : 'ephemeral GitHub-hosted VM; private installation, Electron profile, workspace, XDG data and temporary runtime', publicOrigin: ORIGIN };
  const phase = (name, values = {}) => { report.phases.push({ name, at: new Date().toISOString(), ...values }); console.log(`[zeno-portable-update] ${name}`); };
  let client; let child; let oldPid; let cleanupAllowed = false; let failure = false; let restoreEnvironment; let failureContext; let nativeDefaults;
  const exceptions = []; const origins = new Set();
  const diagnostics = portableDiagnosticState();
  try {
    diagnostics.enter('release-metadata');
    const historicalFile = assertPrivatePath(runner, resolve(process.env.ZENO_UPDATE_BASELINE_METADATA));
    assert.ok(lstatSync(historicalFile).isFile());
    const baseline = validatePortableHistorical(JSON.parse(readFileSync(historicalFile, 'utf8')), platform);
    const index = await (await publicResponse(ORIGIN + '/api/releases/latest.json')).json();
    const feed = `${ORIGIN}/updates/${platform}/x64/`;
    const selected = validatePortableTarget(index, YAML.parse(await (await publicResponse(feed + spec.manifest)).text()), platform);
    report.scope.realPublicFeed = true;
    const baselineFile = join(root, baseline.name); const targetFile = join(root, selected.installer.name);
    diagnostics.enter('artifact-copy');
    for (const directory of [process.env.ZENO_UPDATE_BASELINE_DIR, process.env.ZENO_UPDATE_TARGET_DIR]) assertPrivatePath(runner, resolve(directory));
    await copyVerifiedArtifact(process.env.ZENO_UPDATE_BASELINE_DIR, runner, baseline, baselineFile);
    await copyVerifiedArtifact(process.env.ZENO_UPDATE_TARGET_DIR, runner, selected.installer, targetFile);
    report.scope.originalBaseline = true; report.scope.originalTarget = true;
    phase('original-installers-verified', { baselineSha256: baseline.sha256, targetSha256: selected.installer.sha256, baselineBytes: baseline.size, targetBytes: selected.installer.size });
    diagnostics.enter('target-reference');
    const reference = referenceResources(targetFile, join(root, 'reference-only'), platform, profileMode === 'native-defaults');
    const targetCode = verifyResources(reference.resources, TARGET, feed, platform, reference.executableNames); rmSync(join(root, 'reference-only'), { recursive: true, force: true });
    if (profileMode === 'native-defaults') {
      diagnostics.enter('windows-native-reference');
      const historicalReference = referenceResources(baselineFile, join(root, 'baseline-reference-only'), platform, true);
      const historicalCode = verifyResources(historicalReference.resources, BASELINE, feed, platform, historicalReference.executableNames);
      assert.deepEqual(historicalCode.nativeIdentity, targetCode.nativeIdentity, 'Original NSIS native installation/cache identities differ.');
      rmSync(join(root, 'baseline-reference-only'), { recursive: true, force: true });
      const roots = nativeWindowsRead(windowsNativeRootsScript());
      assert.ok(sameWindowsPath(roots.home, homedir()) && sameWindowsPath(roots.home, process.env.USERPROFILE));
      assertNativeEnvironmentRoots(roots, process.env);
      nativeDefaults = windowsNativePlan(roots, targetCode.nativeIdentity, join(root, 'workspace'));
      diagnostics.enter('windows-native-pristine');
      assertNativePristineLeaves(nativeDefaults);
      report.nativeDefaults = nativeWindowsRead(windowsNativePristineScript(), nativeDefaults);
      assert.equal(report.nativeDefaults.pristine, true);
    }
    diagnostics.enter('private-directories');
    for (const name of nativeDefaults ? ['workspace', 'logs'] : ['installation', 'profile', 'workspace', 'state', 'data', 'config', 'cache', 'logs', 'tmp']) mkdirSync(join(root, name));
    const installation = nativeDefaults?.installation ?? join(root, 'installation'); const profile = nativeDefaults?.profile ?? join(root, 'profile'); const workspace = join(root, 'workspace');
    const port = nativeDefaults ? 9223 : await freePort();
    failureContext = { platform, root, installation, profile, port, executable: join(installation, platform === 'win32' ? PRODUCT + '.exe' : 'Zeno.AppImage'),
      targetAsarSha256: targetCode.archiveSha256, targetInstallerSha256: selected.installer.sha256, ...(nativeDefaults ? { nativeDefaults } : {}) };
    const environment = nativeDefaults ? nativeDefaultsEnvironment(process.env) : isolatedEnvironment(root, port);
    if (!nativeDefaults) writeFileSync(join(profile, 'openwork-workspaces.json'), JSON.stringify({ selectedId: '', activeId: null, watchedId: null, workspaces: [] }));
    const marker = 'zeno-update-fixture-' + randomBytes(16).toString('hex'); writeFileSync(join(workspace, 'update-smoke-marker.txt'), marker);
    let executable;
    if (platform === 'win32') {
      diagnostics.enter('windows-pristine-installation');
      windowsPristineInstallation();
      if (!nativeDefaults) {
        diagnostics.enter('windows-relaunch-environment');
        restoreEnvironment = publishWindowsRelaunchEnvironment(environment, root);
      } else {
        diagnostics.enter('windows-native-ports'); await assertNativeCdpPortsFree();
      }
      diagnostics.enter('baseline-nsis-install');
      command(baselineFile, nativeDefaults ? ['/S'] : ['/S', `/D=${installation}`], { env: environment });
      if (nativeDefaults) {
        diagnostics.enter('windows-native-installation');
        assertNativeOwnedPath(nativeDefaults, installation);
        assert.ok(sameWindowsPath(realpathSync(installation), installation));
        const observed = nativeWindowsRead(windowsNativeInstallationScript(), nativeDefaults);
        assert.equal(observed.nativeInstallationRegistered, true); assert.equal(observed.exactDefaultInstallation, true);
        Object.assign(report.nativeDefaults, observed);
      }
      executable = join(installation, PRODUCT + '.exe'); assert.ok(existsSync(executable), 'NSIS did not install into its private directory.');
      diagnostics.enter('baseline-resource-verification');
      const installed = verifyResources(join(installation, 'resources'), BASELINE, feed, platform);
      assert.equal(installed.updaterCacheDirName, targetCode.updaterCacheDirName);
      phase('original-nsis-installed', { privateDirectory: !nativeDefaults, ...(nativeDefaults ? { pristineNativeDefaultDirectory: true } : {}), noResigning: true });
    } else {
      diagnostics.enter('baseline-appimage-install');
      executable = join(installation, 'Zeno.AppImage');
      // A versionless filename is a supported AppImageUpdater installation;
      // native replacement retains this exact user-chosen executable path.
      await copyVerifiedArtifact(process.env.ZENO_UPDATE_BASELINE_DIR, runner, baseline, executable); chmodSync(executable, 0o755);
      phase('original-appimage-installed', { privateDirectory: true, unchangedExecutableBytes: hash(readFileSync(executable)) === baseline.sha256 });
    }
    diagnostics.enter('baseline-app-launch');
    if (nativeDefaults) await assertNativeCdpPortsFree();
    const output = openSync(join(root, 'logs/electron.log'), 'a', 0o600); const errors = openSync(join(root, 'logs/electron-error.log'), 'a', 0o600);
    child = spawn(executable, [], { env: environment, cwd: workspace, stdio: ['ignore', output, errors], detached: true });
    child.on('error', () => {}); closeSync(output); closeSync(errors);
    client = await attach(port, platform, installation, root, profile, exceptions, origins, diagnostics, failureContext); oldPid = client.pid;
    diagnostics.enter('baseline-resource-verification');
    const baselineCode = verifyResources(client.resources, BASELINE, feed, platform); assert.equal(baselineCode.updaterCacheDirName, targetCode.updaterCacheDirName);
    diagnostics.enter('baseline-build-info');
    assert.equal((await client.invoke('appBuildInfo')).version, BASELINE);
    diagnostics.enter('baseline-updater-channel');
    const channel = await client.evaluate('window.__OPENWORK_ELECTRON__.updater.getChannel()');
    assert.equal(channel.supported, true); assert.equal(channel.product, 'zeno'); assert.equal(channel.feedUrl, feed); assert.equal(channel.currentVersion, BASELINE);
    diagnostics.enter('baseline-workspace-create');
    const created = await client.invoke('workspaceCreate', { folderPath: workspace, name: 'Zeno update fixture' });
    diagnostics.enter('baseline-workspace-identity');
    const workspaceRecord = created.workspaces.find(item => item.path === workspace); assert.ok(workspaceRecord?.id);
    const before = await runtime(client, workspace, { registerWorkspace: true }, diagnostics);
    if (nativeDefaults) {
      diagnostics.enter('baseline-native-v1-setting');
      await verifyNativeV1HistorySetting(before.request, () => JSON.parse(readFileSync(assertNativeOwnedPath(nativeDefaults, nativeDefaults.engineState), 'utf8')),
        (read, predicate, timeout, description) => until(read, predicate, timeout, description, diagnostics), true);
      Object.assign(report.nativeDefaults, { historicalEngine: 'v1', originalFreshV2SettingObserved: true, selectedThroughOriginalSettings: true, savedV1BeforeHistory: true, defaultV2HistoryTested: false });
    }
    const mount = before.mount; const serverWorkspaceRecord = before.workspace;
    diagnostics.enter('baseline-session-create');
    const session = await before.request(mount + '/session', { method: 'POST', body: JSON.stringify({ title: marker }) });
    diagnostics.enter('baseline-session-identity'); assert.ok(session.id);
    diagnostics.enter('baseline-message-create');
    await before.request(`${mount}/session/${encodeURIComponent(session.id)}/message`, { method: 'POST', body: JSON.stringify({ noReply: true, parts: [{ type: 'text', text: marker }] }) });
    const hasMarker = messages => messages.some(message => message.parts?.some(part => part.type === 'text' && part.text === marker));
    diagnostics.enter('baseline-message-read');
    assert.ok(hasMarker(await before.request(`${mount}/session/${encodeURIComponent(session.id)}/message`)));
    diagnostics.enter('baseline-profile-marker');
    await client.evaluate(`localStorage.setItem('zeno.update.smoke',${JSON.stringify(marker)})`);
    phase('baseline-native-history-created', { installedVersion: BASELINE, workspace: true, serverRegistryIdentity: true, storedSession: true, storedMessage: true, noModelCall: true });
    diagnostics.enter('update-check');
    const checked = await client.evaluate("window.__OPENWORK_ELECTRON__.updater.check('stable')", 120_000);
    assert.equal(checked.available, true); assert.equal(checked.latestVersion, TARGET); assert.equal(checked.feedUrl, feed); assert.equal(checked.totalBytes, selected.installer.size);
    try { report.downloadProgress = { subscriptionSupported: await client.evaluate(`(()=>{window.__zenoSmokeDownloadProgress={};const updater=window.__OPENWORK_ELECTRON__.updater;if(typeof updater.onDownloadProgress!=='function')return false;const numeric=${numericDownloadProgress.toString()};updater.onDownloadProgress(value=>window.__zenoSmokeDownloadProgress={...window.__zenoSmokeDownloadProgress,...numeric(value)});return true})()`, 2000) === true }; } catch { report.downloadProgress = { subscriptionSupported: false }; }
    phase('native-public-download-started', { bytes: selected.installer.size, installer: spec.suffix });
    diagnostics.enter('update-download');
    const downloaded = await runPortableDownloadAttempts({ platform, additionalRetries, records: report.downloadAttempts,
      begin: async attempt => {
        if (attempt > 1) {
          // Retry the same original UI bridge/session. No re-check, cache seed,
          // installer command, new profile, baseline restart or target launch.
          assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
          const processes = await client.browser.send('SystemInfo.getProcessInfo');
          assert.equal(processes.processInfo.find(item => item.type === 'browser')?.id, oldPid);
          assert.equal((await client.invoke('appBuildInfo')).version, BASELINE);
          assert.equal(await effectivePortableProfileMatches(client.invoke, profile), true);
          assert.equal(await client.evaluate("localStorage.getItem('zeno.update.smoke')"), marker);
          assert.equal(readFileSync(join(workspace, 'update-smoke-marker.txt'), 'utf8'), marker);
          assert.ok((await client.invoke('workspaceBootstrap')).workspaces.some(item => item.id === workspaceRecord.id && item.path === workspace));
          assert.equal((await before.request(`${mount}/session/${encodeURIComponent(session.id)}`)).title, marker);
          assert.ok(hasMarker(await before.request(`${mount}/session/${encodeURIComponent(session.id)}/message`)));
        }
        await client.evaluate('window.__zenoSmokeDownloadProgress={}', 2000);
        return snapshotDownloadLogs(root);
      },
      download: () => client.evaluate('window.__OPENWORK_ELECTRON__.updater.download()', 1_800_000),
      progress: () => client.evaluate('window.__zenoSmokeDownloadProgress', 2000),
      inspectFailure: snapshot => inspectDownloadLogWindow(root, snapshot),
    });
    assert.equal(downloaded.ok, true, 'Real public native download failed.'); assert.equal(downloaded.version, TARGET);
    phase('native-public-download-completed', { version: TARGET, successfulAttempt: report.downloadAttempts.length });
    diagnostics.enter('update-idle');
    await until(() => before.request('/experimental/engine-v2-preview/activity'), value => value.v1?.verdict === 'idle' && value.v1.busySessions === 0 && value.v1.waitingRequests === 0 && (value.v2 === null || value.v2?.verdict === 'idle'), 30_000, 'idle historical engine', diagnostics);
    diagnostics.enter('update-install');
    await client.evaluate('(()=>{window.__zenoInstallResult=null;window.__OPENWORK_ELECTRON__.updater.installAndRestart().then(value=>{window.__zenoInstallResult=value});return true})()');
    diagnostics.enter('update-process-exit');
    await until(() => child.exitCode ?? child.signalCode, value => value !== null, 120_000, 'baseline process exits naturally', diagnostics);
    client.socket.close(); client.browser.socket.close(); client = null;
    // No spawn, installer command, Browser.close or kill is permitted between
    // admission above and these actual target/restart/preservation assertions.
    client = await attach(port, platform, installation, root, profile, exceptions, origins, diagnostics, failureContext);
    assert.notEqual(client.pid, oldPid, 'The target was not automatically relaunched in a new native process.');
    diagnostics.enter('target-code-verification');
    const afterCode = verifyResources(client.resources, TARGET, feed, platform); assert.equal(afterCode.archiveSha256, targetCode.archiveSha256, 'Installed ASAR differs from the frozen published target.');
    if (platform === 'linux') assert.equal(hash(readFileSync(executable)), selected.installer.sha256, 'Native AppImage replacement differs from the original published installer.');
    diagnostics.enter('target-build-info');
    assert.equal((await client.invoke('appBuildInfo')).version, TARGET);
    report.nativeUpdateExecuted = true; Object.assign(report.scope, { installedUpgrade: true, automaticRelaunch: true });
    phase('original-target-installed-and-automatically-relaunched', { installedVersion: TARGET, publishedAsar: true, actualProcessChanged: true });
    diagnostics.enter('target-profile-marker');
    assert.equal(await client.evaluate("localStorage.getItem('zeno.update.smoke')"), marker, 'Chromium state was lost.');
    diagnostics.enter('target-workspace-file');
    assert.equal(readFileSync(join(workspace, 'update-smoke-marker.txt'), 'utf8'), marker, 'Workspace contents were lost.');
    diagnostics.enter('target-workspace-identity');
    const retained = await client.invoke('workspaceBootstrap'); assert.ok(retained.workspaces.some(item => item.id === workspaceRecord.id && item.path === workspace), 'Workspace identity was lost.');
    const after = await runtime(client, workspace, { expectedWorkspaceId: serverWorkspaceRecord.id }, diagnostics);
    if (nativeDefaults) {
      diagnostics.enter('target-native-v1-setting');
      await verifyNativeV1HistorySetting(after.request, () => JSON.parse(readFileSync(assertNativeOwnedPath(nativeDefaults, nativeDefaults.engineState), 'utf8')),
        (read, predicate, timeout, description) => until(read, predicate, timeout, description, diagnostics));
      Object.assign(report.nativeDefaults, { savedV1Retained: true, actualDefaultProfileRealpathRetained: true });
    }
    assert.deepEqual(after.workspace, serverWorkspaceRecord, 'Historical server workspace registry was lost.');
    assert.equal(after.mount, mount, 'Historical server workspace mount changed.');
    diagnostics.enter('target-session-read');
    assert.equal((await after.request(`${mount}/session/${encodeURIComponent(session.id)}`)).title, marker);
    diagnostics.enter('target-message-read');
    assert.ok(hasMarker(await after.request(`${mount}/session/${encodeURIComponent(session.id)}/message`)), 'Historical native conversation was lost.');
    diagnostics.enter('target-renderer');
    assert.equal(exceptions.length, 0, 'An installed renderer exception occurred.');
    assert.ok([...origins].every(origin => !/openworklabs\.com|github\.com/.test(origin)), 'Unexpected upstream renderer connection.');
    diagnostics.enter('target-screenshot');
    const image = await client.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(evidence, 'updated-app.png'), Buffer.from(image.data, 'base64'));
    report.scope.historicalChatPreservation = true;
    phase('real-native-upgrade-and-preservation-verified', { installedVersion: TARGET, successfulDownloadAttempt: report.downloadAttempts.length, publishedAsar: true, actualProcessChanged: true, chromiumProfile: true, workspaceIdentity: true, serverRegistryIdentity: true, workspaceFile: true, historicalSession: true, historicalMessage: true, embeddedServer: true });
    if (compareStableVersions(TARGET, '1.1.1') >= 0) {
      diagnostics.enter('target-navigation');
      const previousSessions = workspaceSessionIdentitySnapshot(await after.request(`${mount}/session`));
      const navigation = await verifyPackagedNavigation({ client, resources: client.resources });
      report.navigation = navigation.report;
      writeFileSync(join(evidence, 'native-navigation.png'), navigation.screenshot);
      assertWorkspaceSessionsUnchanged(workspaceSessionIdentitySnapshot(await after.request(`${mount}/session`)), previousSessions);
      assert.ok(hasMarker(await after.request(`${mount}/session/${encodeURIComponent(session.id)}/message`)), 'Sidebar navigation changed historical native messages.');
      assert.equal(exceptions.length, 0, 'A renderer exception occurred during sidebar navigation.');
      Object.assign(report.navigation, { workspaceSessionSetUnchanged: true, historicalMessageRetained: true, rendererExceptions: 0 });
      phase('installed-target-four-personal-sidebar-routes-verified', { realClicks: 4, stablePersonalRoutes: true, unpairedAccountGate: true, noNewChat: true, historicalMessageRetained: true });
    }
    cleanupAllowed = true; report.passed = true;
  } catch (error) {
    if (error.navigationReport) report.navigation = error.navigationReport;
    failure = true; report.failure = { classification: 'native-update-validation-failed', lastPhase: report.phases.at(-1)?.name ?? 'initialization', ...diagnostics.snapshot(error) };
    try { report.failureState = collectPortableFailureState(failureContext, oldPid, child); } catch { report.failureState = { collected: false }; }
    try { if (client) report.downloadProgress = { ...report.downloadProgress, ...numericDownloadProgress(await client.evaluate('window.__zenoSmokeDownloadProgress', 2000)) }; } catch {}
    report.failureDiagnostics = privateUpdateFailureDiagnostics(root);
    // Never publish assertion values, private paths, runtime tokens or raw logs.
  } finally {
    if (client) { try { await client.browser.send('Browser.close', {}, 5000).catch(() => {}); } catch {} client.socket.close(); client.browser.socket.close(); }
    try { restoreEnvironment?.(); } catch { report.environmentCleanup = 'private hosted environment restoration failed; VM disposal required'; report.passed = false; failure = true; }
    if (nativeDefaults) {
      // Native default state, registration and shortcuts belong only to this
      // disposable account. Never recursively remove HOME/AppData or rewrite
      // a profile/registry to make the upgrade pass. VM disposal removes it.
      report.cleanup = 'native default leaves and private fixture retained for disposable hosted VM destruction';
    } else if (cleanupAllowed) {
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
  return report.passed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'No native execution or feed overrides are accepted.');
  // main() returns only after all finally work, environment restoration and
  // synchronous report writes. A failed owned child/socket must not keep the
  // hosted verifier alive until its 75-minute job limit. The VM disposes of
  // private failed app processes; success still exits through the normal path.
  finishPortableRun(await main(), code => process.exit(code));
}
