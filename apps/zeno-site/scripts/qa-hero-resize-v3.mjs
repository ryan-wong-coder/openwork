// Local V3 presentation QA. Only the newly created browser context/target's
// local release endpoint receives a copy of the real public manifest.
// No installer downloads, real configuration writes or system clipboard use.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatBytes, formatName, parseRelease, selectArtifact } from '../src/releases.js';
const cdp = process.env.ZENO_SITE_CDP || 'http://127.0.0.1:60238';
const site = 'http://127.0.0.1:5197';
const releaseUrl = 'https://www.zeno.ryan-wong.cn/api/releases/latest.json';
const output = fileURLToPath(new URL('../verification/v3-local/resize/', import.meta.url));
await mkdir(output, { recursive: true });
const response = await fetch(releaseUrl, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
assert.equal(response.status, 200);
const releaseJson = await response.json();
const release = parseRelease(releaseJson, new URL(releaseUrl).origin);
const expectedMac = Object.fromEntries(['arm64', 'x64'].map(arch => [arch, selectArtifact(release, 'darwin', arch)]));
assert.ok(expectedMac.arm64 && expectedMac.x64);
async function connect(url, onEvent = () => {}) {
  const socket = new WebSocket(url); let identifier = 0; const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);
    } else onEvent(message);
  };
  socket.onclose = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('Owned CDP closed')); } pending.clear(); };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return { socket, send(method, params = {}) { return new Promise((resolve, reject) => {
    const id = ++identifier; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 20_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); } };
}
const browser = await connect((await (await fetch(`${cdp}/json/version`)).json()).webSocketDebuggerUrl);
const { browserContextId } = await browser.send('Target.createBrowserContext');
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
const target = (await (await fetch(`${cdp}/json/list`)).json()).find(item => item.id === targetId);
const exceptions = []; const requests = []; const checks = []; const screenshots = [];
let phase = 'desktop'; let connection;
connection = await connect(target.webSocketDebuggerUrl, event => {
  if (event.method === 'Fetch.requestPaused') {
    assert.equal(event.params.request.url, `${site}/api/releases/latest.json`);
    void connection.send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Zeno-QA', value: 'fixtureOnly-real-release-copy' }],
      body: Buffer.from(JSON.stringify(releaseJson)).toString('base64') });
  }
  if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails.text);
  if (event.method === 'Network.requestWillBeSent') {
    try { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol)) requests.push({ phase, path: url.pathname, origin: url.origin, type: event.params.type }); } catch { /* Browser-internal schemes. */ }
  }
});
const send = connection.send;
const evaluate = async (expression, userGesture = false) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(expression, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { if (await evaluate(expression)) return; } catch { /* Navigation. */ } await sleep(60); }
  throw Error(`State timed out: ${label}`);
}
const record = (name, data = {}) => { checks.push({ name, passed: true, ...data }); console.log(`[qa-hero-resize-v3] ${name}`); };
async function media() {
  return evaluate(`(()=>{const v=document.getElementById('heroFilm');return{src:v.getAttribute('src'),currentSrc:new URL(v.currentSrc).pathname,poster:new URL(v.poster).pathname,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,duration:v.duration,paused:v.paused,loop:v.loop,muted:v.muted,autoplay:v.autoplay,playsInline:v.playsInline,controls:v.controls,error:v.error?.code??null}})()`);
}
async function choose(id, value) { await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function viewport(width, height, dark = false, reduced = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
}
async function navigate() {
  await send('Page.navigate', { url: site });
  await until(`document.getElementById('releaseMetadata')?.textContent.includes(${JSON.stringify(release.version)})&&document.documentElement.dataset.qaFixtureOnly==='true'`, 'copied real release ready');
  await until(`document.getElementById('heroFilm')?.videoWidth>0&&!document.getElementById('heroFilm').paused&&document.getElementById('heroFilm').currentTime>.1`, 'native autoplay decodes');
}
async function screenshot(name, top = true) {
  if (top) await evaluate('scrollTo({top:0,behavior:"instant"})');
  await until(`Array.from(document.images).filter(i=>i.loading!=='lazy'||i.naturalWidth>0).every(i=>i.complete&&i.naturalWidth>0)`, 'non-lazy images ready');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}${name}.png`, Buffer.from(shot.data, 'base64')); screenshots.push(`${name}.png`);
}
async function seek(seconds) {
  await evaluate(`document.getElementById('heroFilm').currentTime=${seconds}`);
  await until(`!document.getElementById('heroFilm').seeking&&Math.abs(document.getElementById('heroFilm').currentTime-${seconds})<1`, 'requested scene decodes');
}
async function visibleDownloadState() {
  const state = await evaluate(`(()=>{const ids=['download','heroFilm','releaseMetadata','installLink'];const result={width:innerWidth,contentWidth:document.documentElement.clientWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};for(const id of ids){const b=document.getElementById(id).getBoundingClientRect();result[id]={x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom}}return result})()`);
  assert.ok(state.scrollWidth <= state.width);
  assert.equal(state.download.height, state.height);
  assert.equal(state.heroFilm.width, state.contentWidth); assert.equal(state.heroFilm.height, state.height);
  assert.ok(state.releaseMetadata.bottom <= state.height && state.installLink.bottom <= state.height);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('heroFilm')).objectFit`), 'cover');
  return state;
}
let failure = null;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // A Mac desktop UA intentionally leaves CPU undecided. A narrow screenshot
  // retains this UA to exercise both CPU choices; it is not phone OS detection.
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36', platform: 'MacIntel' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.qaFixtureOnly='true'})` });
  await send('Fetch.enable', { patterns: [{ urlPattern: `${site}/api/releases/latest.json`, requestStage: 'Request' }] });
  await viewport(1440, 1000); await navigate();
  const desktopPath = '/assets/hero-film-v3/hero-worklife-v3.mp4';
  const mobilePath = '/assets/hero-film-v3/hero-worklife-v3-mobile.mp4';
  const initial = await media();
  assert.equal(initial.currentSrc, desktopPath);
  const initialRequests = requests.filter(request => request.phase==='desktop' && request.type==='Media');
  assert.equal(initialRequests.length, 1, 'Initial desktop must not load() and fetch twice.');
  assert.ok(initialRequests.every(request=>request.path===desktopPath));
  record('desktop-initial-load-requests-only-one-desktop-film', {initial,requests:initialRequests});
  async function advancing(expectedPath) {
    await until(`new URL(document.getElementById('heroFilm').currentSrc).pathname===${JSON.stringify(expectedPath)}&&document.getElementById('heroFilm').videoWidth>0&&!document.getElementById('heroFilm').paused`, 'matching source plays');
    const before=await media(); await sleep(350); const after=await media();
    assert.ok(after.time>before.time); assert.equal(after.loop,true); assert.equal(after.muted,true);
    return {before,after};
  }
  phase='resize-mobile'; await viewport(390,844);
  const mobile=await advancing(mobilePath);
  assert.equal(mobile.after.poster,'/assets/hero-film-v3/hero-worklife-v3-mobile-poster.webp');
  await screenshot('resize-01-mobile');
  record('desktop-to-mobile-reselects-native-mobile-source-and-advances',mobile);
  phase='resize-desktop'; await viewport(1440,1000);
  const desktop=await advancing(desktopPath);
  assert.equal(desktop.after.poster,'/assets/hero-film-v3/hero-worklife-v3-poster.webp');
  await screenshot('resize-02-desktop');
  record('mobile-to-desktop-reselects-native-desktop-source-and-advances',desktop);
  phase='offscreen-resize';
  await evaluate(`document.getElementById('allDownloads').open=true;scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})`);
  await until(`document.getElementById('download').getBoundingClientRect().bottom<0&&document.getElementById('heroFilm').paused`, 'offscreen before resize');
  await viewport(390,844);
  await until(`new URL(document.getElementById('heroFilm').currentSrc).pathname===${JSON.stringify(mobilePath)}&&document.getElementById('heroFilm').readyState>=2`, 'offscreen source ready');
  await sleep(350); assert.equal((await media()).paused,true);
  await evaluate(`scrollTo({top:0,behavior:'instant'})`); await advancing(mobilePath);
  record('offscreen-resize-remains-paused-and-return-resumes');
  phase='mobile-initial'; await viewport(390,844); await navigate();
  const mobileInitial=requests.filter(request=>request.phase==='mobile-initial'&&request.type==='Media');
  assert.equal(mobileInitial.length,1); assert.ok(mobileInitial.every(request=>request.path===mobilePath));
  await advancing(mobilePath);
  record('mobile-initial-load-requests-only-one-mobile-film',{requests:mobileInitial});
  assert.equal(exceptions.length,0); assert.ok(requests.every(request=>request.origin===site));
} catch (error) { failure = { message: error.message }; console.error(error); }
finally {
  try { await send('Fetch.disable'); } catch { /* Closed target. */ }
  await browser.send('Target.closeTarget', { targetId });
  await browser.send('Target.disposeBrowserContext', { browserContextId });
  connection.socket.close(); browser.socket.close();
  await writeFile(`${output}resize-qa.json`, JSON.stringify({ passed: !failure, checkedAt: new Date().toISOString(), fixtureOnly: true, fixture: 'Copy of real public manifest, fulfilled only on owned local target', source: releaseUrl, releaseVersion: release.version, viewport: [1440, 1000], narrowViewport: [390, 844], narrowUa: 'Mac desktop UA retained to exercise CPU choices', systemClipboard: 'Not accessed', installerDownloads: false, targetClosed: true, browserContextDisposed: true, checks, screenshots, exceptions, requests, failure }, null, 2));
}
if (failure) process.exitCode = 1;
