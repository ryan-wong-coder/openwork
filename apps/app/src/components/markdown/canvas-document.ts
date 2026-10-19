import type { CanvasKind } from "./canvas-parser";

export type CanvasTheme = {
  text: string; background: string; muted: string; grid: string; accent: string;
  palette: string[]; fontFamily: string; dark: boolean;
};

export const CANVAS_MESSAGE_CHANNEL = "zeno-conversation-canvas";
const MAX_SOURCE_LENGTH = 1_000_000;
const DEFAULT_THEME: CanvasTheme = {
  text: "CanvasText", background: "Canvas", muted: "GrayText", grid: "ButtonBorder", accent: "Highlight",
  palette: ["Highlight", "SelectedItem", "LinkText", "ActiveText", "VisitedText", "Mark"],
  fontFamily: "system-ui, sans-serif", dark: false,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCanvasMessage(data: unknown, token: string):
  { type: "ready" } | { type: "height"; height: number } | { type: "error" } | null {
  if (!record(data) || data.channel !== CANVAS_MESSAGE_CHANNEL || data.token !== token) return null;
  if (data.type === "ready" || data.type === "error") return { type: data.type };
  if (data.type === "height" && typeof data.height === "number" && Number.isFinite(data.height)
    && data.height > 0 && data.height <= 100_000) return { type: "height", height: data.height };
  return null;
}

/** Canvas libraries receive resolved RGB values, including for OKLCH themes. */
export function getCanvasTheme(element: HTMLElement | null): CanvasTheme {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return DEFAULT_THEME;
  const host = element ?? document.documentElement;
  const style = getComputedStyle(host);
  let context: CanvasRenderingContext2D | null = null;
  try { context = document.createElement("canvas").getContext("2d", { willReadFrequently: true }); } catch { /* Non-browser test hosts have no canvas. */ }
  const resolveColor = (expression: string, fallback: string) => {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    probe.style.color = expression;
    host.append(probe);
    const color = getComputedStyle(probe).color || fallback;
    probe.remove();
    if (!context) return color;
    context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, alpha = 255] = context.getImageData(0, 0, 1, 1).data;
    return `rgba(${r},${g},${b},${alpha / 255})`;
  };
  const semantic = (name: string, fallback: string) => resolveColor(`var(${name}, ${fallback})`, fallback);
  const accent = semantic("--primary", style.color);
  return {
    text: resolveColor(style.color, "CanvasText"),
    background: semantic("--background", "Canvas"),
    muted: semantic("--muted-foreground", "GrayText"),
    grid: semantic("--border", "ButtonBorder"), accent,
    palette: ["blue", "teal", "amber", "violet", "pink", "green"].map((name, index) => semantic(`--chart-${index + 1}`, `var(--${name}-9, ${accent})`)),
    fontFamily: style.fontFamily || DEFAULT_THEME.fontFamily,
    dark: document.documentElement.dataset.theme === "dark" || style.colorScheme === "dark",
  };
}

let chartRuntime: Promise<string> | undefined;
export function loadCanvasChartRuntime(): Promise<string> {
  chartRuntime ??= import("virtual:zeno-canvas-chart-runtime").then(module => module.default).catch(error => {
    chartRuntime = undefined;
    throw error;
  });
  return chartRuntime;
}

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function trustedScript(code: string) {
  return `<script>${code.replace(/<\/script/gi, "<\\/script")}</script>`;
}

const BOARD_STYLES = `
:root{color-scheme:light dark;font-synthesis:none}
*,:before,:after{box-sizing:border-box}
html,body{margin:0;min-width:0;background:transparent;color:var(--foreground);font:13px/1.5 var(--canvas-font)}
body{padding:16px;overflow-x:hidden}
button,input,select,textarea{font:inherit;color:inherit;max-width:100%}
button,a,input,select,textarea{touch-action:manipulation}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
h1,h2,h3,p{margin:0 0 12px}h1,h2{font-size:18px;letter-spacing:-.02em}h3{font-size:14px}
canvas,svg,img{max-width:100%}canvas{display:block}table{width:100%;border-collapse:collapse}th,td{padding:8px;text-align:start;border-bottom:1px solid var(--border)}
.viz-row,.viz-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.viz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px}
.viz-controls{margin-block:12px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;min-height:32px;border:1px solid var(--border);border-radius:7px;background:transparent;cursor:pointer}
.btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:transparent}.btn-ghost{border-color:transparent}
.form-label{display:grid;gap:4px}.form-control,.form-select{padding:7px 10px;min-height:34px;border:1px solid var(--border);border-radius:7px;background:var(--background)}.form-range{accent-color:var(--primary)}
.text-muted{color:var(--muted-foreground)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
@media(pointer:coarse){button,input,select{min-height:44px}input,select,textarea{font-size:16px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}
`;

// The trusted shell never shares an origin with the application or the board.
// Its frame-src policy also constrains board-initiated self-navigation, which
// the board's own connect-src policy alone would not prevent.
// The separately served static shell supplies the native Connection-Allowlist
// response policy. CSP alone does not constrain WebRTC in supported Chromium.
const SHELL_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src about:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const BOARD_POLICY = SHELL_POLICY.replace("frame-src about:", "frame-src 'none'");

function themeStyles(theme: CanvasTheme) {
  const safe = (value: string, fallback: string) => value.length < 200 && !/[<>{};]/.test(value) ? value : fallback;
  return `:root{--foreground:${safe(theme.text, "CanvasText")};--background:${safe(theme.background, "Canvas")};--muted-foreground:${safe(theme.muted, "GrayText")};--border:${safe(theme.grid, "ButtonBorder")};--primary:${safe(theme.accent, "Highlight")};--primary-foreground:${safe(theme.background, "Canvas")};--canvas-font:${safe(theme.fontFamily, "system-ui")};color-scheme:${theme.dark ? "dark" : "light"}}`;
}

export function buildCanvasDocument(kind: CanvasKind, source: string, token: string, options: { runtimeScript?: string; theme?: CanvasTheme } = {}):
  { ok: true; srcDoc: string; title?: string } | { ok: false; reason: string } {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(token)) return { ok: false, reason: "invalid-token" };
  if (!source.trim() || source.length > MAX_SOURCE_LENGTH) return { ok: false, reason: "invalid-source" };
  let config: Record<string, unknown> | undefined;
  if (kind === "ant-chart") {
    try {
      const value: unknown = JSON.parse(source);
      if (!record(value) || typeof value.type !== "string" || !/^[A-Z][a-zA-Z]{1,48}$/.test(value.type)) return { ok: false, reason: "invalid-chart" };
      config = value;
    } catch { return { ok: false, reason: "invalid-chart" }; }
  }
  if (kind === "svg" && !/<svg(?:\s|\/?>)/i.test(source)) return { ok: false, reason: "invalid-svg" };
  const theme = options.theme ?? DEFAULT_THEME;
  const title = typeof config?.title === "string" ? config.title.slice(0, 120) : undefined;
  const innerBootstrap = `(()=>{
const token=${scriptJson(token)},channel=${scriptJson(CANVAS_MESSAGE_CHANNEL)},initialTheme=${scriptJson(theme)};
let failed=false,scheduled=false,lastHeight=0;
const send=(type,extra={})=>parent.postMessage({channel,token,type,...extra},'*');
const reportError=()=>{if(!failed){failed=true;send('error')}};
const style=document.getElementById('zeno-theme');
const safeColor=value=>typeof value==='string'&&value.length<200&&!/[<>{};]/.test(value);
const applyTheme=value=>{
 if(!value||typeof value!=='object')return;
 const keys={text:'--foreground',background:'--background',muted:'--muted-foreground',grid:'--border',accent:'--primary',fontFamily:'--canvas-font'};
 for(const [key,variable]of Object.entries(keys))if(safeColor(value[key]))document.documentElement.style.setProperty(variable,value[key]);
 if(safeColor(value.background))document.documentElement.style.setProperty('--primary-foreground',value.background);
 document.documentElement.style.colorScheme=value.dark===true?'dark':'light';
 window.__ZENO_CHART_THEME__=value;window.dispatchEvent(new CustomEvent('zeno:theme-change',{detail:value}));
};
window.__ZENO_CHART_THEME__=initialTheme;
window.addEventListener('message',event=>{if(event.source===parent&&event.data?.channel===channel&&event.data?.token===token&&event.data?.type==='theme')applyTheme(event.data.theme)});
window.addEventListener('error',reportError);window.addEventListener('unhandledrejection',reportError);
document.addEventListener('submit',event=>event.preventDefault(),true);
const measure=()=>{scheduled=false;const h=Math.ceil(Math.max(document.body.getBoundingClientRect().height,document.body.scrollHeight));if(h>0&&Math.abs(h-lastHeight)>=3){lastHeight=h;send('height',{height:Math.min(100000,h)})}};
const requestMeasure=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(measure)}};
window.__zenoCanvasReady=()=>{requestMeasure();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!failed)send('ready')}))};
document.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(requestMeasure).observe(document.body);window.addEventListener('resize',requestMeasure);requestMeasure()},{once:true});
})();`;
  const mount = kind === "ant-chart" ? `
(()=>{try{const root=document.createElement('div');root.id='chart';root.setAttribute('role','img');root.setAttribute('aria-label',${scriptJson(title ?? "数据图表")});document.body.append(root);
const chart=window.ZenoCharts.render(root,${scriptJson(config)});Promise.resolve(chart.ready).then(()=>window.__zenoCanvasReady()).catch(()=>{throw new Error('chart-render-failed')})}catch{window.dispatchEvent(new Event('error'))}})();` : `
(()=>{try{const template=document.createElement('template');template.innerHTML=${scriptJson(source)};
for(const node of template.content.querySelectorAll('base,meta,link,iframe,frame,object,embed'))node.remove();
for(const node of template.content.querySelectorAll('*'))for(const name of ['href','src','xlink:href']){const value=node.getAttribute(name);if(value&&!value.startsWith('#')&&!/^data:image\\//i.test(value)&&!value.startsWith('blob:'))node.removeAttribute(name)}
const scripts=[];for(const node of template.content.querySelectorAll('script')){const replacement=document.createComment('board-script');scripts.push({node, replacement});node.replaceWith(replacement)}
document.body.append(template.content);
for(const {node,replacement}of scripts){if(node.hasAttribute('src')){replacement.remove();continue}const script=document.createElement('script');if(node.type)script.type=node.type;script.textContent=node.textContent;replacement.replaceWith(script)}
window.__zenoCanvasReady();}catch{window.dispatchEvent(new Event('error'))}})();`;
  const inner = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BOARD_POLICY}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BOARD_STYLES}</style><style id="zeno-theme">${themeStyles(theme)}</style>${trustedScript(innerBootstrap)}${options.runtimeScript ? trustedScript(options.runtimeScript) : ""}</head><body>${trustedScript(mount)}</body></html>`;
  const shell = `(()=>{
const channel=${scriptJson(CANVAS_MESSAGE_CHANNEL)},token=${scriptJson(token)},frame=document.createElement('iframe');
frame.title='画板内容';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='display:block;width:100%;height:360px;border:0';
frame.srcdoc=${scriptJson(inner)};
let last=360,queued=null,scheduled=false;
const forward=()=>{scheduled=false;if(queued){parent.postMessage(queued,'*');queued=null}};
window.addEventListener('message',event=>{
 const data=event.data;if(!data||data.channel!==channel||data.token!==token)return;
 if(event.source===parent&&data.type==='theme'){frame.contentWindow.postMessage(data,'*');return}
 if(event.source!==frame.contentWindow||event.origin!=='null')return;
 if(data.type==='height'&&typeof data.height==='number'&&Number.isFinite(data.height)&&data.height>0){const height=Math.min(960,Math.max(240,Math.ceil(data.height)));if(Math.abs(height-last)>=3){last=height;frame.style.height=height+'px';queued={channel,token,type:'height',height};if(!scheduled){scheduled=true;requestAnimationFrame(forward)}}}
 else if(data.type==='ready'||data.type==='error')parent.postMessage({channel,token,type:data.type},'*');
});document.body.append(frame);
})();`;
  return { ok: true, ...(title ? { title } : {}), srcDoc: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SHELL_POLICY}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;overflow:hidden}body{width:100%}</style></head><body>${trustedScript(shell)}</body></html>` };
}
