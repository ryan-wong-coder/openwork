# 1.0.4 image-input verification

Verified on **2026-10-17 (Asia/Shanghai)**. This directory contains safe,
unmodified JSON stdout from the final synthetic native run and the root task's
two explicitly bounded live image-recognition requests. It contains no real
credential, native log, temporary profile, image Base64, raw answer or thinking.

## Evidence boundaries

The capability fallback covers **31 exact full ModelHelm routing IDs** whose
primary vendor documentation declares image input. The complete mapping and
sources are in
[gateway-image-capabilities-sources.md](../../../../apps/server/test/fixtures/gateway-image-capabilities-sources.md).
That table is documentation evidence for input capability. It does **not** mean
all 31 ModelHelm routes received a live image request. The fallback is limited
to the exact official ModelHelm base, retains explicit catalog negatives and
does not infer image support from a family name, attachment flag, image output,
PDF, video or audio support.

Actual live gateway image recognition was checked for **two models only**:

| Engine and exact model | Protocol | Result | PNG | External requests |
| --- | --- | --- | --- | --- |
| V1 1.18.30 — `anthropic/claude-sonnet-5` | Native `image.source/base64` | HTTP 200, streamed answer, correct four-quadrant order | 128 × 128, 577 bytes | 1 |
| V2 2.0.26 — `openai/gpt-6.1-sol` | Compatible `image_url/dataURL` | HTTP 200, streamed answer, correct four-quadrant order | 128 × 128, 501 bytes | 1 |

The root task executed exactly these **two live image requests**, each capped
at 512 output tokens and a 60-second request timeout, with no tools, retries or
continuations. Each technical PNG used a freshly shuffled four-colour layout;
the prompt requested position names without disclosing their colour answers.
The host compared the returned colour sequence in memory. The reports retain
only a success boolean and each image's byte count/MIME/SHA-256, not the image,
colour ordering or answer. Reported token usage is gateway-observed metadata;
it is not independent billing verification.

The separate final synthetic run made **zero external model calls**. It used
the final production model materializer, both pinned native engines, their real
SDKs and the authenticated scoped gateway proxy against localhost upstreams:

- **Four supported first turns:** GPT-6.1 and Claude Sonnet 5 on each engine.
  Each upstream received the same 76-byte 2 × 2 technical PNG, byte for byte,
  through the expected native image content part. Each turn used one model
  request, with no file-read tool continuation and no unsupported-image
  placeholder. The PNG SHA-256 was
  `8e546007599fa6df13786602a501cc2933ae498bb8ed8ff0fa4664f551cad2be`.
- **Two text-only negative controls:** one per engine. Each engine retained
  an explanatory unsupported-image message and sent zero image blocks. Each
  control made one ordinary synthetic text request containing that explanation.

Both native engines ran headlessly with isolated temporary HOME/XDG/database
directories. macOS `sandbox-exec` permitted native subprocess networking only
to loopback. The live upstream key remained in the trusted host process; native
configuration contained only the scoped proxy token. Live profile scans found
no upstream key. All profiles were removed and native logs discarded. Native
engines may transiently store their ordinary chat in those temporary profiles;
no transcript or response was retained after cleanup. No desktop window or GUI
was opened, and no other live request was made by these verification fixtures.

## Files and reproduction

- [synthetic-native-images.json](synthetic-native-images.json): final
  credential-free native transport run, including all four image turns and two
  negative controls.
- [live-native-v1-claude.json](live-native-v1-claude.json): the root task's one
  native Claude image-recognition request.
- [live-native-v2-gpt.json](live-native-v2-gpt.json): the root task's one
  compatible GPT image-recognition request.
- [Synthetic fixture and command](../../../../apps/server/test/fixtures/gateway-vision-native.md).
- [Opt-in live fixture and execution limits](../../../../apps/server/test/fixtures/gateway-vision-live-native.md).

The final synthetic run passed after the configuration ownership signature and
credential-fingerprint boundary changes. Strict TypeScript checking passed for
the synthetic fixture, its upstream helper and the opt-in live fixture. Both
live-fixture dry-run modes and credential-free synthetic preflights passed;
preflight generated answers are transport checks and are not counted as remote
visual-recognition evidence. These results do not establish GUI end-to-end
behaviour, arbitrary attachment formats, all-model gateway availability, or
general visual recognition accuracy beyond the two tested four-colour images.
