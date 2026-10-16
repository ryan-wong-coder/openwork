// Verify the deployed site without intercepting its API or triggering installers.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.ZENO_SITE_CDP || 'http://127.0.0.1:60238';
const site = 'https://www.zeno.ryan-wong.cn';
const expectedVersion = process.argv[2] || JSON.parse(await readFile(new URL('../../desktop/package.json', import.meta.url), 'utf8')).version;
assert.match(expectedVersion, /^\d+\.\d+\.\d+$/); assert.ok(process.argv.length <= 3);
const output = fileURLToPath(new URL(`../verification/releases/${expectedVersion}/`, import.meta.url));
await mkdir(output, { recursive: true });
async function connect(url, onEvent = () => {}) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result); } }
    else onEvent(message);
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return { ws, send: (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); }) };
}
const browser = await connect((await (await fetch(`${base}/json/version`)).json()).webSocketDebuggerUrl);
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const target = (await (await fetch(`${base}/json/list`)).json()).find(target => target.id === targetId);
const exceptions = []; const origins = new Set();
const connection = await connect(target.webSocketDebuggerUrl, event => {
  if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails.text);
  if (event.method === 'Network.requestWillBeSent') { try { origins.add(new URL(event.params.request.url).origin); } catch {} }
});
const send = connection.send;
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
};
async function until(expression) {
  for (let index = 0; index < 200; index += 1) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(`Timed out: ${expression}`);
}
async function choose(id, value) {
  await evaluate(`(()=>{const field=document.getElementById(${JSON.stringify(id)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function shot(name) {
  await evaluate('Promise.all(Array.from(document.images).filter(image=>image.loading!=="lazy"||image.naturalWidth>0).map(image=>image.decode().catch(()=>{})))');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))');
  const result = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${output}${name}.png`, Buffer.from(result.data, 'base64'));
}
const report = { site, checkedAt: new Date().toISOString(), fixtureOnly: false, selections: [] };
try {
  await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Page.navigate', { url: site });
  await until('document.querySelectorAll(".artifact-row").length===10');
  const release = await evaluate('fetch("/api/releases/latest.json",{cache:"no-store"}).then(response=>{if(!response.ok)throw Error("API unavailable");return response.json()})');
  assert.equal(release.version, expectedVersion); assert.equal(release.artifacts.length, 10);
  for (const platform of ['darwin', 'win32', 'linux']) for (const arch of ['x64', 'arm64']) {
    await choose('platform', platform);
    if (platform === 'darwin') assert.equal(await evaluate('document.getElementById("downloadLink").hidden'), true);
    await choose('arch', arch);
    const selected = await evaluate('({href:document.getElementById("downloadLink").getAttribute("href"),hidden:document.getElementById("downloadLink").hidden,hash:document.getElementById("sha256").value})');
    const artifact = release.artifacts.find(artifact => artifact.url === selected.href);
    assert.ok(artifact); assert.equal(selected.hidden, false); assert.equal(artifact.platform, platform); assert.equal(artifact.arch, arch); assert.equal(selected.hash, artifact.sha256);
    report.selections.push({ platform, arch, name: artifact.name });
  }
  await choose('platform', 'darwin'); await choose('arch', 'arm64');
  await shot('site-live-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  await shot('site-live-mobile');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await shot('site-live-mobile-dark');
  assert.deepEqual(exceptions, []); assert.deepEqual([...origins].filter(origin => ![site, 'null'].includes(origin)), []);
  report.version = release.version; report.installers = release.artifacts.length; report.runtimeExceptions = exceptions; report.origins = [...origins]; report.passed = true;
  await writeFile(`${output}live-qa.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  connection.ws.close(); await browser.send('Target.closeTarget', { targetId }); browser.ws.close();
}
