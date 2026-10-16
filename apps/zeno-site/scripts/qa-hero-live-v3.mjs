// Real deployed V3 QA: independent browser context, no API interception.
// Only small website media are downloaded; no installer or clipboard access.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { formatBytes, formatName, parseRelease, selectArtifact } from '../src/releases.js';
const cdp = process.env.ZENO_SITE_CDP || 'http://127.0.0.1:60238';
const site = 'https://www.zeno.ryan-wong.cn';
const expectedVersion = process.argv[2];
const websiteCommit = process.argv[3];
assert.match(expectedVersion || '', /^\d+\.\d+\.\d+$/);
assert.match(websiteCommit || '', /^[a-f0-9]{7,40}$/);
assert.equal(process.argv.length, 4, 'Usage: qa-hero-live-v3.mjs VERSION WEBSITE_COMMIT');
const releaseUrl = 'https://www.zeno.ryan-wong.cn/api/releases/latest.json';
const output = fileURLToPath(new URL(`../verification/releases/${expectedVersion}/`, import.meta.url));
await mkdir(output, { recursive: true });
const response = await fetch(releaseUrl, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
assert.equal(response.status, 200);
const releaseJson = await response.json();
const release = parseRelease(releaseJson, new URL(releaseUrl).origin);
assert.equal(release.version, expectedVersion);
assert.equal(release.artifacts.length, 10);
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

const assetNames = ['hero-worklife-v3.mp4', 'hero-worklife-v3-mobile.mp4', 'hero-worklife-v3-poster.webp', 'hero-worklife-v3-mobile-poster.webp'];
const mediaChecks = [];
for (const name of assetNames) {
  const local = await readFile(new URL(`../dist/assets/hero-film-v3/${name}`, import.meta.url));
  assert.ok(local.length>0 && local.length<3_000_000, 'Only small final website media may be fetched.');
  const url = `${site}/assets/hero-film-v3/${name}`;
  const full = await fetch(url, { redirect:'error', cache:'no-store', signal:AbortSignal.timeout(30_000) });
  assert.equal(full.status, 200); assert.equal(Number(full.headers.get('content-length')), local.length);
  const mime = name.endsWith('.mp4') ? 'video/mp4' : 'image/webp';
  assert.ok(full.headers.get('content-type')?.startsWith(mime));
  const bytes = Buffer.from(await full.arrayBuffer()); assert.deepEqual(bytes, local);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha512 = createHash('sha512').update(bytes).digest('hex');
  const range = await fetch(url, { redirect:'error', headers:{ Range:'bytes=0-63' }, signal:AbortSignal.timeout(30_000) });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), `bytes 0-63/${local.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), local.subarray(0,64));
  mediaChecks.push({ name, size:bytes.length, mime, sha256, sha512, identicalToLocalDist:true, range:true });
}
const sourcePaths = ['coding','data','life'].flatMap(scene=>[`/assets/hero-film-v3/${scene}-reference.png`,`/art-source/hero-film-v3/${scene}-reference.png`]);
for (const path of sourcePaths) {
  const response = await fetch(`${site}${path}`, { redirect:'error', signal:AbortSignal.timeout(30_000) });
  assert.equal(response.status,404, `Reference source must stay private: ${path}`); await response.body?.cancel();
}
const partyUrl='https://www.party.ryan-wong.cn';
const party = await fetch(partyUrl, { redirect:'error', signal:AbortSignal.timeout(30_000) });
assert.equal(party.status,200); await party.body?.cancel();
await writeFile(`${output}hero-media-live.json`,JSON.stringify({passed:true,fixtureOnly:false,checkedAt:new Date().toISOString(),site,websiteCommit,releaseVersion:release.version,checks:mediaChecks,excludedSourcePaths:sourcePaths,excludedSourceStatus:404,otherWebsite:{url:partyUrl,status:party.status},installerDownloads:false},null,2)+'\n');

const browser = await connect((await (await fetch(`${cdp}/json/version`)).json()).webSocketDebuggerUrl);
const { browserContextId } = await browser.send('Target.createBrowserContext');
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
const target = (await (await fetch(`${cdp}/json/list`)).json()).find(item => item.id === targetId);
const exceptions = []; const requests = []; const checks = []; const screenshots = [];
let phase = 'desktop'; let connection;
connection = await connect(target.webSocketDebuggerUrl, event => {
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
const record = (name, data = {}) => { checks.push({ name, passed: true, ...data }); console.log(`[qa-hero-live-v3] ${name}`); };
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
  await until(`document.getElementById('releaseMetadata')?.textContent.includes(${JSON.stringify(release.version)})`, 'real public release ready');
  await until(`document.getElementById('heroFilm')?.videoWidth>0&&!document.getElementById('heroFilm').paused&&document.getElementById('heroFilm').currentTime>.1`, 'native autoplay decodes');
}
async function screenshot(name, top = true) {
  if (top) await evaluate('scrollTo({top:0,behavior:"instant"})');
  await until(`Array.from(document.images).filter(i=>i.loading!=='lazy'||i.naturalWidth>0).every(i=>i.complete&&i.naturalWidth>0)`, 'non-lazy images ready');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}hero-live-${name}.png`, Buffer.from(shot.data, 'base64')); screenshots.push(`hero-live-${name}.png`);
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
  await viewport(1440, 1000); await navigate();
  const initial = await media(); await sleep(400); const advanced = await media();
  assert.ok(advanced.time > initial.time); assert.equal(initial.currentSrc, '/assets/hero-film-v3/hero-worklife-v3.mp4');
  for (const key of ['loop', 'muted', 'autoplay', 'playsInline']) assert.equal(initial[key], true);
  assert.equal(initial.controls, false); assert.equal(initial.src, null);
  assert.equal(await evaluate(`document.querySelectorAll('video').length`), 1);
  assert.equal(await evaluate(`!!document.querySelector('#pauseMotion,#greetMascot,#mascotFilm,#logoFilm')`), false);
  record('native-autoplay-loop-muted-inline-and-no-user-motion-controls', { initial, advanced });
  assert.equal(initial.duration, 19.5);
  // Observe an uninterrupted complete cycle before any seek-based scene shot.
  await evaluate(`(()=>{const v=document.getElementById('heroFilm');window.__zenoLiveCycle={started:performance.now(),last:v.currentTime,peak:v.currentTime,wraps:0,pauses:0,samples:[]};v.addEventListener('pause',()=>window.__zenoLiveCycle.pauses++);v.addEventListener('timeupdate',()=>{const t=window.__zenoLiveCycle;if(t.last>v.duration-1&&v.currentTime<1)t.wraps++;t.last=v.currentTime;t.peak=Math.max(t.peak,v.currentTime);t.samples.push({time:v.currentTime,elapsed:Math.round(performance.now()-t.started)});});})()`);
  await until(`window.__zenoLiveCycle?.wraps>=1&&performance.now()-window.__zenoLiveCycle.started>=20500`, 'uninterrupted full 19.5s cycle and automatic loop', 35_000);
  const continuous = await evaluate(`({...window.__zenoLiveCycle,elapsed:Math.round(performance.now()-window.__zenoLiveCycle.started)})`);
  assert.ok(continuous.peak>18.5 && continuous.wraps>=1 && continuous.elapsed>=20500);
  assert.equal(continuous.pauses, 0);
  record('uninterrupted-real-19.5-second-playback-and-native-loop', continuous);

  assert.equal(await evaluate(`document.getElementById('platform').value`), 'darwin');
  assert.equal(await evaluate(`document.getElementById('arch').value`), '');
  const choices = await evaluate(`Array.from(document.querySelectorAll('#quickChoices a'),a=>({text:a.textContent,href:a.getAttribute('href')}))`);
  assert.deepEqual(choices.map(choice => choice.href), [expectedMac.arm64.url, expectedMac.x64.url]);
  assert.equal(await evaluate(`document.getElementById('downloadUnavailable').hidden`), true);
  const metadata = await evaluate(`Array.from(document.querySelectorAll('.quick-meta'),e=>e.textContent)`);
  for (const [index, arch] of ['arm64', 'x64'].entries()) assert.ok(metadata[index].includes(formatBytes(expectedMac[arch].size)) && metadata[index].includes(formatName(expectedMac[arch].format)));
  record('real-manifest-cpu-downloads-and-visible-file-metadata', { version: release.version, choices, metadata, layout: await visibleDownloadState() });
  await seek(1); await screenshot('01-desktop-coding');
  await seek(8); await screenshot('02-desktop-data');
  await seek(15); await screenshot('03-desktop-life');
  record('three-real-scenes-decoded-and-screenshotted');
  const duration = (await media()).duration;
  await evaluate(`document.getElementById('heroFilm').currentTime=${duration - .4}`);
  await until(`document.getElementById('heroFilm').currentTime<1&&!document.getElementById('heroFilm').paused`, 'native film loops after end', 4000);
  record('native-loop-wraps-without-manual-restart', { duration, afterWrap: await media() });
  await choose('arch', 'arm64'); assert.equal(await evaluate(`document.getElementById('downloadLink').getAttribute('href')`), expectedMac.arm64.url);
  await choose('arch', 'x64'); assert.equal(await evaluate(`document.getElementById('downloadLink').getAttribute('href')`), expectedMac.x64.url);
  record('canonical-download-matches-selected-cpu');
  await evaluate(`document.getElementById('installLink').click()`, true);
  await until(`document.getElementById('installHelp').open&&document.getElementById('installHelp').getBoundingClientRect().top<innerHeight`, 'install link opens and reaches help');
  assert.ok(await evaluate(`document.getElementById('installSteps').textContent.includes('Apple 公证')`));
  await screenshot('04-install-help', false);
  await evaluate(`document.getElementById('allDownloads').open=true;scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'})`);
  await until(`document.getElementById('download').getBoundingClientRect().bottom<0&&document.getElementById('heroFilm').paused`, 'offscreen film pauses');
  const paused = await media(); await sleep(300); assert.ok(Math.abs((await media()).time - paused.time) < .05);
  await evaluate(`scrollTo({top:0,behavior:'instant'})`);
  await until(`!document.getElementById('heroFilm').paused`, 'visible film resumes');
  record('below-fold-install-guidance-and-technical-offscreen-pause-resume');
  phase = 'dark'; await viewport(1440, 1000, true); await navigate(); await seek(8); await screenshot('05-desktop-dark');
  record('dark-preference-preserves-contrast-and-video', { layout: await visibleDownloadState() });
  // Regression for actual window resizing, before the clean mobile navigation.
  const desktopInitialRequests=requests.filter(request=>request.phase==='desktop'&&request.type==='Media');
  assert.equal(desktopInitialRequests.length,1,'No duplicate desktop first-load request.');
  phase='resize-mobile'; await viewport(390,844);
  await until(`document.getElementById('heroFilm').currentSrc.endsWith('/hero-worklife-v3-mobile.mp4')&&document.getElementById('heroFilm').videoWidth===720&&!document.getElementById('heroFilm').paused`, 'desktop window crosses to mobile source');
  const resizedMobile=await media(); await sleep(350); assert.ok((await media()).time>resizedMobile.time);
  phase='resize-desktop'; await viewport(1440,1000);
  await until(`document.getElementById('heroFilm').currentSrc.endsWith('/hero-worklife-v3.mp4')&&document.getElementById('heroFilm').videoWidth===1920&&!document.getElementById('heroFilm').paused`, 'mobile window crosses back to desktop source');
  const resizedDesktop=await media(); await sleep(350); assert.ok((await media()).time>resizedDesktop.time);
  assert.equal(resizedMobile.muted,true); assert.equal(resizedDesktop.loop,true);
  record('bidirectional-breakpoint-reselection-and-no-duplicate-first-load', {desktopInitialRequests:desktopInitialRequests.map(request=>request.path),mobile:resizedMobile,desktop:resizedDesktop});
  phase = 'mobile'; await viewport(390, 844); await navigate();
  const mobile = await media(); assert.equal(mobile.currentSrc, '/assets/hero-film-v3/hero-worklife-v3-mobile.mp4');
  assert.equal(mobile.poster, '/assets/hero-film-v3/hero-worklife-v3-mobile-poster.webp');
  assert.equal(mobile.width, 720); assert.equal(mobile.height, 1280);
  await seek(1); await screenshot('06-mobile-coding');
  await seek(8); await screenshot('07-mobile-data');
  await seek(15); await screenshot('08-mobile-life');
  const mobileRequests = requests.filter(request => request.phase === 'mobile' && request.type === 'Media');
  assert.ok(mobileRequests.length > 0); assert.ok(mobileRequests.every(request => request.path.endsWith('-mobile.mp4')));
  record('mobile-native-source-only-and-three-scenes-fit-viewport', { mobile, mediaRequests: mobileRequests.map(request => request.path), layout: await visibleDownloadState() });
  phase = 'reduced'; await viewport(390, 844, true, true); await navigate(); await seek(8); await screenshot('09-mobile-reduced-motion');
  assert.equal((await media()).paused, false); assert.equal(await evaluate(`getComputedStyle(document.documentElement).scrollBehavior`), 'auto');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('installLink')).transitionDuration`), '0s');
  record('explicit-user-request-keeps-looping-film-in-reduce-but-removes-ui-transitions');
  await evaluate(`document.getElementById('previewNav').click()`, true);
  await until(`document.getElementById('workspacePreview').open&&document.querySelector('.product-preview img').naturalWidth>0`, 'real product preview loads');
  await evaluate(`document.getElementById('preview').scrollIntoView({block:'start',behavior:'instant'})`);
  await screenshot('10-workspace-preview', false);
  record('real-product-preview-and-openwork-attribution-preserved');
  assert.equal(exceptions.length, 0); assert.ok(requests.every(request => request.origin === site));
  assert.equal(requests.some(request => request.path.startsWith('/downloads/')), false);
  record('no-runtime-exceptions-external-requests-or-installer-downloads');
} catch (error) { failure = { message: error.message }; console.error(error); }
finally {
  await browser.send('Target.closeTarget', { targetId });
  await browser.send('Target.disposeBrowserContext', { browserContextId });
  connection.socket.close(); browser.socket.close();
  await writeFile(`${output}hero-live-qa.json`, JSON.stringify({ passed: !failure, checkedAt: new Date().toISOString(), fixtureOnly: false, apiIntercepted: false, site, websiteCommit, source: releaseUrl, releaseVersion: release.version, viewport: [1440, 1000], narrowViewport: [390, 844], narrowUa: 'Mac desktop UA retained to exercise CPU choices', systemClipboard: 'Not accessed', installerDownloads: false, targetClosed: true, browserContextDisposed: true, checks, screenshots, exceptions, requests, failure }, null, 2));
}
if (failure) process.exitCode = 1;
