// Local refreshed-site QA. Only this script's new CDP target receives a copy
// of the real public release JSON. No installer or system clipboard is used.
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatBytes, formatName, parseRelease, selectArtifact } from '../src/releases.js';

const cdp = process.env.ZENO_SITE_CDP || 'http://127.0.0.1:60238';
const site = 'http://127.0.0.1:5197';
const releaseUrl = 'https://www.zeno.ryan-wong.cn/api/releases/latest.json';
const output = fileURLToPath(new URL('../verification/v2-local/', import.meta.url));
await mkdir(output, { recursive: true });
const releaseResponse = await fetch(releaseUrl, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
assert.equal(releaseResponse.status, 200, 'The real public release must be available for this QA.');
const releaseJson = await releaseResponse.json();
const release = parseRelease(releaseJson, new URL(releaseUrl).origin);
const expectedMac = Object.fromEntries(['arm64', 'x64'].map(arch => [arch, selectArtifact(release, 'darwin', arch)]));
assert.ok(expectedMac.arm64 && expectedMac.x64, 'Both real Mac builds must be published.');

async function connect(url, onEvent = () => {}) {
  const socket = new WebSocket(url); let identifier = 0; const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    } else onEvent(message);
  };
  socket.onclose = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Owned CDP closed.')); } pending.clear(); };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return { socket, send(method, params = {}) { return new Promise((resolve, reject) => {
    const id = ++identifier; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); } };
}

const browser = await connect((await (await fetch(`${cdp}/json/version`)).json()).webSocketDebuggerUrl);
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
console.log(`[qa-motion] owned target ${targetId}`);
browser.socket.close();
const target = (await (await fetch(`${cdp}/json/list`)).json()).find(item => item.id === targetId);
const exceptions = []; const requests = []; const checks = []; const screenshots = [];
let phase = 'normal'; let connection;
connection = await connect(target.webSocketDebuggerUrl, event => {
  if (event.method === 'Fetch.requestPaused') {
    const request = event.params;
    // Fetch is enabled for this one exact local API URL on this one target.
    assert.equal(request.request.url, `${site}/api/releases/latest.json`);
    void connection.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Zeno-QA', value: 'fixtureOnly-real-release-copy' }],
      body: Buffer.from(JSON.stringify(releaseJson)).toString('base64') });
  }
  if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails.text);
  if (event.method === 'Network.requestWillBeSent') {
    try { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol)) requests.push({ phase, path: url.pathname, origin: url.origin, type: event.params.type }); } catch { /* Internal scheme; native video controls also use data: icons. */ }
  }
});
const send = connection.send;
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(expression, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { if (await evaluate(expression)) return; } catch { /* Navigation. */ } await sleep(50); }
  throw new Error(`State timed out: ${label}`);
}
const record = (name, data = {}) => { checks.push({ name, passed: true, ...data }); console.log(`[qa-motion] ${name}`); };
async function quickMetadata() {
  const metadata = await evaluate(`Array.from(document.querySelectorAll('#quickChoices .quick-meta'),e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return{text:e.textContent,visible:b.width>0&&b.height>0&&b.top>=0&&b.bottom<=innerHeight&&s.visibility==='visible'&&s.display!=='none',fits:b.left>=0&&b.right<=innerWidth}})`);
  assert.equal(metadata.length, 2, 'Each direct CPU download needs visible release metadata.');
  for (const [index, arch] of ['arm64', 'x64'].entries()) {
    const artifact = expectedMac[arch];
    assert.equal(metadata[index].visible && metadata[index].fits, true);
    assert.ok(metadata[index].text.includes(formatBytes(artifact.size)) && metadata[index].text.includes(formatName(artifact.format)));
    const signatures = { adhoc: '临时签名', 'self-signed': '自签名', unsigned: '未签名', signed: '已签名' };
    assert.ok(metadata[index].text.includes(signatures[artifact.signature]));
  }
  return metadata;
}
async function media(id) {
  return evaluate(`(()=>{const v=document.getElementById(${JSON.stringify(id)});return{src:v.getAttribute('src'),currentSrc:v.currentSrc,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,ended:v.ended,loop:v.loop,readyState:v.readyState,error:v.error?.code??null}})()`);
}
async function choose(id, value) {
  await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e||e.disabled)throw Error('Missing available select');return Array.from(e.options,o=>o.value)})()`);
  await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function click(id) {
  assert.equal(await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});return!!e&&!e.hidden&&!e.disabled&&e.getBoundingClientRect().width>0})()`), true);
  await evaluate(`document.getElementById(${JSON.stringify(id)}).focus();document.getElementById(${JSON.stringify(id)}).click()`);
}
async function toggleDetails(id) {
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(`#${id} summary`)})?.getBoundingClientRect().width>0`), true);
  await evaluate(`document.querySelector(${JSON.stringify(`#${id} summary`)}).focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(100);
}
async function screenshot(name, top = true) {
  if (top) await evaluate('window.scrollTo({top:0,behavior:"instant"})');
  // Closed disclosures contain lazy images: never decode hidden images.
  await until(`Array.from(document.images).filter(i=>i.loading!=='lazy'||i.naturalWidth>0).filter(i=>{const b=i.getBoundingClientRect();return b.width>0&&b.height>0&&b.bottom>0&&b.top<innerHeight}).every(i=>i.complete&&i.naturalWidth>0)`, 'visible image decode');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}${name}.png`, Buffer.from(shot.data, 'base64')); screenshots.push(`${name}.png`);
}
async function navigate() {
  await send('Page.navigate', { url: site });
  await until(`document.querySelector('#releaseMetadata')?.textContent.includes(${JSON.stringify(release.version)})&&document.documentElement.dataset.qaFixtureOnly==='true'`, 'real release copy ready');
}
async function viewport(width, height, dark = false, reduced = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
}
let failure = null;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36', platform: 'MacIntel' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__zenoMotionQa={fixtureOnly:true,events:[]};document.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.qaFixtureOnly='true'});for(const type of ['play','pause','ended'])document.addEventListener(type,event=>{if(event.target instanceof HTMLVideoElement)window.__zenoMotionQa.events.push({type,id:event.target.id,time:event.target.currentTime,src:event.target.getAttribute('src')})},true);` });
  await send('Fetch.enable', { patterns: [{ urlPattern: `${site}/api/releases/latest.json`, requestStage: 'Request' }] });
  await viewport(1440, 1000); await navigate();
  assert.equal(await evaluate('document.getElementById("platform").value'), 'darwin');
  assert.equal(await evaluate('document.getElementById("arch").value'), '');
  const choices = await evaluate('Array.from(document.querySelectorAll("#quickChoices a"),a=>({text:a.textContent,href:a.getAttribute("href")}))');
  assert.deepEqual(choices.map(choice => choice.href), [expectedMac.arm64.url, expectedMac.x64.url]);
  assert.ok(choices[0].text.includes('Apple Silicon') && choices[1].text.includes('Intel'));
  assert.equal(await evaluate('document.getElementById("downloadUnavailable").hidden'), true);
  assert.equal((await media('logoFilm')).src, null);
  record('default-mac-quick-cpu-downloads', { choices, visibleMetadata: await quickMetadata() });
  await until('document.getElementById("mascotFilm").videoWidth>0&&!document.getElementById("mascotFilm").paused&&document.getElementById("mascotFilm").currentTime>.1', 'welcome video plays');
  const welcome = await media('mascotFilm'); await sleep(350); const welcomeNext = await media('mascotFilm');
  assert.ok(welcomeNext.time > welcome.time); assert.ok(welcome.width > 0); assert.equal(welcome.loop, false);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  await screenshot('01-desktop-motion');
  await until('document.getElementById("mascotFilm").ended&&document.getElementById("mascotFilm").paused', 'automatic greeting ends once', 25_000);
  await sleep(600);
  assert.equal(await evaluate('window.__zenoMotionQa.events.filter(e=>e.id==="mascotFilm"&&e.type==="play").length'), 1);
  assert.equal(await evaluate('document.getElementById("mascotStage").classList.contains("is-playing")'), false);
  record('video-decodes-advances-and-autoplays-once', { welcome, ended: await media('mascotFilm') });
  await choose('arch', 'arm64');
  assert.equal(await evaluate('document.getElementById("downloadLink").getAttribute("href")'), expectedMac.arm64.url);
  assert.equal(await evaluate('document.getElementById("quickChoices").hidden'), true);
  await choose('arch', 'x64');
  assert.equal(await evaluate('document.getElementById("downloadLink").getAttribute("href")'), expectedMac.x64.url);
  record('canonical-download-matches-explicit-cpu');
  await screenshot('02-desktop-rest');
  await click('greetMascot');
  await until('document.getElementById("mascotFilm").currentTime>.1&&!document.getElementById("mascotFilm").paused', 'manual nod plays');
  const nod = await media('mascotFilm'); assert.notEqual(nod.src, welcome.src);
  await click('pauseMotion'); const paused = await media('mascotFilm'); await sleep(350); const pausedNext = await media('mascotFilm');
  assert.equal(paused.paused, true); assert.ok(Math.abs(pausedNext.time - paused.time) < .05);
  assert.equal(await evaluate('document.getElementById("mascotStage").classList.contains("is-playing")'), true, 'User pause retains the actual video frame.');
  await evaluate('document.getElementById("greetMascot").focus()');
  assert.equal(await evaluate('document.getElementById("pauseMotion").hidden'), false, 'Resume remains reachable after losing focus.');
  await click('pauseMotion');
  await until(`!document.getElementById('mascotFilm').paused&&document.getElementById('mascotFilm').currentTime>${paused.time + .15}`, 'resume advances the same clip');
  const resumed = await media('mascotFilm');
  assert.equal(resumed.src, paused.src); assert.ok(resumed.time > paused.time);
  await click('pauseMotion'); assert.equal((await media('mascotFilm')).paused, true);
  await click('greetMascot');
  await until('document.getElementById("mascotFilm").currentTime>.1&&!document.getElementById("mascotFilm").paused', 'greet again plays');
  assert.equal((await media('mascotFilm')).src, welcome.src);
  record('manual-greeting-pause-resume-and-greet-again', { nod, paused, resumed });
  await toggleDetails('allDownloads');
  assert.equal(await evaluate('document.getElementById("allDownloads").open'), true);
  await evaluate('window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"})');
  await until('document.getElementById("mascotStage").getBoundingClientRect().bottom<0&&document.getElementById("mascotFilm").paused', 'offscreen media pauses');
  const offscreen = await media('mascotFilm'); await sleep(300); assert.ok(Math.abs((await media('mascotFilm')).time - offscreen.time) < .05);
  await evaluate('window.scrollTo({top:0,behavior:"instant"})'); await sleep(500);
  assert.equal((await media('mascotFilm')).paused, true);
  assert.equal(await evaluate('window.__zenoMotionQa.events.filter(e=>e.id==="mascotFilm"&&e.type==="play").length'), 4);
  await toggleDetails('allDownloads');
  record('offscreen-pauses-and-return-does-not-autoplay', { offscreen });
  assert.equal((await media('logoFilm')).src, null);
  assert.equal(requests.some(request => request.path.endsWith('logo-reveal-v2.mp4')), false);
  await evaluate('document.getElementById("brandFilmDetails").scrollIntoView({block:"center",behavior:"instant"})');
  await toggleDetails('brandFilmDetails');
  await until('document.getElementById("logoFilm").getAttribute("src")?.endsWith("logo-reveal-v2.mp4")', 'logo source set by user disclosure');
  assert.equal((await media('logoFilm')).paused, true);
  await evaluate('document.getElementById("logoFilm").play()');
  await until('document.getElementById("logoFilm").videoWidth>0&&document.getElementById("logoFilm").currentTime>.1', 'logo video decodes');
  const logo = await media('logoFilm'); await sleep(300); assert.ok((await media('logoFilm')).time > logo.time);
  await screenshot('03-logo-explicit-playback', false);
  await toggleDetails('brandFilmDetails'); assert.equal((await media('logoFilm')).paused, true);
  record('logo-loads-on-disclosure-and-plays-on-explicit-intent', { logo });
  phase = 'reduced'; await viewport(1440, 1000, false, true); await navigate(); await sleep(1_000);
  const reduced = await media('mascotFilm');
  assert.equal(reduced.src, null); assert.equal((await media('logoFilm')).src, null);
  assert.equal(await evaluate('window.__zenoMotionQa.events.filter(e=>e.type==="play").length'), 0);
  assert.equal(requests.filter(request => request.phase === 'reduced' && request.path.endsWith('.mp4')).length, 0);
  await until('document.querySelector("#mascotPoster img").currentSrc.includes("mascot-rest-v2.webp")&&document.querySelector("#mascotPoster img").naturalWidth>0', 'reduced-motion seated poster');
  await screenshot('04-desktop-reduced-motion');
  record('reduced-motion-does-not-load-video-and-shows-seated-poster', { reduced });
  phase = 'dark-desktop'; await viewport(1440, 1000, true); await navigate();
  await until('document.getElementById("mascotFilm").currentSrc.endsWith("welcome-dark-v2.mp4")&&document.getElementById("mascotFilm").videoWidth>0&&document.getElementById("mascotFilm").currentTime>.1&&!document.getElementById("mascotFilm").paused', 'dark welcome decodes and plays');
  const darkWelcome = await media('mascotFilm'); await sleep(350);
  assert.ok((await media('mascotFilm')).time > darkWelcome.time);
  assert.equal(await evaluate('getComputedStyle(document.getElementById("mascotFilm")).mixBlendMode'), 'normal');
  const darkCanvas = await evaluate(`(()=>{const v=document.getElementById('mascotFilm'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d');ctx.drawImage(v,0,0);return{videoRgb:Array.from(ctx.getImageData(10,10,1,1).data).slice(0,3),canvasCss:getComputedStyle(document.getElementById('mascotStage')).backgroundColor}})()`);
  assert.equal(darkCanvas.canvasCss, 'rgb(16, 38, 38)');
  assert.ok(darkCanvas.videoRgb.every((value, index) => Math.abs(value - [16, 38, 38][index]) <= 2), 'Decoded dark video must match the CSS canvas within 8-bit encoding tolerance.');
  await screenshot('07-desktop-dark-motion');
  await click('greetMascot');
  await until('document.getElementById("mascotFilm").currentSrc.endsWith("nod-dark-v2.mp4")&&document.getElementById("mascotFilm").videoWidth>0&&document.getElementById("mascotFilm").currentTime>.1&&!document.getElementById("mascotFilm").paused', 'dark nod decodes and plays');
  const darkNod = await media('mascotFilm'); await sleep(300);
  assert.ok((await media('mascotFilm')).time > darkNod.time);
  await click('pauseMotion');
  record('dark-composites-decode-and-advance', { welcome: darkWelcome, nod: darkNod, darkCanvas });
  await evaluate('document.getElementById("greetMascot").click();document.getElementById("greetMascot").click()');
  await until('document.getElementById("mascotFilm").currentSrc.endsWith("nod-dark-v2.mp4")&&!document.getElementById("mascotFilm").paused&&document.getElementById("mascotFilm").currentTime>.1', 'rapid greeting retains latest playback');
  const rapid = await media('mascotFilm'); await sleep(300);
  assert.ok((await media('mascotFilm')).time > rapid.time);
  record('rapid-greetings-do-not-pause-latest-clip', { latest: rapid });
  phase = 'reduced-dark'; await viewport(1440, 1000, true, true); await navigate(); await sleep(500);
  assert.equal((await media('mascotFilm')).src, null);
  assert.equal(requests.filter(request => request.phase === 'reduced-dark' && request.path.endsWith('.mp4')).length, 0);
  await until('document.querySelector("#mascotPoster img").naturalWidth>0', 'dark reduced-motion static image');
  await screenshot('08-desktop-dark-reduced-motion');
  record('dark-reduced-motion-does-not-load-video');
  phase = 'mobile'; await viewport(390, 844); await navigate();
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  const mobileMetadata = await quickMetadata();
  await screenshot('05-mobile-light');
  phase = 'dark-mobile'; await viewport(390, 844, true); await navigate();
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  await until('Array.from(document.querySelectorAll(".brand img,.brand-art img")).every(i=>i.currentSrc.includes("reverse")&&i.complete&&i.naturalWidth>0)', 'dark brand images');
  await until('document.getElementById("mascotFilm").currentSrc.endsWith("welcome-dark-v2.mp4")&&document.getElementById("mascotFilm").videoWidth>0&&document.getElementById("mascotFilm").currentTime>.1', 'dark mobile welcome video');
  await screenshot('06-mobile-dark');
  record('mobile-and-dark-layout-images', { width: 390, height: 844, overflow: false, visibleMetadata: mobileMetadata });
  assert.equal(exceptions.length, 0, 'Runtime exceptions occurred.');
  assert.equal(requests.some(request => request.path.startsWith('/downloads/')), false, 'No installer may be requested.');
  assert.ok(requests.every(request => request.origin === site), 'The page must only request its local own-origin resources.');
  record('no-installer-downloads-or-runtime-exceptions');
} catch (error) {
  failure = error.message; process.exitCode = 1;
  try { await screenshot('failure-state', false); } catch { /* Preserve completed evidence. */ }
} finally {
  try { await send('Fetch.disable'); } catch { /* Closing target. */ }
  connection.socket.close();
  await fetch(`${cdp}/json/close/${targetId}`);
  const report = { passed: failure === null, fixtureOnly: true, dataSource: 'Copied once from real public release JSON; only own local target API fulfilled', releaseVersion: release.version,
    capturedAt: new Date().toISOString(), viewports: [[1440, 1000], [390, 844]], browserContext: 'Mac user agent retained for narrow viewport CPU-choice testing; no claim of mobile OS detection', clipboard: 'Never accessed', installers: 'Href checks only; no downloads', targetClosed: targetId,
    checks, screenshots, exceptions, failure, requests };
  if (report.passed) await rm(`${output}failure-state.png`, { force: true });
  await writeFile(`${output}motion-qa.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, screenshots: screenshots.length, failure, targetClosed: targetId }));
}
