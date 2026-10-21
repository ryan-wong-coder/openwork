/** Account scrolling regression: owned headless Chrome, production PWA, private loopback API. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
assert.equal(args[0], '--phase', 'use --phase before|after');
const phase = args[1];
assert.ok(phase === 'before' || phase === 'after', 'unsupported phase');
assert.ok(args.length === 2 || (args.length === 4 && args[2] === '--attempt' && /^[2-9][0-9]*$/.test(args[3])), 'unsupported arguments');
const output = resolve(repository, 'docs/evidence/zeno-1.1.3/account-scroll/local-' + phase, ...(args[3] ? ['attempt-' + args[3]] : []));
await mkdir(resolve(output, '..'), { recursive: true });
await mkdir(output); // Evidence receipts and screenshots are never overwritten.
const screenshots = resolve(output, 'screenshots');
await mkdir(screenshots);
const temporary = await mkdtemp(resolve(tmpdir(), 'zeno-account-scroll-'));
const password = randomBytes(24).toString('base64url');
const control = randomBytes(32).toString('hex');
const children = [], sockets = [], checks = [], images = [], measurements = [];
const exceptions = [], consoleErrors = [], externalRequests = [], blockedRequests = [], cspViolations = [], observedPolicies = new Set();
const productWrites = [];
let origin, page, browser, productionIndexSha256, fixtureCounts, stage = 'prepare', browserVersion;
const startedAt = new Date().toISOString();
const pause = ms => new Promise(done => setTimeout(done, ms));
function launch(command, argv, env = {}) {
  const child = spawn(command, argv, { cwd: repository, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  children.push(child);
  let stdout = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-65536); });
  child.stderr.on('data', () => {});
  child.on('error', () => {});
  return { child, stdout: () => stdout };
}
async function until(read, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await pause(100);
  }
  throw new Error('deadline:' + label);
}
async function connect(url, observe = () => {}) {
  const socket = new WebSocket(url); sockets.push(socket);
  const pending = new Map(); let sequence = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) { observe(message); return; }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error('cdp:' + message.error.code)); else request.done(message.result);
  };
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = () => reject(new Error('cdp:connect')); });
  return { send(method, params = {}) { return new Promise((done, reject) => {
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('cdp:timeout')); }, 30000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); } };
}
function observe(event) {
  if (event.method === 'Runtime.exceptionThrown') exceptions.push('renderer-exception');
  if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') consoleErrors.push('renderer-console-error');
  if (event.method === 'Runtime.bindingCalled' && event.params.name === 'zenoScrollCsp') cspViolations.push(JSON.parse(event.params.payload));
  if (event.method === 'Network.requestWillBeSent') {
    const url = new URL(event.params.request.url);
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) externalRequests.push('external-request');
    if (url.origin === origin && url.pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(event.params.request.method)) productWrites.push({ method: event.params.request.method, path: url.pathname });
  }
  if (event.method === 'Network.responseReceived' && event.params.type === 'Document') {
    const policy = Object.entries(event.params.response.headers).find(([key]) => key.toLowerCase() === 'content-security-policy')?.[1];
    if (policy) observedPolicies.add(createHash('sha256').update(policy).digest('hex'));
  }
  if (event.method === 'Fetch.requestPaused') {
    const request = event.params.request, url = new URL(request.url);
    const allowed = url.origin === origin && (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || (request.method === 'POST' && url.pathname === '/api/zeno/v1/auth/sign-in/email'));
    if (!allowed) blockedRequests.push({ kind: url.origin === origin ? 'unexpected-write' : 'external' });
    void page.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: event.params.requestId } : { requestId: event.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  }
}
async function evaluate(expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error('browser-evaluation-failed');
  return result.result.value;
}
const visible = `e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden],[inert],[aria-hidden=true]')`;
function check(name, detail = {}) { checks.push({ name, passed: true, ...detail }); console.info(JSON.stringify({ phase, check: name, passed: true })); }
async function target(label, scope = 'document') {
  return evaluate(`(() => {const root=${scope};if(!root)return null;const e=[...root.querySelectorAll('button,summary')].filter(${visible}).find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return x>0&&y>0&&x<innerWidth&&y<innerHeight&&hit&&e.contains(hit)?{x,y}:null;})()`);
}
async function click(label, scope = 'document') {
  const point = await until(() => target(label, scope), 'visible-button:' + label);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await pause(120);
}
async function input(selector, value) {
  assert.ok(await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.select();return document.activeElement===e;})()`), 'input-missing');
  await page.send('Input.insertText', { text: value });
}
async function controlCall(path, body) {
  const response = await fetch(origin + '/__qa/' + path, { method: body ? 'POST' : 'GET', headers: { 'x-zeno-qa': control, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, 200, 'control-failure'); return response.json();
}
async function dimensions() {
  return evaluate(`(() => {const e=document.querySelector('[data-zeno-account] > div'),shell=document.querySelector('[data-zeno-personal]');const r=e.getBoundingClientRect();return {viewportHeight:innerHeight,shellHeight:shell.getBoundingClientRect().height,rootHeight:document.querySelector('#root').clientHeight,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,documentScrollTop:document.scrollingElement.scrollTop,top:r.top,bottom:r.bottom,overflowY:getComputedStyle(e).overflowY};})()`);
}
async function gesture(mobile, direction = 1) {
  const point = await evaluate(`(() => {const r=document.querySelector('[data-zeno-account] > div').getBoundingClientRect();return {x:Math.round((Math.max(0,r.left)+Math.min(innerWidth,r.right))/2),y:Math.round(Math.min(innerHeight-150,Math.max(r.top+80,innerHeight*.65)))};})()`);
  if (mobile) await page.send('Input.synthesizeScrollGesture', { ...point, yDistance: -direction * 440, xDistance: 0, speed: 1600, gestureSourceType: 'touch' });
  else await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: direction * 600 });
  await pause(180);
}
async function seek(label, mobile, scope = 'document', direction = 1) {
  for (let count = 0; count < 24; count++) {
    if (await target(label, scope)) return;
    await gesture(mobile, direction);
  }
  throw new Error('unreachable:' + label);
}
async function toTop(mobile) {
  for (let count = 0; count < 24; count++) {
    if ((await dimensions()).scrollTop < 1) return;
    await gesture(mobile, -1);
  }
  throw new Error('unreachable:top');
}
async function screenshot(name) {
  await evaluate('document.activeElement?.blur()');
  await pause(150);
  assert.ok(!await evaluate('Boolean(document.querySelector("input[type=password]")?.value)'), 'password-in-capture');
  const size = await evaluate('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme})');
  assert.ok(size.scrollWidth <= size.width + 1, 'horizontal-overflow');
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, 'base64');
  await writeFile(resolve(screenshots, name + '.png'), bytes, { flag: 'wx' });
  images.push({ file: 'screenshots/' + name + '.png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...size });
}
async function theme(mode) {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
  await until(() => evaluate(`document.documentElement.dataset.theme===${JSON.stringify(mode)}`), 'theme');
}
async function navigate(label) {
  await click(label, `[...document.querySelectorAll('nav[aria-label="个人空间"]')].find(${visible})`);
  await until(() => evaluate(`document.querySelector('[data-zeno-${({ 日历: 'calendar', 健身: 'fitness', 任务: 'tasks', 账号: 'account' })[label]}]')?.getBoundingClientRect().height>0`), 'navigation');
}
try {
  const dist = resolve(repository, 'apps/app/dist-personal');
  const html = await readFile(resolve(dist, 'index.html'));
  productionIndexSha256 = createHash('sha256').update(html).digest('hex');
  assert.ok(html.includes(Buffer.from('/app/assets/')), 'production-build-required');
  if (phase === 'before') assert.equal(productionIndexSha256, 'e407b1b9d857ff33e604122be56254b9c3500aa87299923cd2426534a8a8e71b', 'original-release-build-required');
  const fixedDist = resolve(temporary, 'production-dist');
  await cp(dist, fixedDist, { recursive: true });
  assert.equal(createHash('sha256').update(await readFile(resolve(fixedDist, 'index.html'))).digest('hex'), productionIndexSha256, 'snapshot-changed');
  const fixture = launch('pnpm', ['exec', 'bun', 'apps/app/scripts/zeno-personal-browser-fixture.ts'], { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', ZENO_QA_ROOT: temporary, ZENO_QA_DIST: fixedDist, ZENO_QA_PASSWORD: password, ZENO_QA_CONTROL: control, ZENO_QA_ACCOUNT_SCROLL: '1' });
  origin = await until(() => { const line = fixture.stdout().split('\n').find(value => value.startsWith('{"ready":true')); return line ? JSON.parse(line).origin : null; }, 'fixture-ready', 45000);
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  fixtureCounts = await controlCall('scroll-fixture');
  assert.ok(fixtureCounts.users.count >= 21 && fixtureCounts.invites.count >= 44, 'long-lists-required');
  launch('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + resolve(temporary, 'chrome'), 'about:blank']);
  const port = await until(async () => { try { return (await readFile(resolve(temporary, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, 'chrome-ready');
  const endpoint = 'http://127.0.0.1:' + port;
  const version = await (await fetch(endpoint + '/json/version')).json(); browserVersion = version.Browser;
  browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const targetInfo = (await (await fetch(endpoint + '/json/list')).json()).find(value => value.id === targetId);
  page = await connect(targetInfo.webSocketDebuggerUrl, observe);
  for (const domain of ['Page', 'Runtime', 'Network']) await page.send(domain + '.enable');
  await page.send('Runtime.addBinding', { name: 'zenoScrollCsp' });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('securitypolicyviolation',e=>window.zenoScrollCsp(JSON.stringify({disposition:e.disposition,directive:e.effectiveDirective})));` });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*', requestStage: 'Request' }, { urlPattern: 'https://*', requestStage: 'Request' }] });
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await page.send('Page.navigate', { url: origin + '/app/account' });
  await until(() => evaluate('Boolean(document.querySelector("input[name=email]"))'), 'login-form');
  await input('input[name=email]', 'qa@example.test'); await input('input[name=password]', password); await click('登录');
  await until(() => evaluate('Boolean(document.querySelector("[data-zeno-account]"))'), 'account-ready');
  await until(() => evaluate('document.body.innerText.includes("合成成员 18")'), 'admin-list-ready');
  check('real-local-api-synthetic-admin-login', { users: fixtureCounts.users.count, invites: fixtureCounts.invites.count });
  for (const mobile of [false, true]) {
    const device = mobile ? 'mobile' : 'desktop'; stage = device + '-' + phase;
    await page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 });
    await theme('light'); await pause(250);
    const initial = await dimensions();
    if (phase === 'before') {
      assert.ok(initial.shellHeight > initial.viewportHeight + 500, 'before-shell-not-expanded');
      for (let count = 0; count < 4; count++) await gesture(mobile);
      const after = await dimensions();
      assert.equal(after.scrollTop, initial.scrollTop, 'before-unexpected-inner-scroll');
      assert.equal(after.documentScrollTop, initial.documentScrollTop, 'before-unexpected-document-scroll');
      assert.equal(await target('创建邀请'), null, 'before-invite-unexpectedly-reachable');
      measurements.push({ device, input: mobile ? 'CDP touch scroll gesture' : 'CDP mouse wheel', initial, after });
      await screenshot(device + '-cannot-scroll-light'); await theme('dark'); await screenshot(device + '-cannot-scroll-dark');
      check(device + '-original-build-scroll-failure-reproduced');
      continue;
    }
    assert.ok(Math.abs(initial.shellHeight - initial.viewportHeight) <= 1, 'after-shell-not-constrained');
    await toTop(mobile); const top = await dimensions();
    await gesture(mobile); const advanced = await dimensions();
    assert.ok(advanced.scrollTop >= 100, 'native-input-did-not-scroll');
    assert.ok(advanced.scrollHeight > advanced.clientHeight + 500, 'long-content-not-scrollable');
    assert.equal(advanced.documentScrollTop, 0, 'document-moved');
    await seek('创建邀请', mobile); await screenshot(device + '-invite-reachable-light');
    await click('创建邀请');
    assert.ok(await evaluate(`(() => {const e=document.querySelector('[data-zeno-account] input[type=email]');return e?.validity.valueMissing&&document.activeElement===e;})()`), 'invite-click-not-delivered');
    check(device + '-invite-button-reached-and-clicked-without-submission');
    await seek('邀请', mobile); await click('邀请');
    await until(() => evaluate(`[...document.querySelectorAll('[data-zeno-account] details')].find(e=>e.querySelector('summary')?.textContent==='邀请')?.open`), 'invite-list-open');
    await seek('功能', mobile);
    assert.ok(await evaluate(`[...document.querySelectorAll('[data-zeno-account] details')].find(e=>e.querySelector('summary')?.textContent==='邀请')?.querySelectorAll('li').length>=44`), 'long-invite-list-missing');
    await screenshot(device + '-long-invites-light');
    await seek('退出账号', mobile); await screenshot(device + '-bottom-light');
    const bottom = await dimensions();
    assert.ok(bottom.scrollTop > advanced.scrollTop + 500, 'long-list-not-traversed');
    if (mobile) assert.ok(await evaluate(`(() => {const n=[...document.querySelectorAll('nav[aria-label="个人空间"]')].filter(${visible})[0].getBoundingClientRect(),e=[...document.querySelectorAll('[data-zeno-account] button')].find(e=>e.textContent.trim()==='退出账号').getBoundingClientRect();return e.bottom<=n.top+1;})()`), 'bottom-nav-overlaps-action');
    await theme('dark'); await screenshot(device + '-bottom-dark'); await theme('light');
    check(device + '-long-user-and-invite-lists-bottom-reachable');
    measurements.push({ device, input: mobile ? 'CDP touch scroll gesture' : 'CDP mouse wheel', top, advanced, bottom });
    for (const label of ['日历', '健身', '任务', '账号']) await navigate(label);
    check(device + '-other-personal-pages-navigation');
    await toTop(mobile);
    await controlCall('scroll-error', { enabled: true }); await click('刷新设备');
    await until(() => evaluate('document.querySelector("[data-zeno-account] [role=alert]")?.textContent.includes("合成连接故障")'), 'inline-error');
    await screenshot(device + '-error-light');
    await gesture(mobile); assert.ok((await dimensions()).scrollTop >= 100, 'error-state-does-not-scroll');
    await controlCall('scroll-error', { enabled: false }); await toTop(mobile); await click('刷新设备');
    await until(() => evaluate('!document.querySelector("[data-zeno-account] [role=alert]")'), 'error-recovered');
    await until(() => evaluate('navigator.serviceWorker.ready.then(()=>Boolean(navigator.serviceWorker.controller))'), 'service-worker-ready');
    await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await page.send('Page.reload');
    await until(() => evaluate('Boolean(document.querySelector("[data-zeno-account]"))&&document.body.innerText.includes("离线，修改已保存在此设备")'), 'offline-account');
    await screenshot(device + '-offline-light');
    await gesture(mobile); assert.ok((await dimensions()).scrollTop >= 100, 'offline-state-does-not-scroll');
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.send('Page.reload'); await until(() => evaluate('document.body.innerText.includes("合成成员 18")'), 'online-recovered');
    check(device + '-error-and-offline-states-scroll');
  }
  stage = 'final';
  const final = await controlCall('scroll-fixture'); assert.equal(final.realModelCalls, 0);
  assert.equal(final.invites.count, fixtureCounts.invites.count, 'unexpected-invite-created');
  assert.ok(observedPolicies.size > 0, 'production-csp-missing');
  assert.equal(cspViolations.filter(value => value.disposition === 'enforce').length, 0, 'enforced-csp-violation');
  assert.equal(exceptions.length, 0, 'renderer-exception'); assert.equal(consoleErrors.length, 0, 'renderer-console-error');
  assert.equal(externalRequests.length, 0, 'external-request'); assert.equal(blockedRequests.length, 0, 'blocked-request');
  assert.ok(productWrites.every(value => value.method === 'POST' && value.path === '/api/zeno/v1/auth/sign-in/email'), 'unexpected-product-write');
  const report = { verdict: phase === 'before' ? 'Bug reproduced' : 'Passed', phase, scope: 'production PWA + real private loopback Bun API, synthetic accounts only; local regression, not live administrator or native desktop acceptance', startedAt, finishedAt: new Date().toISOString(), productionIndexSha256, browserVersion, fixture: { synthetic: true, users: final.users.count, invites: final.invites.count }, checks, measurements, screenshots: images, rendererExceptions: exceptions.length, rendererConsoleErrors: consoleErrors.length, enforcedCspViolations: cspViolations.filter(value => value.disposition === 'enforce').length, observedCspPolicySha256: [...observedPolicies].sort(), externalRequests: externalRequests.length, blockedRequests: blockedRequests.length, realModelCalls: final.realModelCalls, productWrites: productWrites.map(value => ({ ...value })), publicServerTested: false, nativeDesktopTested: false, installerTested: false, realInvitationsSent: false, ownedProfileRemoved: false };
  // Cleanup completes before publishing a successful receipt.
  for (const socket of sockets) socket.close();
  for (const child of [...children].reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await pause(300);
  for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await rm(temporary, { recursive: true, force: true }); report.ownedProfileRemoved = true;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.info(JSON.stringify({ verdict: report.verdict, phase, checks: checks.length, screenshots: images.length }));
} catch (error) {
  const reason = error instanceof Error && /^(deadline:|unreachable:|cdp:)/.test(error.message) ? error.message : 'assertion-or-fixture-failure';
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ verdict: 'Failed', phase, stage, reason, productionIndexSha256, startedAt, finishedAt: new Date().toISOString(), checks, measurements, screenshots: images, rendererExceptions: exceptions.length, rendererConsoleErrors: consoleErrors.length, blockedRequests: blockedRequests.length, externalRequests: externalRequests.length }, null, 2) + '\n', { flag: 'wx' });
  console.error(JSON.stringify({ verdict: 'Failed', phase, stage, reason, detail: error instanceof assert.AssertionError ? error.message : undefined })); process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  for (const child of [...children].reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await pause(300);
  for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await rm(temporary, { recursive: true, force: true });
}
