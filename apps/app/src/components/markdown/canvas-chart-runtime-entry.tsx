import { Component, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Line, Area, Column, Bar, Pie, Scatter, Heatmap, Radar, Funnel,
  FlowGraph, MindMap, OrganizationChart, NetworkGraph, IndentedTree,
} from "@ant-design/charts";
import { canvasChartTypes, type CanvasChartHandle, type CanvasChartSpecification, type CanvasChartTheme, type CanvasChartType } from "./canvas-chart-runtime-types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const relationshipTypes = new Set<string>(["FlowGraph", "MindMap", "OrganizationChart", "NetworkGraph", "IndentedTree"]);
const handles = new WeakMap<HTMLElement, CanvasChartHandle>();
const activeHandles = new Set<CanvasChartHandle>();

function currentTheme(): CanvasChartTheme {
  const supplied = window.__ZENO_CHART_THEME__ ?? {};
  const style = getComputedStyle(document.documentElement);
  const text = typeof supplied.text === "string" ? supplied.text : style.color;
  const accent = typeof supplied.accent === "string" ? supplied.accent : text;
  return {
    dark: supplied.dark === true,
    background: typeof supplied.background === "string" ? supplied.background : style.backgroundColor,
    text,
    muted: typeof supplied.muted === "string" ? supplied.muted : text,
    grid: typeof supplied.grid === "string" ? supplied.grid : text,
    accent,
    palette: Array.isArray(supplied.palette) && supplied.palette.every(color => typeof color === "string") && supplied.palette.length > 0 ? supplied.palette.slice(0, 24) : [accent],
    fontFamily: typeof supplied.fontFamily === "string" ? supplied.fontFamily : style.fontFamily,
  };
}

function specification(value: unknown): CanvasChartSpecification {
  if (!record(value) || !canvasChartTypes.some(type => type === value.type)) throw new Error("请选择支持的图表类型。");
  if (!Array.isArray(value.data) && !record(value.data)) throw new Error("图表需要本地数据。");
  if (record(value.data) && (value.data.type === "fetch" || value.data.type === "csv")) throw new Error("请将数据直接放入图表。");
  // The discriminator has been checked against the literal allowlist, while
  // the data remains opaque to Ant's individual statistical/graph adapters.
  const type = canvasChartTypes.find(type => type === value.type);
  if (!type) throw new Error("请选择支持的图表类型。");
  return { ...value, type, data: value.data };
}

function chartView(type: CanvasChartType, props: Record<string, unknown>): ReactElement {
  switch (type) {
    case "Line": return createElement(Line, props);
    case "Area": return createElement(Area, props);
    case "Column": return createElement(Column, props);
    case "Bar": return createElement(Bar, props);
    case "Pie": return createElement(Pie, props);
    case "Scatter": return createElement(Scatter, props);
    case "Heatmap": return createElement(Heatmap, props);
    case "Radar": return createElement(Radar, props);
    case "Funnel": return createElement(Funnel, props);
    case "FlowGraph": return createElement(FlowGraph, props);
    case "MindMap": return createElement(MindMap, props);
    case "OrganizationChart": return createElement(OrganizationChart, props);
    case "NetworkGraph": return createElement(NetworkGraph, props);
    case "IndentedTree": return createElement(IndentedTree, props);
  }
}

class LocalChartBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function invoke(instance: unknown, name: string, args: unknown[] = []): boolean {
  if (!record(instance) || typeof instance[name] !== "function") return false;
  const result: unknown = Reflect.apply(instance[name], instance, args);
  if (result instanceof Promise) void result.catch(() => undefined);
  return true;
}

function fitGraph(instance: unknown): Promise<void> {
  if (!record(instance) || typeof instance.fitView !== "function") return Promise.resolve();
  return Promise.resolve(Reflect.apply(instance.fitView, instance, [{ when: "always" }, false])).then(() => undefined);
}

function localGraphData(value: unknown): unknown {
  if (!record(value) || typeof value.id !== "string" || Array.isArray(value.nodes)) return value;
  const nodes: Record<string, unknown>[] = [];
  const edges: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();
  const visit = (node: Record<string, unknown>, parent?: string, depth = 0) => {
    if (typeof node.id !== "string" || seen.has(node.id) || seen.size >= 1000 || depth > 80) throw new Error("请简化关系图数据。");
    seen.add(node.id);
    const { id, children, data, ...fields } = node;
    const descendants = Array.isArray(children) ? children.filter(record) : [];
    nodes.push({ id, data: { ...fields, ...(record(data) ? data : {}) }, children: descendants.map(child => child.id) });
    if (parent) edges.push({ source: parent, target: id });
    for (const child of descendants) visit(child, id, depth + 1);
  };
  visit(value);
  return { nodes, edges };
}

function themedProps(spec: CanvasChartSpecification, theme: CanvasChartTheme): Record<string, unknown> {
  const { type, ...options } = spec;
  if (relationshipTypes.has(type)) {
    const node = record(options.node) ? options.node : {};
    const nodeStyle = record(node.style) ? node.style : {};
    const edge = record(options.edge) ? options.edge : {};
    const edgeStyle = record(edge.style) ? edge.style : {};
    const labelText = (datum: unknown) => {
      if (!record(datum)) return "";
      const data = record(datum.data) ? datum.data : {};
      const field = typeof options.labelField === "string" ? options.labelField : "label";
      return String(data[field] ?? datum[field] ?? datum.id ?? "");
    };
    return {
      ...options,
      ...(["OrganizationChart", "FlowGraph", "NetworkGraph"].includes(type) ? { data: localGraphData(options.data) } : {}),
      autoFit: "view",
      padding: 20,
      animation: false,
      theme: theme.dark ? "dark" : "light",
      containerStyle: { width: "100%", height: "100%", fontFamily: theme.fontFamily },
      // Canvas nodes keep labels and colours inside this board's theme and
      // avoid the library's independent blue React-node styling layer.
      node: { type: type === "NetworkGraph" ? "circle" : "rect", ...node, style: {
        size: type === "NetworkGraph" ? 48 : [104, 32], radius: 6, lineWidth: 1.25, fill: theme.background, stroke: theme.accent,
        labelText, labelPlacement: "center", labelFill: theme.text, labelFontFamily: theme.fontFamily, labelFontSize: 12, ...nodeStyle,
      } },
      edge: {
        ...(type === "FlowGraph" ? { type: "line" } : type === "OrganizationChart" ? { type: options.direction === "horizontal" ? "cubic-horizontal" : "cubic-vertical" } : {}),
        ...edge, style: { stroke: theme.muted, lineWidth: 1.25, labelFill: theme.text, ...edgeStyle },
      },
      transforms: Array.isArray(options.transforms) ? options.transforms : [],
      // All bundled graph layouts remain on the main thread: no remote or
      // Blob worker is needed by an opaque, connect-src 'none' iframe.
      layout: { ...(["FlowGraph", "OrganizationChart"].includes(type) ? { nodesep: 20, ranksep: 28 } : {}), ...(record(options.layout) ? options.layout : {}), enableWorker: false },
    };
  }
  const configuredTheme = record(options.theme) ? options.theme : {};
  const scale = record(options.scale) ? options.scale : {};
  const colorScale = record(scale.color) ? scale.color : {};
  return {
    ...options,
    autoFit: true,
    animation: false,
    theme: typeof options.theme === "string" ? options.theme : {
      type: theme.dark ? "classicDark" : "classic",
      view: { viewFill: "transparent" },
      axis: { labelFill: theme.muted, labelOpacity: 1, titleFill: theme.text, gridStroke: theme.grid, lineStroke: theme.grid, tickStroke: theme.grid },
      legend: { itemLabelFill: theme.text, titleFill: theme.text },
      ...configuredTheme,
    },
    ...(type === "Heatmap" ? { mark: typeof options.mark === "string" ? options.mark : "cell" } : {}),
    scale: { ...scale, color: { ...(type === "Heatmap" ? { type: "linear", range: [theme.background, theme.accent] } : { range: theme.palette }), ...colorScale } },
    style: { ...(type === "Heatmap" ? { inset: 1 } : {}), ...(record(options.style) ? options.style : {}), fontFamily: theme.fontFamily },
    containerStyle: { width: "100%", height: "100%", fontFamily: theme.fontFamily },
  };
}

function render(elementOrSelector: HTMLElement | string, input: CanvasChartSpecification): CanvasChartHandle {
  const element = typeof elementOrSelector === "string" ? document.querySelector(elementOrSelector) : elementOrSelector;
  if (!(element instanceof HTMLElement)) throw new Error("找不到图表容器。");
  handles.get(element)?.destroy();
  if (element.clientHeight <= 0) element.style.height = `${typeof input.height === "number" && input.height >= 120 && input.height <= 2400 ? input.height : 320}px`;
  const root = createRoot(element);
  let destroyed = false;
  let generation = 0;
  let current = input;
  let instance: unknown;
  let pendingReject: ((reason: Error) => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let observer: ResizeObserver | undefined;
  let resizing: Promise<void> | undefined;
  const notify = (state: string) => { element.dataset.zenoChartState = state; element.dispatchEvent(new CustomEvent(`zeno-chart-${state}`, { bubbles: true })); };
  const resize = (): Promise<void> => {
    if (destroyed) return Promise.resolve();
    if (resizing) return resizing;
    const target = instance;
    resizing = (async () => {
      if (!record(target)) return;
      if (typeof target.forceFit === "function") await Reflect.apply(target.forceFit, target, []);
      else {
        if (typeof target.resize === "function") await Reflect.apply(target.resize, target, []);
        await fitGraph(target);
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    })().catch(() => undefined).finally(() => { resizing = undefined; });
    return resizing;
  };
  const mount = (next: CanvasChartSpecification): Promise<void> => {
    if (destroyed) return Promise.reject(new Error("图表已关闭。"));
    pendingReject?.(new Error("图表已更新。"));
    if (deadline) clearTimeout(deadline);
    const ownGeneration = ++generation;
    let completed = false;
    notify("rendering");
    const ready = new Promise<void>((resolve, reject) => {
      pendingReject = reject;
      const finish = () => {
        if (destroyed || completed || generation !== ownGeneration) return;
        completed = true; pendingReject = undefined; if (deadline) clearTimeout(deadline);
        notify("ready"); resolve();
      };
      const fail = () => {
        if (destroyed || completed || generation !== ownGeneration) return;
        completed = true; pendingReject = undefined; if (deadline) clearTimeout(deadline);
        notify("error");
        queueMicrotask(() => {
          if (destroyed || generation !== ownGeneration) return;
          root.render(createElement("div", { role: "status", style: { color: currentTheme().muted, fontFamily: currentTheme().fontFamily, padding: "1em" } }, "图表暂时无法显示，请调整数据后重试。"));
        });
        reject(new Error("图表暂时无法显示。"));
      };
      deadline = setTimeout(fail, 15000);
      try {
        const spec = specification(next);
        current = spec;
        const onReady = (value: unknown) => {
          instance = value;
          if (relationshipTypes.has(spec.type)) {
            void resize().then(() => requestAnimationFrame(() => requestAnimationFrame(finish))).catch(fail);
            return;
          }
          // Graphs calls onReady after render; statistical plots starts its
          // async render before this callback, so listen for the concrete draw.
          invoke(value, "once", ["afterrender", finish]);
          requestAnimationFrame(() => requestAnimationFrame(() => { if (element.querySelector("canvas,svg")) finish(); }));
        };
        const props = { ...themedProps(spec, currentTheme()), onReady };
        root.render(createElement(LocalChartBoundary, { key: ownGeneration, onFailure: fail, children: chartView(spec.type, props) }));
      } catch { fail(); }
    });
    // A board may use the API without awaiting ready; errors remain local.
    void ready.catch(() => undefined);
    return ready;
  };
  const ready = mount(input);
  const handle: CanvasChartHandle = {
    ready,
    update(next) { return mount({ ...current, ...next }); },
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true; if (deadline) clearTimeout(deadline); observer?.disconnect();
      pendingReject?.(new Error("图表已关闭。")); pendingReject = undefined; instance = undefined; root.unmount();
      activeHandles.delete(handle);
      if (handles.get(element) === handle) handles.delete(element);
    },
  };
  if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(() => { void resize(); }); observer.observe(element); }
  handles.set(element, handle);
  activeHandles.add(handle);
  return handle;
}

window.ZenoCharts = Object.freeze({ version: "2.6.5", ready: Promise.resolve(), types: canvasChartTypes, render });
let themeFingerprint = JSON.stringify(currentTheme());
window.addEventListener("zeno:theme-change", () => {
  const next = JSON.stringify(currentTheme());
  if (next === themeFingerprint) return;
  themeFingerprint = next;
  for (const handle of activeHandles) void handle.update({}).catch(() => undefined);
});
document.dispatchEvent(new CustomEvent("zeno-charts-ready"));
