/** One owned synthetic invitation/account and two private headless tabs only. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPwaCsp } from './qa-public-personal.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ORIGIN = 'https://www.zeno.ryan-wong.cn';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUTPUT = join(ROOT, 'docs/evidence/zeno-1.1.1/device-approval/public-after');
const pause = ms => new Promise(done => setTimeout(done, ms));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [], sockets = [], exceptions = [], violations = [];
const report = { passed: false, checkedAt: new Date().toISOString(), origin: ORIGIN, checks, screenshots: [], scope: { ownedSyntheticAccount: true, actualPublicHttps: true, actualTwoTabs: false, realBrowserApprovalClick: false, devicePkceExchange: false, personalRecordWrites: false, administratorActions: false, modelsInvoked: false, nativeDesktop: false } };
let stage = 'private-arrangement', credentialsFile, credentials, cleanupIdentity = {}, temporary, child, browser, page, blocked = 0, external = 0, personalWrites = 0;
async function until(read, label, timeout = 45000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await read(); if (value) return value; await pause(100); } throw new Error('deadline:' + label); }
async function connect(url, observe = () => {}) {
  const address = new URL(url); assert.equal(address.protocol, 'ws:'); assert.equal(address.hostname, '127.0.0.1');
  const socket = new WebSocket(url); sockets.push(socket); let id = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const event = JSON.parse(data); if (!event.id) return observe(event); const request = pending.get(event.id); if (!request) return; pending.delete(event.id); clearTimeout(request.timer); event.error ? request.fail(new Error('owned-cdp-error')) : request.done(event.result); };
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('owned-cdp-failed')); });
  return { send(method, params = {}) { return new Promise((done, fail) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); fail(new Error('owned-cdp-timeout')); }, 30000); pending.set(key, { done, fail, timer }); socket.send(JSON.stringify({ id: key, method, params })); }); } };
}
const visible = `e=>e.getClientRects().length&&!e.closest('[hidden],[inert],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'`;
async function evaluate(expression) { const value = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!value.exceptionDetails, 'owned-page-evaluation-failed'); return value.result.value; }
async function button(label) { const point = await until(() => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].filter(${visible}).find(e=>(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)})&&!e.disabled);if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`), 'button'); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }); }
async function fill(selector, value) { assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.select();return document.activeElement===e})()`), true); await page.send('Input.insertText', { text: value }); }
function allowed(url, method) {
  const address = new URL(url);
  if (method === 'GET' && (address.protocol === 'data:' || address.protocol === 'blob:' && address.origin === ORIGIN)) return true;
  if (address.origin !== ORIGIN || address.username || address.password || address.hash) return false;
  if (method === 'GET' && address.pathname.startsWith('/app/')) return true;
  if (method === 'GET') return ['/api/zeno/v1/me', '/api/zeno/v1/features', '/api/zeno/v1/devices', '/api/zeno/v1/sync'].includes(address.pathname);
  return method === 'POST' && ['/api/zeno/v1/invites/redeem', '/api/zeno/v1/auth/sign-in/email', '/api/zeno/v1/devices/approve'].includes(address.pathname);
}
async function tab(cdp) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }); const target = (await (await fetch(cdp + '/json/list')).json()).find(value => value.id === targetId); assert.ok(target);
  let client;
  client = await connect(target.webSocketDebuggerUrl, event => {
    if (event.method === 'Runtime.exceptionThrown') exceptions.push('renderer-exception');
    if (event.method === 'Runtime.bindingCalled' && event.params.name === 'zenoApprovalCsp') violations.push('csp-violation');
    if (event.method === 'Network.requestWillBeSent') { try { const u = new URL(event.params.request.url); if (['http:', 'https:'].includes(u.protocol) && u.origin !== ORIGIN) external++; if (u.pathname.startsWith('/api/zeno/v1/records') && !['GET', 'HEAD'].includes(event.params.request.method)) personalWrites++; } catch {} }
    if (event.method === 'Fetch.requestPaused') { let permitted = false; try { permitted = allowed(event.params.request.url, event.params.request.method); } catch {} if (!permitted) blocked++; void client.send(permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: event.params.requestId, ...(permitted ? {} : { errorReason: 'BlockedByClient' }) }).catch(() => {}); }
  });
  await client.send('Page.enable'); await client.send('Runtime.enable'); await client.send('Network.enable'); await client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await client.send('Runtime.addBinding', { name: 'zenoApprovalCsp' }); await client.send('Page.addScriptToEvaluateOnNewDocument', { source: "addEventListener('securitypolicyviolation',()=>zenoApprovalCsp('violation'))" });
  await client.send('Page.bringToFront'); await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); return client;
}
async function api(path, method = 'GET', body, token) {
  assert.ok(['/devices/authorization', '/devices/token', '/me', '/sync?cursor=0&limit=500'].includes(path));
  const response = await fetch(ORIGIN + '/api/zeno/v1' + path, { method, redirect: 'error', credentials: 'omit', headers: { Origin: ORIGIN, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) }); return { status: response.status, data: await response.json() };
}
const check = name => { checks.push({ name, passed: true }); console.log('[zeno-public-approval] ' + name); };
try {
  const args = process.argv.slice(2); assert.ok(args.length === 2 && args[0] === '--credentials-file'); credentialsFile = resolve(args[1]); const permissions = await stat(credentialsFile); assert.equal(permissions.mode & 0o077, 0);
  credentials = JSON.parse(await readFile(credentialsFile, 'utf8')); assert.equal(typeof credentials.email, 'string'); assert.ok(credentials.email.endsWith('@example.invalid')); assert.equal(typeof credentials.password, 'string'); assert.ok(credentials.password.length >= 12);
  const invitation = new URL(credentials.inviteUrl); assert.equal(invitation.origin, ORIGIN); assert.equal(invitation.pathname, '/app/invite'); assert.ok(invitation.searchParams.get('token')); assert.ok(!invitation.username && !invitation.password && !invitation.hash);
  cleanupIdentity = { ownedSyntheticAccount: true, email: credentials.email };
  const entry = await fetch(ORIGIN + '/app/device', { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000) }); assert.equal(entry.status, 200); assertPwaCsp(entry.headers.get('content-security-policy')); const entryBytes = Buffer.from(await entry.arrayBuffer()); const expected = await readFile(join(ROOT, 'apps/app/dist-personal/index.html')); assert.equal(sha256(entryBytes), sha256(expected)); report.pwaIndexSha256 = sha256(entryBytes); check('public-device-page-matches-reviewed-hotfix-with-strict-csp');
  await mkdir(OUTPUT, { recursive: true }); temporary = await mkdtemp(join(tmpdir(), 'zeno-public-approval-')); const profile = join(temporary, 'chrome');
  child = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE www.zeno.ryan-wong.cn, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], { detached: true, stdio: 'ignore' }); child.on('error', () => {});
  const port = await until(async () => { try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, 'owned-chrome'); const cdp = 'http://127.0.0.1:' + port; const info = await (await fetch(cdp + '/json/version')).json(); report.browserVersion = info.Browser; browser = await connect(info.webSocketDebuggerUrl); await browser.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  stage = 'owned-invitation-registration'; page = await tab(cdp); const writerPage = page; await page.send('Page.navigate', { url: invitation.href }); await until(() => evaluate('Boolean(document.querySelector("input[name=invite]"))'), 'invitation-ui');
  await fill('input[name=email]', credentials.email); await fill('input[name=name]', '授权验收'); await fill('input[name=password]', credentials.password); await button('创建账号');
  await until(() => evaluate(`Boolean(document.querySelector('[data-zeno-calendar]'))&&[...document.querySelectorAll('[data-zeno-calendar] button')].some(e=>e.textContent.trim()==='新增'&&!e.disabled)`), 'authenticated-writer-tab');
  const member = await evaluate("fetch('/api/zeno/v1/me').then(async response=>({status:response.status,data:await response.json()}))"); assert.equal(member.status, 200); cleanupIdentity.userId = member.data.user.id; check('owned-invitation-redeemed-and-first-tab-holds-real-writer-lock');
  const verifier = randomBytes(32).toString('base64url'); const grant = await api('/devices/authorization', 'POST', { name: '授权验收电脑', platform: 'linux', codeChallenge: createHash('sha256').update(verifier).digest('base64url') }); assert.equal(grant.status, 201); cleanupIdentity.authorizationCodeHash = sha256(grant.data.deviceCode);
  const pending = await api('/devices/token', 'POST', { deviceCode: grant.data.deviceCode, codeVerifier: verifier }); assert.equal(pending.status, 428); const lastPoll = Date.now(); check('owned-pkce-authorization-awaits-manual-browser-approval');
  stage = 'second-tab-approval'; page = await tab(cdp); report.scope.actualTwoTabs = true; await page.send('Page.navigate', { url: ORIGIN + '/app/device?code=' + encodeURIComponent(grant.data.userCode) });
  await until(() => evaluate('Boolean(document.querySelector("[data-zeno-account]"))&&Boolean(document.querySelector("[data-zeno-writer=readonly]"))'), 'second-tab-readonly');
  const state = await evaluate(`(()=>{const input=document.querySelector('[data-zeno-account] form input');const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='同意连接');return{codeMatches:input?.value===${JSON.stringify(grant.data.userCode)},inputEnabled:input?.disabled===false,approvalEnabled:button?.disabled===false,recordReadonly:Boolean(document.querySelector('[data-zeno-writer=readonly]')),calendarLocked:[...document.querySelectorAll('[data-zeno-calendar] button')].find(e=>e.textContent.trim()==='新增')?.disabled===true,preferencesLocked:document.querySelector('[aria-label=日历时区]')?.disabled===true}})()`); for (const value of Object.values(state)) assert.equal(value, true); report.secondTab = state; check('prefilled-approval-enabled-with-calendar-and-preferences-still-locked');
  await button('同意连接'); await until(() => evaluate('document.body.innerText.includes("已授权此电脑同步")'), 'actual-ui-approval'); report.scope.realBrowserApprovalClick = true;
  if (Date.now() - lastPoll < 5000) await pause(5000 - (Date.now() - lastPoll));
  const bound = await api('/devices/token', 'POST', { deviceCode: grant.data.deviceCode, codeVerifier: verifier }); assert.equal(bound.status, 200); cleanupIdentity.deviceId = bound.data.deviceId; report.scope.devicePkceExchange = true;
  const device = await api('/me', 'GET', undefined, bound.data.accessToken); assert.equal(device.status, 200); assert.equal(device.data.deviceId, bound.data.deviceId); assert.equal(device.data.user.id, member.data.user.id);
  const data = await api('/sync?cursor=0&limit=500', 'GET', undefined, bound.data.accessToken); assert.equal(data.status, 200); assert.ok(Array.isArray(data.data.records)); assert.ok(data.data.records.every(record => record.userId === member.data.user.id));
  await button('刷新设备'); await until(() => evaluate('document.body.innerText.includes("授权验收电脑")'), 'real-device-list'); const devices = await evaluate("fetch('/api/zeno/v1/devices').then(async response=>({status:response.status,data:await response.json()}))"); assert.equal(devices.status, 200); assert.ok(devices.data.devices.some(value => value.id === bound.data.deviceId && value.name === '授权验收电脑')); check('approved-pkce-device-owner-me-list-and-read-boundary-verified');
  assert.equal(await evaluate(`document.querySelector('[data-zeno-account] form input')?.value`), '');
  await evaluate(`(()=>{for(const element of document.querySelectorAll('[data-zeno-account] p'))if(element.textContent===${JSON.stringify(credentials.email)})element.textContent='合成账号';return true})()`);
  assert.equal(await evaluate(`document.body.innerText.includes(${JSON.stringify(credentials.email)})`), false); assert.equal(await evaluate('Boolean(document.querySelector("input[type=password]"))'), false);
  await page.send('Page.bringToFront'); await evaluate('document.fonts.ready.then(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))'); const image = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const bytes = Buffer.from(image.data, 'base64'); await writeFile(join(OUTPUT, 'second-tab-approved.png'), bytes); report.screenshots.push({ file: 'second-tab-approved.png', bytes: bytes.length, sha256: sha256(bytes), syntheticAccountIdentifierRedacted: true, authorizationInputEmpty: true });
  page = writerPage; assert.equal(await evaluate(`[...document.querySelectorAll('[data-zeno-calendar] button')].find(e=>e.textContent.trim()==='新增')?.disabled`), false); assert.equal(personalWrites, 0); assert.equal(blocked, 0); assert.equal(external, 0); assert.equal(exceptions.length, 0); assert.equal(violations.length, 0); check('original-record-writer-retained-with-zero-personal-writes-or-renderer-errors'); report.passed = true;
} catch (error) { report.failedStage = stage; report.errorKind = error?.name === 'AssertionError' ? 'AssertionError' : 'Error'; process.exitCode = 1; }
finally {
  try { await browser?.send('Browser.close'); } catch {} for (const socket of sockets) socket.close(); if (child) { try { await until(() => child.exitCode !== null || child.signalCode !== null, 'owned-chrome-cleanup', 5000); } catch { child.kill('SIGTERM'); } } if (temporary) await rm(temporary, { recursive: true, force: true });
  if (credentialsFile && credentials) await writeFile(credentialsFile + '.cleanup.json', JSON.stringify(cleanupIdentity) + '\n', { mode: 0o600 });
  report.network = { blockedRequests: blocked, externalRequests: external, personalRecordWrites: personalWrites, rendererExceptions: exceptions.length, cspViolations: violations.length, scope: 'owned-page CDP plus external DNS denial, not system packet capture' }; report.cleanup = 'owned Chrome/profile removed; synthetic service account/device/invitation cleanup belongs to release operator';
  await mkdir(OUTPUT, { recursive: true }); await writeFile(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log('[zeno-public-approval] ' + (report.passed ? 'passed' : 'failed') + '; sanitized evidence saved');
}
