# Offline Ant Design Charts runtime

The runtime uses the user's selected **Ant Design Charts**.
The official [introduction](https://charts.ant.design/manual/introduction/)
identifies the aggregate package's statistical `@ant-design/plots` and
relationship `@ant-design/graphs` packages. Its [component overview](https://charts.ant.design/components/overview/)
lists the statistical and relationship chart families. The public package
metadata was checked before installation; direct dependencies are pinned to
`@ant-design/charts@2.6.5`, `@ant-design/plots@2.6.5`, and
`@ant-design/graphs@2.1.1`. The generated pnpm lock pins their transitive graph.

The [FlowGraph](https://charts.ant.design/components/graphs/flow-graph/),
[MindMap](https://charts.ant.design/components/graphs/mind-map/), and
[OrganizationChart](https://charts.ant.design/components/graphs/organization-chart/)
APIs are real Ant components. Flow and organization charts also accept a local
tree root; the runtime converts it to the graph data shape expected by Ant.
These sources were reviewed on 2026-10-19.

## Host build interface

Register `canvasChartRuntimePlugin()` from
`apps/app/scripts/canvas-chart-runtime-vite-plugin.ts` in Vite. The virtual
module `virtual:zeno-canvas-chart-runtime` exports one JavaScript **string**.
The host loads that module lazily and places its code in the opaque board's
inline script. The script is a self-contained, tree-shaken production IIFE,
including React and ReactDOM. There is no iframe runtime asset URL, CDN script,
dynamic runtime import, credential, host bridge, or data fetch.

This works for both normal Vite output and Electron's relative `file://`
assets: only the host's usual lazy chunk loading occurs. The iframe itself
requires no external origin or connection. The build uses the existing Vite
esbuild version, pinned directly to `0.25.12` for reproducibility.

## Board API

```js
await window.ZenoCharts.ready;
const chart = window.ZenoCharts.render(document.getElementById('trend'), {
  type: 'Line',
  data: [
    { day: '周一', value: 20 },
    { day: '周二', value: 42 },
    { day: '周三', value: 34 },
  ],
  xField: 'day',
  yField: 'value',
});
await chart.ready;
await chart.update({ data: filteredRows });
await chart.resize();
chart.destroy();
```

The declarative `ant-chart` fence uses the same flat object:
`{type, data, ...AntOptions}`. Supported names are `Line`, `Area`, `Column`,
`Bar`, `Pie`, `Scatter`, `Heatmap`, `Radar`, `Funnel`, `FlowGraph`, `MindMap`,
`OrganizationChart`, `NetworkGraph`, and `IndentedTree`. Functions encoded as
strings are never compiled or evaluated. Data must be local arrays/objects;
Root-level fetch/CSV source specifications are rejected; the frame's CSP also
blocks external data connections. Heatmap defaults to cells with a continuous
colour scale. Existing Ant interaction options remain available.

`render` accepts an element or local selector. A handle has an initial
`ready: Promise<void>`, `update(partialConfig): Promise<void>`,
`resize(): Promise<void>`, and `destroy(): void`. A later render on the same
element disposes its earlier chart. Resize and fit operations are sequenced
so a G6 canvas does not get cleared while a concurrent fit is taking place.
Errors stay in their own chart container with a short Chinese recovery state.
No source, raw error, stack, or external action is exposed by that state.

The parent supplies resolved `text`, `background`, `muted`, `grid`, `accent`,
`palette`, `fontFamily`, and `dark` fields in `window.__ZENO_CHART_THEME__`.
The runtime honours `zeno:theme-change` without replacing the board or its form
controls; filtered data remains current. Default graph nodes use Ant's Canvas
shapes with theme colours, avoiding a separate blue React-node theme. Layouts
run locally with workers disabled. Charts and graphs disable entrance animation
and resize with their containers. These choices follow DESIGN.md V2/V6, while
the screenshot evidence below supports P10.

## Executed headless verification

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false \
pnpm --dir apps/app exec bun scripts/canvas-chart-runtime-qa.mjs

ZENO_CHART_QA_DARK=1 PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false \
pnpm --dir apps/app exec bun scripts/canvas-chart-runtime-qa.mjs
```

The test launches a fresh **headless** Chrome profile, not the developer's
desktop app or existing browser. It executes the real IIFE in an opaque
`sandbox="allow-scripts"` frame under `default-src 'none'`,
`connect-src 'none'`, `worker-src 'none'`, and script policy without
`unsafe-eval`. Both light and dark runs verify all 14 chart types render real
nonblank pixels both in their canvases and in the actual page screenshot,
a real Ant tooltip appears on pointer hover, filtering changes
the rendered pixels, all 14 survive viewport resizing, a theme change preserves
the filter, a bad chart fails locally, and destruction removes the rendered
nodes. Network and CSP observations verify no external runtime request,
worker, or renderer exception. No live model or API key is used.

The runner activates its own headless CDP target before observing page pixels.
An inactive target or Chromium's beyond-viewport capture can retain nonblank G6
canvas data while omitting those layers from its page screenshot; the runner
uses an activated target and a normal viewport screenshot large enough to show
all charts. Its screenshot pixel assertion catches missing page layers.
No product rendering workaround was needed. The separate
integrated component QA also captures five relationship chart types together
inside the final static policy shell.

Reports and actual screenshots are in
`apps/app/verification/canvas-charts/`: `report.json`, `report-dark.json`,
`ant-charts.png` and `ant-charts-dark.png`. They contain only synthetic data.
The runtime's own code never uses `eval` or a function constructor. The bundled
Lodash dependency contains its upstream global-object fallback function, but
the browser's ordinary `self` branch is used; both strict CSP executions pass
without enabling or invoking `unsafe-eval`.

The runtime IIFE is approximately 2.55 MB, about 769 KB gzip, loaded only when
the host requests the lazy virtual module. Exact final byte counts and SHA-256
are recorded in each browser report. This checks actual Ant rendering and
interaction; the separate host document tests cover the host isolation boundary,
message authentication, self-navigation restrictions, and transcript stability.
