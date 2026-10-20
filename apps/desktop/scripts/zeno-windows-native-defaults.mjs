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

const PREREQUISITE_CHECKS = new Set(['input', 'owned-leaf', 'shortcut', 'check-only', 'environment', 'known-folder-environment',
  'process', 'registry', 'powershell-launch', 'complete', 'invalid-response']);
const PREREQUISITE_REASONS = new Set(['clear', 'existing-state', 'reparse', 'scoped-environment', 'known-folder-mismatch',
  'existing-process', 'existing-registration', 'api-error', 'invalid-response']);
const PREREQUISITE_VARIABLES = new Set(['enumeration', 'openwork-prefix', 'opencode-prefix', 'xdg-prefix', 'vite-openwork-prefix',
  'electron-prefix', 'zeno-api-origin', 'node-options', 'node-path', 'anthropic-api-key', 'openai-api-key', 'modelhelm-api-key',
  'appdata', 'localappdata', 'programdata']);
const PREREQUISITE_CODES = new Set(['EACCES', 'EPERM', 'EINVAL', 'ENOTDIR', 'EISDIR', 'ELOOP', 'unknown']);
const PREREQUISITE_REGISTRY = new Set(['enumeration', 'app-guid', 'app-id', 'uninstall', 'protocol', 'app-user-model-id', 'product-association', 'legacy-association']);
const PREREQUISITE_FIELDS = new Set(['engine', 'passed', 'check', 'reason', 'pristine', 'index', 'ancestorDepth', 'scope', 'variable', 'code',
  'hive', 'view', 'registryKind', 'processCount', 'countCapped', 'nativeLeavesChecked', 'shortcutsChecked', 'checkOnlyLeavesChecked',
  'environmentScopesChecked', 'registryViewsChecked']);

export function safeNativePrerequisite(value, engine, plan) {
  assert.ok(['node', 'powershell'].includes(engine));
  const invalid = { engine, passed: false, check: 'invalid-response', reason: 'invalid-response' };
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.engine !== engine || typeof value.passed !== 'boolean'
    || !PREREQUISITE_CHECKS.has(value.check) || !PREREQUISITE_REASONS.has(value.reason)) return invalid;
  const result = { engine, passed: value.passed, check: value.check, reason: value.reason };
  for (const key of ['nativeLeavesChecked', 'shortcutsChecked', 'checkOnlyLeavesChecked', 'environmentScopesChecked', 'registryViewsChecked', 'index', 'ancestorDepth', 'processCount']) {
    if (value[key] === undefined) continue;
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 512) return invalid;
    result[key] = value[key];
  }
  for (const key of ['pristine', 'countCapped']) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') return invalid;
    result[key] = value[key];
  }
  for (const [key, allowed] of [['scope', new Set(['process', 'user', 'machine'])], ['variable', PREREQUISITE_VARIABLES],
    ['code', PREREQUISITE_CODES], ['hive', new Set(['current-user', 'local-machine'])], ['view', new Set(['registry32', 'registry64'])], ['registryKind', PREREQUISITE_REGISTRY]]) {
    if (value[key] === undefined) continue;
    if (!allowed.has(value[key])) return invalid;
    result[key] = value[key];
  }
  const groups = { 'owned-leaf': plan.leaves, shortcut: plan.shortcuts, 'check-only': plan.checkOnlyLeaves };
  if (groups[result.check] && (!Number.isSafeInteger(result.index) || result.index >= groups[result.check].length)) return invalid;
  if (!result.passed && (result.check === 'complete' || result.reason === 'clear' || result.pristine === true)) return invalid;
  const successFields = new Set(['engine', 'passed', 'check', 'reason', 'pristine', 'nativeLeavesChecked', 'shortcutsChecked', 'checkOnlyLeavesChecked',
    ...(engine === 'powershell' ? ['environmentScopesChecked', 'registryViewsChecked'] : [])]);
  if (result.passed && (result.check !== 'complete' || result.reason !== 'clear' || result.pristine !== true
    || result.nativeLeavesChecked !== plan.leaves.length || result.shortcutsChecked !== plan.shortcuts.length || result.checkOnlyLeavesChecked !== plan.checkOnlyLeaves.length
    || engine === 'powershell' && (result.environmentScopesChecked !== 3 || result.registryViewsChecked !== 4)
    || Object.keys(value).some(key => !PREREQUISITE_FIELDS.has(key) || !successFields.has(key)))) return invalid;
  return result;
}

export function inspectNativePristineLeaves(plan, inspect = lstatSync) {
  for (const [check, paths] of [['owned-leaf', plan.leaves], ['shortcut', plan.shortcuts], ['check-only', plan.checkOnlyLeaves]]) {
    for (const [index, path] of paths.entries()) {
      let ancestorDepth = 0;
      for (let cursor = path; ; cursor = win32.dirname(cursor), ancestorDepth++) {
        const context = { engine: 'node', passed: false, check, index, ancestorDepth };
        try {
          const info = inspect(cursor);
          if (info.isSymbolicLink()) return { ...context, reason: 'reparse' };
          if (cursor === path) return { ...context, reason: 'existing-state' };
        } catch (error) {
          const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
          if (code !== 'ENOENT') return { ...context, reason: 'api-error', code: PREREQUISITE_CODES.has(code) ? code : 'unknown' };
        }
        if (cursor === win32.dirname(cursor)) break;
      }
    }
  }
  return { engine: 'node', passed: true, pristine: true, check: 'complete', reason: 'clear',
    nativeLeavesChecked: plan.leaves.length, shortcutsChecked: plan.shortcuts.length, checkOnlyLeavesChecked: plan.checkOnlyLeaves.length };
}

export function assertNativePristineLeaves(plan) {
  assert.equal(safeNativePrerequisite(inspectNativePristineLeaves(plan), 'node', plan).passed, true, 'Native filesystem prerequisites failed.');
}

export function verifyNativePrerequisites(plan, inspectLeaves, inspectWindows, record) {
  let node = { engine: 'node', passed: false, check: 'input', reason: 'api-error' };
  record('node', node);
  try { node = safeNativePrerequisite(inspectLeaves(), 'node', plan); } catch { /* Keep a fixed unknown API classification. */ }
  record('node', node);
  assert.equal(node.passed, true, 'Native filesystem prerequisites failed.');
  let windows = { engine: 'powershell', passed: false, check: 'powershell-launch', reason: 'api-error' };
  record('powershell', windows);
  try { windows = safeNativePrerequisite(inspectWindows(), 'powershell', plan); } catch { /* No command text, raw error or private value is retained. */ }
  record('powershell', windows);
  assert.equal(windows.passed, true, 'Native Windows prerequisites failed.');
  return windows;
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
function New-NativePrerequisite($check){return [ordered]@{engine='powershell';passed=$false;check=$check;reason='api-error'}}
function Get-NativeVariableClass($name){
 switch -Regex ($name){
  '^OPENWORK_' {return 'openwork-prefix'} '^OPENCODE_' {return 'opencode-prefix'} '^XDG_' {return 'xdg-prefix'}
  '^VITE_OPENWORK_' {return 'vite-openwork-prefix'} '^ELECTRON_' {return 'electron-prefix'} '^ZENO_API_ORIGIN$' {return 'zeno-api-origin'}
  '^NODE_OPTIONS$' {return 'node-options'} '^NODE_PATH$' {return 'node-path'} '^ANTHROPIC_API_KEY$' {return 'anthropic-api-key'}
  '^OPENAI_API_KEY$' {return 'openai-api-key'} '^MODELHELM_API_KEY$' {return 'modelhelm-api-key'}
 }
 throw 'Unknown prerequisite classification'
}
$result=New-NativePrerequisite 'input'
try {
 ${wireInput}
 $pattern='^(?:OPENWORK_|OPENCODE_|XDG_|VITE_OPENWORK_|ELECTRON_|ZENO_API_ORIGIN$|NODE_OPTIONS$|NODE_PATH$|ANTHROPIC_API_KEY$|OPENAI_API_KEY$|MODELHELM_API_KEY$)'
 foreach($scope in @('Process','User','Machine')){
  $result=New-NativePrerequisite 'environment';$result['scope']=$scope.ToLowerInvariant();$result['variable']='enumeration'
  foreach($entry in [Environment]::GetEnvironmentVariables($scope).GetEnumerator()){
   if($entry.Key -match $pattern -and [string]$entry.Value -ne ''){$result['variable']=Get-NativeVariableClass $entry.Key;$result['reason']='scoped-environment';throw 'Prerequisite rejected'}
  }
  foreach($pair in @(@('APPDATA','roaming'),@('LOCALAPPDATA','local'),@('ProgramData','programData'))){
   $result=New-NativePrerequisite 'known-folder-environment';$result['scope']=$scope.ToLowerInvariant();$result['variable']=$pair[0].ToLowerInvariant()
   $configured=[Environment]::GetEnvironmentVariable($pair[0],$scope)
   if($configured){$expanded=[Environment]::ExpandEnvironmentVariables($configured);if($expanded -notmatch '^[A-Za-z]:[\\\\/]' -or -not [string]::Equals([IO.Path]::GetFullPath($expanded),$v.roots.($pair[1]),[StringComparison]::OrdinalIgnoreCase)){$result['reason']='known-folder-mismatch';throw 'Prerequisite rejected'}}
  }
 }
 $groups=@([pscustomobject]@{check='owned-leaf';paths=@($v.leaves)},[pscustomobject]@{check='shortcut';paths=@($v.shortcuts)},[pscustomobject]@{check='check-only';paths=@($v.checkOnlyLeaves)})
 foreach($group in $groups){for($nativeIndex=0;$nativeIndex -lt $group.paths.Count;$nativeIndex++){
  $path=$group.paths[$nativeIndex];$result=New-NativePrerequisite $group.check;$result['index']=$nativeIndex;$depth=0
  for($cursor=$path;$cursor;$cursor=[IO.Path]::GetDirectoryName($cursor)){
   $result['ancestorDepth']=$depth;$depth++
   if(Test-Path -LiteralPath $cursor){$item=Get-Item -LiteralPath $cursor -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){$result['reason']='reparse';throw 'Prerequisite rejected'};if($cursor -eq $path){$result['reason']='existing-state';throw 'Prerequisite rejected'}}
  }
 }}
 $result=New-NativePrerequisite 'process'
 $names=@($v.identity.executableName,'OpenWork.exe','opencode.exe','opencode2.exe')
 $processCount=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object{$names -contains $_.Name}).Count
 if($processCount -ne 0){$result['processCount']=[Math]::Min(512,$processCount);$result['countCapped']=$processCount -gt 512;$result['reason']='existing-process';throw 'Prerequisite rejected'}
 $hives=@([pscustomobject]@{name='current-user';value=[Microsoft.Win32.RegistryHive]::CurrentUser},[pscustomobject]@{name='local-machine';value=[Microsoft.Win32.RegistryHive]::LocalMachine})
 $views=@([pscustomobject]@{name='registry32';value=[Microsoft.Win32.RegistryView]::Registry32},[pscustomobject]@{name='registry64';value=[Microsoft.Win32.RegistryView]::Registry64})
 foreach($hive in $hives){foreach($view in $views){
  $result=New-NativePrerequisite 'registry';$result['hive']=$hive.name;$result['view']=$view.name;$result['registryKind']='enumeration'
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive.value,$view.value)
  try {
   $keys=@([pscustomobject]@{kind='app-guid';key=('Software\\'+$v.identity.appGuid)},[pscustomobject]@{kind='app-id';key=('Software\\'+$v.identity.appId)},[pscustomobject]@{kind='uninstall';key=('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$v.identity.appGuid)},[pscustomobject]@{kind='protocol';key=('Software\\Classes\\'+$v.identity.protocol)},[pscustomobject]@{kind='app-user-model-id';key=('Software\\Classes\\AppUserModelId\\'+$v.identity.appId)},[pscustomobject]@{kind='product-association';key=('Software\\Classes\\Applications\\'+$v.identity.executableName)},[pscustomobject]@{kind='legacy-association';key='Software\\Classes\\Applications\\OpenWork.exe'})
   foreach($key in $keys){
    $result=New-NativePrerequisite 'registry';$result['hive']=$hive.name;$result['view']=$view.name;$result['registryKind']=$key.kind
    $found=$base.OpenSubKey($key.key);if($null -ne $found){$found.Dispose();$result['reason']='existing-registration';throw 'Prerequisite rejected'}
   }
  } finally {$base.Dispose()}
 }}
 $result=[ordered]@{engine='powershell';passed=$true;check='complete';reason='clear';pristine=$true;environmentScopesChecked=3;registryViewsChecked=4;nativeLeavesChecked=@($v.leaves).Count;shortcutsChecked=@($v.shortcuts).Count;checkOnlyLeavesChecked=@($v.checkOnlyLeaves).Count}
} catch { }
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
