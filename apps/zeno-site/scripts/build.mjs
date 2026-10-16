import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve, sep } from 'node:path';
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
const heroDirectory = join(root, 'public/assets/hero-film-v3');
const heroFiles = ['hero-worklife-v3.mp4', 'hero-worklife-v3-poster.webp', 'hero-worklife-v3-mobile.mp4', 'hero-worklife-v3-mobile-poster.webp'].map(file => join(heroDirectory, file));
// Validate before replacing dist. An unfinished scene film must never quietly
// ship the old standing-otter clip or erase the previous complete preview.
if (refreshed) for (const path of heroFiles) {
  try { if (!(await stat(path)).isFile() || (await stat(path)).size === 0) throw Error('Empty hero asset'); }
  catch { throw Error(`Cannot build Zeno website v3: required scene asset is not ready (${basename(path)}).`); }
}
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, refreshed ? 'src' : 'classic'), dist, { recursive: true });
await cp(join(root, 'public'), dist, { recursive: true, filter: source => {
  if (source === heroDirectory) return refreshed;
  if (source.startsWith(`${heroDirectory}${sep}`)) return refreshed && heroFiles.includes(source);
  return !source.endsWith('-source.mp4') && !source.includes(`${sep}motion-v2`) && !source.includes(`${sep}static-v2`);
} });
console.log(`Built ${dist}; zenoWebsiteRefresh=${refreshed}`);
