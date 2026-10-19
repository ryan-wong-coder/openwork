# Native packaged canvas release check

`zeno-update-smoke.mjs` runs this probe for targets **1.0.5 and later**, after
the original 1.0.0 installation has downloaded the public own-domain update,
been replaced by Squirrel, restarted itself, and passed the existing signature,
ASAR, embedded-server, workspace, profile and history checks.

It uses the already authenticated private `file://.../app-dist/index.html` CDP
target on the ephemeral, matching-CPU GitHub-hosted macOS runner. It does not
launch another application, modify/re-sign the installed bundle, read a user's
profile, configure a model, or call a model/API. The existing native smoke
refuses local and self-hosted execution; this probe additionally refuses a
non-native, non-hosted target.

The probe imports the **installed production lazy Ant module** through that
renderer and embeds its returned IIFE with the release checkout's production
`buildCanvasDocument`. No development runtime is compiled for the probe. Its
small synthetic board checks:

- the actual native preload capability advertises the `zeno-canvas:` shell;
- the real protocol response is HTTP-style status 200, HTML, and carries
  `Connection-Allowlist: ()`;
- a local button changes Canvas pixels and SVG geometry;
- the installed Ant runtime draws a Line chart and FlowGraph with real pixels;
- the board cannot read the host document, native bridge or Node globals, and
  its message carrying the valid token is rejected because its source is the
  board instead of the trusted outer shell (wrong-token rejection has separate
  unit coverage);
- disposal preserves the existing host root, native bridge and profile marker,
  then the original native history message is checked again through the local
  embedded server.

Only booleans, fixed policy fields, byte counts and SHA-256 hashes enter the
sanitized update report's `canvas` field. `native-canvas.png` is a synthetic-board
screenshot; the original post-update app screenshot remains separate. The
workflow uploads these small artifacts together with `report.json`, never the
temporary profile, native logs, credentials or full package.

This is an installed-runtime/protocol integration check. The source document
builder comes from the matching release checkout; the probe does not claim to
invoke the compiled Markdown parser/React component, nor duplicate the existing
HTTP/STUN positive-control, fresh-iframe, or navigation-isolation suite. Those
have separate source/browser evidence, while package presence/wiring is checked
on all six native build lanes by `verify-canvas-packaging.mjs`.

Preparation-only check, with no desktop/native execution:

```sh
node apps/desktop/scripts/zeno-update-smoke.mjs --self-test
```

Actual dual-architecture execution uses the existing **Zeno real macOS update
smoke** workflow on `personal`, after the public target feed is enabled, with
the original baseline build `38883434626` and the exact frozen target build ID.
Both resulting `canvas.passed` fields and their screenshots must be audited
before reporting native packaged-canvas success. Local self-tests alone do not
establish that result.
