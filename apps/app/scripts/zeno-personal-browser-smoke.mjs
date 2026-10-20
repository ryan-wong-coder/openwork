/** Production PWA smoke; only owned headless Chrome, loopback API, synthetic accounts. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const mode=process.env.ZENO_PWA_QA_MODE??'full';assert.ok(['full','workspace'].includes(mode),'unsupported QA mode');
const output = resolve(process.env.ZENO_PWA_QA_OUTPUT ?? resolve(repository, mode==='full'?'docs/evidence/zeno-1.1.0':'docs/evidence/zeno-1.1.0/workspace-delta'));
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
  const match = await until(() => evaluate(`(() => { const root=${scope}; if(!root)return null; const e=[...root.querySelectorAll('button,[role=checkbox],[role=combobox],[role=option],[role=menuitem],summary')].filter(${visible}).find(e=>${exact ? '(e.textContent.trim() === ' + JSON.stringify(label) + ' || e.getAttribute("aria-label") === ' + JSON.stringify(label) + ')' : 'e.textContent.includes(' + JSON.stringify(label) + ')'} && !e.disabled && e.getAttribute('aria-disabled')!=='true'); if(!e)return null; e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!hit||!e.contains(hit))return null;return {x,y}; })()`), 'button:' + label, 25000);
  assert.ok(match, 'button unavailable:' + label);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...match });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...match });await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
async function field(label, value, selector) {
  const found = await evaluate(`(() => {const root=[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)??document;const e=${selector ? `[...root.querySelectorAll(${JSON.stringify(selector)})].find(${visible})` : `[...root.querySelectorAll('label')].filter(${visible}).find(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)}&&e.querySelector('input,textarea'))?.querySelector('input,textarea')`};if(!e)return false;e.focus();e.select?.();return document.activeElement===e;})()`);
  assert.ok(found, 'field unavailable:' + label); await page.send('Input.insertText', { text: value });
}
function technicalPng(rgb) {
  const width=128,height=192;const raw=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)raw[y*(width*3+1)+1+x*3+c]=Math.round(rgb[c]*(x<width/2?1:0.65));
  const chunk=(type,data)=>{const kind=Buffer.from(type);const body=Buffer.concat([kind,data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;}const length=Buffer.alloc(4);length.writeUInt32BE(data.length);const check=Buffer.alloc(4);check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,body,check]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
async function instrument(target) {
  await target.send('Runtime.addBinding', { name: 'zenoQaViolation' });
  await target.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('securitypolicyviolation', e=>{globalThis.zenoQaViolation(JSON.stringify({directive:e.effectiveDirective,disposition:e.disposition,source:e.sourceFile?.split(/[?#]/)[0]?.split('/').at(-1)??'',line:e.lineNumber,column:e.columnNumber,blockedType:['eval','inline'].includes(e.blockedURI)?e.blockedURI:e.blockedURI.startsWith('blob:')?'blob':e.blockedURI.startsWith('data:')?'data':e.blockedURI.startsWith(location.origin)?'same-origin':'external'}))});` });
}
async function choose(label, value) { await button(label); await button(value,{scope:`[...document.querySelectorAll('[role=listbox]')].find(${visible})`,exact:false}); }
async function closeDialog() { await page.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape'}); await page.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape'}); await pause(150); }
async function inputValue(label, value) {
  const ok = await evaluate(`(()=>{const e=[...document.querySelectorAll('label')].filter(${visible}).find(e=>e.querySelector('span')?.textContent.trim()===${JSON.stringify(label)}&&e.querySelector('input'))?.querySelector('input');if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`); assert.ok(ok,'field unavailable:'+label);
}
async function fileInput(selector, filename) {
  const found=await evaluate(`(()=>{const root=[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)??document;const input=[...root.querySelectorAll(${JSON.stringify(selector)})].find(${visible});if(!input)return false;input.setAttribute('data-zeno-qa-upload','chosen');return true})()`);assert.ok(found,'file input unavailable');
  const {root}=await page.send('DOM.getDocument');const {nodeId}=await page.send('DOM.querySelector',{nodeId:root.nodeId,selector:'[data-zeno-qa-upload=chosen]'});assert.ok(nodeId);await page.send('DOM.setFileInputFiles',{nodeId,files:[filename]});await evaluate(`document.querySelector('[data-zeno-qa-upload=chosen]')?.removeAttribute('data-zeno-qa-upload')`);
}
async function controlCall(path, body) { const response=await fetch(origin+'/__qa/'+path,{method:body?'POST':'GET',headers:{'x-zeno-qa':control,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200);return response.json(); }
async function waitText(value, timeout) { return until(async () => (await text()).includes(value), 'text:' + value, timeout); }
async function state(account = 'a') { const response = await fetch(origin + '/__qa/state?account=' + account, { headers: { 'x-zeno-qa': control } }); assert.equal(response.status, 200); return response.json(); }
async function waitRecord(predicate, name) { return until(async () => (await state()).records.find(predicate), name, 60000); }
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
async function theme(mode) { await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] }); await until(() => evaluate(`document.documentElement.dataset.theme===${JSON.stringify(mode)}`), 'theme:' + mode); }
async function login(account, wrong = false) {
  await field('邮箱', `qa-${account}@example.test`, 'input[name=email]'); await field('密码', wrong ? 'incorrect-synthetic-password' : password, 'input[name=password]'); await button('登录');
  if (!wrong) await until(() => evaluate('Boolean(document.querySelector("[data-zeno-personal]"))'), 'authenticated');
}
async function navigate(label) { await button(label,{scope:`[...document.querySelectorAll('nav[aria-label="个人空间"]')].find(${visible})`}); }
async function calendar() { await button('日历', { scope: `[...document.querySelectorAll('nav[aria-label="个人空间"]')].find(${visible})` }); await waitText('项目讨论'); }
async function createEvent(title) {
  await button('新增', { scope: 'document.querySelector("[data-zeno-calendar]")' }); await field('日程', title); await button('保存', { scope: `[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)` });
  await until(() => evaluate('!document.querySelector("[role=dialog]")'), 'event-dialog-closed');
}
try {
  await mkdir(screenshots, { recursive: true }); const html = await readFile(resolve(dist, 'index.html'));
  assert.ok(html.includes(Buffer.from('/app/assets/')), 'production dist-personal required');productionIndexSha256=createHash('sha256').update(html).digest('hex');deploymentCspConfigSha256=createHash('sha256').update(await readFile(resolve(repository,'infra/zeno-release/zeno-api/nginx-locations.conf'))).digest('hex');
  const fixedDist=resolve(temporary,'production-dist');await cp(dist,fixedDist,{recursive:true});
  assert.equal(createHash('sha256').update(await readFile(resolve(fixedDist,'index.html'))).digest('hex'),productionIndexSha256,'production snapshot changed during copy');
  const fixture = launch('pnpm', ['exec', 'bun', 'apps/app/scripts/zeno-personal-browser-fixture.ts'], { PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false', ZENO_QA_ROOT: temporary, ZENO_QA_DIST: fixedDist, ZENO_QA_PASSWORD: password, ZENO_QA_CONTROL: control });
  origin = await until(() => { const line = fixture.stdout().split('\n').find(value => value.startsWith('{"ready":true')); return line ? JSON.parse(line).origin : null; }, 'api-ready', 30000);
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  launch(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + resolve(temporary, 'chrome'), 'about:blank']);
  const port = await until(async () => { try { return (await readFile(resolve(temporary, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, 'chrome-ready');
  const cdp = 'http://127.0.0.1:' + port; const version = await (await fetch(cdp + '/json/version')).json(); browser = await connect(version.webSocketDebuggerUrl); await mkdir(resolve(temporary,'downloads'),{recursive:true}); await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:resolve(temporary,'downloads')});
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }); const target = (await (await fetch(cdp + '/json/list')).json()).find(value => value.id === targetId); assert.ok(target);
  page = await connect(target.webSocketDebuggerUrl, observePage);
  await instrument(page); await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable'); await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await page.send('Page.navigate', { url: origin + '/app/calendar' }); await waitText('欢迎回来');
  stage = 'login-error'; await login('a', true); await until(() => evaluate('Boolean(document.querySelector("[role=alert]"))'), 'login-error');
  await field('邮箱', '', 'input[name=email]'); await field('密码', '', 'input[name=password]');
  assert.ok(await evaluate('[...document.querySelectorAll("input[name=email],input[name=password]")].every(e=>e.value.length===0)')); await screenshot('desktop-login-error'); check('invalid-login-visible');
  stage = 'login'; await login('a'); await waitText('项目讨论'); check('real-form-login');
  {
    stage='workspace-association';await button('新增',{scope:'document.querySelector("[data-zeno-calendar]")'});await field('日程','工作区关联测试');await button('工作区');await choose('关联工作区','测试工作区');await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
    const linked=await waitRecord(record=>record.kind==='event'&&record.data.title==='工作区关联测试'&&record.data.workspaceId==='qa-workspace','workspace-linked-record');check('workspace-event-created-through-ui');
    await button('工作区关联测试',{exact:false,scope:'document.querySelector("[data-zeno-calendar]")'});await button('工作区');assert.ok(await evaluate('document.querySelector("[aria-label=关联工作区]")?.textContent.includes("测试工作区")'));await screenshot('desktop-workspace-association');await choose('关联工作区','个人全局');await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});await waitRecord(record=>record.id===linked.id&&record.version===2&&record.data.workspaceId===undefined,'workspace-link-cleared');check('workspace-event-cleared-to-personal-through-ui');
    await controlCall('remote-edit',{id:linked.id,description:'合成缺失工作区关联',workspaceId:'synthetic-retired-workspace'});await page.send('Page.reload');await waitText('工作区关联测试');await button('工作区关联测试',{exact:false,scope:'document.querySelector("[data-zeno-calendar]")'});await button('工作区');assert.ok(await evaluate('document.querySelector("[aria-label=关联工作区]")?.textContent.includes("已关联工作区（暂不可用）")'));assert.ok(!await evaluate('document.body.innerText.includes("synthetic-retired-workspace")'));await field('日程','工作区缺失仍保留');await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});await waitRecord(record=>record.id===linked.id&&record.version===4&&record.data.workspaceId==='synthetic-retired-workspace'&&record.data.title==='工作区缺失仍保留','missing-workspace-link-preserved');check('missing-workspace-link-retained-with-safe-label');
  }if(mode==='full'){
  stage = 'calendar-create'; await createEvent('界面创建的日程'); await waitRecord(record => record.kind === 'event' && record.data.title === '界面创建的日程', 'event-persisted'); check('calendar-created-through-ui');
  await screenshot('desktop-calendar-light'); await theme('dark'); await screenshot('desktop-calendar-dark'); await theme('light');
  stage = 'calendar-edit'; await button('界面创建的日程', { exact: false, scope: 'document.querySelector("[data-zeno-calendar]")' }); await field('日程', '界面编辑后的日程'); await button('保存', { scope: `[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)` });
  await waitRecord(record => record.kind === 'event' && record.data.title === '界面编辑后的日程' && record.version === 2, 'event-edited'); check('calendar-edited-through-ui');
  await button('界面编辑后的日程', { exact: false, scope: 'document.querySelector("[data-zeno-calendar]")' }); await button('删除', { scope: `[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)` });
  await until(async () => !(await state()).records.some(record => record.kind === 'event' && record.data.title === '界面编辑后的日程'), 'event-deleted'); check('calendar-deleted-through-ui');
  stage = 'calendar-series-atomic-undo';
  await button('新增', {scope:'document.querySelector("[data-zeno-calendar]")'}); await field('日程','连续日程撤销');
  const dates=await evaluate(`(()=>{const d=new Date();const key=x=>[x.getFullYear(),String(x.getMonth()+1).padStart(2,'0'),String(x.getDate()).padStart(2,'0')].join('-');const old=new Date(d.getTime()-86400000);return {today:key(d),yesterday:key(old)}})()`);
  await inputValue('开始',dates.yesterday+'T08:00'); await inputValue('结束',dates.yesterday+'T09:00'); await choose('重复','每天'); await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  const series=await waitRecord(record=>record.kind==='event'&&record.data.title==='连续日程撤销','daily-series-created');
  await button('日',{scope:'document.querySelector("[aria-label=日历视图]")'}); await button('连续日程撤销',{exact:false,scope:'document.querySelector("[data-zeno-calendar]")'});
  await choose('修改范围','此日程及之后'); await inputValue('开始',dates.today+'T08:30'); await inputValue('结束',dates.today+'T09:30'); await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  await until(async()=>{const rows=(await state()).records.filter(record=>record.kind==='event'&&record.data.title==='连续日程撤销');return rows.length===2&&rows.some(record=>record.id===series.id&&record.version===2)},'series-split-two-records');
  await button('撤销',{scope:'document.querySelector("[data-zeno-personal]")'});
  await until(async()=>{const rows=(await state()).records.filter(record=>record.kind==='event'&&record.data.title==='连续日程撤销');return rows.length===1&&rows[0].id===series.id&&rows[0].version===3&&rows[0].data.recurrence.until===null},'series-undo-both-atomic'); check('daily-series-following-edit-and-atomic-two-record-undo');
  await button('连续日程撤销',{exact:false,scope:'document.querySelector("[data-zeno-calendar]")'}); await choose('修改范围','此日程及之后'); await inputValue('开始',dates.today+'T08:30'); await inputValue('结束',dates.today+'T09:30'); await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  await until(async()=>(await state()).records.filter(record=>record.kind==='event'&&record.data.title==='连续日程撤销').length===2,'series-second-split');
  const remote=await controlCall('remote-edit',{id:series.id,description:'服务器保留修改'}); await button('撤销',{scope:'document.querySelector("[data-zeno-personal]")'});
  await until(()=>evaluate('Boolean(document.querySelector("[role=alert]"))||document.body.innerText.includes("项修改需要处理")'),'undo-remote-version-conflict');
  const refused=(await state()).records.filter(record=>record.kind==='event'&&record.data.title==='连续日程撤销'); assert.equal(refused.length,2);assert.equal(refused.find(record=>record.id===series.id).version,remote.version);assert.equal(refused.find(record=>record.id===series.id).data.description,'服务器保留修改');check('batch-undo-refuses-remote-version-and-preserves-both-records',{server409Observed:apiStatuses.some(item=>item.path.endsWith('/records/batch')&&item.status===409)});if((await text()).includes('项修改需要处理')){await button('处理');await button('使用已同步版本');await until(async()=>!(await text()).includes('项修改需要处理'),'batch-undo-conflict-dismissed');}
  await button('周',{scope:'document.querySelector("[aria-label=日历视图]")'});
  stage = 'service-worker'; await until(() => evaluate('navigator.serviceWorker.ready.then(()=>Boolean(navigator.serviceWorker.controller))'), 'service-worker-control'); await page.send('Page.reload'); await waitText('项目讨论');
  check('production-service-worker-controls-page');
  const cachedPaths = await evaluate(`(async()=>{const paths=[];for(const key of await caches.keys()){for(const request of await (await caches.open(key)).keys())paths.push(new URL(request.url).pathname)}return paths})()`);
  assert.ok(cachedPaths.length > 3); assert.ok(cachedPaths.every(path => path.startsWith('/app/') && !path.includes('/api/'))); check('service-worker-cache-contains-only-public-shell', { cachedPaths: cachedPaths.length });
  stage = 'same-account-two-tabs';
  const mainPage = page; const { targetId: secondId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const secondTarget = (await (await fetch(cdp + '/json/list')).json()).find(value => value.id === secondId); assert.ok(secondTarget);
  const secondPage = await connect(secondTarget.webSocketDebuggerUrl, observePage); page = secondPage;
  await instrument(page); await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable'); await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: origin + '/app/calendar' }); await waitText('页签乙编辑日程');
  await until(() => evaluate('Boolean(document.querySelector("[data-zeno-writer=readonly]"))'), 'second-tab-read-only-banner');
  assert.ok(await evaluate(`[...document.querySelectorAll('[data-zeno-calendar] button')].find(e=>e.textContent.trim()==='新增')?.disabled`));
  check('second-account-tab-is-explicitly-read-only');
  for (const tab of [mainPage, secondPage]) await tab.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  page = mainPage; await page.send('Page.bringToFront'); await button('页签甲编辑日程', { exact: false, scope: 'document.querySelector("[data-zeno-calendar]")' }); await field('日程', '甲页签保留的修改'); await button('保存', { scope: `[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)` });
  assert.equal((await state()).records.find(record => record.id === 'qa-tab-a')?.version, 1);
  page = secondPage; await page.send('Page.bringToFront'); await waitText('甲页签保留的修改'); check('read-only-tab-receives-offline-edit-broadcast');
  await browser.send('Target.closeTarget', { targetId });
  await until(() => evaluate(`[...document.querySelectorAll('[data-zeno-calendar] button')].some(e=>e.textContent.trim()==='新增'&&!e.disabled)`), 'second-tab-acquires-writer-lock');
  await button('页签乙编辑日程', { exact: false, scope: 'document.querySelector("[data-zeno-calendar]")' }); await field('日程', '乙页签接管后的修改'); await button('保存', { scope: `[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)` });
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await waitRecord(record => record.kind === 'event' && record.id === 'qa-tab-a' && record.version === 2 && record.data.title === '甲页签保留的修改', 'tab-a-edit-preserved');
  await waitRecord(record => record.kind === 'event' && record.id === 'qa-tab-b' && record.version === 2 && record.data.title === '乙页签接管后的修改', 'tab-b-edit-preserved');
  check('writer-handoff-preserves-closed-tab-outbox-and-new-edit');
  stage = 'offline'; await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.send('Page.reload'); await waitText('离线，修改已保存在此设备'); await waitText('项目讨论'); check('offline-cold-reload-keeps-account-and-history');
  await createEvent('离线创建的日程'); assert.equal((await state()).records.some(record => record.kind === 'event' && record.data.title === '离线创建的日程'), false); await screenshot('desktop-offline-calendar'); check('offline-ui-change-queued-without-server-write');
  stage = 'conflict-local';
  await button('冲突测试日程', { exact: false, scope: 'document.querySelector("[data-zeno-calendar]")' }); await field('日程', '此设备的冲突修改'); await button('保存', { scope: `[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)` });
  const changed = await fetch(origin + '/__qa/conflict', { method: 'POST', headers: { 'x-zeno-qa': control } }); assert.equal(changed.status, 200);
  stage = 'reconnect'; await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await waitRecord(record => record.kind === 'event' && record.data.title === '离线创建的日程', 'offline-synced'); check('offline-outbox-syncs-after-reconnect');
  await waitText('项修改需要处理', 60000); await button('处理'); await waitText('处理修改冲突'); await waitText('远端第三版日程'); await screenshot('desktop-conflict');
  await button('保留此设备修改'); await until(async () => !(await text()).includes('项修改需要处理'), 'conflict-resolved');
  await waitRecord(record => record.kind === 'event' && record.id === 'qa-conflict' && record.version === 4 && record.data.title === '此设备的冲突修改', 'local-conflict-applied-on-v3'); check('real-v3-conflict-preserves-local-edit-as-v4');
  stage = 'account-preferences'; await navigate('账号');
  await choose('默认重量单位','磅 lb'); await waitRecord(record=>record.kind==='settings'&&record.data.unit==='lb','default-unit-saved');
  await choose('日历时区','协调世界时'); await waitRecord(record=>record.kind==='settings'&&record.data.timeZone==='UTC','timezone-saved');
  await page.send('Page.reload'); await until(()=>evaluate('document.querySelector("[aria-label=默认重量单位]")?.textContent.includes("lb")&&document.querySelector("[aria-label=日历时区]")?.textContent.includes("协调世界时")'),'preferences-reloaded');
  await choose('默认重量单位','公斤 kg'); await waitRecord(record=>record.kind==='settings'&&record.data.unit==='kg','default-unit-restored');
  await choose('日历时区','上海 · 中国标准时间'); await waitRecord(record=>record.kind==='settings'&&record.data.timeZone==='Asia/Shanghai','timezone-restored'); check('timezone-and-weight-unit-saved-and-reloaded-through-ui');
  stage = 'fitness-settings'; await navigate('健身'); await button('记录',{scope:`[...document.querySelectorAll('section')].find(e=>e.querySelector('h2')?.textContent==='今日状态')`});
  await choose('训练日状态','休息'); await field('备注','合成训练日说明'); await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  await waitRecord(record=>record.kind==='settings'&&Object.values(record.data.fitnessDayNotes??{}).some(note=>note.text==='合成训练日说明'&&note.tag==='rest'),'day-note-saved'); check('day-note-saved-through-ui');
  await button('计划',{scope:'document.querySelector("nav[aria-label=健身页面]")'}); await button('设置',{scope:`[...document.querySelectorAll('section')].find(e=>e.querySelector('h2')?.textContent==='我的器械')`});
  await field('拥有的哑铃 · 单只重量（kg）','5、10、20'); await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  await waitRecord(record=>record.kind==='settings'&&JSON.stringify(record.data.fitnessEquipment?.dumbbells?.kg)==='[5,10,20]','equipment-saved'); check('owned-equipment-saved-through-ui');await screenshot('desktop-fitness-plans');
  stage = 'plan-print-document'; await button('基础力量',{exact:false,scope:'document.querySelector("[data-zeno-fitness]")'});
  await evaluate(`(()=>{window.__zenoPrintResult=null;const observer=new MutationObserver(()=>{const frame=document.querySelector('iframe[title="训练计划打印"]');if(!frame)return;observer.disconnect();frame.contentWindow.print=()=>{const doc=frame.contentDocument;window.__zenoPrintResult={title:doc.title,text:doc.body.innerText,sections:doc.querySelectorAll('section').length,navigation:doc.querySelectorAll('nav,[role=dialog],input').length,styleApplied:doc.defaultView.getComputedStyle(doc.body).color};frame.contentWindow.dispatchEvent(new Event('afterprint'))}});observer.observe(document.body,{childList:true});})()`);
  await button('打印或存为 PDF'); const printed=await until(()=>evaluate('window.__zenoPrintResult'),'separate-plan-print-document'); assert.equal(printed.title,'基础力量');assert.ok(printed.text.includes('杠铃卧推'));assert.equal(printed.sections,1);assert.equal(printed.navigation,0);assert.ok(!printed.text.includes('账号'));assert.equal(printed.styleApplied,'rgb(22, 46, 42)'); check('actual-plan-only-print-iframe-under-production-csp',{actualPdf:false}); await closeDialog();
  stage = 'custom-exercise-media';
  const videoPath=resolve(temporary,'synthetic-form-check.mp4'); const video=launch('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=128x128:d=0.2','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',videoPath]); await until(()=>video.child.exitCode!==null,'synthetic-video-created'); assert.equal(video.child.exitCode,0); const videoBytes=await readFile(videoPath); const videoHash=createHash('sha256').update(videoBytes).digest('hex');
  await button('动作库'); await button('自定义动作'); await field('动作名称','自定义动作测试'); await field('主要肌群','胸部'); await field('器械','哑铃'); await field('动作步骤','保持稳定姿势');
  await fileInput('[role=dialog] input[type=file][multiple]',videoPath); await until(()=>evaluate('Boolean(document.querySelector("[role=dialog] video"))'),'custom-video-preview');await screenshot('desktop-custom-exercise-media','[role=dialog] video'); await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  const custom=await waitRecord(record=>record.kind==='exercise'&&record.data.name==='自定义动作测试'&&record.data.mediaIds.length===1,'custom-exercise-and-media-saved');
  const media=await controlCall('media'); assert.ok(media.files.some(file=>file.id===custom.data.mediaIds[0]&&file.mime==='video/mp4'&&file.sha256===videoHash&&file.bytes===videoBytes.length)); check('custom-exercise-video-upload-preserves-original-bytes');
  await button('自定义动作测试',{exact:false}); await button('编辑动作'); await field('动作名称','自定义动作已编辑'); await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  await waitRecord(record=>record.kind==='exercise'&&record.id===custom.id&&record.version===2&&record.data.name==='自定义动作已编辑'&&record.data.mediaIds[0]===custom.data.mediaIds[0],'custom-exercise-edited');check('custom-exercise-edited-with-media-link-preserved'); await closeDialog();
  stage = 'mobile-workout'; await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await button('健身', { scope: `[...document.querySelectorAll('nav[aria-label="个人空间"]')].find(${visible})` });
  await waitText('基础力量');
  // Fitness owner keeps these user-facing controls stable; no business state is injected.
  await button('基础力量', { exact: false, scope: 'document.querySelector("[data-zeno-fitness]")' });
  await button('开始训练', { exact: false }); await until(() => evaluate('Boolean(document.querySelector("[data-zeno-workout]"))'), 'running-workout');
  const toggle = await evaluate(`[...document.querySelectorAll('[data-zeno-workout] [role=checkbox]')].filter(${visible}).find(e=>/完成第|完成这|完成组/.test(e.getAttribute('aria-label')??''))?.getAttribute('aria-label')`);
  assert.ok(toggle, 'set completion control missing'); await button(toggle);
  await waitRecord(record => record.kind === 'workout' && record.data.finishedAt === null && typeof record.data.restEndsAt==='number' && record.data.restEndsAt>record.data.startedAt && record.data.exercises.some(exercise => exercise.sets.some(set => set.completed)), 'completed-set-and-rest-persisted');
  await screenshot('mobile-workout-light'); await theme('dark'); await screenshot('mobile-workout-dark'); await theme('light'); check('mobile-training-set-and-rest-persisted');
  stage = 'active-workout-safe-edit';await button('杠铃卧推动作选项');await button('替换动作');await field('搜索动作','哑铃卧推','input[aria-label=搜索动作]');await button('哑铃卧推',{exact:false,scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});await button('添加动作');await button('保留原记录并替换');
  const swapped=await waitRecord(record=>record.kind==='workout'&&record.data.finishedAt===null&&record.data.exercises.length===2&&record.data.exercises[0].exerciseId==='0025'&&record.data.exercises[0].sets[0].completed&&record.data.exercises[1].exerciseId!=='0025'&&record.data.exercises[1].sets.every(set=>!set.completed&&set.completedAt===null),'active-swap-keeps-old-logged-result');
  const newName=swapped.data.exercises[1].name;await button(newName+'动作选项');await button('上移动作');await waitRecord(record=>record.kind==='workout'&&record.data.finishedAt===null&&record.data.exercises[0].exerciseId!=='0025','active-exercise-moved-up');await button(newName+'动作选项');await button('下移动作');await waitRecord(record=>record.kind==='workout'&&record.data.finishedAt===null&&record.data.exercises[0].exerciseId==='0025','active-exercise-moved-down');await button(newName+'动作选项');await button('移除动作');await waitRecord(record=>record.kind==='workout'&&record.data.finishedAt===null&&record.data.exercises.length===1&&record.data.exercises[0].sets[0].completed,'active-unlogged-replacement-removed');check('active-swap-reorder-removal-preserve-logged-exercise-identity');
  await until(() => evaluate(`[...document.querySelectorAll('[data-zeno-workout] button')].some(e=>e.textContent.trim()==='完成训练'&&!e.disabled)`), 'workout-autosave-complete'); await button('完成训练'); await button('保存训练记录');
  await waitRecord(record => record.kind === 'workout' && record.data.finishedAt !== null, 'workout-finished'); check('mobile-workout-finished-through-ui');
  stage = 'ant-design-statistics'; await button('统计', { scope: 'document.querySelector("nav[aria-label=健身页面]")' });
  await until(() => evaluate(`[...document.querySelectorAll('[data-zeno-fitness-chart] canvas,[data-zeno-fitness-chart] svg')].some(e=>{const r=e.getBoundingClientRect();return r.width>100&&r.height>50})`), 'actual-ant-chart-rendered');
  await screenshot('mobile-statistics-light', '[data-zeno-fitness-chart]'); await theme('dark'); await screenshot('mobile-statistics-dark', '[data-zeno-fitness-chart]'); await theme('light'); check('actual-ant-design-statistics-chart-rendered');
  stage = 'workout-history-edit'; await button('记录',{scope:'document.querySelector("nav[aria-label=健身页面]")'}); await button('基础力量',{exact:false,scope:'document.querySelector("[data-zeno-fitness]")'}); await button('编辑',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  await field('第1组重量','45','[role=dialog] input[aria-label="第1组重量"]'); await waitRecord(record=>record.kind==='workout'&&record.data.finishedAt!==null&&record.data.exercises[0].sets[0].weight===45,'history-edited'); await button('完成编辑',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`}); await closeDialog();
  await button('统计',{scope:'document.querySelector("nav[aria-label=健身页面]")'}); await until(()=>evaluate(`[...document.querySelectorAll('dl>div')].find(e=>e.querySelector('dt')?.textContent==='训练容量')?.querySelector('dd')?.textContent.includes('360')`),'statistics-recomputed-after-history-edit'); check('history-edit-recomputes-statistics');
  stage = 'body-photos-and-comparison';await button('记录',{scope:'document.querySelector("nav[aria-label=健身页面]")'});await button('身体');
  for(const [index,color] of [[0,[52,108,160]],[1,[92,148,104]]]){
    const photoPath=resolve(temporary,`synthetic-body-${index}.png`);await writeFile(photoPath,technicalPng(color));
    await button('记录',{scope:`[...document.querySelectorAll('section')].find(e=>e.querySelector('h2')?.textContent==='身体记录')`});await field('体重（kg）',index?'69.5':'70');await inputValue('记录时间',(index?dates.today:dates.yesterday)+'T09:00');await fileInput('input[aria-label=添加身体照片]',photoPath);await until(()=>evaluate('Boolean(document.querySelector("[role=dialog] img[alt=身体记录照片]"))'),'body-photo-preview');await button('保存',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});await waitRecord(record=>record.kind==='measurement'&&record.data.weightKg===(index?69.5:70)&&record.data.photoMediaIds.length===1,'body-measurement-and-photo-saved');
  }
  await button('照片对比');await until(()=>evaluate(`[...document.querySelectorAll('[role=dialog] img[alt="身体记录照片"]')].filter(e=>e.complete&&e.naturalWidth===128).length===2`),'private-photo-comparison-real-images');const comparisonDates=await evaluate(`[...document.querySelectorAll('[data-zeno-photo-comparison] [role=combobox]')].map(e=>e.title)`);assert.equal(comparisonDates.length,2);await choose('对比前日期',comparisonDates[1]);await choose('对比后日期',comparisonDates[0]);await until(()=>evaluate(`(()=>{const panes=[...document.querySelectorAll('[data-zeno-photo-comparison] section')];return panes[0]?.querySelector('p')?.textContent.includes('69.5')&&panes[1]?.querySelector('p')?.textContent.includes('70')&&[...document.querySelectorAll('[data-zeno-photo-comparison] img')].filter(e=>e.complete&&e.naturalWidth===128).length===2})()`),'photo-comparison-date-controls-load-new-images');assert.ok(await evaluate(`(()=>{const grid=document.querySelector('[data-zeno-photo-comparison]');const bound=grid.getBoundingClientRect();const dialog=grid.closest('[role=dialog]').getBoundingClientRect();return grid.scrollWidth<=grid.clientWidth+1&&[...grid.querySelectorAll('img')].every(img=>img.getBoundingClientRect().right<=dialog.right-24+1)&&[...grid.querySelectorAll('section')].every(pane=>{const p=pane.getBoundingClientRect();return p.left>=bound.left-1&&p.right<=bound.right+1&&[...pane.querySelectorAll('img,[role=combobox]')].every(child=>{const r=child.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1})})})()`),'photo-comparison-pane-overflow');await screenshot('mobile-body-comparison-light');await theme('dark');await screenshot('mobile-body-comparison-dark');await theme('light');check('mobile-body-record-photos-and-two-date-comparison');await closeDialog();
  stage = 'fitness-backup-restore'; await button('导入与导出健身数据'); await button('完整备份');
  const archiveName=await until(async()=>{const files=await readdir(resolve(temporary,'downloads'));return files.find(name=>name.endsWith('.zip'))},'fitness-media-backup-downloaded',60000);const archivePath=resolve(temporary,'downloads',archiveName);const archiveBytes=await readFile(archivePath);assert.ok(archiveBytes.length>videoBytes.length);await closeDialog();
  await button('动作库');await field('搜索动作','自定义动作已编辑','input[aria-label=搜索动作]');await button('自定义动作已编辑',{exact:false});await button('编辑动作');await button('删除动作',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});await button('删除动作',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});await until(async()=>!(await state()).records.some(record=>record.id===custom.id),'custom-exercise-deleted');check('custom-exercise-deleted-through-ui');await closeDialog();
  await button('导入与导出健身数据');await fileInput('[role=dialog] input[type=file]',archivePath);await waitText('确认导入');await button('确认导入');
  const restoredExercise=await waitRecord(record=>record.kind==='exercise'&&record.id!==custom.id&&record.data.name==='自定义动作已编辑'&&record.data.mediaIds.length===1,'backup-custom-restored');
  assert.notEqual(restoredExercise.data.mediaIds[0],custom.data.mediaIds[0]);const restoredMedia=await controlCall('media');assert.ok(restoredMedia.files.some(file=>file.id===restoredExercise.data.mediaIds[0]&&file.sha256===videoHash&&file.bytes===videoBytes.length));
  const restoredState=await state();assert.equal(restoredState.records.filter(record=>record.kind==='workout').length,2);assert.equal(restoredState.records.filter(record=>record.kind==='measurement').length,4);assert.ok(restoredState.records.some(record=>record.kind==='settings'&&record.data.fitnessEquipment?.dumbbells?.kg.includes(20)&&Object.values(record.data.fitnessDayNotes??{}).some(note=>note.text==='合成训练日说明')));check('ui-full-backup-restores-custom-video-workout-and-settings',{zipBytes:archiveBytes.length,zipSha256:createHash('sha256').update(archiveBytes).digest('hex')});
  stage = 'waiting-computer'; await button('任务', { scope: `[...document.querySelectorAll('nav[aria-label="个人空间"]')].find(${visible})` }); await waitText('每周回顾'); await button('运行');
  await waitRecord(record => record.kind === 'request' && record.data.type === 'run_task' && record.data.status === 'pending', 'pending-computer-request'); await waitText('等待电脑'); await screenshot('mobile-waiting-computer'); check('real-request-waits-for-inactive-computer');
  stage = 'mobile-chat-pending-cancel';await button('发给电脑');await field('消息','合成消息等待电脑');await button('发送',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});
  const chat=await waitRecord(record=>record.kind==='request'&&record.data.type==='chat'&&record.data.status==='pending','mobile-chat-pending');await button('合成消息等待电脑',{exact:false});await button('取消请求');await waitRecord(record=>record.kind==='request'&&record.id===chat.id&&record.data.cancelRequested===true,'mobile-chat-cancellation-requested');await waitText('等待电脑确认取消');await screenshot('mobile-chat-cancel');check('mobile-chat-queues-and-requests-cancellation-without-model-call');await closeDialog();
  stage = 'account-switch'; await button('账号', { scope: `[...document.querySelectorAll('nav[aria-label="个人空间"]')].find(${visible})` }); await button('退出账号'); await waitText('欢迎回来'); await login('b');
  await button('日历', { scope: `[...document.querySelectorAll('nav[aria-label="个人空间"]')].find(${visible})` }); await waitText('乙账号专属日程'); assert.ok(!(await text()).includes('离线创建的日程')); assert.ok(!(await text()).includes('基础力量')); check('account-switch-keeps-records-isolated'); await screenshot('mobile-second-account');
  stage = 'admin-controls';await navigate('账号');await button('退出账号');await waitText('欢迎回来');await login('admin');await navigate('账号');await waitText('管理账号');await waitText('测试账号甲');check('actual-admin-users-panel-loads');
  const beforeInvite=await controlCall('admin');await field('邮箱','qa-invited@example.test');await button('创建邀请');await waitText('一次性链接');assert.ok(await evaluate('Boolean(document.querySelector("input[aria-label=一次性链接]")?.value.includes("token="))'));await closeDialog();await field('邮箱','');await button('邀请');
  const afterInvite=await controlCall('admin');assert.equal(afterInvite.inviteCount,beforeInvite.inviteCount+1);await button('撤销',{scope:`[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent==='邀请')`});await button('撤销邀请',{scope:`[...document.querySelectorAll('[role=dialog]')].filter(${visible}).at(-1)`});await until(async()=>(await controlCall('admin')).revokedInvites===beforeInvite.revokedInvites+1,'admin-invite-revoked');check('admin-invite-create-and-revoke-through-ui');
  await button('邀请');await button('功能');await button('启用健身');await until(async()=>(await controlCall('admin')).features.fitnessTracking===false,'admin-fitness-disabled');await navigate('健身');await waitText('此功能已停用');assert.ok(await evaluate(`[...document.querySelectorAll('[data-zeno-fitness] header button')].find(e=>e.textContent.trim()==='计划')?.disabled`));await navigate('账号');await button('启用健身');await until(async()=>(await controlCall('admin')).features.fitnessTracking===true,'admin-fitness-restored');check('admin-feature-toggle-reaches-operator-and-enforces-read-only-ui');
  stage = 'admin-account-feature-off';await button('启用账号服务');await until(async()=>(await controlCall('admin')).features.zenoAccounts===false,'account-feature-disabled');
  await until(()=>evaluate(`document.querySelector('[aria-label="默认重量单位"]')?.disabled&&document.querySelector('[aria-label="日历时区"]')?.disabled&&[...document.querySelectorAll('[data-zeno-account] button')].find(e=>e.textContent.trim()==='同意连接')?.disabled`),'account-off-preferences-and-approval-disabled');
  assert.ok(await evaluate(`[...document.querySelectorAll('[data-zeno-account] button')].some(e=>e.textContent.trim()==='修改密码'&&!e.disabled)&&[...document.querySelectorAll('[data-zeno-account] button')].some(e=>e.textContent.trim()==='退出账号'&&!e.disabled)`));await button('启用账号服务');await until(async()=>(await controlCall('admin')).features.zenoAccounts===true,'account-feature-restored');await until(()=>evaluate(`!document.querySelector('[aria-label="默认重量单位"]')?.disabled`),'account-preferences-restored');check('account-feature-off-blocks-preferences-and-new-pairing-retains-security-and-admin-recovery');
  }
  stage = 'final'; assert.ok(await evaluate('Boolean(document.querySelector("[data-zeno-personal]"))'),'authenticated-personal-page-missing'); assert.equal(policyViolations.filter(item=>item.disposition==='enforce').length,0,'production CSP violation'); assert.ok(observedPolicies.size>0,'production CSP header absent'); check('production-nginx-csp-no-enforced-violations'); assert.equal(exceptions.length, 0, 'renderer exception');assert.equal(consoleErrors.length,0,'renderer caught console error'); assert.equal(externalOrigins.size, 0, 'external request');
  const final = await state(); assert.equal(final.realModelCalls, 0);
  const manifest = await fetch(origin + '/app/personal.webmanifest'); assert.equal(manifest.status, 200); const manifestBody = await manifest.json(); assert.equal(manifestBody.display, 'standalone'); check('standalone-manifest');
  const report = { verdict: 'Passed', mode, scope: 'production PWA + real local Bun API, synthetic accounts only', startedAt, finishedAt: new Date().toISOString(), productionIndexSha256, deploymentCspConfigSha256, observedPolicySha256:[...observedPolicies].map(policy=>createHash('sha256').update(policy).digest('hex')).sort(), browserVersion: version.Browser, viewport: { desktop: [1440,1000], mobile: [390,844] }, checks, screenshots: images, rendererExceptions: exceptions.length, rendererConsoleErrors: consoleErrors.length, enforcedCspViolations: policyViolations.filter(item=>item.disposition==='enforce').length, observedCspPolicies: observedPolicies.size, policyViolations, externalOrigins: externalOrigins.size, modelCalls: 0, visibleWindows: 0, nativeKeychainVerified: false, packagedAppVerified: false };
  await writeFile(resolve(output, 'pwa-browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.info(JSON.stringify({ verdict: 'Passed', checks: checks.length, screenshots: images.length }));
} catch (error) {
  const reason = error instanceof Error && /^(?:deadline:|button unavailable:|field unavailable:|renderer-|cdp|horizontal overflow:)/.test(error.message) ? error.message : 'assertion_or_fixture_failure';
  await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'pwa-browser-report.json'), JSON.stringify({ verdict: 'Failed', stage, reason, productionIndexSha256, deploymentCspConfigSha256, startedAt, finishedAt: new Date().toISOString(), checks, screenshots: images, apiStatuses, rendererExceptions: exceptions.length, rendererConsoleErrors: consoleErrors.length, enforcedCspViolations: policyViolations.filter(item=>item.disposition==='enforce').length, observedCspPolicies: observedPolicies.size, policyViolations, externalOrigins: externalOrigins.size, modelCalls: 0, visibleWindows: 0 }, null, 2) + '\n'); console.error(JSON.stringify({ verdict: 'Failed', stage, reason, apiErrors: apiStatuses.filter(item=>item.status>=400).slice(-20) })); process.exitCode = 1;
} finally {
  for (const socket of connections) socket.close();
  for (const child of children.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await pause(300); for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await rm(temporary, { recursive: true, force: true });
}
