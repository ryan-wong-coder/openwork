// Headless UI verification. All package records below are test fixtures, never shipped.
// Only a newly created target's local preview API is intercepted; no app tab is touched.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.ZENO_SITE_CDP || 'http://127.0.0.1:60238';
const site = 'http://127.0.0.1:5197';
const output = fileURLToPath(new URL('../verification/', import.meta.url));
await mkdir(output, { recursive: true });
async function connect(url, onEvent = () => {}) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const result = JSON.parse(data); if (result.id) { const p = pending.get(result.id); if (p) { pending.delete(result.id); result.error ? p.reject(Error(result.error.message)) : p.resolve(result.result); } } else onEvent(result); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { ws, send: (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); }) };
}
const browser = await connect((await (await fetch(`${base}/json/version`)).json()).webSocketDebuggerUrl);
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
browser.ws.close();
const target = (await (await fetch(`${base}/json/list`)).json()).find(t => t.id === targetId);
let mode = 'success'; let heldRequest = null; let connection;
const exceptions = []; const origins = new Set();
const packageRecord = (platform, arch, format) => ({ platform, arch, format, name: `fixture-zeno-${platform}-${arch}-1.0.0.${format}`, url: `/downloads/1.0.0/fixture-zeno-${platform}-${arch}-1.0.0.${format}`, size: 207618048, sha256: createHash('sha256').update(`${platform}-${arch}-${format}`).digest('hex'), sha512: createHash('sha512').update(`${platform}-${arch}-${format}`).digest('hex'), signature: 'adhoc' });
const fixture = { version: '1.0.0', publishedAt: '2026-10-16T00:00:00.000Z', notes: ['测试发布记录，仅用于浏览器验收'], artifacts: [packageRecord('darwin', 'arm64', 'dmg'), packageRecord('darwin', 'arm64', 'zip'), packageRecord('darwin', 'x64', 'dmg'), packageRecord('win32', 'x64', 'exe'), packageRecord('linux', 'x64', 'AppImage')] };
async function fulfill(requestId, value, responseCode = 200) { await connection.send('Fetch.fulfillRequest', { requestId, responseCode, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(value)).toString('base64') }); }
connection = await connect(target.webSocketDebuggerUrl, event => {
  if (event.method === 'Fetch.requestPaused') {
    if (mode === 'hold') heldRequest = event.params.requestId;
    else if (mode === 'empty') void fulfill(event.params.requestId, { ...fixture, artifacts: [] });
    else if (mode === 'invalid') void fulfill(event.params.requestId, { ...fixture, artifacts: [{ ...fixture.artifacts[0], url: 'https://external.invalid/package.dmg' }] });
    else void fulfill(event.params.requestId, fixture);
  }
  if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails.text);
  if (event.method === 'Network.requestWillBeSent') { try { origins.add(new URL(event.params.request.url).origin); } catch {} }
});
const send = connection.send;
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) { for (let i = 0; i < 100; i += 1) { try { if (await evaluate(expression)) return; } catch {} await pause(50); } throw Error(`State timed out: ${expression}`); }
async function screenshot(name) {
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await evaluate('Promise.all(Array.from(document.images,image=>image.decode().catch(()=>{})))');
  if (!name.includes('install')) await evaluate('window.scrollTo({top:0,behavior:"instant"})');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await evaluate('document.getAnimations().forEach(a=>{if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish()})');
  const s = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}${name}.png`, Buffer.from(s.data, 'base64'));
}
async function choose(id, value) { await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function enterOn(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await pause(50); }
const results = {};
try {
  await send('Runtime.enable'); await send('Network.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: site });
  await until('document.getElementById("releaseStatus")?.getAttribute("role")==="alert"');
  results.realMissingApi = await evaluate('({disabled:document.getElementById("downloadUnavailable").disabled,link:document.getElementById("downloadLink").getAttribute("href"),rows:document.querySelectorAll(".artifact-row").length})');
  assert.equal(results.realMissingApi.link, null); assert.equal(results.realMissingApi.rows, 0);
  assert.equal(await evaluate('document.getElementById("releaseMetadata").hidden'), true);
  await screenshot('site-error');
  mode = 'hold';
  await send('Fetch.enable', { patterns: [{ urlPattern: `${site}/api/releases/latest.json`, requestStage: 'Request' }] });
  await send('Page.reload'); await until('document.getElementById("releaseMetadata")?.getAttribute("aria-busy")==="true"');
  await screenshot('site-loading'); await until('document.readyState==="complete"');
  for (let i = 0; !heldRequest && i < 50; i += 1) await pause(20);
  assert.ok(heldRequest); mode = 'success'; await fulfill(heldRequest, fixture); heldRequest = null;
  await until('document.getElementById("releaseMetadata")?.textContent.includes("1.0.0")');
  await choose('platform', 'darwin');
  assert.equal(await evaluate('document.getElementById("arch").value'), '');
  assert.equal(await evaluate('document.getElementById("downloadLink").hidden'), true);
  await screenshot('site-mac-selection');
  await choose('arch', 'arm64');
  results.selectedMac = await evaluate('({href:document.getElementById("downloadLink").getAttribute("href"),metadata:document.getElementById("releaseMetadata").textContent,rows:document.querySelectorAll(".artifact-row").length})');
  assert.equal(results.selectedMac.href, fixture.artifacts[0].url); assert.equal(results.selectedMac.rows, fixture.artifacts.length);
  await screenshot('site-desktop-fixture');
  await send('Emulation.setDeviceMetricsOverride', { width: 1435, height: 1058, deviceScaleFactor: 1, mobile: false });
  await screenshot('site-reference-viewport-fixture');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await enterOn('#checksumDetails summary');
  assert.equal(await evaluate('document.getElementById("checksumDetails").open'), true);
  await evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>{window.__qaCopied=value;}}})');
  await evaluate('document.getElementById("copySha256").click()');
  assert.equal(await evaluate('window.__qaCopied'), fixture.artifacts[0].sha256);
  await evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("Denied for test");}}})');
  await evaluate('document.getElementById("copySha512").click()');
  results.clipboard = await evaluate('({message:document.getElementById("copyStatus").textContent,selected:document.getElementById("sha512").selectionEnd-document.getElementById("sha512").selectionStart})');
  assert.equal(results.clipboard.selected, fixture.artifacts[0].sha512.length);
  await enterOn('#allDownloads summary');
  await evaluate('document.querySelectorAll(".artifact-row button")[1].click()');
  assert.equal(await evaluate('document.getElementById("downloadLink").getAttribute("href")'), fixture.artifacts[1].url);
  assert.equal(await evaluate('document.getElementById("sha256").value'), fixture.artifacts[1].sha256);
  results.perArtifactChecksums = true;
  await choose('platform', 'win32'); assert.equal(await evaluate('document.getElementById("arch").value'), 'x64');
  await choose('arch', 'arm64');
  assert.equal(await evaluate('document.getElementById("downloadLink").hidden'), true);
  assert.equal(await evaluate('document.getElementById("downloadLink").getAttribute("href")'), null);
  await screenshot('site-unpublished-selection');
  mode = 'empty'; await send('Page.reload'); await until('document.getElementById("releaseMetadata")?.textContent.includes("1.0.0")');
  results.empty = await evaluate('({rows:document.querySelectorAll(".artifact-row").length,text:document.getElementById("downloadUnavailable").textContent,disabled:document.getElementById("downloadUnavailable").disabled})');
  assert.equal(results.empty.rows, 0); assert.equal(results.empty.disabled, true);
  await screenshot('site-empty');
  mode = 'invalid'; await send('Page.reload'); await until('document.getElementById("releaseStatus")?.getAttribute("role")==="alert"');
  assert.equal(await evaluate('document.getElementById("downloadLink").getAttribute("href")'), null);
  mode = 'success'; await evaluate('document.getElementById("retry").click()'); await until('document.getElementById("releaseMetadata")?.textContent.includes("1.0.0")');
  await choose('platform', 'darwin'); await choose('arch', 'arm64');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  results.narrow = await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');
  assert.ok(results.narrow.scrollWidth <= results.narrow.width);
  await screenshot('site-narrow-fixture');
  await enterOn('.install-help summary');
  assert.equal(await evaluate('document.querySelector(".install-help").open'), true);
  await screenshot('site-install-narrow');
  await evaluate('document.querySelector(".install-help").open=false;document.activeElement.blur()');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await screenshot('site-dark-narrow-fixture');
  results.keyboardDetails = true; results.exceptions = exceptions; results.origins = [...origins];
  assert.equal(exceptions.length, 0);
  await writeFile(`${output}browser-qa.json`, JSON.stringify({ fixtureOnly: true, viewport: [1440, 1000], narrowViewport: [390, 844], clipboard: 'Stubbed success/denial; no system clipboard changed', ...results }, null, 2));
  console.log(JSON.stringify({ passed: true, screenshots: 10, exceptions: exceptions.length, targetClosedAfterRun: targetId }));
} finally {
  try { await send('Fetch.disable'); } catch {}
  connection.ws.close(); await fetch(`${base}/json/close/${targetId}`);
}
