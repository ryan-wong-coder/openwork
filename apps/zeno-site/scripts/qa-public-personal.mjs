import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://www.zeno.ryan-wong.cn';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Only the expected stable version is configurable. The public origin, profile,
// API permissions and evidence root remain fixed by this verification script.
export function publicQaTarget(args = [], environment = {}) {
  assert.ok(args.length === 0 || args.length === 2 && args[0] === '--version', 'Only --version X.Y.Z is accepted; origin, profile, credentials and API overrides are forbidden.');
  const version = args[1] ?? environment.ZENO_PUBLIC_QA_VERSION ?? '1.1.0';
  assert.equal(typeof version, 'string', 'Expected a stable X.Y.Z version.');
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/, 'Expected a stable X.Y.Z version.');
  return { version, output: resolve(ROOT, 'docs/evidence', 'zeno-' + version, 'public-site-pwa') };
}

export function publicReadAllowed(rawUrl, method) {
  try {
    const url = new URL(rawUrl);
    if (!['GET', 'HEAD'].includes(method) || url.origin !== ORIGIN || url.username || url.password || url.hash) return false;
    const path = decodeURIComponent(url.pathname);
    if (path.includes('\\') || /^\/(?:downloads|updates)\//.test(path)) return false;
    if (path.startsWith('/api/')) return ['/api/releases/latest.json', '/api/zeno/v1/me'].includes(path);
    return path === '/' || path.startsWith('/app/') || path.startsWith('/assets/')
      || ['/app.js', '/motion.js', '/releases.js', '/styles.css', '/favicon.ico', '/LICENSE.txt'].includes(path);
  } catch { return false; }
}

export function assertPwaCsp(policy) {
  assert.equal(typeof policy, 'string', 'Missing public PWA CSP.');
  const directives = new Map(policy.split(';').map(value => value.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name, values]));
  for (const directive of ['default-src', 'script-src', 'connect-src']) assert.deepEqual(directives.get(directive), ["'self'"], 'Unexpected PWA security policy.');
  assert.deepEqual(directives.get('object-src'), ["'none'"]); assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(directives.get('form-action'), ["'self'"]); assert.ok(!policy.includes('unsafe-eval'));
}

export function pwaAssetPaths(html) {
  const assets = [...html.matchAll(/(?:src|href)=["'](\/app\/assets\/[^"']+)["']/g)].map(match => match[1]);
  assert.ok(assets.some(path => path.endsWith('.js')) && assets.some(path => path.endsWith('.css')), 'Built PWA entry assets are missing.');
  for (const path of assets) assert.match(path, /^\/app\/assets\/[A-Za-z\d_.-]+\.(?:js|css)$/);
  return [...new Set(assets)];
}

async function publicGet(path, limit = 20 * 1024 * 1024) {
  const url = new URL(path, ORIGIN); assert.equal(publicReadAllowed(url.href, 'GET'), true, 'Refusing unsafe public fetch.');
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30_000) });
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; assert.ok(length <= limit, 'Public metadata or UI asset exceeded its bounded size.'); chunks.push(chunk); }
  return { response, bytes: Buffer.concat(chunks) };
}

async function until(read, label, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await read(); if (value) return value; } catch {} await pause(100); }
  throw new Error('Public verification timed out: ' + label);
}

async function connect(url, observe = () => {}) {
  const address = new URL(url); assert.equal(address.protocol, 'ws:'); assert.equal(address.hostname, '127.0.0.1');
  const socket = new WebSocket(url); let id = 0; const pending = new Map();
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error('Owned headless CDP failed.')); });
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data); if (!event.id) { observe(event); return; }
    const item = pending.get(event.id); if (!item) return; pending.delete(event.id); clearTimeout(item.timer);
    event.error ? item.fail(new Error('Owned headless CDP operation failed.')) : item.done(event.result);
  };
  socket.onclose = () => { for (const item of pending.values()) { clearTimeout(item.timer); item.fail(new Error('Owned CDP closed.')); } pending.clear(); };
  return { socket, send(method, params = {}) { return new Promise((done, fail) => {
    const key = ++id; const timer = setTimeout(() => { pending.delete(key); fail(new Error('Owned CDP timed out.')); }, 35_000);
    pending.set(key, { done, fail, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  }); } };
}

async function main() {
  const { version, output: OUTPUT } = publicQaTarget(process.argv.slice(2), process.env);
  assert.equal(JSON.parse(await readFile(join(ROOT, 'apps/desktop/package.json'), 'utf8')).version, version, 'The expected public version must match the checked-out desktop version.');
  const report = { passed: false, version, checkedAt: new Date().toISOString(), origin: ORIGIN, checks: [], assets: [], screenshots: [],
    scope: { realPublicHttps: false, freshHeadlessProfile: false, authenticatedAccountTested: false, mutationsAllowed: false, installersDownloaded: false, modelsInvoked: false, mobileDeviceInstallationTested: false } };
  let stage = 'http'; let temporary; let child; let browser; let page;
  const sockets = []; const exceptions = []; const violations = []; const httpFailures = []; let externalRequests = 0; let blockedMutations = 0; let blockedPackages = 0; let blockedExternal = 0; let blockedReads = 0;
  const seenOrigins = new Set();
  const check = (name, data = {}) => { report.checks.push({ name, passed: true, ...data }); console.log('[zeno-public-qa] ' + name); };
  try {
    await mkdir(OUTPUT, { recursive: true });
    const index = await publicGet('/api/releases/latest.json', 512 * 1024); assert.equal(index.response.status, 200);
    const release = JSON.parse(index.bytes); assert.equal(release.version, version); assert.equal(release.artifacts.length, 10);
    report.scope.realPublicHttps = true;
    for (const platform of ['darwin', 'win32', 'linux']) for (const arch of ['x64', 'arm64']) assert.ok(release.artifacts.some(file => file.platform === platform && file.arch === arch && file.name.includes('-' + arch + '-' + version + '.')));
    check('public-release-version-and-ten-installers', { installers: 10 });
    const localIndex = await readFile(join(ROOT, 'apps/app/dist-personal/index.html'));
    const paths = ['/app/', '/app/calendar', '/app/fitness', '/app/tasks', '/app/account', '/app/invite', '/app/reset', '/app/device'];
    let entry;
    for (const path of paths) {
      const value = await publicGet(path, 512 * 1024); assert.equal(value.response.status, 200); assert.match(value.response.headers.get('content-type') ?? '', /text\/html/i);
      assertPwaCsp(value.response.headers.get('content-security-policy')); assert.equal(value.response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(value.response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(value.response.headers.get('cache-control') ?? '', /no-cache|no-store/i);
      assert.equal(sha256(value.bytes), sha256(localIndex), 'A public deep link differs from the exact current production PWA build.'); entry = value.bytes.toString('utf8');
    }
    report.pwaIndexSha256 = sha256(localIndex); check('public-deep-links-html-csp-and-exact-build', { routes: paths });
    const staticPaths = [...pwaAssetPaths(entry), '/app/zeno-personal.svg', '/app/apple-touch-icon.png'];
    for (const path of staticPaths) {
      const value = await publicGet(path); assert.equal(value.response.status, 200); assert.ok(value.bytes.length > 0);
      assert.ok(!/text\/html/i.test(value.response.headers.get('content-type') ?? ''), 'Missing asset was hidden by SPA fallback.');
      if (path.endsWith('.js')) assert.match(value.response.headers.get('content-type') ?? '', /(?:javascript|ecmascript)/i);
      if (path.endsWith('.css')) assert.match(value.response.headers.get('content-type') ?? '', /text\/css/i);
      assert.equal(sha256(value.bytes), sha256(await readFile(join(ROOT, 'apps/app/dist-personal', path.slice('/app/'.length)))), 'Public PWA static bytes differ from the final local build.');
      report.assets.push({ path, bytes: value.bytes.length, sha256: sha256(value.bytes) });
    }
    const manifest = await publicGet('/app/personal.webmanifest', 64 * 1024); assert.equal(manifest.response.status, 200);
    assert.match(manifest.response.headers.get('content-type') ?? '', /(?:manifest\+json|application\/json)/i);
    const manifestJson = JSON.parse(manifest.bytes); assert.equal(manifestJson.start_url, '/app/'); assert.equal(manifestJson.scope, '/app/'); assert.equal(manifestJson.lang, 'zh-CN'); assert.equal(manifestJson.display, 'standalone');
    assert.equal(sha256(manifest.bytes), sha256(await readFile(join(ROOT, 'apps/app/dist-personal/personal.webmanifest'))));
    assert.ok(manifestJson.icons.some(icon => icon.src === '/app/apple-touch-icon.png'));
    const worker = await publicGet('/app/personal-sw.js', 512 * 1024); assert.equal(worker.response.status, 200);
    assert.match(worker.response.headers.get('content-type') ?? '', /(?:javascript|ecmascript)/i); assert.match(worker.response.headers.get('cache-control') ?? '', /no-cache|no-store/i);
    assert.equal(sha256(worker.bytes), sha256(await readFile(join(ROOT, 'apps/app/dist-personal/personal-sw.js'))));
    assert.ok(worker.bytes.includes(Buffer.from("url.pathname.startsWith('/app/')"))); assert.ok(worker.bytes.includes(Buffer.from('url.search')));
    const me = await publicGet('/api/zeno/v1/me', 64 * 1024); assert.equal(me.response.status, 401);
    check('public-static-assets-manifest-worker-and-anonymous-boundary', { entryAssets: staticPaths.length, anonymousMeStatus: 401, workerSha256: sha256(worker.bytes) });

    stage = 'browser'; temporary = await mkdtemp(join(tmpdir(), 'zeno-public-pwa-'));
    const profile = join(temporary, 'chrome');
    child = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--metrics-recording-only', '--no-pings', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE www.zeno.ryan-wong.cn, EXCLUDE 127.0.0.1', 'about:blank'], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    const port = await until(async () => { try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return null; } }, 'owned Chrome startup'); assert.match(port, /^\d+$/);
    const cdp = 'http://127.0.0.1:' + port; const info = await (await fetch(cdp + '/json/version', { signal: AbortSignal.timeout(2000) })).json();
    assert.match(info['User-Agent'], /HeadlessChrome\//); report.browserVersion = info.Browser; report.scope.freshHeadlessProfile = true;
    browser = await connect(info.webSocketDebuggerUrl); sockets.push(browser.socket); await browser.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const targets = await (await fetch(cdp + '/json/list', { signal: AbortSignal.timeout(2000) })).json(); const target = targets.find(item => item.id === targetId); assert.ok(target);
    page = await connect(target.webSocketDebuggerUrl, event => {
      if (event.method === 'Runtime.exceptionThrown') exceptions.push('renderer-exception');
      if (event.method === 'Runtime.bindingCalled' && event.params.name === 'zenoPublicCsp') {
        try { const value = JSON.parse(event.params.payload); if (/^[a-z-]{1,64}$/.test(value.directive)) violations.push(value.directive); } catch {}
      }
      if (event.method === 'Network.requestWillBeSent') {
        try { const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol)) { seenOrigins.add(url.origin); if (url.origin !== ORIGIN) externalRequests++; } } catch {}
      }
      if (event.method === 'Network.responseReceived') {
        try { const value = event.params.response; const url = new URL(value.url); if (url.origin === ORIGIN && value.status >= 400 && !(url.pathname === '/api/zeno/v1/me' && value.status === 401)) httpFailures.push({ status: value.status, path: url.pathname }); } catch {}
      }
      if (event.method === 'Fetch.requestPaused') {
        const request = event.params.request;
        let localBytes = false;
        try { const url = new URL(request.url); localBytes = request.method === 'GET' && (url.protocol === 'data:' || url.protocol === 'blob:' && url.origin === ORIGIN); } catch {}
        if (localBytes || publicReadAllowed(request.url, request.method)) void page.send('Fetch.continueRequest', { requestId: event.params.requestId }).catch(() => {});
        else {
          if (!['GET', 'HEAD'].includes(request.method)) blockedMutations++;
          if (/\/(?:downloads|updates)\//.test(request.url)) blockedPackages++;
          try { if (new URL(request.url).origin !== ORIGIN) blockedExternal++; else if (['GET', 'HEAD'].includes(request.method)) blockedReads++; } catch { blockedReads++; }
          void page.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        }
      }
    }); sockets.push(page.socket);
    const evaluate = async expression => { const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.ok(!result.exceptionDetails, 'Public page evaluation failed.'); return result.result.value; };
    await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await page.send('Runtime.addBinding', { name: 'zenoPublicCsp' });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "addEventListener('securitypolicyviolation',event=>zenoPublicCsp(JSON.stringify({directive:event.effectiveDirective})))" });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    const metrics = async mobile => page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1440, height: mobile ? 844 : 1000, deviceScaleFactor: 1, mobile });
    const navigate = async (path, selector) => {
      await page.send('Page.navigate', { url: ORIGIN + path });
      await until(() => evaluate(`location.origin===${JSON.stringify(ORIGIN)}&&Boolean(document.querySelector(${JSON.stringify(selector)}))`), 'public UI route');
      await evaluate('document.fonts.ready.then(()=>true)');
    };
    const screenshot = async name => {
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), true, 'Public UI has horizontal overflow.');
      assert.equal(await evaluate('Boolean(document.querySelector("input[type=email]")?.value)'), false, 'Do not record account identifiers.');
      await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      const captured = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const bytes = Buffer.from(captured.data, 'base64');
      await writeFile(join(OUTPUT, name + '.png'), bytes); report.screenshots.push({ file: name + '.png', bytes: bytes.length, sha256: sha256(bytes) });
    };

    stage = 'website-ui'; await metrics(false); await navigate('/', '.artifact-row');
    assert.equal(await evaluate('document.querySelectorAll(".artifact-row").length'), 10);
    assert.equal(await evaluate('document.querySelector("#personalNav")?.getAttribute("href")'), '/app/');
    for (const platform of ['darwin', 'win32', 'linux']) for (const arch of ['x64', 'arm64']) {
      await evaluate(`(()=>{const p=document.getElementById('platform');p.value=${JSON.stringify(platform)};p.dispatchEvent(new Event('change',{bubbles:true}));const a=document.getElementById('arch');a.value=${JSON.stringify(arch)};a.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      const selected = await evaluate('({url:document.getElementById("downloadLink").getAttribute("href"),hash:document.getElementById("sha256").value,hidden:document.getElementById("downloadLink").hidden})');
      const artifact = release.artifacts.find(item => item.platform === platform && item.arch === arch && item.url === selected.url); assert.ok(artifact); assert.equal(selected.hidden, false); assert.equal(selected.hash, artifact.sha256);
    }
    for (const mobile of [false, true]) {
      await metrics(mobile);
      await until(() => evaluate(`(()=>{const v=document.getElementById('heroFilm');return v&&v.readyState>=2&&v.videoWidth===${mobile ? 720 : 1920}})()`), 'decoded public hero');
      await screenshot('website-' + (mobile ? 'mobile' : 'desktop'));
    }
    check('public-website-video-download-selection-and-personal-entry', { architectures: 6 });
    stage = 'pwa-ui'; await metrics(false);
    for (const path of paths) { await navigate(path, '[data-zeno-auth]'); assert.equal(await evaluate('document.querySelector("input[name=email]").value'), ''); assert.equal(await evaluate('document.querySelector("input[name=password]").value'), ''); }
    await navigate('/app/calendar', '[data-zeno-auth]'); await screenshot('pwa-login-desktop');
    await metrics(true); await screenshot('pwa-login-mobile');
    const sw = await until(() => evaluate("navigator.serviceWorker.ready.then(registration=>({scope:registration.scope,script:registration.active?.scriptURL,controller:navigator.serviceWorker.controller?.scriptURL}))"), 'public service worker');
    assert.equal(sw.scope, ORIGIN + '/app/'); assert.equal(sw.script, ORIGIN + '/app/personal-sw.js');
    const cacheUrls = await evaluate("caches.keys().then(async names=>(await Promise.all(names.filter(name=>name.startsWith('zeno-personal-shell-')).map(async name=>(await (await caches.open(name)).keys()).map(request=>request.url)))).flat())");
    assert.ok(cacheUrls.includes(ORIGIN + '/app/')); assert.ok(cacheUrls.every(url => new URL(url).origin === ORIGIN && new URL(url).pathname.startsWith('/app/') && !new URL(url).search));
    assert.ok(!cacheUrls.some(url => url.includes('/api/')));
    check('public-pwa-deep-link-login-mobile-and-service-worker', { registeredWorker: true, publicShellCacheOnly: true });
    assert.equal(exceptions.length, 0); assert.equal(violations.length, 0); assert.equal(httpFailures.length, 0);
    assert.equal(externalRequests, 0); assert.equal(blockedMutations, 0); assert.equal(blockedPackages, 0); assert.equal(blockedExternal, 0); assert.equal(blockedReads, 0);
    report.passed = true;
  } catch { report.failedStage = stage; process.exitCode = 1; }
  finally {
    try { await browser?.send('Browser.close'); } catch {}
    for (const socket of sockets) socket.close();
    if (child) { try { await until(() => child.exitCode !== null || child.signalCode !== null, 'owned Chrome cleanup', 5000); } catch { child.kill('SIGTERM'); } }
    if (temporary) await rm(temporary, { recursive: true, force: true });
    report.network = { pageExternalRequests: externalRequests, blockedExternalRequests: blockedExternal, blockedMutations, blockedInstallerRequests: blockedPackages, blockedOtherReads: blockedReads, pageOrigins: [...seenOrigins], pageHttpFailures: httpFailures.length, runtimeExceptions: exceptions.length, cspViolations: violations.length, actualModelRequests: report.passed ? 0 : null, scope: 'owned page CDP plus same-origin CSP and external DNS denial; not system packet capture' };
    await mkdir(OUTPUT, { recursive: true }); await writeFile(join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('[zeno-public-qa] ' + (report.passed ? 'passed' : 'failed') + '; sanitized public evidence saved.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
