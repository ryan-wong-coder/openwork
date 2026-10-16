export const PLATFORM_LABELS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
export const ARCH_LABELS = { darwin: { arm64: 'Apple Silicon', x64: 'Intel' }, win32: { x64: 'x64', arm64: 'ARM64' }, linux: { x64: 'x64', arm64: 'ARM64' } };
const FORMATS = { darwin: ['dmg', 'zip'], win32: ['exe', 'zip'], linux: ['AppImage', 'deb'] };
export function detectPlatform({ userAgent = '', platform = '' } = {}) {
  if (/iPhone|iPad|Android|CrOS/i.test(userAgent)) return null;
  if (/Mac/i.test(platform + ' ' + userAgent)) return 'darwin';
  if (/Win/i.test(platform + ' ' + userAgent)) return 'win32';
  if (/Linux/i.test(platform + ' ' + userAgent)) return 'linux';
  return null;
}
export function defaultArch(platform) { return platform === 'darwin' || !platform ? null : 'x64'; }
export function formatBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: index > 1 ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
}
export function formatName(format) { return format === 'AppImage' ? format : format.toUpperCase(); }
export function parseRelease(value, origin) {
  if (!value || typeof value !== 'object' || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version) || typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt)) || !Array.isArray(value.notes) || value.notes.some(note => typeof note !== 'string') || !Array.isArray(value.artifacts)) throw Error('Invalid release');
  const names = new Set();
  const artifacts = value.artifacts.map(artifact => {
    if (!artifact || typeof artifact !== 'object' || !Object.hasOwn(PLATFORM_LABELS, artifact.platform) || !Object.hasOwn(ARCH_LABELS[artifact.platform], artifact.arch) || !FORMATS[artifact.platform].includes(artifact.format) || typeof artifact.name !== 'string' || !artifact.name || artifact.name.length > 256 || /[/\\\r\n]/.test(artifact.name) || typeof artifact.url !== 'string' || !artifact.url.startsWith('/downloads/') || artifact.url.startsWith('//') || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || typeof artifact.sha256 !== 'string' || typeof artifact.sha512 !== 'string' || !/^[a-f\d]{64}$/i.test(artifact.sha256) || !/^(?:[a-f\d]{128}|[A-Za-z\d+/]{86}==)$/i.test(artifact.sha512) || !['adhoc', 'self-signed', 'unsigned', 'signed'].includes(artifact.signature)) throw Error('Invalid artifact');
    const url = new URL(artifact.url, origin);
    if (url.origin !== origin || url.search || url.hash || url.pathname.split('/').length !== 4 || !url.pathname.startsWith(`/downloads/${value.version}/`) || decodeURIComponent(url.pathname.split('/').at(-1)) !== artifact.name || names.has(artifact.name)) throw Error('Invalid download');
    names.add(artifact.name);
    return { platform: artifact.platform, arch: artifact.arch, format: artifact.format, name: artifact.name, url: url.pathname, size: artifact.size, sha256: artifact.sha256, sha512: artifact.sha512, signature: artifact.signature };
  });
  return { version: value.version, publishedAt: value.publishedAt, notes: value.notes.slice(0, 8), artifacts };
}
export function selectArtifact(release, platform, arch, format) {
  if (!release || !platform || !arch) return null;
  const matches = release.artifacts.filter(artifact => artifact.platform === platform && artifact.arch === arch);
  return matches.find(artifact => artifact.format === format) || matches.sort((a, b) => FORMATS[platform].indexOf(a.format) - FORMATS[platform].indexOf(b.format))[0] || null;
}
