import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../app/public/zeno/fitness/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verify actual installed media bytes independently of renderer source strings. */
export function verifyFitnessVisualPackaging({ resources }) {
  const files = [];
  for (const name of ['curl', 'squat', 'shoulder-press']) {
    for (const suffix of ['.mp4', '-poster.webp']) {
      const filename = name + suffix;
      const expected = readFileSync(join(source, filename));
      let actual;
      try { actual = readFileSync(join(resources, 'app-dist', 'zeno', 'fitness', filename)); }
      catch { throw new Error('Packaged fitness demonstration media is missing.'); }
      if (!actual.equals(expected)) throw new Error('Packaged fitness demonstration media differs from the frozen source.');
      files.push({ name: filename, bytes: actual.length, sha256: digest(actual) });
    }
  }
  return { scope: 'six packaged media files read in full; no playback or native UI claim', passed: true, files };
}
