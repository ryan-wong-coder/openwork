import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertPublicMediaBytes, assertPublicVideoRange, completedPublicMedia, publicMediaQaTarget } from '../scripts/qa-public-mainstream-media.mjs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const snapshot = {
  selection: readJson('../../app/art-source/fitness/mainstream/selection.json'),
  provenance: readJson('../../app/art-source/fitness/provenance.json'),
  demonstrations: readJson('../../app/src/react-app/domains/zeno/mascot-demos.json'),
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('public media QA separates explicit stable-release evidence without changing the historical default', () => {
  const previous = publicMediaQaTarget(); const next = publicMediaQaTarget(['--version', '1.1.3']);
  assert.equal(previous.version, '1.1.2'); assert.equal(next.version, '1.1.3');
  assert.ok(previous.output.endsWith('/docs/evidence/zeno-1.1.2/mainstream/public-media'));
  assert.ok(next.output.endsWith('/docs/evidence/zeno-1.1.3/mainstream/public-media'));
  assert.ok(next.deployment.endsWith('/docs/evidence/zeno-1.1.3/mainstream/deployment.json'));
  assert.notEqual(previous.output, next.output);
  assert.notEqual(previous.deployment, next.deployment);
});

test('public media QA rejects unsafe versions and origin, profile or output overrides before side effects', () => {
  for (const version of ['', 'v1.1.3', '1.1', '01.1.3', '1.1.3-beta', '../outside', '1.1.3/../../outside', '1.1.3\n', 'https://outside.invalid']) assert.throws(() => publicMediaQaTarget(['--version', version]));
  for (const args of [['--version'], ['--origin', 'https://outside.invalid'], ['--profile', 'fixture'], ['--output', '../outside'], ['--version', '1.1.3', '--output', '../outside']]) assert.throws(() => publicMediaQaTarget(args));
});

test('all completed runtime media enter acceptance while the original 32 identities remain present', () => {
  const media = completedPublicMedia(snapshot); const count = snapshot.demonstrations.length;
  assert.ok(count > snapshot.selection.selectedCanonicalCount, 'The expanded catalogue must not be truncated to the original baseline.');
  assert.equal(media.length, count * 2); assert.equal(media.filter(asset => asset.kind === 'video').length, count);
  assert.equal(media.filter(asset => asset.kind === 'poster').length, count);
  assert.deepEqual([...new Set(media.map(asset => asset.id))].sort(), snapshot.demonstrations.map(item => item.exerciseId).sort());
  for (const item of snapshot.demonstrations) {
    assert.equal(media.find(asset => asset.id === item.exerciseId && asset.kind === 'video').path, `/app/zeno/fitness/${item.stem}.mp4`);
    assert.equal(media.find(asset => asset.id === item.exerciseId && asset.kind === 'poster').path, `/app/zeno/fitness/${item.stem}-poster.webp`);
  }
});

test('missing, duplicate, substituted, unreviewed or unsafe-path media fail the complete ready mapping gate', () => {
  const withoutProvenance = structuredClone(snapshot); withoutProvenance.provenance.assets.pop();
  const duplicateIdentity = structuredClone(snapshot); duplicateIdentity.demonstrations[1].exerciseId = duplicateIdentity.demonstrations[0].exerciseId;
  const substitutedEnglish = structuredClone(snapshot); substitutedEnglish.provenance.assets[0].englishName += ' other technique';
  const missingBaseline = structuredClone(snapshot); missingBaseline.provenance.assets.shift(); missingBaseline.demonstrations.shift();
  const unreviewed = structuredClone(snapshot); unreviewed.provenance.assets.at(-1).manualFrameReview.reviewed = false;
  const unsafePath = structuredClone(snapshot); unsafePath.provenance.assets[0].video.file = 'apps/app/public/zeno/fitness/../private.mp4';
  const duplicateFootage = structuredClone(snapshot); duplicateFootage.provenance.assets[1].video.sha256 = duplicateFootage.provenance.assets[0].video.sha256;
  for (const invalid of [withoutProvenance, duplicateIdentity, substitutedEnglish, missingBaseline, unreviewed, unsafePath, duplicateFootage]) assert.throws(() => completedPublicMedia(invalid));
});

test('HTTP 200 HTML fallback and damaged or truncated bytes cannot count as a delivered video', () => {
  const bytes = Buffer.alloc(2048, 0x5a);
  const asset = { kind: 'video', path: '/app/zeno/fitness/synthetic.mp4', id: '0000', bytes: bytes.length, sha256: sha256(bytes) };
  const response = contentType => new Response(null, { status: 200, headers: { 'content-type': contentType } });
  assert.equal(assertPublicMediaBytes(asset, { response: response('video/mp4'), bytes }, bytes).sha256, asset.sha256);
  assert.throws(() => assertPublicMediaBytes(asset, { response: response('text/html'), bytes }, bytes));
  assert.throws(() => assertPublicMediaBytes(asset, { response: response('video/mp4'), bytes: bytes.subarray(0, 1024) }, bytes));
  const damaged = Buffer.from(bytes); damaged[20] ^= 1;
  assert.throws(() => assertPublicMediaBytes(asset, { response: response('video/mp4'), bytes: damaged }, bytes));
  assert.throws(() => assertPublicMediaBytes(asset, { response: response('video/mp4'), bytes }, damaged));
  const poster = { ...asset, kind: 'poster', path: '/app/zeno/fitness/synthetic-poster.webp' };
  assert.equal(assertPublicMediaBytes(poster, { response: response('image/webp'), bytes }, bytes).contentType, 'image/webp');
  assert.throws(() => assertPublicMediaBytes(poster, { response: response('video/mp4'), bytes }, bytes));
});

test('video Range acceptance requires exact 206 bytes, MIME and declared total', () => {
  const local = Buffer.alloc(2048, 0x5a); const bytes = local.subarray(0, 1024); const asset = { bytes: local.length };
  const response = (status = 206, type = 'video/mp4', range = 'bytes 0-1023/2048') => new Response(null, { status, headers: { 'content-type': type, 'content-range': range } });
  assert.equal(assertPublicVideoRange(asset, { response: response(), bytes }, local).bytesMatched, true);
  assert.throws(() => assertPublicVideoRange(asset, { response: response(200), bytes }, local));
  assert.throws(() => assertPublicVideoRange(asset, { response: response(206, 'text/html'), bytes }, local));
  assert.throws(() => assertPublicVideoRange(asset, { response: response(206, 'video/mp4', 'bytes 0-1023/2049'), bytes }, local));
  assert.throws(() => assertPublicVideoRange(asset, { response: response(), bytes: bytes.subarray(0, 1000) }, local));
  const changed = Buffer.from(bytes); changed[100] ^= 1;
  assert.throws(() => assertPublicVideoRange(asset, { response: response(), bytes: changed }, local));
});
