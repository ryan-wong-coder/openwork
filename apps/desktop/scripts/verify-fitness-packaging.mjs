import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../app/public/zeno/fitness/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verify actual installed media bytes independently of renderer source strings. */
export function verifyFitnessVisualPackaging({ resources }) {
  const names = readdirSync(source).sort();
  if (!names.length || names.some(name => !/^[a-z\d][a-z\d-]*(?:\.mp4|-poster\.webp)$/.test(name))) {
    throw new Error('Source fitness media contains an unsupported file.');
  }
  const videos = names.filter(name => name.endsWith('.mp4'));
  if (videos.length < 3 || names.length !== videos.length * 2 || videos.some(name => !names.includes(name.slice(0, -4) + '-poster.webp'))) {
    throw new Error('Every source fitness video must have exactly one poster.');
  }
  const destination = join(resources, 'app-dist', 'zeno', 'fitness');
  let packagedNames;
  try { packagedNames = readdirSync(destination).sort(); }
  catch { throw new Error('Packaged fitness demonstration media is missing.'); }
  if (names.some(name => !packagedNames.includes(name))) throw new Error('Packaged fitness demonstration media is missing.');
  if (packagedNames.some(name => !names.includes(name))) throw new Error('Packaged fitness demonstration media contains an unexpected file.');
  const files = [];
  for (const filename of names) {
    const expected = readFileSync(join(source, filename));
    let actual;
    try { actual = readFileSync(join(destination, filename)); }
    catch { throw new Error('Packaged fitness demonstration media is missing.'); }
    if (!actual.equals(expected)) throw new Error('Packaged fitness demonstration media differs from the frozen source.');
    files.push({ name: filename, bytes: actual.length, sha256: digest(actual) });
  }
  return { scope: 'all packaged fitness video/poster pairs read in full; no playback or native UI claim', passed: true, demonstrations: videos.length, files };
}
