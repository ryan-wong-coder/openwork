import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseRelease } from '../../apps/zeno-site/src/releases.js';
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const YAML = require('yaml');
const origin = 'https://www.zeno.ryan-wong.cn';
async function request(path, options = {}) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
}
const home = await request('/');
assert.equal(home.status, 200); assert.match(home.headers.get('content-type'), /text\/html/);
const api = await request('/api/releases/latest.json');
assert.equal(api.status, 200); assert.match(api.headers.get('cache-control'), /no-store/);
const release = parseRelease(await api.json(), origin);
assert.equal(release.version, '1.0.0'); assert.equal(release.artifacts.length, 10);
const targets = new Set();
for (const artifact of release.artifacts) {
  targets.add(`${artifact.platform}/${artifact.arch}`);
  const head = await request(artifact.url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), artifact.size);
  assert.match(head.headers.get('content-disposition'), /attachment/); assert.match(head.headers.get('cache-control'), /immutable/);
  const range = await request(artifact.url, { headers: { Range: 'bytes=0-63' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-63/${artifact.size}`);
  const bytes = Buffer.from(await range.arrayBuffer()); assert.equal(bytes.length, 64);
  if (artifact.format === 'zip') assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304');
  if (artifact.format === 'exe') assert.equal(bytes.subarray(0, 2).toString(), 'MZ');
  if (artifact.format === 'deb') assert.equal(bytes.subarray(0, 8).toString(), '!<arch>\n');
  if (artifact.format === 'AppImage') {
    assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46'); assert.equal(bytes[4], 2);
    assert.equal(bytes.readUInt16LE(18), artifact.arch === 'arm64' ? 183 : 62);
  }
}
assert.equal(targets.size, 6);
for (const target of targets) {
  const [platform, arch] = target.split('/');
  const filename = platform === 'darwin' ? 'latest-mac.yml' : platform === 'win32' ? 'latest.yml' : `latest-linux${arch === 'arm64' ? '-arm64' : ''}.yml`;
  const response = await request(`/updates/${target}/${filename}`);
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const manifest = YAML.parse(await response.text());
  assert.equal(manifest.version, release.version); assert.ok(manifest.files.length > 0);
  for (const file of manifest.files) {
    const artifact = release.artifacts.find(item => item.platform === platform && item.arch === arch && item.name === file.url);
    assert.ok(artifact); assert.equal(file.size, artifact.size); assert.equal(file.sha512, artifact.sha512);
    const packageResponse = await request(`/updates/${target}/${encodeURIComponent(file.url)}`, { method: 'HEAD' });
    assert.equal(packageResponse.status, 200); assert.equal(Number(packageResponse.headers.get('content-length')), file.size);
  }
}
console.log(JSON.stringify({ passed: true, origin, version: release.version, installers: release.artifacts.length, nativeFeeds: targets.size, checks: ['https', 'download-head', 'range', 'native-file-headers', 'metadata-integrity-agreement', 'architecture-feed-files', 'cache-policy'] }));
