/** Original Zeno 2D movement illustration; no upstream visual or generated video is used. */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const colors = { ink: '#24464a', edge: '#18363b', cream: '#f4eadb', lime: '#d1e66e', floor: '#e9eddf', background: '#f7f3e9' };
const radians = degrees => degrees * Math.PI / 180;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const p = clamp(value); return p * p * (3 - 2 * p); };
const f = value => value.toFixed(3);

export function jumpingJackProgress(timeSeconds) {
  const phase = ((timeSeconds % 4) + 4) % 4 / 4;
  return phase < .05 ? 0 : phase < .4 ? smooth((phase - .05) / .35) : phase < .55 ? 1 : phase < .9 ? 1 - smooth((phase - .55) / .35) : 0;
}

export function jumpingJackSvg(progress) {
  const p = clamp(progress);
  const legAngle = radians(30 * p);
  const drop = 97 * (1 - Math.cos(legAngle));
  const lift = 12 * Math.sin(Math.PI * p);
  const offset = drop - lift;
  const leftFoot = [486 - 97 * Math.sin(legAngle), 389 + 97 * Math.cos(legAngle)];
  const rightFoot = [1024 - leftFoot[0], leftFoot[1]];
  const leftKnee = [(486 + leftFoot[0]) / 2 - 2, (389 + leftFoot[1]) / 2];
  const rightKnee = [1024 - leftKnee[0], leftKnee[1]];
  const armAngle = radians(100 + 155 * p);
  const leftHand = [460 + 168 * Math.cos(armAngle), 276 + 168 * Math.sin(armAngle)];
  const leftElbow = [460 + 84 * Math.cos(armAngle), 276 + 84 * Math.sin(armAngle)];
  const rightHand = [1024 - leftHand[0], leftHand[1]];
  const rightElbow = [1024 - leftElbow[0], leftElbow[1]];
  const line = points => points.map(point => point.map(f).join(',')).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576" viewBox="0 0 1024 576" role="img" aria-labelledby="title description">
<title id="title">开合跳：原创动作图解</title>
<desc id="description">双臂由体侧经侧方伸直到头顶上方，同时双脚跳开；随后双臂下落、双脚合拢。图解循环，人物与地面始终完整可见。</desc>
<rect width="1024" height="576" fill="${colors.background}"/>
<path d="M0 486H1024V576H0Z" fill="${colors.floor}"/>
<ellipse cx="512" cy="505" rx="${f(100 + 28 * p)}" ry="9" fill="${colors.ink}" opacity="${f(.1 - .04 * Math.sin(Math.PI * p))}"/>
<g transform="translate(0 ${f(offset)})">
<path d="M562 390C605 408 639 421 670 414C681 412 681 422 670 431C645 452 596 448 557 426Z" fill="${colors.ink}"/>
<g fill="none" stroke="${colors.ink}" stroke-width="35" stroke-linecap="round" stroke-linejoin="round">
<polyline points="${line([[486,389],leftKnee,leftFoot])}"/>
<polyline points="${line([[538,389],rightKnee,rightFoot])}"/>
</g>
<ellipse cx="${f(leftFoot[0])}" cy="${f(leftFoot[1] + 6)}" rx="26" ry="15" fill="${colors.ink}"/>
<ellipse cx="${f(rightFoot[0])}" cy="${f(rightFoot[1] + 6)}" rx="26" ry="15" fill="${colors.ink}"/>
<g fill="none" stroke="${colors.ink}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
<polyline points="${line([[460,276],leftElbow,leftHand])}"/>
<polyline points="${line([[564,276],rightElbow,rightHand])}"/>
</g>
<ellipse cx="${f(leftHand[0])}" cy="${f(leftHand[1])}" rx="16" ry="18" fill="${colors.ink}"/>
<ellipse cx="${f(rightHand[0])}" cy="${f(rightHand[1])}" rx="16" ry="18" fill="${colors.ink}"/>
<ellipse cx="512" cy="350" rx="67" ry="93" fill="${colors.ink}"/>
<ellipse cx="512" cy="351" rx="43" ry="73" fill="${colors.cream}"/>
<path d="M463 286L560 388" stroke="${colors.lime}" stroke-width="15" stroke-linecap="round"/>
<g transform="translate(522 348) rotate(45)"><rect x="-13" y="-14" width="26" height="28" rx="5" fill="${colors.lime}"/><path d="M-6-6H6L-6 6H6" fill="none" stroke="${colors.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>
<circle cx="466" cy="161" r="20" fill="${colors.ink}"/><circle cx="558" cy="161" r="20" fill="${colors.ink}"/>
<circle cx="466" cy="161" r="11" fill="${colors.edge}"/><circle cx="558" cy="161" r="11" fill="${colors.edge}"/>
<ellipse cx="512" cy="210" rx="62" ry="63" fill="${colors.ink}"/>
<ellipse cx="512" cy="236" rx="45" ry="29" fill="${colors.cream}"/>
<ellipse cx="489" cy="205" rx="6" ry="8" fill="${colors.edge}"/><ellipse cx="535" cy="205" rx="6" ry="8" fill="${colors.edge}"/>
<circle cx="487" cy="202" r="2" fill="${colors.cream}"/><circle cx="533" cy="202" r="2" fill="${colors.cream}"/>
<ellipse cx="512" cy="226" rx="11" ry="8" fill="${colors.edge}"/>
<path d="M512 233V239M512 239Q504 246 496 240M512 239Q520 246 528 240" fill="none" stroke="${colors.edge}" stroke-width="2" stroke-linecap="round"/>
<g stroke="${colors.edge}" stroke-width="1.5" stroke-linecap="round"><path d="M476 233L450 226M476 239L447 240M548 233L574 226M548 239L577 240"/></g>
</g></svg>`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Pass one new output directory for original frames.');
  const directory = resolve(process.argv[2]);
  mkdirSync(directory, { recursive: true });
  if (readdirSync(directory).length) throw new Error('Refusing to overwrite existing frames.');
  for (let frame = 0; frame < 192; frame++) writeFileSync(resolve(directory, String(frame).padStart(5, '0') + '.svg'), jumpingJackSvg(jumpingJackProgress(frame / 24)));
  writeFileSync(resolve(directory, 'poster.svg'), jumpingJackSvg(1));
}
