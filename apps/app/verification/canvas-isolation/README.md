# Conversation canvas isolation

Run from the repository root:

```sh
pnpm --dir apps/app exec bun scripts/canvas-isolation-qa.mjs
```

The script opens an isolated headless Chrome profile and a hidden, temporary
Electron window. It uses the checked-in trusted shell, generated canvas
documents, self-host static response handler and native custom protocol module.
It never starts Zeno, reads an application profile, calls a model or contacts an
external service. Set `ZENO_CANVAS_QA_CHROME` to a Chrome executable if needed.

The checked-in report passed on Chrome 155.0.8059.85 and Electron 43.7.7 /
Chromium 150.0.7871.250. Real loopback HTTP and UDP STUN sinks recorded zero
requests from all isolated probes. Positive controls reached both sinks. The
probes cover fetch, images, scripts, CSS, forms, nested frames, WebRTC, fresh
iframe globals, HTTP/data/blob/about:blank navigation, closing-tag injection,
parent access, host bridge calls, forged bridge messages and prototype isolation.
An ordinary interactive input and inline SVG still worked.

`connect-src 'none'` alone does not prevent WebRTC traffic. An earlier diagnostic
with that policy emitted five loopback STUN packets; adding `webrtc 'block'` to
CSP still emitted five in Chrome 155. The actual native boundary is the
`Connection-Allowlist: ()` response header. Chromium 152+ supports this header
directly. The bundled Chromium 150 requires the exact native switches
`ConnectionAllowlists,OverrideConnectionAllowlistOriginTrial`; the native module
sets them before ready, serves only the trusted shell and advertises support
after installation. Unsupported delivery/runtime paths keep generated source
readable without executing it.

These are concrete browser checks on the recorded versions, rather than a claim
that arbitrary JavaScript cannot exhaust CPU or memory. The report contains only
fixed probe names, booleans, counts, public runtime versions and safe error names.

Primary implementation references:

- [Chrome: Connection Allowlists shipped in Chromium 152](https://developer.chrome.com/blog/connection-allowlist-announcement?hl=en)
- [Chromium: exact feature and origin-trial override switches](https://chromium.googlesource.com/experimental/chromium/src/+/d648519d6dbc4cfef2e4d681bad6e7cd92e38058%5E%21/)
- [Connection Allowlists specification](https://wicg.github.io/connection-allowlists/)
