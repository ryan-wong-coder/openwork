import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { resolveFeature } from '../../../packages/features/src/resolve.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const args = process.argv.slice(2).filter(value => value !== '--');
if (args.length && (args.length !== 2 || args[0] !== '--profile')) throw Error('Usage: build.mjs [--profile OPERATOR_PROFILE_JSON]');
let enabled;
if (args.length) {
  const profile = JSON.parse(await readFile(resolve(root, args[1]), 'utf8'));
  if (!profile || typeof profile !== 'object' || !profile.features || Object.keys(profile).some(key => key !== 'features') || Object.keys(profile.features).some(key => key !== 'zenoWebsiteRefresh') || typeof profile.features.zenoWebsiteRefresh !== 'boolean') throw Error('Invalid website operator profile');
  enabled = profile.features.zenoWebsiteRefresh;
}
const refreshed = resolveFeature('zenoWebsiteRefresh', { deployment: 'self_hosted', locks: enabled === undefined ? {} : { zenoWebsiteRefresh: enabled }, rollouts: {}, overrides: {} }).enabled;
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, refreshed ? 'src' : 'classic'), dist, { recursive: true });
await cp(join(root, 'public'), dist, { recursive: true, filter: source => !source.endsWith('-source.mp4') && !(source.includes('/static-v2/') && source.endsWith('.png')) && (refreshed || (!source.includes('/motion-v2') && !source.includes('/static-v2'))) });
if (refreshed) {
  const assets = {};
  for (const [key, file] of Object.entries({ welcome: 'welcome-v2.mp4', nod: 'nod-v2.mp4', logo: 'logo-reveal-v2.mp4', welcomeDark: 'welcome-dark-v2.mp4', nodDark: 'nod-dark-v2.mp4' })) {
    const path = join(root, 'public/assets/motion-v2', file);
    try { if ((await stat(path)).isFile()) assets[key] = `/assets/motion-v2/${file}`; } catch { /* A missing optional animation keeps its static fallback. */ }
  }
  await writeFile(join(dist, 'motion-config.js'), `export const motionAssets = ${JSON.stringify(assets)};\n`);
}
console.log(`Built ${dist}; zenoWebsiteRefresh=${refreshed}`);
