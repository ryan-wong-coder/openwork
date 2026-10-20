/** Original Zeno lunge geometry, adapted from the original 0612 vector scene.
 * Adds a separate stepping phase and a fixed rear-toe contact point; no source
 * exercise photograph, animation or video is used to produce these frames.
 * Requires sharp, ffmpeg and cwebp; use ZENO_RENDER_NODE_MODULES for bundled sharp.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = process.env.ZENO_RENDER_NODE_MODULES
  ? createRequire(join(process.env.ZENO_RENDER_NODE_MODULES, 'package.json')) : createRequire(import.meta.url);
const sharp = require('sharp');
const output = process.argv[2];
assert.ok(typeof output === 'string' && isAbsolute(output), 'An absolute output directory is required.');
mkdirSync(output, { recursive: true });

const standing = {
  head: [122, 39], shoulder: [118, 64], hip: [112, 125], elbow: [136, 94], hand: [115, 116],
  knee: [119, 170], ankle: [127, 211], toe: [147, 213],
  farElbow: [105, 95], farHand: [104, 117], farKnee: [100, 171], farAnkle: [94, 211], farToe: [111, 213],
};
const stepped = {
  head: [151, 59], shoulder: [147, 84], hip: [139, 145], elbow: [164, 114], hand: [143, 136],
  knee: [172, 175], ankle: [206, 211], toe: [226, 213],
  farElbow: [135, 115], farHand: [132, 138], farKnee: [117, 177], farAnkle: [94, 211], farToe: [111, 213],
};
const lowered = {
  head: [162, 74], shoulder: [159, 99], hip: [151, 160], elbow: [177, 129], hand: [154, 151],
  knee: [205, 166], ankle: [206, 211], toe: [226, 213],
  farElbow: [147, 130], farHand: [143, 152], farKnee: [143, 203], farAnkle: [100, 193], farToe: [111, 213],
};
const smooth = value => value * value * (3 - 2 * value);
function interpolate(from, to, progress) {
  const ratio = smooth(Math.max(0, Math.min(1, progress)));
  return Object.fromEntries(Object.keys(from).map(key => [key, [
    from[key][0] + (to[key][0] - from[key][0]) * ratio,
    from[key][1] + (to[key][1] - from[key][1]) * ratio,
  ]]));
}
function posture(time) {
  const cycle = time / 8;
  let pose;
  if (cycle < .08) pose = standing;
  else if (cycle < .25) {
    const progress = (cycle - .08) / .17;
    pose = interpolate(standing, stepped, progress);
    // The leading foot clears the ground during its forward step. Rear toes
    // remain at the exact same contact point for the entire repetition.
    const clearance = Math.sin(Math.PI * progress) * 17;
    pose.ankle[1] -= clearance; pose.toe[1] -= clearance;
  } else if (cycle < .46) pose = interpolate(stepped, lowered, (cycle - .25) / .21);
  else if (cycle < .56) pose = lowered;
  else if (cycle < .77) pose = interpolate(lowered, stepped, (cycle - .56) / .21);
  else if (cycle < .96) {
    const progress = (cycle - .77) / .19;
    pose = interpolate(stepped, standing, progress);
    const clearance = Math.sin(Math.PI * progress) * 17;
    pose.ankle[1] -= clearance; pose.toe[1] -= clearance;
  } else pose = standing;
  for (const [x, y] of Object.values(pose)) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= 60 && x <= 240 && y >= 20 && y <= 216);
  }
  assert.deepEqual(pose.farToe, [111, 213]);
  if (cycle >= .25 && cycle <= .77) { assert.deepEqual(pose.ankle, [206, 211]); assert.deepEqual(pose.toe, [226, 213]); }
  return pose;
}
const points = (...values) => values.map(point => point.join(',')).join(' ');
function frame(time) {
  const body = posture(time);
  const farShoulder = [body.shoulder[0] - 8, body.shoulder[1]];
  const farHip = [body.hip[0] - 8, body.hip[1]];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576" viewBox="0 0 426.6666667 240">
<rect width="426.6666667" height="240" fill="#f7f5ed"/>
<g transform="translate(53.3333333 0)">
<path d="M48 216H272" stroke="#d9dfd5" stroke-width="1.5" stroke-linecap="round"/>
<g fill="none" stroke="#6f8c87" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
<polyline points="${points(farShoulder, body.farElbow, body.farHand)}"/>
<polyline points="${points(farHip, body.farKnee, body.farAnkle, body.farToe)}"/>
</g>
<g fill="none" stroke="#254b4d" stroke-linecap="round" stroke-linejoin="round">
<path d="M${body.head.join(' ')}L${body.shoulder.join(' ')}" stroke-width="9"/>
<path d="M${body.shoulder.join(' ')}L${body.hip.join(' ')}" stroke-width="19"/>
<polyline points="${points(body.hip, body.knee, body.ankle, body.toe)}" stroke-width="9"/>
<polyline points="${points(body.shoulder, body.elbow, body.hand)}" stroke-width="8"/>
<circle cx="${body.head[0]}" cy="${body.head[1]}" r="11" fill="#254b4d" stroke="none"/>
<path d="M${body.shoulder[0] - 4} ${body.shoulder[1] + 7}L${body.hip[0] + 5} ${body.hip[1] - 13}" stroke="#accb65" stroke-width="4"/>
</g></g></svg>`;
}
for (let index = 0; index < 192; index++) {
  const svg = frame(index / 24);
  await sharp(Buffer.from(svg)).png().toFile(join(output, String(index).padStart(5, '0') + '.png'));
}
writeFileSync(join(output, 'lunge-diagram-start.svg'), frame(0));
writeFileSync(join(output, 'lunge-diagram-lowered.svg'), frame(4));
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, command + ' failed.');
}
run('ffmpeg', ['-y', '-v', 'error', '-framerate', '24', '-i', join(output, '%05d.png'), '-frames:v', '192',
  '-c:v', 'libx264', '-crf', '26', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(output, 'lunge.mp4')]);
run('cwebp', ['-q', '86', join(output, '00000.png'), '-o', join(output, 'lunge-poster.webp')]);
run('ffmpeg', ['-y', '-v', 'error', '-i', join(output, 'lunge.mp4'), '-vf', 'fps=1,scale=384:-2,tile=4x2', '-frames:v', '1', join(output, 'lunge-diagram-contact.jpg')]);
run('ffmpeg', ['-v', 'error', '-i', join(output, 'lunge.mp4'), '-f', 'null', '-']);
console.log(JSON.stringify({ exerciseId: '0612', kind: 'diagram', renderedFrames: 192, fps: 24, seconds: 8, fullDecode: true }));
