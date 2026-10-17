# Opt-in one-call native image recognition

This manual fixture is **dry-run by default**. A dry-run exits before reading
saved configuration or credentials, resolving a binary, creating a profile or
making a network request. Only the exact `--execute-approved-live` mode reads
the existing ModelHelm key, after validating that the saved gateway base is the
factory ModelHelm endpoint. A missing base uses the factory default; an
explicit empty, invalid or custom base is rejected before selecting the key.

The root task owns the two approved executions:

```sh
OPENWORK_TEST_OPENCODE_BIN=/absolute/path/to/opencode-1.18.30 \
pnpm exec bun apps/server/test/fixtures/gateway-vision-live-native.ts v1 --execute-approved-live

OPENWORK_TEST_OPENCODE2_BIN=/absolute/path/to/opencode2-2.0.26 \
pnpm exec bun apps/server/test/fixtures/gateway-vision-live-native.ts v2 --execute-approved-live
```

V1 selects native `anthropic/claude-sonnet-5`; V2 selects compatible
`openai/gpt-6.1-sol`. Each execution has a hard budget of **one upstream
request**, **512 maximum output tokens**, and a **60 second request timeout**.
There are no tools, retries or continuations. The scoped proxy verifies the
wire output limit, zero tools, exact model and exactly one inline PNG before
allowing the request. A second proxy request cannot reach the network.

The 128 × 128 PNG is constructed entirely in host memory. Its four solid
colour quadrants are cryptographically shuffled on each execution. The prompt
asks for top-left, top-right, bottom-left and bottom-right colour names as a
JSON array; it does not disclose the answers. The returned order is compared
in memory. Reports contain only the comparison result and image MIME, size,
byte count and SHA-256, plus safe protocol/usage/status information. They do
not contain the colour order, image base64, raw answer or thinking.

Both native engines use isolated temporary HOME/XDG/database directories and
a macOS `sandbox-exec` profile that permits only loopback networking. The real
upstream key remains in host memory; native configuration contains only the
process-scoped proxy token. The fixture scans the stopped profile for the key,
removes the profile, and discards native logs before printing its final report.
The native engine may transiently store its ordinary chat in that temporary
profile; no transcript, raw answer, thinking or log is retained after cleanup.

For a credential-free transport/budget check, replace the execution flag with
`--synthetic-preflight`. This uses synthetic credentials and a localhost
upstream. It proves the harness accepts each engine's actual first-turn wire
shape; its generated answer is not evidence of remote image recognition.
`remoteVisualRecognitionVerified` is always false in this mode. The two
synthetic preflights passed on 2026-10-17, with exactly one call each, 512-token
caps, zero tools and successful profile/key/log cleanup. No live request was
made while preparing this fixture.
