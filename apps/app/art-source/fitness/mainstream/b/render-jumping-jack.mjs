/** Rasterize only the adjacent original SVG source; no model or network calls. */
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jumpingJackProgress, jumpingJackSvg } from './jumping-jack-diagram.mjs';

const require = process.env.ZENO_RENDER_NODE_MODULES
  ? createRequire(join(process.env.ZENO_RENDER_NODE_MODULES, 'package.json')) : createRequire(import.meta.url);
const sharp = require('sharp');
const directory = process.argv[2];
assert.ok(process.argv.length === 3 && typeof directory === 'string' && isAbsolute(directory));
mkdirSync(directory, { recursive: true });
assert.equal(readdirSync(directory).length, 0, 'Refusing to overwrite existing rendered frames.');
assert.equal(jumpingJackProgress(0), 0);
assert.equal(jumpingJackProgress(2), 1);
assert.equal(jumpingJackProgress(4), 0);
assert.equal(jumpingJackProgress(8), 0);
for (let frame = 0; frame < 192; frame++) {
  const svg = jumpingJackSvg(jumpingJackProgress(frame / 24));
  await sharp(Buffer.from(svg)).png().toFile(join(directory, String(frame).padStart(5, '0') + '.png'));
}
const open = jumpingJackSvg(1);
writeFileSync(join(directory, 'jumping-jack-open.svg'), open);
writeFileSync(join(directory, 'jumping-jack-closed.svg'), jumpingJackSvg(0));
await sharp(Buffer.from(jumpingJackSvg(0))).png().toFile(join(directory, 'poster.png'));
const run = (command, args) => assert.equal(spawnSync(command, args, { stdio: 'pipe' }).status, 0, command + ' failed.');
run('ffmpeg', ['-y', '-v', 'error', '-framerate', '24', '-i', join(directory, '%05d.png'), '-frames:v', '192', '-c:v', 'libx264', '-crf', '22', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(directory, 'jumping-jack.mp4')]);
run('cwebp', ['-quiet', '-q', '85', join(directory, 'poster.png'), '-o', join(directory, 'jumping-jack-poster.webp')]);
run('ffmpeg', ['-y', '-v', 'error', '-i', join(directory, 'jumping-jack.mp4'), '-vf', 'fps=1,scale=320:-2,tile=4x2', '-frames:v', '1', '-q:v', '2', join(directory, 'jumping-jack-diagram-contact.jpg')]);
run('ffmpeg', ['-v', 'error', '-i', join(directory, 'jumping-jack.mp4'), '-f', 'null', '-']);
console.log(JSON.stringify({ canonicalExerciseId: '3094', kind: 'diagram', frames: 192, fps: 24, seconds: 8, fullDecode: true }));
