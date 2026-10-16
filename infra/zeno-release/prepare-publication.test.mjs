import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { preparePublication } from './prepare-publication.mjs';

async function fixture(t, version = '1.0.0') {
  const input = await mkdtemp(join(tmpdir(), 'zeno-publication-'));
  t.after(() => rm(input, { recursive: true, force: true }));
  const platforms = [];
  for (const platform of ['darwin', 'win32', 'linux']) for (const arch of ['x64', 'arm64']) {
    const manifest = platform === 'darwin' ? 'latest-mac.yml' : platform === 'win32' ? 'latest.yml' : `latest-linux${arch === 'arm64' ? '-arm64' : ''}.yml`;
    const manifestAsset = `zeno-${platform}-${arch}-${manifest}`;
    const extensions = platform === 'darwin' ? ['dmg', 'zip'] : platform === 'win32' ? ['exe'] : ['AppImage', 'deb'];
    const feedUrl = `https://www.zeno.ryan-wong.cn/updates/${platform}/${arch}/`;
    const files = [];
    for (const name of [...extensions.map(ext => `zeno-${platform}-${arch}-${version}.${ext}`), manifest]) {
      const bytes = Buffer.from(`${platform}/${arch}/${name}`);
      await writeFile(join(input, name === manifest ? manifestAsset : name), bytes);
      files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), sha512: createHash('sha512').update(bytes).digest('base64'), url: feedUrl + name });
    }
    platforms.push({ version, platform, arch, feedUrl, manifest, manifestAsset, files, signing: platform === 'darwin' ? 'self-signed' : 'unsigned', updatesEnabled: true });
  }
  const release = { version, platforms };
  const save = () => writeFile(join(input, 'zeno-release.json'), JSON.stringify(release));
  await save();
  return { input, output: join(input, 'publication'), release, save };
}
const date = '2026-10-16T00:00:00.000Z';
test('publishes ten verified installers and all six native feeds without copying package bytes twice', async t => {
  const f = await fixture(t);
  const result = await preparePublication(f.input, f.output, date);
  assert.equal(result.artifacts.length, 10);
  const artifact = result.artifacts[0];
  assert.equal(artifact.signature, 'self-signed');
  assert.deepEqual(await readFile(join(f.output, 'updates', artifact.platform, artifact.arch, artifact.name)), await readFile(join(f.output, artifact.url)));
  assert.equal(JSON.parse(await readFile(join(f.output, 'api/releases/latest.json'))).publishedAt, date);
});
test('rejects tampered package bytes before creating a publication', async t => {
  const f = await fixture(t);
  await writeFile(join(f.input, f.release.platforms[0].files[0].name), 'modified');
  await assert.rejects(preparePublication(f.input, f.output, date), /mismatch/);
});
test('rejects missing targets and mismatched signing/update eligibility', async t => {
  const f = await fixture(t);
  f.release.platforms.pop(); await f.save();
  await assert.rejects(preparePublication(f.input, f.output, date), /metadata/);
  f.release.platforms.push(f.release.platforms[0]); await f.save();
  await assert.rejects(preparePublication(f.input, f.output, date), /target/);
  f.release.platforms[0].updatesEnabled = false; await f.save();
  await assert.rejects(preparePublication(f.input, f.output, date), /target/);
});
test('rejects paths and foreign update origins', async t => {
  const f = await fixture(t);
  f.release.platforms[0].files[0].name = '../outside'; await f.save();
  await assert.rejects(preparePublication(f.input, f.output, date), /file/);
  f.release.platforms[0].feedUrl = 'https://example.com/'; await f.save();
  await assert.rejects(preparePublication(f.input, f.output, date), /target/);
});
test('a patch release carries its own notes and cannot reuse the initial-release announcement', async t => {
  const f = await fixture(t, '1.0.1');
  await assert.rejects(preparePublication(f.input, f.output, date), /release notes/);
  f.release.notes = ['修复独立模型网关的任务标题生成。'];
  await f.save();
  const result = await preparePublication(f.input, f.output, date);
  assert.equal(result.version, '1.0.1');
  assert.deepEqual(result.notes, f.release.notes);
});
