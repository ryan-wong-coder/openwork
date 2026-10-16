import { ARCH_LABELS, PLATFORM_LABELS, defaultArch, detectPlatform, formatBytes, formatName, parseRelease, selectArtifact } from './releases.js';

const byId = id => document.getElementById(id);
const platformInput = byId('platform');
const archInput = byId('arch');
let platform = detectPlatform({ platform: navigator.userAgentData?.platform || navigator.platform, userAgent: navigator.userAgent });
let arch = defaultArch(platform);
let format = null;
let release = null;
let artifact = null;
let loading = false;
let failed = false;
let lastChecked = null;
let requestVersion = 0;
let controller = null;
const signatureLabels = { adhoc: '临时签名', 'self-signed': '自签名', unsigned: '未签名', signed: '已签名' };

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function updateArchitectures() {
  archInput.replaceChildren();
  archInput.disabled = !platform;
  if (!platform || platform === 'darwin') {
    const placeholder = new Option(platform ? '选择 Mac 芯片' : '先选择平台', '');
    placeholder.disabled = true;
    archInput.add(placeholder);
  }
  if (platform) for (const [value, label] of Object.entries(ARCH_LABELS[platform])) archInput.add(new Option(label, value));
  archInput.value = arch || '';
  byId('chipHelp').hidden = platform !== 'darwin' || Boolean(arch);
}
function updateInstallHelp() {
  const holder = byId('installSteps');
  holder.replaceChildren();
  if (!platform) { holder.append(textElement('p', '选择与你电脑一致的平台与芯片。当前未发布的组合无法下载。')); return; }
  const steps = platform === 'darwin'
    ? [artifact?.format === 'zip' ? '解压后，将泽诺移到“应用程序”。' : '打开 DMG，将泽诺拖到“应用程序”。']
    : platform === 'win32'
      ? [artifact?.format === 'zip' ? '将 ZIP 解压到独立文件夹，再打开泽诺。' : '打开 EXE，按安装向导完成安装。']
      : [artifact?.format === 'deb' ? '通过系统的软件安装器打开 DEB 安装包。' : '在文件属性中允许作为程序执行，再打开 AppImage。'];
  if (artifact && artifact.signature !== 'signed') {
    if (platform === 'darwin') steps.push('此包未经过 Apple 公证。确认下载来源与 SHA-256 后，若系统拦截首次打开，在“系统设置”的“隐私与安全性”中检查对应应用，选择“仍要打开”。');
    else if (platform === 'win32') steps.push('此包尚未获得受信任的发布者签名。请先确认下载来源与 SHA-256；如果系统策略阻止运行，请由设备管理员检查，保留系统安全保护。');
    else steps.push('此包未提供受信任的发布者签名，请先核对 SHA-256。');
  }
  const list = document.createElement('ol');
  for (const step of steps) list.append(textElement('li', step));
  holder.append(list);
  holder.append(textElement('p', `${PLATFORM_LABELS[platform]} 桌面系统；${arch ? ARCH_LABELS[platform][arch] : '请选择对应芯片'}。需要 64 位桌面系统。`));
}
function renderSelection() {
  artifact = selectArtifact(release, platform, arch, format);
  byId('chipHelp').hidden = platform !== 'darwin' || Boolean(arch);
  byId('releaseMetadata').setAttribute('aria-busy', String(loading && !release));
  byId('releaseMetadata').hidden = !release && !loading;
  if (release) {
    const metadata = [textElement('span', `v${release.version}`, 'version')];
    if (artifact) metadata.push(textElement('span', formatBytes(artifact.size)), textElement('span', formatName(artifact.format)), textElement('span', signatureLabels[artifact.signature]));
    byId('releaseMetadata').replaceChildren(...metadata);
  }
  const link = byId('downloadLink');
  const unavailable = byId('downloadUnavailable');
  const choices = byId('quickChoices');
  choices.replaceChildren();
  if (!artifact && release && platform && !arch) {
    for (const cpu of ['arm64', 'x64']) {
      const candidate = selectArtifact(release, platform, cpu, format);
      if (!candidate) continue;
      const choice = textElement('a', `下载 ${ARCH_LABELS[platform][cpu]} 版`, 'button');
      choice.href = candidate.url;
      choice.download = candidate.name;
      choice.title = `${formatName(candidate.format)} · ${formatBytes(candidate.size)} · ${signatureLabels[candidate.signature]}`;
      choice.setAttribute('aria-label', `下载 ${PLATFORM_LABELS[platform]} ${ARCH_LABELS[platform][cpu]} 版，${formatBytes(candidate.size)}`);
      const group = textElement('div', '', 'quick-choice');
      group.append(choice, textElement('p', `${formatName(candidate.format)} · ${formatBytes(candidate.size)} · ${signatureLabels[candidate.signature]}`, 'quick-meta'));
      choices.append(group);
    }
  }
  choices.hidden = !choices.childElementCount;
  link.hidden = !artifact;
  unavailable.hidden = Boolean(artifact) || choices.childElementCount > 0;
  if (artifact) {
    link.href = artifact.url;
    link.download = artifact.name;
    link.textContent = `下载 ${PLATFORM_LABELS[platform]} 版`;
    link.title = artifact.name;
  } else {
    link.removeAttribute('href');
    unavailable.textContent = loading && !release ? '下载泽诺' : !release ? '暂时无法下载' : !release.artifacts.length ? '安装包尚未发布' : !platform ? '选择电脑平台' : !arch ? '选择 Mac 芯片' : '此版本尚未发布';
  }
  const status = byId('releaseStatus');
  status.setAttribute('role', failed && !release ? 'alert' : 'status');
  status.textContent = failed
    ? release ? `暂时无法检查新版本，仍显示 ${lastChecked.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 读取的记录。` : '暂时无法读取下载信息，请重新检查。'
    : release?.artifacts.length === 0 ? '当前版本尚无可下载的安装包。' : '';
  byId('retry').hidden = !failed && release?.artifacts.length !== 0;
  byId('retry').disabled = loading;
  byId('checksumDetails').hidden = !artifact;
  byId('sha256').value = artifact?.sha256 || '';
  byId('sha512').value = artifact?.sha512 || '';
  byId('copyStatus').textContent = '';
  updateInstallHelp();
}
function renderArtifacts() {
  const list = byId('artifactList');
  list.replaceChildren();
  byId('allDownloads').hidden = !release?.artifacts.length;
  byId('artifactCount').textContent = release ? String(release.artifacts.length) : '';
  byId('releaseVersion').textContent = release ? `v${release.version}` : '';
  if (release) for (const item of release.artifacts) {
    const row = textElement('li', '', 'artifact-row');
    const information = document.createElement('div');
    information.append(textElement('p', item.name, 'artifact-name'));
    const metadata = textElement('div', '', 'artifact-meta');
    for (const value of [PLATFORM_LABELS[item.platform], ARCH_LABELS[item.platform][item.arch], formatName(item.format), formatBytes(item.size)]) metadata.append(textElement('span', value));
    information.append(metadata);
    const download = textElement('a', '下载');
    download.href = item.url;
    download.download = item.name;
    download.setAttribute('aria-label', `下载 ${item.name}`);
    const checksum = textElement('button', '校验和', 'text-button');
    checksum.type = 'button';
    checksum.setAttribute('aria-label', `查看 ${item.name} 的校验和`);
    checksum.addEventListener('click', () => {
      platform = item.platform; arch = item.arch; format = item.format;
      platformInput.value = platform; updateArchitectures(); renderSelection();
      byId('checksumDetails').open = true;
      byId('checksumDetails').scrollIntoView({ block: 'center' });
      byId('checksumDetails').querySelector('summary').focus();
    });
    const actions = textElement('div', '', 'artifact-actions');
    actions.append(checksum, download);
    row.append(information, actions);
    list.append(row);
  }
  byId('noteList').replaceChildren();
  byId('releaseNotes').hidden = !release?.notes.length;
  if (release?.notes.length) {
    byId('noteList').append(textElement('li', new Date(release.publishedAt).toLocaleDateString('zh-CN')));
    for (const note of release.notes) byId('noteList').append(textElement('li', note));
  }
}
async function loadRelease() {
  const version = ++requestVersion;
  controller?.abort();
  controller = new AbortController();
  loading = true;
  renderSelection();
  try {
    const response = await fetch('/api/releases/latest.json', { cache: 'no-store', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw Error('Release unavailable');
    const next = parseRelease(await response.json(), location.origin);
    if (version !== requestVersion) return;
    release = next;
    lastChecked = new Date();
    failed = false;
    renderArtifacts();
  } catch (cause) {
    if (version !== requestVersion || cause.name === 'AbortError') return;
    failed = true;
  } finally {
    if (version === requestVersion) { loading = false; renderSelection(); }
  }
}
async function copyHash(kind) {
  if (!artifact) return;
  const selected = artifact;
  const field = byId(kind);
  try {
    if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
    await navigator.clipboard.writeText(selected[kind]);
    if (artifact?.url === selected.url) byId('copyStatus').textContent = `${kind === 'sha256' ? 'SHA-256' : 'SHA-512'} 已复制`;
  } catch {
    if (artifact?.url !== selected.url) return;
    byId('checksumDetails').open = true;
    field.focus(); field.select();
    byId('copyStatus').textContent = '剪贴板不可用，校验和已选中，可手动复制。';
  }
}
const darkMode = matchMedia('(prefers-color-scheme: dark)');
const syncPreviewLink = () => { document.querySelector('.product-preview').href = darkMode.matches ? '/assets/product-full-dark.webp' : '/assets/product-full-light.webp'; };
darkMode.addEventListener('change', syncPreviewLink);
syncPreviewLink();
byId('previewNav').addEventListener('click', () => { byId('workspacePreview').open = true; });
byId('installLink').addEventListener('click', () => {
  byId('installHelp').open = true;
  byId('installHelp').querySelector('summary').focus({ preventScroll: true });
});
platformInput.value = platform || '';
updateArchitectures();
platformInput.addEventListener('change', () => { platform = platformInput.value || null; arch = defaultArch(platform); format = null; updateArchitectures(); renderSelection(); });
archInput.addEventListener('change', () => { arch = archInput.value || null; format = null; renderSelection(); });
byId('retry').addEventListener('click', () => { void loadRelease(); });
byId('copySha256').addEventListener('click', () => { void copyHash('sha256'); });
byId('copySha512').addEventListener('click', () => { void copyHash('sha512'); });
window.addEventListener('pagehide', () => controller?.abort());
void loadRelease();
