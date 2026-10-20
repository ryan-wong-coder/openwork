import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { win32 } from 'node:path';

// Dev-only fixture. These functions never install, launch, copy or migrate an
// application. All native paths remain private to an ephemeral hosted VM.
export function windowsProfileMode(platform, value = 'isolated') {
  assert.ok(['isolated', 'native-defaults'].includes(value), 'Unknown Windows profile mode.');
  assert.ok(platform === 'win32' || value === 'isolated', 'Native defaults are Windows-only.');
  return value;
}

export function windowsNativeLeaf(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0 && value.length <= 128 && !/[<>:"/\\|?*\u0000-\u001f]/.test(value)
    && !value.endsWith('.') && !value.endsWith(' ') && value !== '.' && value !== '..'
    && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value), 'Invalid native Windows leaf.');
  return value;
}

function nsisGuid(appId) {
  // electron-builder 26.15.3 NsisTarget's UUIDv5 namespace, not a new identity.
  const namespace = Buffer.from('50e065bc313411e69bab38c9862bdaf3', 'hex');
  const bytes = createHash('sha1').update(namespace).update(appId).digest().subarray(0, 16);
  bytes[6] = bytes[6] & 15 | 80; bytes[8] = bytes[8] & 63 | 128;
  const value = bytes.toString('hex');
  return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-');
}

export function nativeWindowsPackageIdentity(metadata, cacheName, distributionSource, executableNames) {
  assert.equal(metadata?.openworkBrand, 'zeno'); assert.equal(metadata.openworkDistribution, 'public');
  // Read the original ASAR's actual package name, public identity and actual
  // payload EXE name. Pinned NSIS selects sanitizedName for this non-ASCII
  // productFilename in both one-click and assisted per-user installations.
  assert.equal(typeof metadata.name, 'string');
  assert.match(metadata.name, /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/);
  assert.deepEqual(executableNames, ['泽诺 Zeno.exe']);
  const block = /export const PUBLIC_DESKTOP_DISTRIBUTION = Object\.freeze\(\{([^}]{1,1024})\}\);/.exec(distributionSource)?.[1];
  assert.ok(block, 'Missing original public desktop identity.');
  const appId = /appIdentifier:\s*"([^"]+)"/.exec(block)?.[1];
  const protocol = /protocolScheme:\s*"([^"]+)"/.exec(block)?.[1];
  assert.equal(appId, 'com.differentai.openwork'); assert.equal(protocol, 'openwork');
  // sanitize-filename 1.6.4 removes slash; the restricted real scoped package
  // name above contains no other characters requiring that algorithm.
  const installationLeaf = windowsNativeLeaf(metadata.name.replace('/', ''));
  const cacheLeaf = windowsNativeLeaf(cacheName);
  assert.equal(cacheLeaf, installationLeaf.toLowerCase() + '-updater', 'Original updater cache differs from the pinned builder identity.');
  return { installationLeaf, cacheLeaf, appId, protocol, appGuid: nsisGuid(appId), executableName: executableNames[0] };
}

export function sameWindowsPath(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

export function assertNativeEnvironmentRoots(roots, env) {
  const programData = Object.entries(env).find(([name]) => name.toLowerCase() === 'programdata')?.[1];
  assert.ok(typeof programData === 'string' && programData.length > 0, 'Native managed configuration requires an explicit OS ProgramData root.');
  for (const [name, key] of [['USERPROFILE', 'home'], ['HOME', 'home'], ['APPDATA', 'roaming'], ['LOCALAPPDATA', 'local'], ['ProgramData', 'programData']]) {
    const value = Object.entries(env).find(([candidate]) => candidate.toLowerCase() === name.toLowerCase())?.[1];
    if (value !== undefined && value !== '') assert.ok(typeof value === 'string' && /^[A-Za-z]:[\\/]/.test(value)
      && sameWindowsPath(value, roots[key]), 'Ambient OS environment differs from the native known folder.');
  }
}

export function windowsNativePlan(roots, identity, workspace) {
  for (const key of ['home', 'roaming', 'local', 'programFiles', 'programData', 'programs', 'desktop', 'commonPrograms', 'commonDesktop', 'temp']) {
    assert.ok(typeof roots?.[key] === 'string' && /^[A-Za-z]:\\/.test(roots[key]) && win32.normalize(roots[key]) === roots[key], 'Invalid native known folder.');
  }
  assert.ok(sameWindowsPath(roots.roaming, win32.join(roots.home, 'AppData/Roaming')));
  assert.ok(sameWindowsPath(roots.local, win32.join(roots.home, 'AppData/Local')));
  assert.ok(sameWindowsPath(roots.programFiles, win32.join(roots.local, 'Programs')));
  assert.ok(sameWindowsPath(roots.programs, win32.join(roots.roaming, 'Microsoft/Windows/Start Menu/Programs')));
  assert.ok(/^S-1-5-21-(?:\d+-){2}\d+-\d+$/.test(roots.sid), 'Missing disposable account identity.');
  const profile = win32.join(roots.roaming, identity.appId);
  const installation = win32.join(roots.programFiles, windowsNativeLeaf(identity.installationLeaf));
  const cache = win32.join(roots.local, windowsNativeLeaf(identity.cacheLeaf));
  const leaves = [installation, profile, cache, win32.join(roots.roaming, 'openwork'), win32.join(roots.local, 'openwork'),
    win32.join(roots.home, '.config/openwork'), win32.join(roots.home, '.config/opencode'), win32.join(roots.home, '.opencode'),
    win32.join(roots.home, '.local/share/opencode'), win32.join(roots.roaming, 'opencode'), win32.join(roots.local, 'opencode'),
    win32.join(roots.home, '.cache/opencode'), win32.join(roots.home, '.local/state/opencode'),
    win32.join(roots.home, '.openwork/openwork-server'), win32.join(roots.home, '.openwork/openwork-orchestrator'),
    win32.join(roots.home, 'OpenWork Chat'), win32.join(roots.temp, 'opencode')];
  const shortcuts = [roots.programs, roots.desktop, roots.commonPrograms, roots.commonDesktop]
    .flatMap(directory => ['OpenWork.lnk', '泽诺 Zeno.lnk'].map(name => win32.join(directory, name)));
  const checkOnlyLeaves = [win32.join(roots.programData, 'opencode/opencode.json'), win32.join(roots.programData, 'opencode/opencode.jsonc'),
    win32.join(roots.home, '.claude'), win32.join(roots.home, '.agents')];
  if (workspace !== undefined) {
    assert.ok(/^[A-Za-z]:\\/.test(workspace) && win32.normalize(workspace) === workspace, 'Invalid private workspace path.');
    let depth = 0;
    for (let cursor = workspace; ; cursor = win32.dirname(cursor)) {
      assert.ok(depth++ < 64, 'Workspace prerequisite ancestry is too deep.');
      for (const leaf of ['.opencode', '.claude', '.agents', 'opencode.json', 'opencode.jsonc']) checkOnlyLeaves.push(win32.join(cursor, leaf));
      if (cursor === win32.dirname(cursor)) break;
    }
  }
  assert.equal(new Set(leaves.map(value => value.toLowerCase())).size, leaves.length, 'Native leaf ownership overlaps.');
  for (const leaf of leaves) assert.ok(![roots.home, roots.roaming, roots.local, roots.temp, roots.programFiles].some(root => sameWindowsPath(root, leaf)));
  return { roots, identity, installation, profile, cache, leaves, shortcuts, checkOnlyLeaves: [...new Set(checkOnlyLeaves)],
    engineState: win32.join(roots.roaming, 'openwork/engine-v2-preview.json') };
}

export function assertNativeOwnedPath(plan, value) {
  const path = win32.resolve(value);
  assert.ok(plan.leaves.some(leaf => { const child = win32.relative(leaf, path); return !child || !win32.isAbsolute(child) && !child.split('\\').includes('..'); }), 'Path is outside the native ownership ledger.');
  for (let cursor = path; ; cursor = win32.dirname(cursor)) {
    try { assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Native ownership crosses a link.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (cursor === win32.dirname(cursor)) break;
  }
  return path;
}

export function assertNativePristineLeaves(plan) {
  for (const path of [...plan.leaves, ...plan.shortcuts, ...plan.checkOnlyLeaves]) {
    for (let cursor = path; ; cursor = win32.dirname(cursor)) {
      try {
        const info = lstatSync(cursor); assert.ok(!info.isSymbolicLink(), 'Native prerequisite crosses a link.');
        assert.ok(cursor !== path, 'A native product leaf already exists.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (cursor === win32.dirname(cursor)) break;
    }
  }
}

export function nativeDefaultsEnvironment(env) {
  const result = { ...env };
  for (const key of Object.keys(result)) if (/^(?:OPENWORK_|OPENCODE_|DEN_|VITE_|ZENO_|CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$|ELECTRON_|NODE_OPTIONS$|NODE_PATH$|XDG_)/.test(key)) delete result[key];
  return result; // No User/Machine writes, path overrides or injected port.
}

const wireInput = "$v=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())))";
const wireOutput = "$json=$result|ConvertTo-Json -Depth 5 -Compress; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))";

export function windowsNativeRootsScript() {
  return `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ZenoNativeFolders { [DllImport("shell32.dll")] public static extern int SHGetKnownFolderPath(ref Guid id,uint flags,IntPtr token,out IntPtr path); }'
$id=[Guid]'5CD7AEE2-2219-4A67-B85D-6C9CE15660CB';$pointer=[IntPtr]::Zero
try {$status=[ZenoNativeFolders]::SHGetKnownFolderPath([ref]$id,0x4000,[IntPtr]::Zero,[ref]$pointer);if($status -ne 0){throw 'Known folder unavailable'};$programFiles=[Runtime.InteropServices.Marshal]::PtrToStringUni($pointer)}finally{if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeCoTaskMem($pointer)}}
$result=[ordered]@{home=[Environment]::GetFolderPath('UserProfile');roaming=[Environment]::GetFolderPath('ApplicationData');local=[Environment]::GetFolderPath('LocalApplicationData');programFiles=$programFiles;programData=[Environment]::GetFolderPath('CommonApplicationData');programs=[Environment]::GetFolderPath('Programs');desktop=[Environment]::GetFolderPath('DesktopDirectory');commonPrograms=[Environment]::GetFolderPath('CommonPrograms');commonDesktop=[Environment]::GetFolderPath('CommonDesktopDirectory');temp=[IO.Path]::GetTempPath().TrimEnd('\\');sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}
${wireOutput}`;
}

export function windowsNativePristineScript() {
  return `$ErrorActionPreference='Stop'
${wireInput}
$pattern='^(?:OPENWORK_|OPENCODE_|XDG_|VITE_OPENWORK_|ELECTRON_|ZENO_API_ORIGIN$|NODE_OPTIONS$|NODE_PATH$|ANTHROPIC_API_KEY$|OPENAI_API_KEY$|MODELHELM_API_KEY$)'
foreach($scope in @('Process','User','Machine')){foreach($entry in [Environment]::GetEnvironmentVariables($scope).GetEnumerator()){if($entry.Key -match $pattern -and [string]$entry.Value -ne ''){throw 'Pre-existing scoped environment'}}
 foreach($pair in @(@('APPDATA','roaming'),@('LOCALAPPDATA','local'),@('ProgramData','programData'))){$configured=[Environment]::GetEnvironmentVariable($pair[0],$scope);if($configured){$expanded=[Environment]::ExpandEnvironmentVariables($configured);if($expanded -notmatch '^[A-Za-z]:[\\/]' -or -not [string]::Equals([IO.Path]::GetFullPath($expanded),$v.roots.($pair[1]),[StringComparison]::OrdinalIgnoreCase)){throw 'Ambient known folder mismatch'}}}
}
foreach($path in @($v.leaves)+@($v.shortcuts)+@($v.checkOnlyLeaves)){for($cursor=$path;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){if(Test-Path -LiteralPath $cursor){$item=Get-Item -LiteralPath $cursor -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse prerequisite'};if($cursor -eq $path){throw 'Pre-existing native state'}}}}
$names=@($v.identity.executableName,'OpenWork.exe','opencode.exe','opencode2.exe')
if(@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{$names -contains $_.Name}).Count -ne 0){throw 'Pre-existing application process'}
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
 $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
 try{foreach($key in @(('Software\\'+$v.identity.appGuid),('Software\\'+$v.identity.appId),('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$v.identity.appGuid),('Software\\Classes\\'+$v.identity.protocol),('Software\\Classes\\AppUserModelId\\'+$v.identity.appId),('Software\\Classes\\Applications\\'+$v.identity.executableName),'Software\\Classes\\Applications\\OpenWork.exe')){ $found=$base.OpenSubKey($key);if($null -ne $found){$found.Dispose();throw 'Pre-existing native registration'}}}finally{$base.Dispose()}
}}
$result=[ordered]@{pristine=$true;environmentScopesChecked=3;registryViewsChecked=4;nativeLeavesChecked=@($v.leaves).Count;shortcutsChecked=@($v.shortcuts).Count;checkOnlyLeavesChecked=@($v.checkOnlyLeaves).Count}
${wireOutput}`;
}

export function windowsNativeInstallationScript() {
  return `$ErrorActionPreference='Stop'
${wireInput}
$installationLocations=@()
foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
 $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
 try{$key=$base.OpenSubKey('Software\\'+$v.identity.appGuid);if($key){try{$location=[string]$key.GetValue('InstallLocation');if($location){$installationLocations+= $location}}finally{$key.Dispose()}}}finally{$base.Dispose()}
}
if($installationLocations.Count -lt 1 -or @($installationLocations|Where-Object{ -not [string]::Equals($_,$v.installation,[StringComparison]::OrdinalIgnoreCase)}).Count -ne 0){throw 'Native installation identity mismatch'}
$item=Get-Item -LiteralPath $v.installation -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Native installation link'}
$result=[ordered]@{nativeInstallationRegistered=$true;exactDefaultInstallation=$true}
${wireOutput}`;
}

export function decodeNativeWindowsWire(text) {
  assert.match(text, /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(text, 'base64')));
}

export function assertNativeEffectiveProfile(plan, expectedRealpath) {
  assertNativeOwnedPath(plan, plan.profile);
  const actual = realpathSync(plan.profile);
  assert.ok(sameWindowsPath(actual, plan.profile), 'Native profile resolves outside its original default path.');
  if (expectedRealpath !== undefined) assert.ok(sameWindowsPath(actual, expectedRealpath), 'Native profile identity changed after upgrade.');
  return actual;
}
