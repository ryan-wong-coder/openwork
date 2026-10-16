import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formats = { darwin: ['dmg', 'zip'], win32: ['exe'], linux: ['AppImage', 'deb'] };
const origin = 'https://www.zeno.ryan-wong.cn';
function safeName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && basename(name) === name;
}
async function verifyFile(path, expected) {
  const info = await stat(path);
  if (!info.isFile() || !Number.isSafeInteger(expected.size) || expected.size <= 0 || info.size !== expected.size) throw Error('Release file size mismatch');
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  for await (const chunk of createReadStream(path)) { sha256.update(chunk); sha512.update(chunk); }
  if (sha256.digest('hex') !== expected.sha256 || sha512.digest('base64') !== expected.sha512) throw Error('Release checksum mismatch');
}

// Input is the assembled release downloaded from GitHub. Nothing is published
// until every target, native manifest and package has passed this verification.
export async function preparePublication(input, output, publishedAt) {
  const release = JSON.parse(await readFile(join(input, 'zeno-release.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !Array.isArray(release.platforms) || release.platforms.length !== 6 || !Number.isFinite(Date.parse(publishedAt))) throw Error('Invalid release metadata');
  const targets = new Set();
  const files = new Set();
  const artifacts = [];
  const verified = [];
  for (const lane of release.platforms) {
    const key = `${lane.platform}/${lane.arch}`;
    if (!Object.hasOwn(formats, lane.platform) || !['x64', 'arm64'].includes(lane.arch) || targets.has(key) || lane.version !== release.version || lane.feedUrl !== `${origin}/updates/${key}/` || lane.updatesEnabled !== true || !Array.isArray(lane.files)) throw Error('Invalid release target');
    targets.add(key);
    const manifest = lane.platform === 'darwin' ? 'latest-mac.yml' : lane.platform === 'win32' ? 'latest.yml' : `latest-linux${lane.arch === 'arm64' ? '-arm64' : ''}.yml`;
    if (lane.manifest !== manifest || lane.manifestAsset !== `zeno-${lane.platform}-${lane.arch}-${manifest}`) throw Error('Invalid native manifest');
    const signature = lane.signing === 'self-signed' ? 'self-signed' : ['developer-id', 'certificate'].includes(lane.signing) ? 'signed' : ['none', 'unsigned'].includes(lane.signing) ? 'unsigned' : null;
    if (!signature || (lane.platform === 'darwin' && signature === 'unsigned')) throw Error('Invalid signing identity for updates');
    const found = new Set();
    let hasManifest = false;
    for (const file of lane.files) {
      if (!safeName(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256) || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) || file.url !== `${lane.feedUrl}${encodeURIComponent(file.name)}`) throw Error('Invalid release file');
      const isManifest = file.name === manifest;
      const sourceName = isManifest ? lane.manifestAsset : file.name;
      if (!isManifest && (!file.name.startsWith('zeno-') || !file.name.includes(`-${lane.arch}-${release.version}.`) || files.has(file.name))) throw Error('Duplicate or unrelated package');
      await verifyFile(join(input, sourceName), file);
      if (isManifest) hasManifest = true;
      else {
        files.add(file.name);
        const format = formats[lane.platform].find(extension => file.name.endsWith(`.${extension}`));
        if (format) {
          found.add(format);
          artifacts.push({ platform: lane.platform, arch: lane.arch, format, name: file.name, url: `/downloads/${release.version}/${file.name}`, size: file.size, sha256: file.sha256, sha512: file.sha512, signature });
        } else if (!file.name.endsWith('.blockmap')) throw Error('Unexpected package format');
      }
      verified.push({ source: join(input, sourceName), file, key, isManifest });
    }
    if (!hasManifest || formats[lane.platform].some(format => !found.has(format))) throw Error('Incomplete release target');
  }
  await mkdir(output); // Deliberately refuse to overwrite an existing bundle.
  await mkdir(join(output, 'downloads', release.version), { recursive: true });
  for (const item of verified) {
    const directory = join(output, 'updates', item.key);
    await mkdir(directory, { recursive: true });
    if (item.isManifest) await copyFile(item.source, join(directory, item.file.name));
    else {
      await copyFile(item.source, join(output, 'downloads', release.version, item.file.name));
      await symlink(`../../../downloads/${release.version}/${item.file.name}`, join(directory, item.file.name));
    }
  }
  await mkdir(join(output, 'api', 'releases'), { recursive: true });
  const document = { version: release.version, publishedAt, notes: ['泽诺的第一个正式版本。', '中文界面，本地与自部署，独立版本更新。'], artifacts };
  await writeFile(join(output, 'api', 'releases', 'latest.json'), JSON.stringify(document, null, 2) + '\n');
  await copyFile(join(input, 'zeno-release.json'), join(output, 'zeno-release.json'));
  return document;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, publishedAt] = process.argv.slice(2);
  if (!input || !output || !publishedAt) throw Error('Usage: node prepare-publication.mjs RELEASE_DIRECTORY NEW_OUTPUT_DIRECTORY PUBLISHED_AT_ISO');
  const document = await preparePublication(resolve(input), resolve(output), publishedAt);
  console.log(JSON.stringify({ version: document.version, installers: document.artifacts.length, output: resolve(output) }));
}
