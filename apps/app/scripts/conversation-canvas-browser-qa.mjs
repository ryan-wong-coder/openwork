// Actual React component fixture, isolated browser targets; no API/model calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cdp = process.env.CANVAS_QA_CDP;
const fixture = process.env.CANVAS_QA_URL;
assert.ok(cdp && fixture, 'Provide the task-owned headless CDP and Vite fixture URLs.');
for (const value of [cdp, fixture]) assert.equal(new URL(value).hostname, '127.0.0.1');
const output = fileURLToPath(new URL('../verification/conversation-canvas/', import.meta.url));
await mkdir(output, { recursive: true });
async function connect(url, onEvent = () => {}) {
  const socket = new WebSocket(url); let next = 0; const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);
    } else onEvent(message);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return { socket, listen: listener => { onEvent = listener; }, send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 90_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  }) };
}
const browserVersion = await (await fetch(`${cdp}/json/version`)).json();
const browser = await connect(browserVersion.webSocketDebuggerUrl);
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const target = (await (await fetch(`${cdp}/json/list`)).json()).find(item => item.id === targetId);
const contexts = new Map(); const sessions = new Map(); const exceptions = []; const origins = new Set(); const checks = []; const shellResponses = [];
let interceptResponse; let interceptionFailure;
const observe = event => {
  const scope = event.sessionId ?? 'host';
  if (event.method === 'Runtime.executionContextCreated') contexts.set(`${scope}:${event.params.context.id}`, { ...event.params.context, sessionId: event.sessionId });
  if (event.method === 'Runtime.executionContextDestroyed') contexts.delete(`${scope}:${event.params.executionContextId}`);
  if (event.method === 'Runtime.executionContextsCleared') for (const key of contexts.keys()) if (key.startsWith(`${scope}:`)) contexts.delete(key);
  if (event.method === 'Runtime.exceptionThrown') exceptions.push(event.params.exceptionDetails.text);
  if (event.method === 'Network.requestWillBeSent') {
    const url = new URL(event.params.request.url); if (['http:', 'https:'].includes(url.protocol)) origins.add(url.origin);
  }
  if (event.method === 'Network.responseReceived' && new URL(event.params.response.url).pathname.endsWith('/zeno-canvas-shell.html')) {
    const response = event.params.response;
    const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
    shellResponses.push({ status: response.status, allowlist: headers['connection-allowlist'] ?? null, contentType: headers['content-type'] ?? null });
  }
  if (event.method === 'Fetch.requestPaused' && interceptResponse) void interceptResponse(event.params).catch(error => { interceptionFailure = error; });
};
const page = await connect(target.webSocketDebuggerUrl, observe);
browser.listen(observe);
async function evaluate(expression, contextId) {
  const reference = typeof contextId === 'object' ? contextId : { id: contextId };
  const transport = reference?.sessionId ? browser : page;
  const result = await transport.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(reference?.id ? { contextId: reference.id } : {}) }, reference?.sessionId);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await pause(100); }
  throw Error(`Timed out: ${label}`);
}
async function innerContext(predicate) {
  return until(async () => {
    const targets = (await browser.send('Target.getTargets')).targetInfos;
    const queue = [undefined]; const inspected = new Set();
    while (queue.length) {
      const sessionId = queue.shift(); if (inspected.has(sessionId)) continue; inspected.add(sessionId);
      const transport = sessionId ? browser : page;
      let document;
      try { document = await transport.send('DOM.getDocument', { depth: -1, pierce: true }, sessionId); } catch { continue; }
      const frames = [];
      function scan(node) { if (node.nodeName === 'IFRAME' && node.frameId) frames.push(node.frameId); for (const child of node.children ?? []) scan(child); if (node.contentDocument) scan(node.contentDocument); }
      scan(document.root);
      for (const frameId of frames) {
        if (!targets.some(target => target.type === 'iframe' && target.targetId === frameId)) continue;
        if (!sessions.has(frameId)) {
          const attached = await browser.send('Target.attachToTarget', { targetId: frameId, flatten: true }); sessions.set(frameId, attached.sessionId);
          await browser.send('Runtime.enable', {}, attached.sessionId); await browser.send('Page.enable', {}, attached.sessionId);
        }
        queue.push(sessions.get(frameId));
      }
    }
    for (const context of contexts.values()) {
      if (context.auxData?.isDefault === false) continue;
      try { if (await evaluate(predicate, context)) return context; } catch { /* A replaced sandbox context disappears. */ }
    }
    return null;
  }, 'owned inner sandbox context');
}
async function size(width, height = 900) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
  await pause(350);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, `Host horizontal overflow at ${width}`);
}
async function shot(name) {
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await page.send('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(`${output}${name}.png`, Buffer.from(result.data, 'base64')));
}
async function scenario(name) {
  await evaluate(`window.__conversationCanvasFixture.setScenario(${JSON.stringify(name)})`);
  await pause(100);
}
async function ready() {
  await until(async () => {
    const state = await evaluate('document.querySelector("[data-canvas-state]")?.dataset.canvasState');
    if (state === 'failed') throw Error('The real component reported sandbox rendering failure.');
    return state === 'ready';
  }, 'real component sandbox ready');
}
function check(name, values = {}) { checks.push({ name, passed: true, ...values }); console.log(`[canvas-browser-qa] ${name}`); }
const report = { checkedAt: new Date().toISOString(), fixture, scope: 'actual MarkdownBlock and ConversationCanvas in an isolated Vite component fixture; no full app/native or model call', passed: false, checks };
try {
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await size(1200);
  await page.send('Page.navigate', { url: fixture });
  await until(() => evaluate('Boolean(window.__conversationCanvasFixture)'), 'actual React fixture bootstrap');
  await ready();
  let inner = await innerContext('Boolean(window.fixtureRead && document.getElementById("rate"))');
  const tree = await page.send('Page.getFrameTree');
  const frameIDs = new Set();
  function collectFrames(node) { frameIDs.add(node.frame.id); for (const child of node.childFrames ?? []) collectFrames(child); }
  collectFrames(tree.frameTree);
  for (const sessionId of sessions.values()) collectFrames((await browser.send('Page.getFrameTree', {}, sessionId)).frameTree);
  assert.equal(frameIDs.size, 4, 'Expected host + policy-bearing static shell + trusted shell + isolated board');
  assert.ok(shellResponses.some(response => response.status === 200 && response.allowlist === '()' && response.contentType.includes('text/html')));
  assert.equal(await evaluate('document.querySelector("[data-canvas-frame]").hasAttribute("srcdoc")'), false);
  check('policy-bearing static shell authenticates and three isolated iframe layers become ready', { frames: frameIDs.size, shellResponses: shellResponses.slice() });
  const initial = await evaluate('window.fixtureRead()', inner);
  await evaluate('document.getElementById("rate").value="75";document.getElementById("rate").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("increment").click();document.getElementById("increment").click()', inner);
  const changed = await evaluate('window.fixtureRead()', inner);
  assert.equal(changed.rate, 75); assert.equal(changed.counter, 2); assert.equal(changed.barWidth, 480); assert.notDeepEqual(changed.pixel, initial.pixel);
  check('slider changes actual canvas pixels and SVG geometry', { rate: changed.rate, counter: changed.counter, barWidth: changed.barWidth });
  await pause(300);
  const before = await evaluate('window.fixtureRead()', inner);
  await evaluate('window.__qaFrame=document.querySelector("[data-canvas-frame]");window.__qaSource=window.__qaFrame.src;window.__qaLoads=0;window.__qaFrame.addEventListener("load",()=>window.__qaLoads++)');
  assert.equal(await evaluate('window.__conversationCanvasFixture.streamHundred()'), 100);
  await evaluate('window.__conversationCanvasFixture.settle();window.__conversationCanvasFixture.highlight("结果")'); await pause(250);
  const after = await evaluate('window.fixtureRead()', inner);
  assert.deepEqual(after, before);
  assert.deepEqual(await evaluate('({sameFrame:window.__qaFrame===document.querySelector("[data-canvas-frame]"),sameDocument:window.__qaSource===window.__qaFrame.src,loads:window.__qaLoads})'), { sameFrame: true, sameDocument: true, loads: 0 });
  check('100 streamed prose updates, settlement and highlighting preserve controls and painting', { updates: 100, iframeLoads: 0, bootCount: after.bootCount, paintCount: after.paintCount });
  await evaluate('Array.from(document.querySelectorAll("[data-conversation-canvas] button")).find(button=>button.textContent==="源码").click()');
  assert.equal(await evaluate('document.querySelector("[data-canvas-source]").textContent.includes("fixturePaintCount")'), true);
  await shot('source');
  await evaluate('Array.from(document.querySelectorAll("[data-conversation-canvas] button")).find(button=>button.textContent==="预览").click()'); await pause(150);
  assert.deepEqual(await evaluate('window.fixtureRead()', inner), before);
  assert.equal(await evaluate('window.__qaLoads'), 0);
  check('source roundtrip retains the running board and control state');
  const layouts = [];
  for (const [width, height, name] of [[1200, 900, 'desktop'], [736, 900, 'tablet'], [360, 844, 'mobile']]) {
    await size(width, height);
    const layout = await evaluate('({width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,bodyClientHeight:document.body.clientHeight,bodyScrollHeight:document.body.scrollHeight,scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),scrollHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),rootScrollRange:document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight})', inner);
    assert.ok(layout.scrollWidth <= layout.width, `Board horizontal overflow at ${width}`);
    assert.ok(layout.scrollHeight <= layout.height + 1, `Board internal vertical scrolling at ${width}`);
    assert.ok(layout.rootScrollRange <= 1, `Root scroll range at ${width}`);
    assert.ok(layout.bodyScrollHeight <= layout.bodyClientHeight + 1, `Body scroll range at ${width}`);
    layouts.push({ hostWidth: width, ...layout });
    await shot(name);
  }
  const labels = await evaluate('({slider:document.getElementById("rate").getAttribute("aria-label"),button:document.getElementById("increment").textContent,font:parseFloat(getComputedStyle(document.getElementById("rate")).fontSize),width:document.documentElement.scrollWidth,viewport:innerWidth})', inner);
  assert.equal(labels.slider, '增长率'); assert.equal(labels.button, '增加一次'); assert.ok(labels.font >= 13); assert.ok(labels.width <= labels.viewport);
  check('360, 736 and 1200 widths fit the host and board without internal scrolling; interactive labels remain legible', { layouts });
  await size(1200);
  await evaluate('window.__conversationCanvasFixture.theme(true)');
  await until(() => evaluate('window.fixtureRead().dark', inner), 'theme forwarding into isolated board');
  assert.equal(await evaluate('window.__qaFrame===document.querySelector("[data-canvas-frame]")&&window.__qaSource===window.__qaFrame.src&&window.__qaLoads===0'), true);
  assert.equal((await evaluate('window.fixtureRead()', inner)).counter, 2);
  await shot('dark'); check('dark theme forwarded without replacing the frame or resetting controls');
  await evaluate('window.__conversationCanvasFixture.theme(false)');
  await scenario('pending'); await size(360, 844);
  assert.equal(await evaluate('document.querySelector("[data-canvas-viewport]").getBoundingClientRect().height'), 360);
  assert.equal(await evaluate('document.querySelectorAll("[data-canvas-frame]").length'), 0);
  for (let index = 0; index < 10; index++) await evaluate(`window.__conversationCanvasFixture.append(${JSON.stringify(' partial'.repeat(index + 1))})`);
  assert.equal(await evaluate('document.querySelector("[data-canvas-viewport]").getBoundingClientRect().height'), 360);
  await shot('pending'); check('incomplete fence reserves 360px without executing partial code');
  await scenario('error'); await size(736);
  await until(() => evaluate('Boolean(document.querySelector("[data-canvas-state=failed]"))'), 'invalid chart source fallback');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-canvas-source]")&&!document.querySelector("[data-canvas-source]").parentElement.hidden)'), true);
  await shot('error');
  await evaluate('document.querySelector("button[aria-label=重试预览]").click()');
  await until(() => evaluate('Boolean(document.querySelector("[data-canvas-state=failed]"))'), 'retry preserves explicit failure');
  check('invalid source stays readable with a working retry action');
  await size(1200); await scenario('statistical'); await ready();
  inner = await innerContext('Boolean(document.getElementById("chart")&&document.querySelector("canvas,svg"))');
  const statistical = await evaluate('({canvases:document.querySelectorAll("#chart canvas").length,svgs:document.querySelectorAll("#chart svg").length,title:document.getElementById("chart").getAttribute("aria-label"),width:document.body.scrollWidth,viewport:innerWidth})', inner);
  assert.equal(statistical.title, '每周完成量'); assert.ok(statistical.canvases + statistical.svgs > 0); assert.ok(statistical.width <= statistical.viewport);
  await shot('statistical'); check('Ant Design statistical chart renders in the real isolated board', statistical);
  await scenario('relationship'); await ready();
  inner = await innerContext('Boolean(document.getElementById("chart")&&document.querySelector("canvas,svg"))');
  const relationship = await evaluate('({canvases:document.querySelectorAll("#chart canvas").length,svgs:document.querySelectorAll("#chart svg").length,title:document.getElementById("chart").getAttribute("aria-label"),width:document.body.scrollWidth,viewport:innerWidth})', inner);
  assert.equal(relationship.title, '项目协作'); assert.ok(relationship.canvases + relationship.svgs > 0); assert.ok(relationship.width <= relationship.viewport);
  await shot('relationship'); check('Ant Design relationship chart renders in the real isolated board', relationship);
  await scenario('relationships'); await size(1200, 1100); await ready();
  inner = await innerContext('Boolean(window.fixtureRelationshipsReady)');
  const relationships = await evaluate('Array.from(document.querySelectorAll(".gallery section")).map(section=>({type:section.querySelector("h3").textContent,state:section.querySelector(".graph").dataset.zenoChartState,canvases:section.querySelectorAll("canvas").length}))', inner);
  assert.equal(relationships.length, 5);
  assert.ok(relationships.every(graph => graph.state === 'ready' && graph.canvases > 0));
  await pause(500);
  await shot('relationships'); check('five relationship families render together using the actual board chart API', { charts: relationships });
  await scenario('plain'); await pause(200);
  assert.equal(await evaluate('document.querySelectorAll("[data-canvas-frame]").length'), 0);
  assert.equal(await evaluate('document.querySelector("code").textContent.includes("普通代码示例")'), true);
  check('ordinary HTML remains fenced code');
  await size(1200, 900);
  await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36' });
  await page.send('Page.navigate', { url: fixture });
  await until(() => evaluate('Boolean(document.querySelector("[data-canvas-state=failed]"))'), 'unsupported Chromium source-only gate');
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0);
  assert.equal(await evaluate('document.querySelector("[data-canvas-source]").textContent.includes("fixturePaintCount")'), true);
  await shot('unsupported-browser'); check('unsupported Chromium 151 exposes source without creating any generated-code iframe');
  await page.send('Emulation.setUserAgentOverride', { userAgent: browserVersion['User-Agent'] });
  let removedHeaders = 0;
  interceptResponse = async paused => {
    const response = await page.send('Fetch.getResponseBody', { requestId: paused.requestId });
    const responseHeaders = (paused.responseHeaders ?? []).filter(header => header.name.toLowerCase() !== 'connection-allowlist');
    removedHeaders++;
    await page.send('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: paused.responseStatusCode,
      responseHeaders, body: response.base64Encoded ? response.body : Buffer.from(response.body).toString('base64') });
  };
  await page.send('Fetch.enable', { patterns: [{ urlPattern: `${new URL(fixture).origin}/*zeno-canvas-shell.html`, requestStage: 'Response' }] });
  await page.send('Page.navigate', { url: fixture });
  await until(() => evaluate('Boolean(document.querySelector("[data-canvas-state=failed]"))'), 'missing header source-only gate');
  if (interceptionFailure) throw interceptionFailure;
  assert.equal(removedHeaders, 1);
  assert.equal(await evaluate('document.querySelectorAll("iframe").length'), 0);
  assert.equal(await evaluate('document.querySelector("[data-canvas-source]").textContent.includes("fixturePaintCount")'), true);
  await shot('missing-policy'); check('removing the actual HTTP shell allowlist header leaves readable source without generated-code iframe', { removedHeaders });
  await page.send('Fetch.disable'); interceptResponse = undefined;
  assert.deepEqual(exceptions, []); assert.deepEqual([...origins], [new URL(fixture).origin]);
  report.runtimeExceptions = exceptions; report.networkOrigins = [...origins]; report.externalModelCalls = 0; report.userBrowserUsed = false; report.passed = true;
} catch (error) {
  report.error = error.message; report.runtimeExceptions = exceptions;
  try { await shot('failure'); } catch { /* Preserve the original failure. */ }
  throw error;
} finally {
  await writeFile(`${output}browser-qa.json`, JSON.stringify(report, null, 2) + '\n');
  page.socket.close(); await browser.send('Target.closeTarget', { targetId }); browser.socket.close();
}
console.log(JSON.stringify(report));
