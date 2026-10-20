# Production PWA browser verification

Final local run on **2026-10-20**: **42 checks passed / 17 screenshots**. Every screenshot
was opened and visually inspected; its archived bytes match the report's size and SHA-256.
The repaired 390px photo comparison keeps both images and date controls inside their panes,
including a real date swap. Ant's actual light/dark chart renders with the compact heatmap.
Enforced CSP violations, renderer exceptions, console errors, external page HTTP origins and
real model calls were all **zero**. `pwa-build-manifest.json` identifies every file in the exact
tested local bundle; this result does not assert that those bytes have been deployed publicly.

Reproduce from the repository root with the normal pnpm workspace dependencies installed:

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @zeno/core build
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm --filter @openwork/app build:personal
node apps/app/scripts/zeno-personal-browser-smoke.mjs
```

The runner uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with
`--headless=new`, an independent temporary profile and owned CDP targets. FFmpeg at
`/opt/homebrew/bin/ffmpeg` creates a small, synthetic MP4 fixture. The PNG fixtures are
original technical color blocks encoded in the test; they depict no real person. No visible
window, real account, model, external artwork or user profile is used.

The fixture starts the **actual Bun API** against temporary SQLite/media storage and serves
a **private, fixed snapshot of the production `dist-personal` bundle** at the same loopback
origin. The index hash is checked after copying; a later shared build cannot replace its
lazy chunks mid-run. Its authentication,
account fencing, optimistic versions, atomic batches, authenticated media and feature routes
remain real. Operator feature state uses the test fixture's in-memory callback; this browser
run does not establish persistence of the production operator configuration file. Setup
creates only synthetic admin/member accounts, routine data and an inactive paired device.
Internal setup and browser sign-in use separate loopback IP identities so setup does not
consume the browser's sign-in quota. All profiles, credentials, downloads and database files
are removed after each run. High-frequency harness assertions read a scoped, test-only database
projection; user operations still use the actual API. This avoids consuming the user's real API
rate limit merely to observe whether a write has completed.

## Security and error gates

HTML responses use the exact `/app/index.html` CSP extracted from
`infra/zeno-release/zeno-api/nginx-locations.conf`, including navigation fallback responses.
The canvas shell receives its separate isolation CSP when requested; this fitness journey
does not independently exercise a conversation canvas. The report includes the nginx file
SHA-256, observed document-policy hashes, enforced `securitypolicyviolation` count, uncaught
runtime exceptions and caught `console.error` count. A React error boundary is also a failure,
even when it consumes an exception before `Runtime.exceptionThrown` can observe it.

The first production bundle exposed a real continuous-input defect: a deferred React state
updater read a cleared `event.currentTarget`. The minimal sanitized record is retained in
[`pwa-event-input-regression.json`](pwa-event-input-regression.json). The product fix captures
input primitives before state/async boundaries and has independent actual-React and AST
regressions. A failed intermediate run is not treated as final passing evidence.

The real backup/re-import journey also exposed an extensionless multipart upload problem:
the Bun parser returned an empty MIME type for a valid MP4 sent with a record-ID filename.
[`pwa-backup-upload-regression.json`](pwa-backup-upload-regression.json) preserves the safe
failure summary. Original-byte ZIP validation alone did not establish successful server upload.
After the shared client/native MIME-to-extension normalization fix, the final UI journey
successfully imported an **8,644-byte** backup, created independent record/media IDs and
verified the restored MP4's original SHA-256 and byte count in real API storage.

The service worker must cold-reload offline and cache only public application-shell paths.
The harness observes requests from its page targets and requires zero external HTTP origins;
this is not a machine-wide packet capture. No executor or real model service is started.
Screenshots are guarded against synthetic email display; credentials, cookies, invite/device
grants, private database rows, raw response bodies and raw stack traces are not archived.

## Actual user paths

Only the checks present in the final `pwa-browser-report.json` passed through the browser.
They cover these paths:

- Real sign-in, visible invalid-password error, account switching and account-data isolation.
- Calendar create/edit/delete; daily-series “this and following” edit through a real two-record
  batch; atomic undo; server version change followed by rejected undo without overwriting
  either record. A separate v1 local edit versus actual remote v3 conflict is reviewed and
  saved as v4.
- Calendar workspace association, clearing to the personal scope and preserving an unavailable
  workspace while editing another field. The raw unavailable identifier is not shown in the UI.
- Same-account second tab explicitly read-only; offline first-tab edit reaches it by broadcast;
  first tab closes with an unsynced outbox; the second acquires the writer lock, edits another
  event and reconnects. Both records must survive. Cold offline reload and reconnect sync use
  the real production service worker and local outbox.
- Time zone/default weight-unit changes survive reload; training day notes and owned dumbbell
  settings reach actual settings records.
- Plan-print action creates an actual separate same-origin document, with the expected plan,
  exercise/sets, applied style and no application navigation, account panel or dialog backdrop.
  **This is a print-document DOM/CSP check. It does not save, render or inspect a PDF file.**
- Custom exercise create/edit/delete; real synthetic MP4 form upload and original byte SHA-256
  in API media storage; linked media remains after editing.
- Mobile workout start, completed set/rest persistence, logged exercise replacement confirmation,
  up/down reorder and removal of the unlogged replacement without relabelling the old result;
  finish, history weight edit and recomputed statistics. Actual Ant Design Charts canvas/SVG
  renders under production CSP.
- Two dated body records with real PNG uploads, decoded private images and mobile light/dark
  photo comparison. These are technical fixtures, not before/after pictures of a real person.
- Complete fitness ZIP is downloaded through the UI and re-imported through its real file input.
  Restored copies remap record/media IDs while preserving video byte hashes, workout/body
  records, equipment settings and day notes. The downloaded archive is temporary; only its
  byte count and SHA-256 are reported.
- A task run and chat request wait for the inactive paired computer; chat cancellation is a
  request awaiting that computer's acknowledgement, not a fabricated successful AI reply.
- Real admin users panel, invite creation/revocation, fitness feature disabled/read-only and
  restored, account feature disabled/new-pairing/preferences blocked while password security,
  sign-out and admin recovery remain available.

`pwa-browser-report.json` records the authoritative verdict, exact production index hash,
browser version, checks and screenshot hashes. Desktop is 1440×1000; mobile is 390×844.
Every archived screenshot is opened for visual inspection after a passing run. The report
must be read alongside any final-build differential report if a later narrowly scoped UI
change was built without repeating the entire unchanged journey.

`ZENO_PWA_QA_MODE=workspace` runs a focused real-UI association/clear/missing-workspace
preservation check and writes separately under `workspace-delta/`. Its two screenshots are
also visually inspected. The final full run includes the same workspace checks and its own
matching screenshot, so that earlier focused report is not needed to establish final coverage.

`ZENO_PWA_QA_DIST` and `ZENO_PWA_QA_OUTPUT` select a local build/output directory. This is a
production **web bundle and real local API** verification. It does not prove a native installer,
Electron bridge, OS keychain, installed-mobile PWA, background push delivery, public HTTPS
publication or actual AI execution. Those have separate, explicitly scoped reports. Fitness
source/algorithm and native synthetic tests are recorded in
[`verification.json`](../../../packages/zeno-fitness/verification.json); the migration feature
map and exclusions are in
[`MIGRATION-COVERAGE.md`](../../../packages/zeno-fitness/MIGRATION-COVERAGE.md).
