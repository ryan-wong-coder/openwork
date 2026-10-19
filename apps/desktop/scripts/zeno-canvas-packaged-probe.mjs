import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCanvasDocument, CANVAS_MESSAGE_CHANNEL } from "../../app/src/components/markdown/canvas-document.ts";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const nativeShell = "zeno-canvas://shell/zeno-canvas-shell.html";

export function assertCanvasProbeTarget(location, bundle) {
  const url = new URL(location);
  assert.ok(url.protocol === "file:" && !url.host && !url.username && !url.password
    && resolve(fileURLToPath(url)) === join(bundle, "Contents/Resources/app-dist/index.html"), "Canvas probe requires the owned packaged main renderer.");
}

function installedRuntime(bundle) {
  const resources = join(bundle, "Contents/Resources/app-dist");
  const directory = join(resources, "assets");
  const names = readdirSync(directory).filter(name => /^_virtual_zeno-canvas-chart-runtime-[A-Za-z0-9_-]+\.js$/.test(name));
  assert.equal(names.length, 1, "The installed target needs one actual lazy chart runtime.");
  const path = join(directory, names[0]);
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), "The installed chart module must be a regular file.");
  const module = readFileSync(path);
  const shell = readFileSync(join(resources, "zeno-canvas-shell.html"));
  assert.ok(module.length > 100_000 && shell.includes('<meta name="zeno-canvas-shell" content="1">'), "Installed canvas resources are incomplete.");
  return { url: pathToFileURL(path).href, moduleBytes: module.length, moduleSha256: hash(module), shellSha256: hash(shell) };
}

export function canvasProbeDocument(runtimeScript, token) {
  const source = `<style>.probe-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.probe-chart{height:180px}h2{font-size:14px}button{margin-block:8px}</style>
<h1>Zeno · 打包画布验收</h1><button class="btn" id="change">更新示例</button><output id="value">1</output>
<div class="probe-grid"><section><h2>Canvas / SVG</h2><canvas id="pixels" width="240" height="70"></canvas><svg width="240" height="35"><rect id="bar" height="24" width="24" fill="currentColor"/></svg></section><section><h2>Ant Design Charts · Line</h2><div class="probe-chart" id="line"></div></section></div>
<h2>Ant Design Charts · FlowGraph</h2><div class="probe-chart" id="flow"></div>
<script>(async()=>{
 const checks={};
 try{
  const canvas=document.getElementById('pixels'),context=canvas.getContext('2d'),bar=document.getElementById('bar');let value=1;
  const draw=()=>{context.clearRect(0,0,240,70);context.fillStyle='#2e8277';context.fillRect(4,8,value*48,48);bar.setAttribute('width',String(value*24));document.getElementById('value').textContent=String(value)};
  document.getElementById('change').onclick=()=>{value++;draw()};draw();const before=canvas.toDataURL();document.getElementById('change').click();
  checks.canvasChanged=before!==canvas.toDataURL();checks.svgChanged=bar.getAttribute('width')==='48';checks.interactive=document.getElementById('value').textContent==='2';
  try{void top.document.body;checks.parentReadable=true}catch{checks.parentReadable=false}
  checks.nativeBridgeReadable=typeof window.__OPENWORK_ELECTRON__!=='undefined';checks.nodeReadable=typeof require!=='undefined'||typeof process!=='undefined';
  top.postMessage({channel:${JSON.stringify(CANVAS_MESSAGE_CHANNEL)},token:${JSON.stringify(token)},type:'open-file',payload:'synthetic-rejected-probe'},'*');
  await ZenoCharts.ready;
  const line=ZenoCharts.render(document.getElementById('line'),{type:'Line',data:[{day:'周一',value:20},{day:'周二',value:42},{day:'周三',value:34}],xField:'day',yField:'value'});
  const flow=ZenoCharts.render(document.getElementById('flow'),{type:'FlowGraph',data:{nodes:[{id:'a',data:{label:'想法'}},{id:'b',data:{label:'实现'}},{id:'c',data:{label:'验证'}}],edges:[{source:'a',target:'b'},{source:'b',target:'c'}]},labelField:'label'});
  await Promise.all([line.ready,flow.ready]);
  checks.antLine=document.getElementById('line').dataset.zenoChartState==='ready';checks.antFlow=document.getElementById('flow').dataset.zenoChartState==='ready';
  checks.antPixels=['line','flow'].every(id=>[...document.getElementById(id).querySelectorAll('canvas')].some(canvas=>{const context=canvas.getContext('2d');return context&&context.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0)}));
 }catch{checks.failed=true}
 top.postMessage({zenoPackagedCanvasProbe:${JSON.stringify(token)},checks},'*');
})();</script>`;
  return buildCanvasDocument("html", source, token, { runtimeScript, theme: {
    dark: false, text: "#183f3d", background: "#f6f5ef", muted: "#617876", grid: "#dce2dc", accent: "#2e8277",
    palette: ["#2e8277", "#bc863f", "#7b75a0"], fontFamily: "system-ui, sans-serif",
  } });
}

/** Called only after the CI-only updater has authenticated its private renderer. */
export async function verifyPackagedCanvas({ client, bundle }) {
  assert.equal(process.env.CI, "true", "Packaged canvas probe is CI-only.");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "An ephemeral hosted runner is required.");
  assert.equal(process.platform, "darwin", "The packaged canvas probe requires native macOS.");
  assertCanvasProbeTarget(await client.evaluate("location.href"), bundle);
  await client.send("Page.bringToFront");
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const assets = installedRuntime(bundle);
  const capability = await client.evaluate("window.__OPENWORK_ELECTRON__.conversationCanvas");
  assert.deepEqual(capability, { shellUrl: nativeShell, networkPolicy: "connection-allowlist" }, "The installed native bridge did not advertise its policy-bearing shell.");
  // Import the real installed lazy module through the real packaged renderer.
  // This verifies production file:// resolution; the returned IIFE is embedded
  // with the release checkout's production document builder, never recompiled.
  const runtimeScript = await client.evaluate(`import(${JSON.stringify(assets.url)}).then(module=>module.default)`);
  assert.ok(typeof runtimeScript === "string" && runtimeScript.length > 100_000, "The installed chart module did not load.");
  const token = randomBytes(24).toString("hex");
  const built = canvasProbeDocument(runtimeScript, token); assert.ok(built.ok, "The production document builder rejected the synthetic canvas.");
  let response;
  const stopObserving = client.observe(event => {
    if (event.method !== "Network.responseReceived") return;
    const candidate = event.params.response;
    if (candidate.url !== `${nativeShell}?instance=${token}`) return;
    const headers = Object.fromEntries(Object.entries(candidate.headers).map(([name, value]) => [name.toLowerCase(), value]));
    response = { status: candidate.status, allowlist: headers["connection-allowlist"], contentType: headers["content-type"] };
  });
  const stateKey = `__zenoCanvasProbe${token}`;
  try {
    await client.evaluate(`(()=>{
      const token=${JSON.stringify(token)},key=${JSON.stringify(stateKey)},channel=${JSON.stringify(CANVAS_MESSAGE_CHANNEL)};
      const container=document.createElement('div');container.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#f6f5ef;padding:16px';
      const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.referrerPolicy='no-referrer';frame.title='打包画布验收';frame.style.cssText='width:100%;height:100%;border:0';
      const state={container,frame,bridge:window.__OPENWORK_ELECTRON__,root:document.getElementById('root'),marker:localStorage.getItem('zeno.update.smoke'),ready:false,rejected:0,checks:null};
      const listener=event=>{const data=event.data;if(!data||typeof data!=='object')return;
        if(data.zenoPackagedCanvasProbe===token&&event.origin==='null'){state.checks=data.checks;return}
        if(data.channel!==channel||data.token!==token)return;
        if(event.source!==frame.contentWindow||event.origin!=='null'){state.rejected++;return}
        if(data.type==='shell-ready'){frame.contentWindow.postMessage({channel,token,type:'document',srcDoc:${JSON.stringify(built.srcDoc)}},'*');return}
        if(data.type==='ready')state.ready=true;
      };
      state.cleanup=()=>{removeEventListener('message',listener);container.remove();const intact=window.__OPENWORK_ELECTRON__===state.bridge&&state.root===document.getElementById('root')&&state.root?.isConnected&&state.marker===localStorage.getItem('zeno.update.smoke');delete window[key];return Boolean(intact)};
      window[key]=state;addEventListener('message',listener);frame.src=${JSON.stringify(nativeShell)}+'?instance='+token;container.append(frame);document.body.append(container);return true;
    })()`);
    const deadline = Date.now() + 60_000;
    let result;
    while (Date.now() < deadline) {
      result = await client.evaluate(`(()=>{const state=window[${JSON.stringify(stateKey)}];return {ready:state.ready,rejected:state.rejected,checks:state.checks}})()`);
      if (result.ready && result.checks) break;
      await delay(100);
    }
    assert.ok(result?.ready && result.checks, "The actual native shell did not finish the synthetic board.");
    assert.deepEqual(result.checks, { canvasChanged: true, svgChanged: true, interactive: true, parentReadable: false, nativeBridgeReadable: false,
      nodeReadable: false, antLine: true, antFlow: true, antPixels: true }, "The packaged canvas interaction or frame boundary failed.");
    assert.ok(result.rejected >= 1, "The spoofed board message was not rejected.");
    assert.ok(response?.status === 200 && response.allowlist?.trim() === "()" && response.contentType?.includes("text/html"), "The actual native protocol response did not carry its connection policy.");
    await client.send("Page.bringToFront");
    await client.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
    return { report: { passed: true, scope: "actual installed target after native update/restart; synthetic board, no model calls", nativeBridge: true,
      policyResponse: response, installedModule: { bytes: assets.moduleBytes, sha256: assets.moduleSha256 }, runtimeIIFE: { bytes: Buffer.byteLength(runtimeScript), sha256: hash(runtimeScript) },
      installedShellSha256: assets.shellSha256, productionDocumentBuilder: "matching release checkout", checks: result.checks, spoofedMessagesRejected: result.rejected },
      screenshot: Buffer.from(screenshot.data, "base64") };
  } finally {
    stopObserving();
    assert.equal(await client.evaluate(`window[${JSON.stringify(stateKey)}]?.cleanup()`), true, "Canvas probe cleanup changed the host DOM, bridge or profile marker.");
  }
}
