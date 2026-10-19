import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownBlock } from "../../../src/components/markdown/markdown";
import "../../../src/app/index.css";

type Scenario = "interactive" | "statistical" | "relationship" | "relationships" | "pending" | "error" | "plain";
type FixtureState = { scenario: Scenario; suffix: string; streaming: boolean; highlight: string };
const interactive = `
<h2>增长模拟</h2>
<div class="viz-controls">
  <label class="form-label">增长率 <input id="rate" class="form-range" type="range" min="0" max="100" value="25" aria-label="增长率"></label>
  <output id="rate-value">25%</output>
  <button id="increment" class="btn">增加一次</button><output id="counter" aria-label="交互次数">0</output>
</div>
<canvas id="projection" width="640" height="150" style="width:100%;height:150px" aria-label="增长率画布"></canvas>
<svg viewBox="0 0 640 72" role="img" aria-label="增长率图形"><rect y="12" height="40" width="640" rx="6" fill="var(--border)"/><rect id="growth-bar" y="12" height="40" width="160" rx="6" fill="var(--primary)"/></svg>
<script>
window.fixtureBootCount=1;window.fixturePaintCount=0;
const slider=document.getElementById('rate'),output=document.getElementById('rate-value'),counter=document.getElementById('counter'),canvas=document.getElementById('projection'),context=canvas.getContext('2d');
function paint(){const value=Number(slider.value);output.textContent=value+'%';document.getElementById('growth-bar').setAttribute('width',String(value*6.4));context.clearRect(0,0,640,150);context.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--border');context.fillRect(0,30,640,90);context.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--primary');context.fillRect(0,30,value*6.4,90);window.fixturePaintCount++}
slider.addEventListener('input',paint);document.getElementById('increment').onclick=()=>counter.textContent=String(Number(counter.textContent)+1);window.addEventListener('zeno:theme-change',paint);paint();
window.fixtureRead=()=>({rate:Number(slider.value),counter:Number(counter.textContent),paintCount:window.fixturePaintCount,bootCount:window.fixtureBootCount,barWidth:Number(document.getElementById('growth-bar').getAttribute('width')),pixel:Array.from(context.getImageData(450,60,1,1).data),dark:document.documentElement.style.colorScheme==='dark'});
</script>`;

const statistical = JSON.stringify({ type: "Column", title: "每周完成量", height: 320,
  data: [{ day: "周一", tasks: 14 }, { day: "周二", tasks: 22 }, { day: "周三", tasks: 18 }, { day: "周四", tasks: 31 }, { day: "周五", tasks: 26 }],
  xField: "day", yField: "tasks", animate: false, axis: { x: { title: false }, y: { title: false } } });
const relationship = JSON.stringify({ type: "OrganizationChart", title: "项目协作", height: 340,
  data: { id: "project", label: "项目", children: [{ id: "design", label: "设计", children: [{ id: "visual", label: "视觉" }] }, { id: "engineering", label: "开发", children: [{ id: "client", label: "客户端" }] }] } });
const graph = { nodes: [{ id: "start", data: { label: "想法" } }, { id: "build", data: { label: "实现" } }, { id: "verify", data: { label: "验证" } }], edges: [{ source: "start", target: "build" }, { source: "build", target: "verify" }] };
const tree = { id: "root", label: "计划", children: [{ id: "design", label: "设计", children: [{ id: "draft", label: "草图" }] }, { id: "develop", label: "开发" }, { id: "test", label: "验收" }] };
const relationshipSpecs = [
  { type: "FlowGraph", data: graph }, { type: "MindMap", data: tree, direction: "right" },
  { type: "OrganizationChart", data: tree }, { type: "NetworkGraph", data: graph, layout: { type: "circular" } },
  { type: "IndentedTree", data: tree },
].map(spec => ({ ...spec, labelField: "label" }));
const relationships = `<style>.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.gallery section{min-width:0}.gallery h3{font-size:13px;margin:0 0 6px}.gallery .graph{height:240px}</style>
<div class="gallery">${relationshipSpecs.map((spec, index) => `<section><h3>${spec.type}</h3><div class="graph" id="graph-${index}"></div></section>`).join("")}</div>
<script>window.fixtureRelationshipsReady=false;Promise.all(${JSON.stringify(relationshipSpecs)}.map((spec,index)=>window.ZenoCharts.render(document.getElementById('graph-'+index),spec).ready)).then(()=>window.fixtureRelationshipsReady=true)</script>`;
const fence = (language: string, source: string) => `\`\`\`${language}\n${source}\n\`\`\``;
function text(state: FixtureState) {
  if (state.scenario === "pending") return "```zeno-html title=\"交互画布\"\n<div>" + state.suffix;
  if (state.scenario === "error") return fence("ant-chart", '{"type":') + state.suffix;
  if (state.scenario === "plain") return fence("html", "<button>普通代码示例</button>") + state.suffix;
  if (state.scenario === "statistical") return fence("ant-chart", statistical) + state.suffix;
  if (state.scenario === "relationship") return fence("ant-chart", relationship) + state.suffix;
  if (state.scenario === "relationships") return fence('zeno-html title="关系图组件验收"', relationships) + state.suffix;
  return fence('zeno-html title="增长模拟"', interactive) + state.suffix;
}

declare global {
  interface Window {
    __conversationCanvasFixture: {
      setScenario: (scenario: Scenario) => void;
      append: (suffix: string) => void;
      settle: () => void;
      highlight: (query: string) => void;
      theme: (dark: boolean) => void;
      streamHundred: () => Promise<number>;
      read: () => FixtureState;
    };
  }
}

function App() {
  const [state, setState] = useState<FixtureState>({ scenario: "interactive", suffix: "", streaming: true, highlight: "" });
  useEffect(() => {
    window.__conversationCanvasFixture = {
      setScenario: scenario => setState({ scenario, suffix: "", streaming: scenario === "pending" || scenario === "interactive", highlight: "" }),
      append: suffix => setState(current => ({ ...current, suffix })),
      settle: () => setState(current => ({ ...current, streaming: false })),
      highlight: highlight => setState(current => ({ ...current, highlight })),
      theme: dark => { document.documentElement.dataset.theme = dark ? "dark" : "light"; document.documentElement.classList.toggle("dark", dark); },
      streamHundred: async () => {
        for (let index = 1; index <= 100; index++) {
          setState(current => ({ ...current, suffix: `\n\n正在整理结果 ${index}。` }));
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
        return 100;
      },
      read: () => state,
    };
  }, [state]);
  return <main className="fixture-shell">
    <header className="fixture-heading"><h1>泽诺 · 对话画布</h1><span className="fixture-meta">实际组件验收</span></header>
    <section className="fixture-answer" aria-label="助手回复"><MarkdownBlock key={state.scenario} text={text(state)} streaming={state.streaming} highlightQuery={state.highlight} assistantCanvas /></section>
  </main>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing component fixture root");
createRoot(root).render(<App />);
