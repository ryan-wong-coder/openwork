import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultArch, detectPlatform, formatBytes, parseRelease, selectArtifact } from '../src/releases.js';
const origin = 'https://www.zeno.ryan-wong.cn';
const artifact = (platform, arch, format) => ({ platform, arch, format, name: `zeno-${platform}-${arch}-1.0.0.${format}`, url: `/downloads/1.0.0/zeno-${platform}-${arch}-1.0.0.${format}`, size: 123456789, sha256: 'a'.repeat(64), sha512: 'b'.repeat(128), signature: 'unsigned' });
const release = artifacts => ({ version: '1.0.0', publishedAt: '2026-10-16T00:00:00.000Z', notes: ['首个版本'], artifacts });
test('desktop detection never guesses Mac architecture or treats a phone as a desktop', () => {
  assert.equal(detectPlatform({ platform: 'MacIntel' }), 'darwin');
  assert.equal(defaultArch('darwin'), null);
  assert.equal(detectPlatform({ platform: 'Win32' }), 'win32');
  assert.equal(defaultArch('win32'), 'x64');
  assert.equal(detectPlatform({ userAgent: 'X11; Linux x86_64' }), 'linux');
  assert.equal(defaultArch('linux'), 'x64');
  assert.equal(detectPlatform({ userAgent: 'iPhone; CPU iPhone OS like Mac OS X', platform: 'iPhone' }), null);
  assert.equal(detectPlatform({ userAgent: 'Linux; Android 15' }), null);
});
test('only published combinations produce links, with a platform-appropriate real format', () => {
  const value = parseRelease(release([artifact('darwin', 'arm64', 'zip'), artifact('darwin', 'arm64', 'dmg'), artifact('win32', 'x64', 'exe')]), origin);
  assert.equal(selectArtifact(value, 'darwin', null), null);
  assert.equal(selectArtifact(value, 'darwin', 'x64'), null);
  assert.equal(selectArtifact(value, 'linux', 'x64'), null);
  assert.equal(selectArtifact(value, 'darwin', 'arm64').format, 'dmg');
  assert.equal(selectArtifact(value, 'darwin', 'arm64', 'zip').format, 'zip');
  assert.equal(selectArtifact(value, 'win32', 'x64').url, value.artifacts[2].url);
});
test('an empty real release remains empty without invented packages', () => {
  const value = parseRelease(release([]), origin);
  assert.deepEqual(value.artifacts, []);
  assert.equal(selectArtifact(value, 'darwin', 'arm64'), null);
});
test('cross-origin, traversal, invalid hashes, size and inconsistent filenames fail closed', () => {
  for (const override of [{ url: 'https://external.invalid/download.exe' }, { url: '//external.invalid/download' }, { url: '/downloads/1.0.0/../../secret' }, { sha256: 'short' }, { sha512: 'short' }, { size: 0 }, { name: 'different.dmg' }, { platform: 'unknown' }, { arch: 'unknown' }, { format: 'exe' }]) assert.throws(() => parseRelease(release([{ ...artifact('darwin', 'arm64', 'dmg'), ...override }]), origin));
});
test('release metadata must be well formed and sizes are actual binary values', () => {
  assert.throws(() => parseRelease({ artifacts: [] }, origin));
  assert.throws(() => parseRelease({ ...release([]), publishedAt: 'not-a-date' }, origin));
  assert.equal(formatBytes(1024), '1 KiB');
  assert.equal(formatBytes(1024 ** 2 * 3), '3 MiB');
  assert.equal(formatBytes(0), '—');
});
