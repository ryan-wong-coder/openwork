// pnpm --dir apps/app exec bun scripts/canvas-chart-runtime-qa.mjs
// Real headless Chrome + opaque iframe + shipped IIFE. No application profile,
// model credential, runtime CDN, network data source or desktop window is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { buildCanvasChartRuntime } from "./canvas-chart-runtime-vite-plugin.ts";

const runtime = await buildCanvasChartRuntime();
const directory = await mkdtemp(join(tmpdir(), "zeno-ant-charts-qa-"));
const output = new URL("../verification/canvas-charts/", import.meta.url);
await mkdir(output, { recursive: true });
const data = [
  { day: "周一", value: 20, series: "研究" }, { day: "周二", value: 42, series: "研究" }, { day: "周三", value: 34, series: "研究" },
  { day: "周一", value: 32, series: "写作" }, { day: "周二", value: 25, series: "写作" }, { day: "周三", value: 49, series: "写作" },
];
const graph = { nodes: [{ id: "start", data: { label: "想法" } }, { id: "build", data: { label: "实现" } }, { id: "verify", data: { label: "验证" } }],
  edges: [{ source: "start", target: "build" }, { source: "build", target: "verify" }] };
const tree = { id: "root", label: "计划", children: [{ id: "design", label: "设计", children: [{ id: "draft", label: "草图" }] }, { id: "develop", label: "开发" }, { id: "test", label: "验收" }] };
const fixtures = [
  { type: "Line", data, xField: "day", yField: "value", colorField: "series" },
  { type: "Column", data, xField: "day", yField: "value", colorField: "series", group: true },
  { type: "Bar", data, xField: "day", yField: "value", colorField: "series", group: true },
  { type: "Pie", data: [{ category: "研究", value: 45 }, { category: "写作", value: 35 }, { category: "整理", value: 20 }], angleField: "value", colorField: "category", innerRadius: 0.55 },
  { type: "Scatter", data: data.map((row, index) => ({ ...row, x: index + 1 })), xField: "x", yField: "value", colorField: "series" },
  { type: "Heatmap", data: ["周一", "周二", "周三"].flatMap((day, x) => ["上午", "下午", "傍晚"].map((time, y) => ({ day, time, value: 10 + x * 17 + y * 9 }))), xField: "day", yField: "time", colorField: "value" },
  { type: "Area", data, xField: "day", yField: "value", colorField: "series" },
  { type: "Radar", data, xField: "day", yField: "value", colorField: "series" },
  { type: "Funnel", data: [{ stage: "想法", value: 100 }, { stage: "实现", value: 70 }, { stage: "验证", value: 45 }], xField: "stage", yField: "value", colorField: "stage" },
  { type: "FlowGraph", data: graph, labelField: "label" },
  { type: "MindMap", data: tree, labelField: "label", direction: "right" },
  { type: "OrganizationChart", data: tree, labelField: "label" },
  { type: "NetworkGraph", data: graph, labelField: "label", layout: { type: "circular" } },
  { type: "IndentedTree", data: tree, labelField: "label" },
];
const dark = process.env.ZENO_CHART_QA_DARK === "1";
const theme = dark
  ? { dark: true, background: "#172524", text: "#d8e6df", muted: "#a4b7af", grid: "#34463f", accent: "#8cc7b7", palette: ["#8cc7b7", "#d5ab6e", "#a9a1c6", "#7fb3bd", "#c68fa0"], fontFamily: "system-ui, sans-serif" }
  : { dark: false, background: "#f6f5ef", text: "#183f3d", muted: "#617876", grid: "#dce2dc", accent: "#2e8277", palette: ["#2e8277", "#bc863f", "#7b75a0", "#5597a1", "#a96a79"], fontFamily: "system-ui, sans-serif" };
const inline = source => source.replace(/<\/script/gi, "<\\/script");
const inner = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; worker-src 'none'; font-src 'none'; media-src 'none'">
<style>html{color:${theme.text};background:${theme.background};font:13px/1.5 system-ui}body{margin:0;padding:16px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}section{min-width:0}section[data-graph]{grid-column:1/-1}h2{font-size:13px;margin:0 0 8px}.chart{height:260px;width:100%}#controls{padding:0 0 16px}select{font:inherit;color:inherit;background:transparent;border:1px solid ${theme.grid};padding:4px}</style>
<div id="controls"><select id="filter"><option value="all">全部</option><option value="研究">研究</option></select></div>
<main>${fixtures.map(fixture => `<section${["FlowGraph", "MindMap", "OrganizationChart", "NetworkGraph", "IndentedTree"].includes(fixture.type) ? " data-graph" : ""}><h2>${fixture.type}</h2><div class="chart" id="${fixture.type}"></div></section>`).join("")}<section><h2>局部错误</h2><div class="chart" id="invalid"></div></section></main>
<script>window.__violations=[];document.addEventListener('securitypolicyviolation',event=>window.__violations.push(event.violatedDirective));window.__ZENO_CHART_THEME__=${JSON.stringify(theme)};</script>
<script>${inline(runtime)}</script><script>
window.__fixtures=${JSON.stringify(fixtures)};window.__handles=[];window.__ready=false;window.__filtered=false;
(async()=>{await ZenoCharts.ready;for(const spec of window.__fixtures)window.__handles.push(ZenoCharts.render(document.getElementById(spec.type),spec));await Promise.all(window.__handles.map(handle=>handle.ready));window.__ready=true;document.getElementById('filter').addEventListener('change',async event=>{await window.__handles[0].update({data:event.target.value==='all'?window.__fixtures[0].data:window.__fixtures[0].data.filter(row=>row.series===event.target.value)});window.__filtered=true;});const bad=ZenoCharts.render(document.getElementById('invalid'),{type:'Missing',data:[]});try{await bad.ready}catch{window.__localError=true}})();
</script>`;
const escaped = inner.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const server = createServer((_request, response) => { response.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" }); response.end(`<!doctype html><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escaped}"></iframe>`); });
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert.ok(address && typeof address === "object");
let chrome; let browser; let connection; let stderr = "";
async function connect(url, onEvent = () => {}) {
  const socket = new WebSocket(url); let sequence = 0; const pending = new Map();
  socket.onmessage = ({ data }) => { const message = JSON.parse(String(data)); if (message.id) { const entry = pending.get(message.id); if (entry) { pending.delete(message.id); clearTimeout(entry.deadline); message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result); } } else onEvent(message); };
  socket.onclose = () => { for(const entry of pending.values()){clearTimeout(entry.deadline);entry.reject(Error("The QA browser disconnected."));}pending.clear(); };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return { socket, send: (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence;const deadline=setTimeout(()=>{pending.delete(id);reject(Error(`QA browser command timed out: ${method}`));},30000);pending.set(id, { resolve, reject, deadline }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }) };
}
async function until(read, label) { const end = Date.now() + 30000; while (Date.now() < end) { if (await read()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error(`Timed out: ${label}`); }
try {
  chrome = spawn(process.env.ZENO_CHART_QA_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--window-size=1280,3100", "--force-device-scale-factor=1", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${directory}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", chunk => { stderr += String(chunk); });
  await until(async () => /DevTools listening on (ws:\/\/[^\s]+)/.test(stderr), "headless Chrome listener");
  browser = await connect(/DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)[1]);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const targets = await browser.send("Target.getTargets"); const target = targets.targetInfos.find(target => target.targetId === targetId); assert.ok(target);
  const wsBase = new URL(/DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)[1]);
  const pageList = await (await fetch(`http://${wsBase.host}/json/list`)).json();
  const contexts = new Map(); const exceptions = []; const requests = []; let iframeSession;
  connection = await connect(pageList.find(page => page.id === targetId).webSocketDebuggerUrl, event => {
    if (event.method === "Target.attachedToTarget" && event.params.targetInfo.type === "iframe") {
      iframeSession = event.params.sessionId;
      void connection.send("Runtime.enable", {}, iframeSession);
      void connection.send("Page.enable", {}, iframeSession);
      void connection.send("Network.enable", {}, iframeSession);
    }
    if (event.method === "Runtime.executionContextCreated" && event.params.context.auxData?.isDefault) contexts.set(event.params.context.auxData?.frameId, { id: event.params.context.id, session: event.sessionId });
    if (event.method === "Runtime.exceptionThrown") exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method === "Network.requestWillBeSent") requests.push(event.params.request.url);
  });
  await connection.send("Runtime.enable"); await connection.send("Page.enable"); await connection.send("Network.enable");
  await connection.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await connection.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 3100, deviceScaleFactor: 1, mobile: false });
  await connection.send("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
  await connection.send("Page.bringToFront");
  await connection.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  let context;
  await until(async () => { const tree = await connection.send("Page.getFrameTree"); context = contexts.get(tree.frameTree.childFrames?.[0]?.frame.id) || [...contexts.values()].find(value => value.session === iframeSession && iframeSession); return Boolean(context); }, "opaque chart frame");
  const evaluate = async expression => { const result = await connection.send("Runtime.evaluate", { contextId: context.id, expression, awaitPromise: true, returnByValue: true }, context.session); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  await until(async () => evaluate("window.__ready === true"), "all real charts render");
  await until(async () => evaluate("window.__localError === true"), "local error control");
  const states = await evaluate(`window.__fixtures.map(spec=>({type:spec.type,state:document.getElementById(spec.type).dataset.zenoChartState,canvases:document.getElementById(spec.type).querySelectorAll('canvas').length,svg:document.getElementById(spec.type).querySelectorAll('svg').length,visibleHTMLLabels:document.getElementById(spec.type).innerText.includes('计划'),nonblank:[...document.getElementById(spec.type).querySelectorAll('canvas')].some(canvas=>{const ctx=canvas.getContext('2d');return ctx&&ctx.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0)})}))`);
  assert.equal(states.length, fixtures.length); assert.ok(states.every(state => state.state === "ready" && (state.nonblank || state.svg > 0 || state.visibleHTMLLabels)), JSON.stringify(states));
  const before = await evaluate("document.querySelector('#Line canvas').toDataURL()");
  const box = await evaluate("(()=>{const b=document.getElementById('Line').getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()");
  let tooltip = false;
  for (const portion of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    await connection.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.width * portion, y: box.y + box.height * 0.5 });
    await new Promise(resolve => setTimeout(resolve, 100));
    tooltip = await evaluate("[...document.querySelectorAll('[class*=tooltip]')].some(node=>node.textContent.trim()&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none')");
    if (tooltip) break;
  }
  assert.ok(tooltip, "Ant Design Charts must render a real data tooltip on hover.");
  await evaluate("(()=>{const filter=document.getElementById('filter');filter.value='研究';filter.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until(async () => evaluate("window.__filtered === true"), "interactive data filter");
  const after = await evaluate("document.querySelector('#Line canvas').toDataURL()"); assert.notEqual(before, after, "Filtering must change actual chart pixels.");
  await connection.send("Emulation.setDeviceMetricsOverride", { width: 960, height: 3100, deviceScaleFactor: 1, mobile: false });
  await new Promise(resolve => setTimeout(resolve, 500));
  await evaluate("Promise.all(window.__handles.map(handle=>handle.resize()))");
  await new Promise(resolve => setTimeout(resolve, 150));
  const resizedStates = await evaluate(`window.__fixtures.map(spec=>({type:spec.type,width:document.getElementById(spec.type).clientWidth,nonblank:[...document.getElementById(spec.type).querySelectorAll('canvas')].some(canvas=>{const ctx=canvas.getContext('2d');return ctx&&ctx.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0)})}))`);
  assert.ok(resizedStates.every(state=>state.nonblank), JSON.stringify(resizedStates));
  assert.deepEqual(await evaluate("window.__violations"), [], "No unsafe-eval, workers or runtime network CSP exceptions.");
  assert.deepEqual(exceptions, []);
  await connection.send("Page.bringToFront");
  await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const screenshot = await connection.send("Page.captureScreenshot", { format: "png" });
  // Verify actual page-compositor pixels as well as the underlying canvases:
  // a background CDP target can retain canvas data without painting its layers.
  const screenshotURL = `data:image/png;base64,${screenshot.data}`;
  const pagePixels = await evaluate(`(async()=>{
    const image=new Image();image.src=${JSON.stringify(screenshotURL)};await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);const background=context.getImageData(1,1,1,1).data;
    return window.__fixtures.map(spec=>{
      const b=document.getElementById(spec.type).getBoundingClientRect();
      const data=context.getImageData(Math.ceil(b.x)+3,Math.ceil(b.y)+3,Math.floor(b.width)-6,Math.floor(b.height)-6).data;
      let distinctPixels=0;
      for(let i=0;i<data.length;i+=4)if(Math.abs(data[i]-background[0])+Math.abs(data[i+1]-background[1])+Math.abs(data[i+2]-background[2])>40)distinctPixels++;
      return{type:spec.type,distinctPixels,nonblank:distinctPixels>100};
    });
  })()`);
  assert.ok(pagePixels.every(chart => chart.nonblank), `Actual page screenshot must show every chart: ${JSON.stringify(pagePixels)}`);
  await writeFile(new URL(dark ? "ant-charts-dark.png" : "ant-charts.png", output), Buffer.from(screenshot.data, "base64"));
  const beforeTheme = await evaluate("document.querySelector('#Line canvas').toDataURL()");
  await evaluate(`window.__ZENO_CHART_THEME__={...window.__ZENO_CHART_THEME__,dark:${!dark},text:${JSON.stringify(dark ? "#183f3d" : "#d8e6df")},background:${JSON.stringify(dark ? "#f6f5ef" : "#172524")},accent:${JSON.stringify(dark ? "#2e8277" : "#8cc7b7")},palette:${JSON.stringify(dark ? ["#2e8277", "#bc863f"] : ["#8cc7b7", "#d5ab6e"])}};window.dispatchEvent(new CustomEvent('zeno:theme-change'))`);
  await until(async () => evaluate("window.__fixtures.every(spec=>document.getElementById(spec.type).dataset.zenoChartState==='ready')"), "theme change preserves chart state");
  assert.equal(await evaluate("document.getElementById('filter').value"), "研究");
  assert.notEqual(await evaluate("document.querySelector('#Line canvas').toDataURL()"), beforeTheme);
  await evaluate("window.__handles.forEach(handle=>handle.destroy())");
  await new Promise(resolve => setTimeout(resolve, 150));
  const remaining = await evaluate("document.querySelectorAll('main canvas,main svg').length"); assert.equal(remaining, 0);
  assert.deepEqual(exceptions, []);
  const external = requests.filter(url => !url.startsWith(`http://127.0.0.1:${address.port}/`) && !url.startsWith("data:") && url !== "about:blank" && url !== "about:srcdoc"); assert.deepEqual(external, []);
  const result = { passed: true, dark, package: "@ant-design/charts", version: "2.6.5", runtimeBytes: Buffer.byteLength(runtime), gzipBytes: gzipSync(runtime).length,
    runtimeSHA256: createHash("sha256").update(runtime).digest("hex"), charts: states, tooltip: true, interactiveFilterChangesPixels: true,
    resize: true, resizedCharts: resizedStates, pageScreenshotPixels: pagePixels, themeChangePreservesFilter: true, localError: true, destroy: true, cspUnsafeEval: false, workerRequests: 0, externalRuntimeRequests: external.length, rendererExceptions: exceptions.length, syntheticDataOnly: true };
  await writeFile(new URL(dark ? "report-dark.json" : "report.json", output), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} finally {
  connection?.socket.close();
  if (browser) { await Promise.race([browser.send("Browser.close").catch(() => {}), new Promise(resolve => setTimeout(resolve, 500))]); browser.socket.close(); }
  if (chrome && chrome.exitCode === null) { chrome.kill("SIGTERM"); await Promise.race([once(chrome, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]); if (chrome.exitCode === null) chrome.kill("SIGKILL"); }
  await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); stderr = "";
}
