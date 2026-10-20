# Installed desktop navigation gate

`zeno-packaged-navigation-probe.mjs` is a development-only step of the real
macOS, Windows and Linux updater harnesses for targets **1.1.1 and later**.
It does not launch an application. The existing harness first authenticates
the disposable hosted runner, original 1.0.0 installation, private profile,
actual updater download, old process exit, target code hash and automatic
relaunch. None of those gates are replaced by this probe.

The probe independently requires a GitHub-hosted `personal` run and the exact
installed `file://.../resources/app-dist/index.html` renderer. It brings only
that owned page to the foreground and sends real CDP mouse press/release
events to the visible AppSidebar buttons 日历、健身、任务、账号. It never changes
the URL directly, calls an internal router, replaces a bridge or supplies an
account session.

Each click must retain its exact `#/personal/{section}` route, active sidebar
entry and real **连接你的账号** surface for at least 1.2 seconds, with no visible
chat composer or application error screen. A fresh original-upgrade profile
is deliberately unpaired: the common account gate is expected on all four
routes. This proves the packaged desktop entry path and auth boundary; it
does **not** prove the four authenticated personal forms. The separately
recorded PWA functional tests cover those forms.

The actual preload bridge, React root and original Chromium marker must
survive. Both updater harnesses also compare the native workspace's session
identity set and re-read its original stored message after navigation, so
an extra persisted chat or a lost historical chat fails the update. Renderer
exceptions remain a hard failure. No account pairing, model call, real user
credential or additional server-side write is performed by the probe.

Successful artifacts add `navigation` to `report.json` and one
`native-navigation.png` (the actual final account gate). Only booleans,
allowlisted route classifications and section names are reported; session
IDs, private paths and raw browser errors are not included. A failed probe
keeps its safe per-section result in the original attempt report. Historical
targets below 1.1.1 do not retroactively acquire this new gate.

Headless logic checks, which never launch Electron:

```sh
node --test apps/desktop/test/zeno-packaged-navigation-probe.test.mjs
node apps/desktop/scripts/zeno-update-smoke.mjs --self-test
node --test apps/desktop/test/zeno-update-portable-smoke.test.mjs
```

The tests exercise hosted/CPU/ref rejection, exact POSIX and Windows file
ownership, actual generated snapshot/click expressions in a synthetic DOM,
all four successful routes, the original workspace/session redirect,
incorrect active state, missing auth gate, visible chat/error, obstruction,
disabled controls, redacted route identifiers and native session-set changes.
They are fixture checks, not evidence that an installed update passed. The
real workflows must run against the frozen target after the operator has
activated the matching public feed.
