# Offline Ant Design Charts verification

Verified on 2026-10-19 with the pinned `@ant-design/charts@2.6.5` IIFE.
Runtime: 2,545,359 bytes; 768,502 bytes gzip; SHA-256
`b56da4564d6421ff3e58c7fc2977ec2c55de020ed6e296780961a94e485c5ebe`.

`report.json` and `report-dark.json` each cover nine statistical charts and five
relationship diagrams. All 14 initially render real pixels, remain nonblank
after resizing, and show distinct non-background pixels in the actual page
screenshot. `ant-charts.png` and `ant-charts-dark.png` were actually inspected:
Chinese graph labels and edges, cell heatmaps, and all statistical plots are
visible. Additional checks cover a real Ant hover tooltip, filtering that
changes chart pixels, theme switching that retains the filter, a local error
state, and disposal. Both runs observe zero external runtime requests, workers,
CSP violations, or renderer exceptions. All data is synthetic; there are no
model calls, credentials, desktop app windows, or existing browser profiles.

Run sequentially from the repository root:

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --dir apps/app exec bun scripts/canvas-chart-runtime-qa.mjs
ZENO_CHART_QA_DARK=1 PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --dir apps/app exec bun scripts/canvas-chart-runtime-qa.mjs
```

The harness uses a fresh, activated headless Chrome target, an opaque script-only
iframe, and strict CSP without `unsafe-eval`, workers, or data connections.
Normal viewport screenshots include every chart. Chromium's inactive-target or
beyond-viewport capture could omit G6 compositor layers despite readable
underlying canvas data; actual screenshot pixel assertions guard against that
harness failure. No product workaround or extra rendering dependency was added.

This evidence verifies offline library rendering and interaction. The separate
`../conversation-canvas/` component evidence covers the final static policy
shell, including all five relationship chart types in one HTML board. Host
message authentication, network isolation, navigation restrictions, and
transcript stability are covered by their dedicated tests; this gallery does
not independently establish those guarantees.
