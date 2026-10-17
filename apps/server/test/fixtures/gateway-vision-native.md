# Pinned native first-turn image transport

This opt-in manual fixture uses the real OpenCode V1 **1.18.30** and V2
**2.0.26** binaries, production ModelHelm model materializer, native SDKs and
authenticated scoped gateway proxy. Both upstreams and all credentials are
synthetic. It never reads a saved API key or calls an external model.

```sh
OPENWORK_TEST_OPENCODE_BIN=/absolute/path/to/opencode-1.18.30 \
OPENWORK_TEST_OPENCODE2_BIN=/absolute/path/to/opencode2-2.0.26 \
pnpm exec bun apps/server/test/fixtures/gateway-vision-native.ts
```

The binaries must already exist; this fixture never downloads or installs one.
It requires macOS `sandbox-exec`, which restricts each engine and its children
to loopback networking. Native HOME/XDG directories and databases live in a
fresh temporary directory and are removed on exit. No GUI is launched. The
host fetch seam redirects the proxy's fixed official destination to a local
synthetic server and rejects every other non-loopback destination.

The image is a valid 2 × 2 RGBA PNG assembled in memory with four coloured
pixels. It is never written into the agent's workspace. V1 receives a first
`message` with a `parts:file` data URL; V2 receives a first native `prompt`
with `files: [{ uri: dataURL, name: "synthetic.png" }]`. The fixture checks
the native catalog and the actual first upstream request for both exact IDs:

- `openai/gpt-6.1-sol`: OpenAI-compatible `image_url.url` data URL.
- `anthropic/claude-sonnet-5`: native `image.source` with base64 data and PNG MIME.

Both decoded payloads must equal the original PNG byte for byte. Each proof
must use exactly one model call, with no file-read tool round trip, and must
not contain the former image rejection placeholder. An explicitly text-only
synthetic model is a negative control: the engine must preserve an explanatory
rejection and must never transmit an image block to that model.

Successful stdout contains versions, model IDs, MIME, byte count and SHA-256,
plus protocol and isolation checks. Full engine logs, profiles, image base64,
prompts, system instructions and response bodies are not retained. This proves
first-turn local image transport; it does not prove remote gateway acceptance
or visual recognition quality.

## Executed result

Passed with both pinned engines on 2026-10-17 (Asia/Shanghai). Each engine
sent the original 76-byte PNG on the first GPT-6.1 and Claude Sonnet 5 turn,
using one upstream request per turn. The decoded SHA-256 was
`8e546007599fa6df13786602a501cc2933ae498bb8ed8ff0fa4664f551cad2be`
in all four requests. Both text-only controls preserved the native unsupported
image explanation and sent zero image blocks. They each made one normal text
request containing that explanation. The temporary profiles were removed,
stderr was empty, and strict TypeScript checking passed.
