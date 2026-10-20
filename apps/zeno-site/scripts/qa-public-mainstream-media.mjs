/** Focused anonymous public-byte and browser-decoding QA; no product UI fixture. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPwaCsp } from './qa-public-personal.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ORIGIN = 'https://www.zeno.ryan-wong.cn';
const OUTPUT = resolve(ROOT, 'docs/evidence/zeno-1.1.2/mainstream/public-media');
const DEPLOYMENT = resolve(ROOT, 'docs/evidence/zeno-1.1.2/mainstream/deployment.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(done => setTimeout(done, ms));

async function until(read, name, milliseconds = 30000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await pause(100); }
  throw new Error(name);
}
async function connect(url, observe = () => {}) {
  const address = new URL(url); assert.equal(address.protocol, 'ws:'); assert.equal(address.hostname, '127.0.0.1');
  const socket = new WebSocket(url); let sequence = 0; const pending = new Map();
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('cdp_connection')); });
  socket.onmessage = ({ data }) => {
    const value = JSON.parse(data); if (!value.id) { observe(value); return; }
    const item = pending.get(value.id); if (!item) return; clearTimeout(item.timer); pending.delete(value.id);
    value.error ? item.fail(new Error('cdp_operation')) : item.done(value.result);
  };
  socket.onclose = () => { for (const item of pending.values()) { clearTimeout(item.timer); item.fail(new Error('cdp_closed')); } pending.clear(); };
  return { socket, send(method, params = {}) { return new Promise((done, fail) => {
    const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); fail(new Error('cdp_timeout')); }, 20000);
    pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); } };
}
async function fetchBytes(path, { range, limit = 1024 * 1024 } = {}) {
  const response = await fetch(ORIGIN + path, { redirect: 'error', cache: 'no-store', credentials: 'omit', headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(30000) });
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= limit, 'bounded_public_response'); chunks.push(chunk); }
  return { response, bytes: Buffer.concat(chunks) };
}

async function main() {
  assert.equal(process.argv.length, 2, 'No origin, credentials, profile or output overrides are accepted.');
  try { await readFile(join(OUTPUT, 'report.json')); throw new Error('existing_report'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const deployed = JSON.parse(await readFile(DEPLOYMENT, 'utf8'));
  assert.equal(deployed.passed, true);
  assert.match(deployed.sourceCommit, /^[a-f\d]{40}$/);
  const INDEX_SHA256 = deployed.indexSha256; assert.match(INDEX_SHA256, /^[a-f\d]{64}$/);
  const selection = JSON.parse(await readFile(join(ROOT, 'apps/app/art-source/fitness/mainstream/selection.json'), 'utf8'));
  const provenance = JSON.parse(await readFile(join(ROOT, 'apps/app/art-source/fitness/provenance.json'), 'utf8'));
  assert.equal(selection.selectedCanonicalCount, 32); assert.equal(selection.exercises.length, 32); assert.equal(provenance.assets.length, 32);
  assert.deepEqual(provenance.assets.map(asset => [asset.canonicalExerciseId, asset.name]).sort(), selection.exercises.map(asset => [asset.exerciseId, asset.stem]).sort());
  assert.equal(new Set(provenance.assets.map(asset => asset.name)).size, 32);
  const media = provenance.assets.flatMap(asset => ['video', 'poster'].map(kind => ({ ...asset[kind], kind, id: asset.canonicalExerciseId, name: asset.name, format: asset.format, path: '/app/' + asset[kind].file.slice('apps/app/public/'.length) })));
  for (const asset of media) assert.match(asset.path, /^\/app\/zeno\/fitness\/[a-z\d][a-z\d-]*(?:-poster\.webp|\.mp4)$/);
  const allowedPaths = new Set(['/app/', '/app/device', '/app/personal-sw.js', '/app/personal.webmanifest', '/app/zeno-personal.svg', '/app/apple-touch-icon.png', '/favicon.ico', '/api/zeno/v1/me', ...media.map(asset => asset.path)]);
  const allowed = (raw, method) => { try { const url = new URL(raw); return ['GET', 'HEAD'].includes(method) && url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && (allowedPaths.has(url.pathname) || /^\/app\/assets\/[A-Za-z\d_.-]+\.(?:js|css)$/.test(url.pathname)); } catch { return false; } };
  const report = { passed: false, checkedAt: new Date().toISOString(), origin: ORIGIN, sourceCommit: deployed.sourceCommit, expectedIndexSha256: INDEX_SHA256, checks: [], assets: [], decodedVideos: [], screenshots: [], scope: { publicHttps: true, anonymousFreshHeadlessProfile: false, productExerciseUiTested: false, temporarySameOriginVideoElements: true, authenticatedAccountTested: false, mutationsAllowed: false, installersDownloaded: false, modelCallsAllowed: false, nativeDesktopTested: false } };
  const sockets = []; const violations = []; const exceptions = []; const consoleErrors = []; const seenOrigins = new Set();
  let temporary, child, browser, page, stage = 'public-pwa', externalRequests = 0, blockedRequests = 0, mutationAttempts = 0, modelAttempts = 0, unexpectedHttpFailures = 0;
  const check = name => { report.checks.push({ name, passed: true }); console.log('[zeno-public-media] ' + name); };
  try {
    await mkdir(OUTPUT, { recursive: true });
    const localIndex = await readFile(join(ROOT, 'apps/app/dist-personal/index.html')); assert.equal(digest(localIndex), INDEX_SHA256);
    const index = await fetchBytes('/app/device'); assert.equal(index.response.status, 200); assert.equal(digest(index.bytes), INDEX_SHA256);
    assert.match(index.response.headers.get('content-type') ?? '', /text\/html/i); assertPwaCsp(index.response.headers.get('content-security-policy'));
    assert.match(index.response.headers.get('cache-control') ?? '', /no-cache|no-store/i); assert.equal(index.response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(index.response.headers.get('referrer-policy'), 'no-referrer');
    report.pwa = { path: '/app/device', bytes: index.bytes.length, sha256: digest(index.bytes), strictCsp: true, cacheControl: index.response.headers.get('cache-control') }; check('device-route-exact-deployed-pwa-and-strict-headers');
    stage = 'public-assets';
    for (const asset of media) {
      const local = await readFile(join(ROOT, asset.file)); assert.equal(local.length, asset.bytes); assert.equal(digest(local), asset.sha256);
      const value = await fetchBytes(asset.path); assert.equal(value.response.status, 200); assert.equal(value.bytes.length, asset.bytes); assert.equal(digest(value.bytes), asset.sha256);
      const mime = value.response.headers.get('content-type') ?? ''; assert.match(mime, asset.kind === 'video' ? /^video\/mp4(?:;|$)/i : /^image\/webp(?:;|$)/i);
      const record = { path: asset.path, id: asset.id, bytes: value.bytes.length, sha256: digest(value.bytes), contentType: mime };
      if (asset.kind === 'video') {
        const range = await fetchBytes(asset.path, { range: 'bytes=0-1023', limit: 1024 }); assert.equal(range.response.status, 206); assert.equal(range.bytes.length, 1024); assert.equal(range.response.headers.get('content-range'), `bytes 0-1023/${asset.bytes}`); assert.equal(range.bytes.equals(local.subarray(0, 1024)), true); assert.match(range.response.headers.get('content-type') ?? '', /^video\/mp4(?:;|$)/i);
        record.range = { status: 206, start: 0, end: 1023, total: asset.bytes, bytesMatched: true };
      }
      report.assets.push(record);
    }
    check('all-64-complete-media-digests-mime-and-32-video-ranges');
    stage = 'headless-start'; temporary = await mkdtemp(join(tmpdir(), 'zeno-public-fitness-media-')); const profile = join(temporary, 'chrome');
    child = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-pings', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE www.zeno.ryan-wong.cn, EXCLUDE 127.0.0.1', 'about:blank'], { detached: true, stdio: 'ignore' }); child.on('error', () => {});
    const port = await until(async () => { try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, 'chrome_start'); assert.match(port, /^\d+$/);
    const cdp = 'http://127.0.0.1:' + port; const version = await (await fetch(cdp + '/json/version')).json(); assert.match(version['User-Agent'], /HeadlessChrome\//); report.browserVersion = version.Browser; report.scope.anonymousFreshHeadlessProfile = true;
    browser = await connect(version.webSocketDebuggerUrl); sockets.push(browser.socket); await browser.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }); const target = (await (await fetch(cdp + '/json/list')).json()).find(value => value.id === targetId); assert.ok(target);
    page = await connect(target.webSocketDebuggerUrl, event => {
      if (event.method === 'Runtime.exceptionThrown') exceptions.push('renderer-exception');
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') consoleErrors.push('console-error');
      if (event.method === 'Runtime.bindingCalled' && event.params.name === 'zenoMediaCsp') { try { const value = JSON.parse(event.params.payload); violations.push(/^[a-z-]{1,64}$/.test(value.directive) ? value.directive : 'unknown'); } catch { violations.push('unknown'); } }
      if (event.method === 'Network.requestWillBeSent') { try { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol)) { seenOrigins.add(url.origin); if (url.origin !== ORIGIN) externalRequests++; if (/\/opencode\/|\/models?(?:\/|$)|\/chat\/completions|\/responses(?:\/|$)/i.test(url.pathname)) modelAttempts++; } } catch {} }
      if (event.method === 'Network.responseReceived') { const value = event.params.response; try { const url = new URL(value.url); if (url.origin === ORIGIN && value.status >= 400 && !(url.pathname === '/api/zeno/v1/me' && value.status === 401)) unexpectedHttpFailures++; } catch {} }
      if (event.method === 'Fetch.requestPaused') { const request = event.params.request; if (allowed(request.url, request.method)) void page.send('Fetch.continueRequest', { requestId: event.params.requestId }).catch(() => {}); else { blockedRequests++; if (!['GET', 'HEAD'].includes(request.method)) mutationAttempts++; void page.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); } }
    }); sockets.push(page.socket);
    const evaluate = async expression => { const value = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!value.exceptionDetails, 'browser_evaluation'); return value.result.value; };
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable'); await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await page.send('Runtime.addBinding', { name: 'zenoMediaCsp' }); await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "addEventListener('securitypolicyviolation',event=>zenoMediaCsp(JSON.stringify({directive:event.effectiveDirective})))" });
    await page.send('Page.navigate', { url: ORIGIN + '/app/' }); await page.send('Page.bringToFront'); await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await until(() => evaluate('Boolean(document.querySelector("[data-zeno-auth]"))'), 'anonymous_login'); assert.equal(await evaluate('document.querySelector("input[name=email]")?.value'), ''); assert.equal(await evaluate('document.querySelector("input[name=password]")?.value'), ''); check('fresh-anonymous-public-pwa-loaded');
    stage = 'video-decode';
    for (const asset of media.filter(value => value.kind === 'video')) {
      const result = await evaluate(`(async()=>{const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.width=320;video.src=${JSON.stringify(asset.path)};document.body.append(video);let callback;let frames=0;let frameWidth=0,frameHeight=0;try{if(typeof video.requestVideoFrameCallback!=='function')return {passed:false,reason:'frame_callback_unavailable'};const frame=(_time,metadata)=>{frames++;frameWidth=metadata.width;frameHeight=metadata.height;callback=video.requestVideoFrameCallback(frame)};callback=video.requestVideoFrameCallback(frame);await video.play();const deadline=performance.now()+10000;while((video.currentTime<.15||frames<2)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,25));video.pause();return {passed:video.readyState>=2&&video.currentTime>=.15&&frames>=2&&video.paused,width:video.videoWidth,height:video.videoHeight,duration:video.duration,currentTime:video.currentTime,presentedFrames:frames,frameWidth,frameHeight,paused:video.paused,errorCode:video.error?.code??null}}catch{return {passed:false,reason:'media_playback'}}finally{video.pause();if(callback!==undefined)video.cancelVideoFrameCallback(callback);video.removeAttribute('src');video.load();video.remove()}})()`);
      assert.equal(result.passed, true); const expected = asset.format.streams[0]; assert.equal(result.width, expected.width); assert.equal(result.height, expected.height); assert.equal(result.frameWidth, expected.width); assert.equal(result.frameHeight, expected.height); assert.ok(Math.abs(result.duration - Number(asset.format.format.duration)) < .1); assert.equal(result.errorCode, null);
      report.decodedVideos.push({ path: asset.path, ...result });
    }
    check('all-32-real-public-videos-decoded-played-and-paused');
    assert.equal(exceptions.length, 0); assert.equal(consoleErrors.length, 0); assert.equal(violations.length, 0); assert.equal(externalRequests, 0); assert.equal(blockedRequests, 0); assert.equal(mutationAttempts, 0); assert.equal(modelAttempts, 0); assert.equal(unexpectedHttpFailures, 0); check('no-csp-renderer-external-mutation-or-model-attempts'); report.passed = true;
  } catch (error) { report.failedStage = stage; report.errorKind = ['AssertionError', 'TypeError', 'Error', 'TimeoutError'].includes(error.name) ? error.name : 'Error'; process.exitCode = 1; }
  finally {
    try { await browser?.send('Browser.close'); } catch {}
    for (const socket of sockets) socket.close();
    if (child) { try { await until(() => child.exitCode !== null || child.signalCode !== null, 'chrome_exit', 5000); } catch { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await pause(300); } }
    if (temporary) { await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); report.ownedProfileRemoved = true; }
    report.network = { externalRequests, blockedRequests, mutationAttempts, modelAttempts, unexpectedHttpFailures, runtimeExceptions: exceptions.length, consoleErrors: consoleErrors.length, cspViolations: violations.length, observedOrigins: [...seenOrigins], scope: 'owned page CDP, request allowlist, CSP and external DNS denial; not system packet capture' };
    await mkdir(OUTPUT, { recursive: true }); await writeFile(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log('[zeno-public-media] ' + (report.passed ? 'passed' : 'failed') + '; sanitized report saved.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
