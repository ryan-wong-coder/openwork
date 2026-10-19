# Conversation canvas UI verification

The [final machine report](browser-qa.json) passed **14 checks** on 2026-10-19
using task-owned headless Chrome 155 and a fresh local Vite server. The fixture
imports the actual `MarkdownBlock`, `ConversationCanvas`, bundled chart runtime
and app CSS. No model/API calls were made or user browser touched. This is
component integration evidence; it does not claim a full-app or native run.

## Results

- The static shell was delivered with HTTP 200, `Connection-Allowlist: ()` and
  HTML content type. The host plus three isolated iframe layers became ready.
  The application iframe has a static `src`, with generated content delivered
  after the authenticated shell handshake.
- A slider changed real canvas pixels and SVG geometry. After two button clicks,
  100 separately rendered prose updates, settlement and highlighting retained
  the slider/counter, one board boot, unchanged paint count and zero iframe loads.
  The source/preview roundtrip and dark theme retained the running board too.
- Widths 360, 736 and 1200 had no host or board horizontal overflow. The root and
  body vertical scroll ranges were zero at each width. Desktop Chrome reserves a
  15px gutter, but measurements confirm it has no scrollable content.
- A new incomplete fence held a 360px placeholder across partial updates without
  creating an iframe. Invalid JSON exposed escaped source and retry. Ordinary
  HTML stayed code. Statistical charts and all five relationship families
  rendered in the actual isolated board, including correct Chinese node labels.
- A fresh page with its user agent overridden to Chromium 151 exposed source
  without creating any iframe. This verifies version detection, not a real
  Chromium 151 engine. A second fresh page intercepted the actual shell HTTP
  response and removed only its allowlist header; it also stayed source-only.
  These two negative controls produced identical visible fallback screenshots.

All 12 final PNG files were actually viewed, including Chinese labels and the
five-chart page. No runtime exceptions occurred. Recorded HTTP origins are scoped
to the runner's enabled CDP sessions; they are **not a network-security proof**.
Dedicated network/security verification is separate.

| Evidence | View |
| --- | --- |
| Desktop / tablet / mobile | [desktop](desktop.png), [tablet](tablet.png), [mobile](mobile.png) |
| Dark / pending / invalid source | [dark](dark.png), [pending](pending.png), [error](error.png) |
| Source view | [source](source.png) |
| Statistical / relationship chart | [statistical](statistical.png), [relationship](relationship.png) |
| Five relationship families in one HTML board | [relationships](relationships.png) |
| Unsupported browser / missing policy header | [unsupported](unsupported-browser.png), [missing policy](missing-policy.png) |

React lifecycle/bridge tests passed **8 tests / 50 assertions** after the static
shell change; the app TypeScript check passed. These tests use a synthetic native
bridge declaration because Happy DOM does not implement the native protocol. Its
expected unsupported `zeno-canvas:` loading logs and existing KaTeX quirks warning
do not represent a real Electron run. Actual documents run in the browser fixture.
The handshake test covers wrong source, origin and token before checking the
generated document payload. Relevant design rules: P1, P5, P10, P11 and S4.

## Repeat

Fixture: `tests/fixtures/conversation-canvas-browser/{index.html,main.tsx}`.
Runner: `scripts/conversation-canvas-browser-qa.mjs`. Start an isolated Vite server
with `VITE_OPENWORK_CLIENT_PROFILE=local-gateway OPENWORK_DEV_MODE=1`, and provide
that server's fixture URL plus a task-owned headless Chrome CDP URL:

```sh
CANVAS_QA_CDP=http://127.0.0.1:50502 \
CANVAS_QA_URL=http://127.0.0.1:58591/tests/fixtures/conversation-canvas-browser/index.html \
node apps/app/scripts/conversation-canvas-browser-qa.mjs
```

The runner creates/closes its own page and attaches only descendant opaque
iframe targets. The browser/server used for this record were cleaned up afterward.

The retained [earlier baseline report](attempts/pre-static-shell-baseline/browser-qa.json)
predates the static shell and is not security approval. Its duplicate PNGs were
removed. An earlier [pending-fixture failure](attempts/pending-reused-existing-message/browser-qa.json)
and [screenshot](attempts/pending-reused-existing-message/failure.png) document a
test that reused an existing message identity; retaining the prior complete board
was correct. Scenarios now have distinct message keys. A separate relationship
fixture literal `labelText` override was removed before final verification.
