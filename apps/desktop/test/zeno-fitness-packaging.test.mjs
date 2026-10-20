import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFitnessVisualPackaging } from '../scripts/verify-fitness-packaging.mjs';

test('packaged fitness media must include every source video/poster pair and unchanged bytes', () => {
  const resources = mkdtempSync(join(tmpdir(), 'zeno-media-package-'));
  try {
    const destination = join(resources, 'app-dist', 'zeno', 'fitness');
    mkdirSync(destination, { recursive: true });
    const source = fileURLToPath(new URL('../../app/public/zeno/fitness/', import.meta.url));
    cpSync(source, destination, { recursive: true });
    const result = verifyFitnessVisualPackaging({ resources });
    assert.equal(result.passed, true); assert.equal(result.files.length, readdirSync(source).length);
    assert.equal(result.demonstrations, readdirSync(source).filter(name => name.endsWith('.mp4')).length);
    assert.ok(result.demonstrations >= 3);
    writeFileSync(join(destination, 'stale.mp4'), 'unreferenced media');
    assert.throws(() => verifyFitnessVisualPackaging({ resources }), { message: 'Packaged fitness demonstration media contains an unexpected file.' });
    rmSync(join(destination, 'stale.mp4'));
    writeFileSync(join(destination, 'curl.mp4'), 'corrupt media');
    assert.throws(() => verifyFitnessVisualPackaging({ resources }), { message: 'Packaged fitness demonstration media differs from the frozen source.' });
    rmSync(join(destination, 'curl.mp4'));
    assert.throws(() => verifyFitnessVisualPackaging({ resources }), { message: 'Packaged fitness demonstration media is missing.' });
  } finally { rmSync(resources, { recursive: true, force: true }); }
});
