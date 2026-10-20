/** Actual production PWA + real isolated API, two owned tabs; no live account or AI. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const mode = process.env.ZENO_DEVICE_QA_MODE ?? 'fixed'; assert.ok(['blocked', 'fixed'].includes(mode));
const output = resolve(repository, 'docs/evidence/zeno-1.1.1/device-approval', mode === 'blocked' ? 'local-before' : 'local-after');
const dist = resolve(process.env.ZENO_DEVICE_QA_DIST ?? join(repository, 'apps/app/dist-personal'));
const temporary = await mkdtemp(join(tmpdir(), 'zeno-device-approval-'));
const password = randomBytes(24).toString('base64url'), control = randomBytes(32).toString('hex');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const children = [], sockets = [], checks = [], exceptions = [], externalOrigins = new Set();
let stage = 'prepare', browser, page, origin, approvalRequests = 0;
const report = { passed: false, mode, checkedAt: new Date().toISOString(), checks, screenshots: [], scope: { realIsolatedApi: true, realProductionPwa: true, actualTwoTabs: false, liveAccount: false, modelsInvoked: false, nativeDesktop: false } };
const pause = ms => new Promise(done => setTimeout(done, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function launch(command, args, environment = {}) {
  const child = spawn(command, args, { cwd: repository, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...environment } }); children.push(child);
  let stdout = ''; child.stdout.on('data', value => { stdout = (stdout + value).slice(-32768); }); child.stderr.resume(); child.on('error', () => {});
  return { child, stdout: () => stdout };
}
async function until(read, label, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await read(); if (value) return value; await pause(100); } throw new Error('deadline:' + label); }
async function connect(url, observe = () => {}) {
  assert.equal(new URL(url).hostname, '127.0.0.1'); const socket = new WebSocket(url); sockets.push(socket); let sequence = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const event = JSON.parse(data); if (!event.id) return observe(event); const request = pending.get(event.id); if (!request) return; pending.delete(event.id); clearTimeout(request.timer); event.error ? request.fail(new Error('cdp-error')) : request.done(event.result); };
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('owned-cdp-failed')); });
  return { send(method, params = {}) { return new Promise((done, fail) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); fail(new Error('cdp-timeout')); }, 30000); pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
}
function observe(event) {
  if (event.method === 'Runtime.exceptionThrown') exceptions.push('renderer-exception');
  if (event.method === 'Network.requestWillBeSent') { try { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) externalOrigins.add(url.origin); if (url.pathname === '/api/zeno/v1/devices/approve' && event.params.request.method === 'POST') approvalRequests++; } catch {} }
}
async function evaluate(expression) { const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, 'owned-page-evaluation-failed'); return result.result.value; }
const visible = `e=>e.getClientRects().length&&!e.closest('[hidden],[inert],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'`;
async function button(label) {
  const point = await until(() => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].filter(${visible}).find(e=>(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)})&&!e.disabled);if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`), 'button:' + label);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function fill(selector, value) { assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.select();return document.activeElement===e})()`), true); await page.send('Input.insertText', { text: value }); }
async function request(path, { method = 'GET', body, token, cookie, account } = {}) {
  const response = await fetch(origin + '/api/zeno/v1' + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(account ? { 'X-Zeno-Account': account } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json(); return { response, data };
}
async function signedRequest(path, method = 'GET', body) { return evaluate(`(async()=>{const me=await(await fetch('/api/zeno/v1/me')).json();const r=await fetch(${JSON.stringify('/api/zeno/v1' + path)},{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json','X-Zeno-Account':me.user.id},body:${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))}});return{status:r.status,data:await r.json()}})()`); }
async function grant(name) { const verifier = randomBytes(32).toString('base64url'); const started = await request('/devices/authorization', { method: 'POST', body: { name, platform: 'linux', codeChallenge: createHash('sha256').update(verifier).digest('base64url') } }); assert.equal(started.response.status, 201); return { ...started.data, verifier }; }
async function newTab(cdp) { const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }); const targets = await (await fetch(cdp + '/json/list')).json(); const target = targets.find(value => value.id === targetId); assert.ok(target); const client = await connect(target.webSocketDebuggerUrl, observe); await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Network.enable'); await client.send('Page.bringToFront'); await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); return client; }
const check = name => { checks.push({ name, passed: true }); console.log('[zeno-device-qa] ' + name); };
async function pairingState() { return evaluate(`(()=>{const input=[...document.querySelectorAll('label')].find(e=>e.textContent.includes('电脑端授权码'))?.querySelector('input');const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='同意连接');return{prefilled:Boolean(input?.value),inputDisabled:input?.disabled,approvalDisabled:button?.disabled,readonly:Boolean(document.querySelector('[data-zeno-writer=readonly]')),calendarDisabled:[...document.querySelectorAll('[data-zeno-calendar] button')].find(e=>e.textContent.trim()==='新增')?.disabled,preferencesDisabled:document.querySelector('[aria-label=日历时区]')?.disabled}})()`); }

try {
  await mkdir(output, { recursive: true }); const frozen = join(temporary, 'dist'); await cp(dist, frozen, { recursive: true }); report.pwaIndexSha256 = sha256(await readFile(join(frozen, 'index.html')));
  const fixture = launch('pnpm', ['exec', 'bun', 'apps/app/scripts/zeno-personal-browser-fixture.ts'], { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', ZENO_QA_ROOT: temporary, ZENO_QA_DIST: frozen, ZENO_QA_PASSWORD: password, ZENO_QA_CONTROL: control });
  origin = await until(() => { const line = fixture.stdout().split('\n').find(value => value.startsWith('{"ready":true')); return line ? JSON.parse(line).origin : null; }, 'real-api-ready'); assert.equal(new URL(origin).hostname, '127.0.0.1');
  launch(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + join(temporary, 'chrome'), 'about:blank']);
  const port = await until(async () => { try { return (await readFile(join(temporary, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, 'owned-chrome'); const cdp = 'http://127.0.0.1:' + port;
  const info = await (await fetch(cdp + '/json/version')).json(); browser = await connect(info.webSocketDebuggerUrl); await browser.send('Browser.setDownloadBehavior', { behavior: 'deny' }); page = await newTab(cdp); const writerPage = page;
  stage = 'login-writer-tab'; await page.send('Page.navigate', { url: origin + '/app/calendar' }); await until(() => evaluate('Boolean(document.querySelector("[data-zeno-auth]"))'), 'login-view');
  await fill('input[name=email]', 'qa-a@example.test'); await fill('input[name=password]', password); await button('登录'); await until(() => evaluate(`Boolean(document.querySelector('[data-zeno-calendar]'))&&[...document.querySelectorAll('[data-zeno-calendar] button')].some(e=>e.textContent.trim()==='新增'&&!e.disabled)`), 'first-tab-writer'); check('first-authenticated-tab-holds-real-record-writer-lock');
  const before = await (await fetch(origin + '/__qa/state', { headers: { 'x-zeno-qa': control } })).json();
  const pending = await grant('合成授权电脑');
  const poll = await request('/devices/token', { method: 'POST', body: { deviceCode: pending.deviceCode, codeVerifier: pending.verifier } }); assert.equal(poll.response.status, 428); check('real-pkce-device-poll-starts-pending');
  stage = 'second-tab-approval'; page = await newTab(cdp); const approvalPage = page; report.scope.actualTwoTabs = true;
  await page.send('Page.navigate', { url: origin + '/app/device?code=' + encodeURIComponent(pending.userCode) });
  await until(() => evaluate('Boolean(document.querySelector("[data-zeno-account]"))&&Boolean(document.querySelector("[data-zeno-writer=readonly]"))'), 'second-tab-readonly');
  const state = await pairingState(); assert.equal(state.prefilled, true); assert.equal(state.readonly, true); assert.equal(state.calendarDisabled, true); assert.equal(state.preferencesDisabled, true); report.secondTab = state;
  if (mode === 'blocked') { assert.equal(state.approvalDisabled, true); assert.equal(state.inputDisabled, true); assert.equal(approvalRequests, 0); check('original-production-pwa-reproduces-disabled-approval-in-second-tab'); report.passed = true; }
  else {
    assert.equal(state.approvalDisabled, false); assert.equal(state.inputDisabled, false); check('server-only-approval-enabled-while-local-calendar-and-preferences-remain-locked');
    stage = 'approve-through-ui'; await button('同意连接'); await until(() => evaluate('document.body.innerText.includes("已授权此电脑同步")'), 'approval-success');
    const bound = await request('/devices/token', { method: 'POST', body: { deviceCode: pending.deviceCode, codeVerifier: pending.verifier } }); assert.equal(bound.response.status, 200); assert.equal(typeof bound.data.accessToken, 'string');
    const device = await request('/me', { token: bound.data.accessToken }); assert.equal(device.response.status, 200); assert.equal(device.data.deviceId, bound.data.deviceId);
    const member = await signedRequest('/me'); assert.equal(member.status, 200); assert.equal(device.data.user.id, member.data.user.id);
    await button('刷新设备'); await until(() => evaluate('document.body.innerText.includes("合成授权电脑")'), 'approved-device-listed');
    const devices = await signedRequest('/devices'); assert.equal(devices.status, 200); assert.ok(devices.data.devices.some(value => value.id === bound.data.deviceId && value.name === '合成授权电脑'));
    assert.equal((await pairingState()).readonly, true); check('actual-approval-pkce-exchange-owner-binding-and-server-device-list');
    const captured = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const screenshot = Buffer.from(captured.data, 'base64'); assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(e=>e.textContent.includes('电脑端授权码'))?.querySelector('input')?.value`), ''); await writeFile(join(output, 'second-tab-approved.png'), screenshot); report.screenshots.push({ file: 'second-tab-approved.png', bytes: screenshot.length, sha256: sha256(screenshot) });
    const reused = await request('/devices/token', { method: 'POST', body: { deviceCode: pending.deviceCode, codeVerifier: pending.verifier } }); assert.equal(reused.response.status, 400); check('approved-pkce-grant-cannot-be-replayed');
    stage = 'server-rejection'; await fill('[data-zeno-account] form input', 'NOTACODE'); await button('同意连接'); await until(() => evaluate('Boolean(document.querySelector("[role=alert]"))'), 'invalid-code-error'); assert.equal(await evaluate('document.body.innerText.includes("已授权此电脑同步")'), false); check('server-rejection-shown-without-false-approval');
    const bearerApproval = await request('/devices/approve', { method: 'POST', token: bound.data.accessToken, body: { userCode: 'NOTACODE' }, account: member.data.user.id }); assert.equal(bearerApproval.response.status, 403); check('device-bearer-cannot-approve-another-device');
    stage = 'feature-off'; const admin = await request('/auth/sign-in/email', { method: 'POST', body: { email: 'qa-admin@example.test', password } }); assert.equal(admin.response.status, 200); const cookie = admin.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const disabled = await request('/admin/features', { method: 'PUT', cookie, account: admin.data.user.id, body: { key: 'zenoAccounts', enabled: false } }); assert.equal(disabled.response.status, 200);
    await page.send('Page.reload'); await until(async () => { const value = await pairingState(); return value.readonly && value.approvalDisabled && value.inputDisabled; }, 'feature-off-blocks-ui');
    const previousRequests = approvalRequests; await evaluate(`(()=>{const f=document.querySelector('[data-zeno-account] form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`); await until(() => evaluate('Boolean(document.querySelector("[role=alert]"))'), 'feature-off-submit-guard'); assert.equal(approvalRequests, previousRequests); check('feature-off-blocks-input-button-and-forged-form-submit');
    const denied = await signedRequest('/devices/approve', 'POST', { userCode: 'NOTACODE' }); assert.equal(denied.status, 404); assert.equal(denied.data.code, 'feature_disabled'); check('server-feature-gate-independently-rejects-approval');
    page = writerPage; assert.equal(await evaluate(`[...document.querySelectorAll('[data-zeno-calendar] button')].find(e=>e.textContent.trim()==='新增')?.disabled`), false);
    const after = await (await fetch(origin + '/__qa/state', { headers: { 'x-zeno-qa': control } })).json(); assert.deepEqual(after.records, before.records); assert.equal(after.realModelCalls, 0); check('writer-ownership-and-all-personal-records-preserved-with-no-model-call');
    page = approvalPage; assert.equal(exceptions.length, 0); assert.equal(externalOrigins.size, 0); report.passed = true;
  }
} catch (error) { report.failedStage = stage; report.errorKind = error?.name === 'AssertionError' ? 'AssertionError' : 'Error'; process.exitCode = 1; }
finally {
  try { await browser?.send('Browser.close'); } catch {} for (const socket of sockets) socket.close();
  for (const child of children.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await pause(300); for (const child of children) if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await rm(temporary, { recursive: true, force: true }); report.cleanup = 'owned API, Chrome, synthetic account database and temporary profiles removed'; report.rendererExceptions = exceptions.length; report.externalOriginsObserved = externalOrigins.size;
  await mkdir(output, { recursive: true }); await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log('[zeno-device-qa] ' + (report.passed ? 'passed' : 'failed') + '; sanitized evidence saved');
}
