# Native Claude protocol verification

These records cover the working-tree protocol changes prepared for 1.0.3.
They do not assert that a 1.0.3 installer has been built or published.

## Synthetic native engines

The three `synthetic-native-*.json` files are the unmodified, sanitized stdout
from the manual native fixtures. OpenCode 1.18.30 and 2.0.26 run without a
desktop window, with isolated configuration and only synthetic credentials.
The real `buildGatewayProvider` and scoped `/gateway/openai/messages` proxy
remain in the path. A test-only host fetch seam redirects the fixed ModelHelm
destination to loopback and refuses other external destinations.

Both native catalogs expose exactly `low`, `medium`, `high`, `xhigh`, and `max`
for all four allowlisted Claude model IDs. Native requests for
`anthropic/claude-opus-5.5` retain provider ID `modelhelm` and the complete model
ID. `high` performs a real read of one fixture-created synthetic file and a
second model turn; thinking text, signature, `tool_use`, and `tool_result`
survive the round trip. `xhigh` and `max` each perform one turn. The original
Chat Completions reasoning replay and GPT-6.1 Sol `high`/`max` cases remain.
There are no real model calls in these fixtures.

V1 uses `@ai-sdk/anthropic` and top-level `output_config.effort`. V2 uses
`@opencode/ai/providers/anthropic`; for Opus 5.5 it sends the selected effort in
a `role: system`, empty-content message with `output_config.effort` and the
pinned SDK's beta headers. The fixture accepts this actual native protocol
instead of manufacturing a top-level value. Adaptive/summarized thinking and
the SDK's automatic thinking block binding are preserved.

## Explicitly authorized live smoke

The two `live-native-*.json` files are the unmodified safe statistics from one
real Sonnet 5 `high` arithmetic request per engine, exactly two upstream calls
in total. Both use the real materializer, native Anthropic adapter, scoped
local proxy, and ModelHelm endpoint. The native body uses the complete
`anthropic/claude-sonnet-5` ID, top-level `output_config.effort: high`,
adaptive/summarized thinking, zero tools, and `max_tokens: 1024`.

Both requests returned HTTP 200, a completed SSE stream, text, and the expected
normalized integer. Token usage is an observed gateway response value; it is
not independently verified billing information. These calls do not establish
live tool execution or live support for every Claude model/effort combination.

The live harness uses an explicit synthetic session title, disables tools, and
enforces one external call per engine with no retry or continuation budget.
It rejects excessive output limits before egress and limits the upstream
timeout to 60 seconds. One V2 setup was rejected by that local tool-schema
guard before any upstream call; native wildcard tool denial then produced
the single permitted real V2 request.

Only the trusted host reads the existing upstream key into memory. Native
processes receive a scoped token. The isolated profiles were checked for the
upstream key and removed after the run; transcripts, thinking, native logs,
and credentials are not archived.

The reusable fixture is
`apps/server/test/fixtures/gateway-reasoning-live-native.ts`. Its default is a
dry run, before credential access or native startup. Real execution requires
`<v1|v2> --execute-approved-live` and a corresponding pinned
`OPENWORK_TEST_OPENCODE_BIN` or `OPENWORK_TEST_OPENCODE2_BIN`. It refuses a saved
custom gateway base URL before selecting its credential. It is not an
automatic CI test. The public fixture's additional credential/base guard was
checked statically and in dry-run mode; no extra real call was made.
