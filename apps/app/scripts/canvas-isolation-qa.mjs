// pnpm --dir apps/app exec bun scripts/canvas-isolation-qa.mjs
// Actual trusted shell + generated documents, synthetic data and loopback sinks.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildCanvasDocument, CANVAS_MESSAGE_CHANNEL } from "../src/components/markdown/canvas-document.ts";
import { serveStaticUi } from "../../server/src/static-ui.ts";

const output = new URL("../verification/canvas-isolation/", import.meta.url);
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const nativeModule = new URL("../../desktop/electron/conversation-canvas-shell.mjs", import.meta.url).href;
const electronPath = createRequire(new URL("../../desktop/package.json", import.meta.url))("electron");
const originalWebRoot = process.env.OPENWORK_WEB_ROOT;
const json = value => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, label, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (await read()) return; await delay(75); }
  throw new Error(`Timed out: ${label}`);
}
async function udpSink() {
  const socket = createSocket("udp4"); let count = 0;
  socket.on("message", () => count++); socket.bind(0, "127.0.0.1"); await once(socket, "listening");
  return { socket, port: socket.address().port, count: () => count };
}
async function connect(url) {
  const socket = new WebSocket(url); let sequence = 0; const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data)); if (!message.id) return;
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return { socket, send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  }) };
}

function boardFixtures(base, udpPort) {
  const report = id => `top.postMessage({qaCase:${json(id)},checks},'*')`;
  const make = (id, code, prefix = "") => {
    const token = randomBytes(24).toString("hex");
    const source = `${prefix}<script>(async()=>{const checks={};try{${code}}catch(error){checks.error=error.name}finally{${report(id)}}})();</script>`;
    const built = buildCanvasDocument("html", source, token); assert.ok(built.ok);
    return { id, token, srcDoc: built.srcDoc };
  };
  const sink = `${base}sink/`;
  const rtc = `const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${udpPort}'}]});window.__qaPC=pc;pc.createDataChannel('synthetic-fixture');await pc.setLocalDescription(await pc.createOffer());checks.offerSet=true;`;
  const nestedPayload = `<script>top.postMessage({qaCase:'unexpected-navigation-executed'},'*');new Image().src=${json(`${sink}nested-navigation`)};</script>`;
  return [
    make("functional", "const input=document.getElementById('range');input.addEventListener('input',()=>document.getElementById('value').textContent=input.value);input.value='7';input.dispatchEvent(new Event('input'));checks.interactive=document.getElementById('value').textContent==='7';checks.svg=!!document.querySelector('svg');", '<label>示例<input id="range" type="range" min="0" max="10" value="1"></label><output id="value">1</output><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'),
    make("network", `fetch(${json(`${sink}fetch`)}).catch(()=>{});const image=new Image();image.src=${json(`${sink}image`)};document.body.append(image);const script=document.createElement('script');script.src=${json(`${sink}script`)};document.body.append(script);const style=document.createElement('style');style.textContent='body{background-image:url(${sink}css)}';document.head.append(style);const nested=document.createElement('iframe');nested.src=${json(`${sink}iframe`)};document.body.append(nested);const form=document.createElement('form');form.action=${json(`${sink}form`)};form.method='POST';document.body.append(form);form.requestSubmit();checks.started=true;`),
    make("webrtc", rtc),
    make("fresh-frame-webrtc", `const nested=document.createElement('iframe');document.body.append(nested);const PC=nested.contentWindow.RTCPeerConnection;const pc=new PC({iceServers:[{urls:'stun:127.0.0.1:${udpPort}'}]});pc.createDataChannel('fresh-global-fixture');await pc.setLocalDescription(await pc.createOffer());checks.offerSet=true;`),
    make("parent-and-bridge", `try{void top.document.body;checks.parentReadable=true}catch{checks.parentReadable=false}try{top.__OPENWORK_ELECTRON__.invokeDesktop('synthetic-fixture');checks.bridgeReadable=true}catch{checks.bridgeReadable=false}Object.prototype.__qaPolluted=true;top.postMessage({channel:${json(CANVAS_MESSAGE_CHANNEL)},token:${json("spoof-token")},type:'open-file',payload:'synthetic-fixture'},'*');checks.prototypeLocal=({}).__qaPolluted===true;`),
    make("script-closing", "try{top.__hostSentinel='escaped';checks.hostWritable=true}catch{checks.hostWritable=false}checks.ran=true;", '</script></body></html><p>Encoded closing-tag fixture</p>'),
    make("navigation-http", `checks.started=true;setTimeout(()=>{location.href=${json(`${sink}navigation`)}},0);`),
    make("navigation-data", `checks.started=true;setTimeout(()=>{location.href='data:text/html,'+encodeURIComponent(${json(nestedPayload)})},0);`),
    make("navigation-blob", `checks.started=true;setTimeout(()=>{location.href=URL.createObjectURL(new Blob([${json(nestedPayload)}],{type:'text/html'}))},0);`),
    make("navigation-about-blank", "checks.started=true;setTimeout(()=>{location.href='about:blank'},0);"),
  ];
}

function hostDocument(fixtures, native) {
  const shell = native ? "zeno-canvas://shell/zeno-canvas-shell.html" : "/zeno-canvas-shell.html";
  return `<!doctype html><meta charset="utf-8"><script>
window.__qa={cases:{},accepted:[],rejected:0,bridgeCalls:0};window.__hostSentinel='intact';
window.__OPENWORK_ELECTRON__={invokeDesktop(){window.__qa.bridgeCalls++}};
const fixtures=${json(fixtures)},frames=new Map();
addEventListener('message',event=>{
 const data=event.data;if(!data||typeof data!=='object')return;
 if(typeof data.qaCase==='string'){window.__qa.cases[data.qaCase]=data.checks||{};return}
 if(data.channel!==${json(CANVAS_MESSAGE_CHANNEL)})return;
 const entry=frames.get(data.token);
 if(!entry||event.source!==entry.contentWindow||event.origin!=='null'){window.__qa.rejected++;return}
 if(data.type==='shell-ready'){const fixture=fixtures.find(item=>item.token===data.token);entry.contentWindow.postMessage({channel:${json(CANVAS_MESSAGE_CHANNEL)},token:data.token,type:'document',srcDoc:fixture.srcDoc},'*');return}
 if(['ready','height','error'].includes(data.type))window.__qa.accepted.push({type:data.type});
});
addEventListener('DOMContentLoaded',()=>{for(const fixture of fixtures){const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.referrerPolicy='no-referrer';frame.title=fixture.id;frame.src=${json(shell)}+'?instance='+fixture.token;frames.set(fixture.token,frame);document.body.append(frame)}});
</script>`;
}

async function verifyRuntime(native) {
  const positiveUdp = await udpSink(); const isolatedUdp = await udpSink();
  let positiveHttp = 0; const leakedRequests = [];
  const profile = await mkdtemp(join(tmpdir(), "zeno-canvas-isolation-"));
  let browser; let child; let stderr = ""; let fixtures; let origin;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", origin ?? "http://127.0.0.1");
      if (url.pathname.startsWith("/sink/")) { leakedRequests.push(url.pathname.slice(6)); response.writeHead(204).end(); return; }
      if (url.pathname === "/positive") { positiveHttp++; response.writeHead(204).end(); return; }
      if (url.pathname === "/zeno-canvas-shell.html") {
        const result = await serveStaticUi(new Request(url, { method: request.method }), { token: "synthetic-never-injected-into-shell" });
        assert.ok(result); response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
      }
      response.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" });
      response.end(hostDocument(fixtures ?? [], native));
    } catch { response.writeHead(500).end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  fixtures = boardFixtures(`${origin}/`, isolatedUdp.port);
  try {
    const flags = ["--headless=new", "--disable-gpu", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check"];
    let executable = process.env.ZENO_CANVAS_QA_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (native) {
      executable = electronPath;
      const main = join(profile, "probe.mjs");
      await writeFile(main, `import {app,BrowserWindow,protocol} from 'electron';import {prepareCanvasShellProtocol,installCanvasShellProtocol} from ${json(nativeModule)};
app.setActivationPolicy?.('prohibited');const prepared=prepareCanvasShellProtocol(app,protocol);
app.whenReady().then(async()=>{const capability=await installCanvasShellProtocol({protocol,prepared,chromiumVersion:process.versions.chrome,shellPath:${json(join(publicRoot, "zeno-canvas-shell.html"))}});if(!capability)throw Error('Native policy unavailable');const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await win.loadURL(${json(`${origin}/`)});});app.on('window-all-closed',()=>app.quit());`);
      flags.unshift(main);
    }
    child = spawn(executable, [...flags, `${origin}/`], { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    await until(() => /DevTools listening on (ws:\/\/[^\s]+)/.test(stderr), "private headless listener");
    const endpoint = new URL(/DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)[1]);
    let page;
    await until(async () => { const pages = await (await fetch(`http://${endpoint.host}/json/list`)).json(); page = pages.find(target => target.type === "page"); return !!page; }, "hidden fixture window");
    browser = await connect(page.webSocketDebuggerUrl);
    const evaluate = async expression => {
      const result = await browser.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error("Fixture evaluation failed");
      return result.result.value;
    };
    const version = await browser.send("Browser.getVersion");
    await until(async () => evaluate(`Object.keys(window.__qa?.cases??{}).length>=${fixtures.length}`), "all isolated probes start");
    await evaluate(`(async()=>{await fetch('/positive');const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${positiveUdp.port}'}]});window.__positivePC=pc;pc.createDataChannel('positive-control');await pc.setLocalDescription(await pc.createOffer())})()`);
    await until(() => positiveUdp.count() > 0 && positiveHttp > 0, "HTTP and UDP positive controls", 8000);
    await evaluate("window.__positivePC.close()");
    await delay(5000);
    const result = await evaluate("({...window.__qa,sentinel:window.__hostSentinel,hostPrototypeUnchanged:({}).__qaPolluted===undefined})");
    assert.equal(leakedRequests.length, 0, "Untrusted board traffic reached the loopback HTTP sink");
    assert.equal(isolatedUdp.count(), 0, "Untrusted board WebRTC reached the loopback UDP sink");
    assert.equal(result.cases.functional?.interactive, true); assert.equal(result.cases.functional?.svg, true);
    assert.equal(result.cases["parent-and-bridge"]?.parentReadable, false);
    assert.equal(result.cases["parent-and-bridge"]?.bridgeReadable, false);
    assert.equal(result.cases["script-closing"]?.hostWritable, false); assert.equal(result.cases["script-closing"]?.ran, true);
    assert.equal(result.cases["unexpected-navigation-executed"], undefined);
    assert.equal(result.bridgeCalls, 0); assert.equal(result.sentinel, "intact"); assert.equal(result.hostPrototypeUnchanged, true);
    assert.ok(result.rejected >= 1); assert.ok(result.accepted.some(event => event.type === "ready"));
    return { passed: true, runtime: native ? "electron" : "chrome-http", browser: version.product,
      ...(native ? { electron: createRequire(new URL("../../desktop/package.json", import.meta.url))("electron/package.json").version,
        nativeFlags: ["ConnectionAllowlists", "OverrideConnectionAllowlistOriginTrial"] } : {}),
      policy: "Connection-Allowlist: ()", actualTrustedShell: true, actualGeneratedDocuments: true,
      positiveControls: { http: positiveHttp > 0, udp: positiveUdp.count() > 0 },
      isolatedHttpRequests: leakedRequests.length, isolatedSTUNPackets: isolatedUdp.count(),
      probes: result.cases, spoofedBridgeMessagesRejected: result.rejected, hostBridgeCalls: result.bridgeCalls,
      hostPrototypeUnchanged: result.hostPrototypeUnchanged, hostSentinelUnchanged: result.sentinel === "intact",
      syntheticDataOnly: true, externalServicesUsed: false };
  } finally {
    if (browser) { await Promise.race([browser.send("Browser.close").catch(() => {}), delay(1000)]); browser.socket.close(); }
    if (child && child.exitCode === null) { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), delay(2000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
    positiveUdp.socket.close(); isolatedUdp.socket.close();
    await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); stderr = "";
  }
}

try {
  process.env.OPENWORK_WEB_ROOT = publicRoot;
  const results = [];
  for (const native of [false, true]) results.push(await verifyRuntime(native));
  await mkdir(output, { recursive: true });
  await writeFile(new URL("report.json", output), JSON.stringify({ passed: true, results }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, runtimes: results.map(result => ({ runtime: result.runtime, browser: result.browser, isolatedHttpRequests: result.isolatedHttpRequests, isolatedSTUNPackets: result.isolatedSTUNPackets })) }));
} finally {
  if (originalWebRoot === undefined) delete process.env.OPENWORK_WEB_ROOT;
  else process.env.OPENWORK_WEB_ROOT = originalWebRoot;
}
