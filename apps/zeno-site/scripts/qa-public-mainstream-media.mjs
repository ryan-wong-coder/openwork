/** Focused anonymous public-byte and browser-decoding QA; no product UI fixture. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPwaCsp, publicQaTarget } from './qa-public-personal.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ORIGIN = 'https://www.zeno.ryan-wong.cn';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(done => setTimeout(done, ms));

// A release version selects a separate evidence directory. Origin, account,
// browser profile and output overrides remain unavailable.
export function publicMediaQaTarget(args = []) {
  const { version } = publicQaTarget(args, { ZENO_PUBLIC_QA_VERSION: '1.1.2' });
  const directory = resolve(ROOT, 'docs/evidence', 'zeno-' + version, 'mainstream');
  return { version, output: join(directory, 'public-media'), deployment: join(directory, 'deployment.json') };
}

export function completedPublicMedia({ selection, provenance, demonstrations }) {
  assert.equal(selection.selectedCanonicalCount, 32); assert.equal(selection.exercises.length, 32);
  assert.ok(Array.isArray(demonstrations) && demonstrations.length >= 32, 'Completed runtime mapping is required.');
  assert.equal(provenance.assets.length, demonstrations.length, 'Provenance must cover the entire runtime mapping.');
  assert.equal(new Set(demonstrations.map(item => item.exerciseId)).size, demonstrations.length);
  assert.equal(new Set(demonstrations.map(item => item.stem)).size, demonstrations.length);
  assert.deepEqual(provenance.assets.map(item => [item.canonicalExerciseId, item.englishName, item.name, item.kind]).sort(), demonstrations.map(item => [item.exerciseId, item.englishName, item.stem, item.kind]).sort());
  for (const baseline of selection.exercises) {
    const item = demonstrations.find(item => item.exerciseId === baseline.exerciseId);
    assert.ok(item, 'Original baseline exercise must remain covered.');
    assert.equal(item.englishName, baseline.englishName); assert.equal(item.stem, baseline.stem);
  }
  for (const item of demonstrations) {
    assert.match(item.exerciseId, /^\d{4,5}$/); assert.ok(typeof item.englishName === 'string' && item.englishName.trim());
    assert.match(item.stem, /^[a-z\d][a-z\d-]*$/); assert.ok(['mascot', 'diagram'].includes(item.kind));
  }
  for (const asset of provenance.assets) {
    // The frozen first three receipts predate the reviewed boolean. Keep their
    // original metadata; every later receipt must carry its actual review flag.
    const review = asset.manualFrameReview;
    assert.ok(Number.isInteger(review.frames) && review.frames > 0);
    assert.equal(typeof review.contactSheet, 'string');
    if (Object.hasOwn(review, 'reviewed') || !['curl', 'squat', 'shoulder-press'].includes(asset.name)) assert.equal(review.reviewed, true, 'Only actually reviewed media may enter public acceptance.');
    if (asset.manualFrameReview.frames === 64) assert.equal(asset.manualFrameReview.rootAccepted, true);
    assert.ok(Number.isInteger(asset.format.streams[0].width) && asset.format.streams[0].width > 0);
    assert.ok(Number.isInteger(asset.format.streams[0].height) && asset.format.streams[0].height > 0);
    assert.ok(Number.isFinite(Number(asset.format.format.duration)) && Number(asset.format.format.duration) > 0);
  }
  const media = provenance.assets.flatMap(asset => ['video', 'poster'].map(kind => {
    const part = asset[kind]; const suffix = kind === 'video' ? '.mp4' : '-poster.webp';
    assert.equal(part.file, 'apps/app/public/zeno/fitness/' + asset.name + suffix);
    assert.ok(Number.isSafeInteger(part.bytes) && part.bytes > 0); assert.match(part.sha256, /^[a-f\d]{64}$/);
    return { ...part, kind, id: asset.canonicalExerciseId, name: asset.name, format: asset.format, path: '/app/' + part.file.slice('apps/app/public/'.length) };
  }));
  assert.equal(new Set(media.map(asset => asset.path)).size, media.length);
  for (const kind of ['video', 'poster']) assert.equal(new Set(media.filter(asset => asset.kind === kind).map(asset => asset.sha256)).size, demonstrations.length, 'Every accepted demonstration requires independent media.');
  return media;
}

export function assertPublicMediaBytes(asset, { response, bytes }, local) {
  assert.equal(local.length, asset.bytes); assert.equal(digest(local), asset.sha256);
  assert.equal(response.status, 200); assert.equal(bytes.length, asset.bytes); assert.equal(digest(bytes), asset.sha256);
  const mime = response.headers.get('content-type') ?? '';
  assert.match(mime, asset.kind === 'video' ? /^video\/mp4(?:;|$)/i : /^image\/webp(?:;|$)/i);
  return { path: asset.path, id: asset.id, bytes: bytes.length, sha256: digest(bytes), contentType: mime };
}

export function assertPublicVideoRange(asset, { response, bytes }, local) {
  assert.equal(response.status, 206); assert.equal(bytes.length, 1024);
  assert.equal(response.headers.get('content-range'), `bytes 0-1023/${asset.bytes}`);
  assert.equal(bytes.equals(local.subarray(0, 1024)), true);
  assert.match(response.headers.get('content-type') ?? '', /^video\/mp4(?:;|$)/i);
  return { status: 206, start: 0, end: 1023, total: asset.bytes, bytesMatched: true };
}

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
  const { version: expectedVersion, output: OUTPUT, deployment: DEPLOYMENT } = publicMediaQaTarget(process.argv.slice(2));
  assert.equal(JSON.parse(await readFile(join(ROOT, 'apps/desktop/package.json'), 'utf8')).version, expectedVersion, 'The expected public version must match the checked-out desktop version.');
  try { await readFile(join(OUTPUT, 'report.json')); throw new Error('existing_report'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const deployed = JSON.parse(await readFile(DEPLOYMENT, 'utf8'));
  assert.equal(deployed.passed, true);
  if (Object.hasOwn(deployed, 'version')) assert.equal(deployed.version, expectedVersion);
  assert.match(deployed.sourceCommit, /^[a-f\d]{40}$/);
  const INDEX_SHA256 = deployed.indexSha256; assert.match(INDEX_SHA256, /^[a-f\d]{64}$/);
  const selection = JSON.parse(await readFile(join(ROOT, 'apps/app/art-source/fitness/mainstream/selection.json'), 'utf8'));
  const provenanceBytes = await readFile(join(ROOT, 'apps/app/art-source/fitness/provenance.json'));
  const runtimeBytes = await readFile(join(ROOT, 'apps/app/src/react-app/domains/zeno/mascot-demos.json'));
  const provenance = JSON.parse(provenanceBytes.toString('utf8')); const demonstrations = JSON.parse(runtimeBytes.toString('utf8'));
  const media = completedPublicMedia({ selection, provenance, demonstrations });
  const videoCount = demonstrations.length;
  if (Object.hasOwn(deployed, 'selectedExercises')) assert.equal(deployed.selectedExercises, videoCount);
  for (const asset of media) assert.match(asset.path, /^\/app\/zeno\/fitness\/[a-z\d][a-z\d-]*(?:-poster\.webp|\.mp4)$/);
  const allowedPaths = new Set(['/app/', '/app/device', '/app/personal-sw.js', '/app/personal.webmanifest', '/app/zeno-personal.svg', '/app/apple-touch-icon.png', '/favicon.ico', '/api/zeno/v1/me', ...media.map(asset => asset.path)]);
  const allowed = (raw, method) => { try { const url = new URL(raw); return ['GET', 'HEAD'].includes(method) && url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && (allowedPaths.has(url.pathname) || /^\/app\/assets\/[A-Za-z\d_.-]+\.(?:js|css)$/.test(url.pathname)); } catch { return false; } };
  const report = { passed: false, version: expectedVersion, checkedAt: new Date().toISOString(), origin: ORIGIN, sourceCommit: deployed.sourceCommit, expectedIndexSha256: INDEX_SHA256, runtimeManifestSha256: digest(runtimeBytes), provenanceSha256: digest(provenanceBytes), expectedDemonstrations: videoCount, expectedMediaFiles: media.length, checks: [], assets: [], decodedVideos: [], screenshots: [], scope: { publicHttps: true, anonymousFreshHeadlessProfile: false, productExerciseUiTested: false, temporarySameOriginVideoElements: true, authenticatedAccountTested: false, mutationsAllowed: false, installersDownloaded: false, modelCallsAllowed: false, nativeDesktopTested: false } };
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
      const local = await readFile(join(ROOT, asset.file));
      const value = await fetchBytes(asset.path); const record = assertPublicMediaBytes(asset, value, local);
      if (asset.kind === 'video') {
        const range = await fetchBytes(asset.path, { range: 'bytes=0-1023', limit: 1024 }); record.range = assertPublicVideoRange(asset, range, local);
      }
      report.assets.push(record);
    }
    assert.equal(report.assets.length, media.length);
    check(`all-${media.length}-complete-media-digests-mime-and-${videoCount}-video-ranges`);
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
    assert.equal(report.decodedVideos.length, videoCount);
    check(`all-${videoCount}-real-public-videos-decoded-played-and-paused`);
    assert.equal(exceptions.length, 0); assert.equal(consoleErrors.length, 0); assert.equal(violations.length, 0); assert.equal(externalRequests, 0); assert.equal(blockedRequests, 0); assert.equal(mutationAttempts, 0); assert.equal(modelAttempts, 0); assert.equal(unexpectedHttpFailures, 0); check('no-csp-renderer-external-mutation-or-model-attempts'); report.passed = true;
  } catch (error) { report.failedStage = stage; report.errorKind = ['AssertionError', 'TypeError', 'Error', 'TimeoutError'].includes(error.name) ? error.name : 'Error'; process.exitCode = 1; }
  finally {
    try { await browser?.send('Browser.close'); } catch {}
    for (const socket of sockets) socket.close();
    if (child) { try { await until(() => child.exitCode !== null || child.signalCode !== null, 'chrome_exit', 5000); } catch { try { process.kill(-child.pid, 'SIGTERM'); } catch {} await pause(300); } }
    if (temporary) { await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); report.ownedProfileRemoved = true; }
    report.network = { externalRequests, blockedRequests, mutationAttempts, modelAttempts, unexpectedHttpFailures, runtimeExceptions: exceptions.length, consoleErrors: consoleErrors.length, cspViolations: violations.length, observedOrigins: [...seenOrigins], scope: 'owned page CDP, request allowlist, CSP and external DNS denial; not system packet capture' };
    await mkdir(OUTPUT, { recursive: true }); await writeFile(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log('[zeno-public-media] ' + (report.passed ? 'passed' : 'failed') + '; sanitized report saved.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
