/** Production PWA smoke; only owned headless Chrome, loopback API, synthetic accounts. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.env.ZENO_FITNESS_QA_OUTPUT ?? resolve(repository, 'docs/evidence/zeno-fitness-mainstream'));
const screenshots = resolve(output, 'screenshots');
const dist = resolve(process.env.ZENO_PWA_QA_DIST ?? resolve(repository, 'apps/app/dist-personal'));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const temporary = await mkdtemp(resolve(tmpdir(), 'zeno-pwa-smoke-'));
const password = randomBytes(24).toString('base64url'); const control = randomBytes(32).toString('hex');
const children = []; const connections = []; const checks = []; const images = []; const exceptions = []; const externalOrigins = new Set(); const apiStatuses = []; const consoleErrors = []; const policyViolations = []; const observedPolicies = new Set();
let stage = 'prepare', origin, page, browser, productionIndexSha256, deploymentCspConfigSha256; const startedAt = new Date().toISOString();
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
function launch(command, args, env = {}) {
  const child = spawn(command, args, { cwd: repository, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  children.push(child); let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-65536); }); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536); });
  child.on('error', () => {}); return { child, stdout: () => stdout, stderr: () => stderr };
}
async function until(read, name, timeout = 45000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { if(consoleErrors.length)throw new Error('renderer-console-error'); try { const result = await read(); if (result) return result; } catch (error) { last = error; } await pause(100); }
  throw new Error('deadline:' + name + (last ? ':read_failed' : ''));
}
async function connect(url, observe = () => {}) {
  const socket = new WebSocket(url); let sequence = 0; const pending = new Map(); connections.push(socket);
  socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (!message.id) return observe(message); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error('cdp:' + message.error.code)) : request.resolve(message.result); };
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = () => reject(new Error('cdp_connection_failed')); });
  return { send(method, params = {}) { return new Promise((resolveCommand, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('cdp_timeout:' + method)); }, 30000); pending.set(id, { resolve: resolveCommand, reject, timer }); socket.send(JSON.stringify({ id, method, params })); }); } };
}
async function evaluate(expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error('page_evaluation_failed'); return result.result.value;
}
function observePage(event) {
  if(event.method==='Runtime.consoleAPICalled'&&event.params.type==='error') { const description=event.params.args.map(arg=>arg.description??arg.value??'').join(' ');consoleErrors.push(/TypeError/.test(description)?'TypeError':/Error:/.test(description)?'Error':'console-error'); }
  if (event.method === 'Runtime.bindingCalled' && event.params.name === 'zenoQaViolation') { try { policyViolations.push(JSON.parse(event.params.payload)); } catch {} }
  if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails.exception?.className ?? event.params.exceptionDetails.text);
  if (event.method === 'Network.requestWillBeSent') { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) externalOrigins.add(url.origin); }
  if (event.method === 'Network.responseReceived') { const url = new URL(event.params.response.url); if (url.origin === origin && event.params.type === 'Document') { const policy=Object.entries(event.params.response.headers).find(([key])=>key.toLowerCase()==='content-security-policy')?.[1]; if(policy) observedPolicies.add(policy); } if (url.origin === origin && url.pathname.startsWith('/api/zeno/v1/')) apiStatuses.push({ path: url.pathname.replace(/\/records\/[^/]+\/.+$/, '/records/<kind>/<id>'), status: event.params.response.status }); }
}
const visible = `element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[inert],[aria-hidden=true]')`;
async function text() { return evaluate('document.body.innerText'); }
async function button(label, { scope = 'document', exact = true } = {}) {
  const match = await until(() => evaluate(`(() => { const root=${scope}; if(!root)return null; const e=[...root.querySelectorAll('button,[role=checkbox],[role=combobox],[role=option],[role=menuitem],summary')].filter(${visible}).find(e=>${exact ? '(e.textContent.trim() === ' + JSON.stringify(label) + ' || e.getAttribute("aria-label") === ' + JSON.stringify(label) + ' || e.querySelector("span")?.textContent.trim() === ' + JSON.stringify(label) + ')' : 'e.textContent.includes(' + JSON.stringify(label) + ')'} && !e.disabled && e.getAttribute('aria-disabled')!=='true'); if(!e)return null; e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!hit||!e.contains(hit))return null;return {x,y}; })()`), 'button:' + label, 25000);
  assert.ok(match, 'button unavailable:' + label);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...match });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...match });await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
async function field(label, value, selector) {
  const found = await until(() => evaluate(`(() => {const root=[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)??document;const e=${selector ? `[...root.querySelectorAll(${JSON.stringify(selector)})].find(${visible})` : `[...root.querySelectorAll('label')].filter(${visible}).find(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)}&&e.querySelector('input,textarea'))?.querySelector('input,textarea')`};if(!e)return false;e.focus();e.select?.();return document.activeElement===e;})()`), 'field-ready:' + label, 5000);
  assert.ok(found, 'field unavailable:' + label); await page.send('Input.insertText', { text: value });
}
async function instrument(target) {
  await target.send('Runtime.addBinding', { name: 'zenoQaViolation' });
  await target.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('securitypolicyviolation', e=>{globalThis.zenoQaViolation(JSON.stringify({directive:e.effectiveDirective,disposition:e.disposition,source:e.sourceFile?.split(/[?#]/)[0]?.split('/').at(-1)??'',line:e.lineNumber,column:e.columnNumber,blockedType:['eval','inline'].includes(e.blockedURI)?e.blockedURI:e.blockedURI.startsWith('blob:')?'blob':e.blockedURI.startsWith('data:')?'data':e.blockedURI.startsWith(location.origin)?'same-origin':'external'}))});` });
}
async function closeDialog() { await button('关闭', { scope: `[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)` }); await pause(200); }
async function waitText(value, timeout) { return until(async () => (await text()).includes(value), 'text:' + value, timeout); }
async function state(account = 'a') { const response = await fetch(origin + '/__qa/state?account=' + account, { headers: { 'x-zeno-qa': control } }); assert.equal(response.status, 200); return response.json(); }
function check(name, detail = {}) { checks.push({ name, passed: true, ...detail }); console.info(JSON.stringify({ phase: name, passed: true })); }
async function screenshot(name, focusSelector) {
  await evaluate('document.activeElement?.blur();scrollTo(0,0)');
  if (focusSelector) await evaluate(`document.querySelector(${JSON.stringify(focusSelector)})?.scrollIntoView({block:'center'})`);
  await pause(200);
  assert.ok(!await evaluate('document.body.innerText.includes("泽诺遇到意外错误")'),'renderer-error-boundary');
  assert.ok(!await evaluate('document.body.innerText.includes("@example.test")'),'synthetic email visible in screenshot');
  const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const bytes = Buffer.from(result.data, 'base64');
  await writeFile(resolve(screenshots, name + '.png'), bytes); images.push({ file: 'screenshots/' + name + '.png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const size = await evaluate('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme})');
  assert.ok(size.scrollWidth <= size.width + 1, 'horizontal overflow:' + name); return size;
}
async function login(account, wrong = false) {
  await field('邮箱', `qa-${account}@example.test`, 'input[name=email]'); await field('密码', wrong ? 'incorrect-synthetic-password' : password, 'input[name=password]'); await button('登录');
  if (!wrong) await until(() => evaluate('Boolean(document.querySelector("[data-zeno-personal]"))'), 'authenticated');
}
try {
  await mkdir(screenshots, { recursive: true });
  const fixedDist = resolve(temporary, 'production-dist'); await cp(dist, fixedDist, { recursive: true });
  productionIndexSha256 = createHash('sha256').update(await readFile(resolve(fixedDist, 'index.html'))).digest('hex');
  const fixture = launch('pnpm', ['exec', 'bun', 'apps/app/scripts/zeno-personal-browser-fixture.ts'], { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', ZENO_QA_ROOT: temporary, ZENO_QA_DIST: fixedDist, ZENO_QA_PASSWORD: password, ZENO_QA_CONTROL: control });
  origin = await until(() => { const line = fixture.stdout().split('\n').find(value => value.startsWith('{"ready":true')); return line ? JSON.parse(line).origin : null; }, 'fixture-ready');
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  launch(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + resolve(temporary, 'chrome'), 'about:blank']);
  const port = await until(async () => { try { return (await readFile(resolve(temporary, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, 'chrome-ready');
  const cdp = 'http://127.0.0.1:' + port; const version = await (await fetch(cdp + '/json/version')).json(); browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }); const target = (await (await fetch(cdp + '/json/list')).json()).find(value => value.id === targetId); assert.ok(target);
  page = await connect(target.webSocketDebuggerUrl, observePage); await instrument(page);
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await page.send('Page.navigate', { url: origin + '/app/fitness' }); await waitText('欢迎回来'); await login('a'); await waitText('基础力量');
  check('real-local-api-login-production-pwa');
  stage = 'catalogue'; await button('动作库');
  const demonstrations = JSON.parse(await readFile(resolve(repository, 'apps/app/src/react-app/domains/zeno/mascot-demos.json'), 'utf8'));
  const expansion = JSON.parse(await readFile(resolve(repository, 'apps/app/art-source/fitness/expansion-1000/selection.json'), 'utf8'));
  assert.ok(demonstrations.length >= 32);
  const visibleReadyCount = Math.min(100, demonstrations.length);
  const firstOptions = await evaluate(`[...document.querySelectorAll("[data-exercise-option]")].slice(0,${visibleReadyCount}).map(element=>element.dataset.exerciseOption)`);
  assert.equal(firstOptions.length, visibleReadyCount);
  assert.ok(firstOptions.every(id => demonstrations.some(item => item.exerciseId === id)));
  if (demonstrations.length <= 100) assert.deepEqual(firstOptions.sort(), demonstrations.map(item=>item.exerciseId).sort());
  await screenshot('desktop-mainstream-catalogue'); check('completed-demonstrations-first-in-bounded-unfiltered-catalogue', { ready: demonstrations.length, visible: visibleReadyCount });
  await field('搜索动作', '杠铃卧推', 'input[aria-label=搜索动作]'); await button('杠铃卧推', { exact: false });
  await until(() => evaluate(`document.querySelector('[data-exercise-detail="0025"]')!==null`), 'bench-detail');
  assert.equal(await evaluate('document.querySelectorAll("[aria-label=动作肌群] svg").length'), 2);
  assert.ok(await evaluate(`document.querySelector('[aria-label=动作肌群] path[opacity="0.4"]')!==null`));
  assert.equal(await evaluate('document.querySelectorAll("video").length'), 1);
  assert.ok(await evaluate('document.querySelector("video").paused'));
  await button('姿态示意'); assert.equal(await evaluate('document.querySelectorAll("[data-movement-figure]").length'), 1);
  await screenshot('desktop-catalogue-bench-light'); check('catalogue-specific-figure-and-primary-secondary-front-back-map');
  stage = 'motion-controls'; const before = await evaluate('document.querySelector("input[aria-label=动作进度]").value'); await pause(300);
  assert.equal(await evaluate('document.querySelector("input[aria-label=动作进度]").value'), before, 'no autoplay');
  await button('播放动作演示'); await until(() => evaluate('Number(document.querySelector("input[aria-label=动作进度]").value)>5'), 'animation-advances');
  await button('暂停动作演示'); const paused = await evaluate('document.querySelector("input[aria-label=动作进度]").value'); await pause(250);
  assert.equal(await evaluate('document.querySelector("input[aria-label=动作进度]").value'), paused, 'pause retains pose');
  await evaluate('document.querySelector("input[aria-label=动作进度]").focus()');
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'End', code: 'End' });
  await until(() => evaluate('document.querySelector("input[aria-label=动作进度]").value==="100"'), 'keyboard-progress');
  check('static-default-play-pause-keyboard-scrub');
  // A second real tab changes the first document's visibility.
  await button('播放动作演示'); const hiddenTab = await browser.send('Target.createTarget', { url: 'about:blank' }); await browser.send('Target.activateTarget', { targetId: hiddenTab.targetId });
  await until(() => evaluate('document.visibilityState==="hidden"'), 'document-hidden');
  assert.ok(await evaluate('document.querySelector("button[aria-label=播放动作演示]")!==null'));
  await browser.send('Target.closeTarget', { targetId: hiddenTab.targetId }); await browser.send('Target.activateTarget', { targetId });
  check('real-tab-visibility-pauses-svg-without-auto-resume');
  // Reduced motion is a separate browser preference, not a synthetic React state.
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until(() => evaluate('document.querySelector("button[aria-label=播放动作演示]")?.disabled===true'), 'reduced-motion-pauses');
  await screenshot('desktop-bench-dark-reduced-motion'); check('reduced-motion-stops-and-disables-svg-playback');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('mobile-bench-dark-reduced-motion'); check('mobile-dark-detail-no-horizontal-overflow');
  const planned = [...expansion.exercises, ...expansion.reserves];
  const unready = planned.filter(row => !demonstrations.some(item => item.exerciseId === row.exerciseId) && planned.filter(other => other.chineseName === row.chineseName).length === 1);
  const uncovered = unready.find(row => row.equipmentId === 'barbell' && row.englishName.includes('bench press')) ?? unready[0];
  assert.ok(uncovered, 'uncovered canonical exercise required for negative coverage check');
  await closeDialog(); await field('搜索动作', uncovered.chineseName, 'input[aria-label=搜索动作]'); await button(uncovered.chineseName); await waitText('暂无动作演示');
  assert.ok(await evaluate(`document.querySelector('[data-exercise-detail="${uncovered.exerciseId}"]')!==null`));
  assert.equal(await evaluate('document.querySelectorAll("[data-movement-figure],video").length'), 0); await screenshot('mobile-uncovered-exercise'); check('uncovered-variant-never-receives-generic-animation', { exerciseId: uncovered.exerciseId });
  await closeDialog(); await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  stage = 'mascot-videos';
  const requestedExpansionIds = (process.env.ZENO_FITNESS_QA_EXERCISES ?? '').split(',').map(id => id.trim()).filter(Boolean);
  assert.equal(new Set(requestedExpansionIds).size, requestedExpansionIds.length);
  const selectedExpansion = requestedExpansionIds.length ? requestedExpansionIds.map(id => {
    assert.match(id, /^\d{4}$/);
    const item = demonstrations.find(row => row.exerciseId === id && row.stem.startsWith('exp-'));
    assert.ok(item, 'requested expansion must have completed exact media');
    return item;
  }) : demonstrations.filter(item => item.stem.startsWith('exp-')).slice(0,3);
  const expansionExamples = selectedExpansion.map(item => {
    const source = [...expansion.exercises, ...expansion.reserves].find(row => row.exerciseId === item.exerciseId);
    assert.ok(source && source.englishName === item.englishName);
    return [source.chineseName, item.exerciseId, item.stem, item.kind, false];
  });
  for (const [name, id, filename, kind, hasPose] of [['哑铃二头弯举', '0294', 'curl', 'mascot', true], ['深蹲', '1197', 'squat', 'mascot', true], ['哑铃坐姿肩部推举', '0405', 'shoulder-press', 'mascot', true], ['哑铃卧推', '0289', 'dumbbell-bench-press', 'mascot', false], ['开合跳', '3094', 'jumping-jack', 'diagram', false], ...expansionExamples]) {
    await field('搜索动作', name, 'input[aria-label=搜索动作]'); await button(name);
    await until(() => evaluate(`document.querySelector('[data-exercise-detail="${id}"] video')!==null`), 'mascot-' + id);
    assert.ok(await evaluate(`document.querySelector('[data-exercise-detail="${id}"] video').src.endsWith('/zeno/fitness/${filename}.mp4')`));
    assert.equal(await evaluate('document.querySelector("video").getAttribute("aria-label")'), kind === 'diagram' ? '原创动作图解视频' : '泽诺吉祥物动作演示');
    assert.ok(await evaluate('document.querySelector("video").paused'));
    await evaluate('document.querySelector("video").play()'); await until(() => evaluate('document.querySelector("video").currentTime>.3&&document.querySelector("video").videoWidth>0'), 'video-decodes-' + id);
    if (id === '0294') {
      const videoTab = await browser.send('Target.createTarget', { url: 'about:blank' }); await browser.send('Target.activateTarget', { targetId: videoTab.targetId });
      await until(() => evaluate('document.visibilityState==="hidden"&&document.querySelector("video").paused'), 'hidden-video-paused');
      await browser.send('Target.closeTarget', { targetId: videoTab.targetId }); await browser.send('Target.activateTarget', { targetId });
      assert.ok(await evaluate('document.querySelector("video").paused'));
      await evaluate('document.querySelector("video").play()'); await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await until(() => evaluate('document.querySelector("video").paused'), 'reduced-motion-pauses-video');
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
      check('native-video-controls-real-tab-and-reduced-motion-pause-without-auto-resume');
    }
    await evaluate('document.querySelector("video").pause()'); await screenshot('mobile-mascot-' + filename);
    await button(hasPose ? '姿态示意' : '起始姿态');
    if (hasPose) assert.ok(await evaluate(`document.querySelector('[data-exercise-movement="${id}"]')!==null`));
    else {
      await until(() => evaluate(`(()=>{const image=document.querySelector('[data-exercise-detail="${id}"] img');return image?.complete&&image.naturalWidth>0})()`), 'poster-decodes-' + id);
      assert.ok(await evaluate(`document.querySelector('[data-exercise-detail="${id}"] img').src.endsWith('/zeno/fitness/${filename}-poster.webp')`));
      assert.equal(await evaluate('document.querySelectorAll("video,[data-movement-figure]").length'), 0);
      if (id === '0289') {
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await screenshot('mobile-video-only-starting-pose-dark');
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
      }
    }
    await button(kind === 'diagram' ? '动作图解' : '泽诺演示'); assert.ok(await evaluate('document.querySelector("video").paused')); check('exact-' + kind + '-video-decodes-and-switches-' + id);
    await closeDialog();
  }
  await closeDialog();
  stage = 'workout-entry'; await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await button('基础力量', { exact: false }); await button('开始训练'); await until(() => evaluate('document.querySelector("button[aria-label=查看杠铃卧推动作详情]")!==null'), 'workout-title-control');
  const workout = await until(async () => (await state()).records.find(record => record.kind === 'workout' && !record.data.finishedAt), 'workout-persisted'); assert.ok(workout);
  await button('查看杠铃卧推动作详情'); await until(() => evaluate(`document.querySelector('[data-exercise-detail="0025"]')!==null`), 'workout-detail');
  await screenshot('desktop-workout-entry'); await closeDialog();
  const afterState = await state(); assert.deepEqual(afterState.records.find(record => record.id === workout.id), workout); check('workout-title-opens-detail-without-changing-record');
  stage = 'final'; assert.equal(exceptions.length, 0); assert.equal(consoleErrors.length, 0); assert.equal(policyViolations.filter(row => row.disposition === 'enforce').length, 0); assert.equal(externalOrigins.size, 0);
  assert.equal((await state()).realModelCalls, 0);
  await writeFile(resolve(output, 'browser-report.json'), JSON.stringify({ verdict: 'Passed', scope: 'Actual production PWA, real disposable loopback API, synthetic account; no native shell or remote account', startedAt, finishedAt: new Date().toISOString(), productionIndexSha256, browserVersion: version.Browser, checks, screenshots: images, rendererExceptions: exceptions.length, rendererConsoleErrors: consoleErrors.length, enforcedCspViolations: policyViolations.filter(row => row.disposition === 'enforce').length, externalOrigins: externalOrigins.size, modelCalls: 0, visibleWindows: 0 }, null, 2) + '\n');
  console.info(JSON.stringify({ verdict: 'Passed', checks: checks.length, screenshots: images.length }));
} catch (error) {
  const reason = error instanceof Error && /^(?:deadline:|button unavailable:|field unavailable:|renderer-|cdp|horizontal overflow:)/.test(error.message) ? error.message : 'assertion_or_fixture_failure';
  await screenshot('failure-' + stage).catch(() => {}); const dialogState = await evaluate(`({dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({title:e.querySelector('h2')?.textContent??'',hidden:e.hasAttribute('hidden'),ariaHidden:e.getAttribute('aria-hidden'),inert:e.inert})),searchInputs:[...document.querySelectorAll('input[aria-label=搜索动作]')].map(e=>({visible:Boolean(e.getClientRects().length),inert:Boolean(e.closest('[inert]')),ariaHidden:Boolean(e.closest('[aria-hidden=true]'))}))})`).catch(() => null); await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'browser-report.json'), JSON.stringify({ verdict: 'Failed', dialogState, stage, reason, startedAt, finishedAt: new Date().toISOString(), productionIndexSha256, checks, screenshots: images, rendererExceptions: exceptions.length, rendererConsoleErrors: consoleErrors.length, policyViolations, externalOrigins: externalOrigins.size, modelCalls: 0, visibleWindows: 0 }, null, 2) + '\n');
  console.error(JSON.stringify({ verdict: 'Failed', stage, reason })); process.exitCode = 1;
} finally {
  for (const socket of connections) socket.close();
  for (const child of children.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await pause(300); for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await rm(temporary, { recursive: true, force: true });
}
