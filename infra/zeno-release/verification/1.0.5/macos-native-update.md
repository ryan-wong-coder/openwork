# macOS native update and installed canvas verification

Target: **1.0.5**, frozen product tag `zeno-v1.0.5`, commit
`51310c0200874451e07b46e3c9345d63b681e527`, build
[39189963114](https://github.com/ryan-wong-coder/openwork/actions/runs/39189963114).
The original, unmodified **1.0.0** baseline comes from build `38883434626` and
its public historical release index.

[Initial dual-architecture run 39194107527](https://github.com/ryan-wong-coder/openwork/actions/runs/39194107527)
uses `personal` checkout `39d54d6087108f35d46174e02b52d2b0b3551168`.
Its exact difference from the frozen product is four development verification
files: the existing update workflow/script and the new packaged-canvas probe
and its explanation. The production document builder, chart runtime, native
protocol code and package version are unchanged.

The website API and six native feeds were activated for 1.0.5 before dispatch.
Each hosted macOS runner verifies the original baseline and target ZIP against
their respective public indices, checks persistent leaf signing continuity,
then lets the original updater download from Zeno's real HTTPS feed, stage,
replace and automatically restart. No target app is manually launched to stand
in for that restart, and no bundle is modified or re-signed by the test.

## x64 attempt 1: connection reset during download

[Job 117873034991](https://github.com/ryan-wong-coder/openwork/actions/runs/39194107527/job/117873034991)
failed at **2026-10-19T03:24:17Z**. The final successful phase was
`native-check-real-public-feed`. The native download returned
`{ok:false, reason:"download-failed"}` after **49,692,654 / 453,433,252 bytes
(10.959%)**. Bounded allowlisted native-log diagnostics recorded
`ERR_CONNECTION_RESET` / `connection-reset`. This is client-side transport
evidence; it does not independently identify the remote cause of the reset.

An independent, restricted [origin transport audit](macos-x64-attempt-1-transport.json)
found the matching updater GET at **03:24:07Z**, HTTP **200**, with only
**52,731,904** response-body bytes sent instead of **453,433,252**. This supports
an incomplete HTTP transfer before the client failure. The origin counter and
the client's **49,692,654** transferred-byte counter measure different points;
neither locates the resetting network node or proves every server-counted byte
reached the client. HTTP 200 alone does not establish a complete package.
These observations do not attribute the failure to the canvas, signing or
product code.

The report has `nativeUpdateExecuted:false`. It did not reach Squirrel staging,
bundle replacement, automatic restart or the canvas probe. The failure therefore
does not establish a canvas defect or a successful native update. Original ZIP,
target ZIP, same-leaf signature, baseline server/history and public 1.0.5
discovery checks had already passed. Temporary app/profile/fresh-run caches were
removed after native processes exited.

Only small sanitized artifact **12161556356** was downloaded (1,215-byte ZIP).
Its SHA-256 was independently verified against the GitHub artifact digest:
`364023cf486dc06b55dd1a7c04826d5bee466bb41f570641696108214cb82b59`.
It contains only [the original failed report](macos-x64-attempt-1.json), saved
byte for byte (2,339 bytes) with SHA-256
`380477586ae40ea31c223b19a2cd78fc53dacf614aff8997a36b69cbdc81b16b`.
There are no success screenshots for this attempt. Its failure report is retained
separately and must not be overwritten by any later retry.

## arm64 attempt 1: original update and installed canvas passed

[Job 117873034932](https://github.com/ryan-wong-coder/openwork/actions/runs/39194107527/job/117873034932)
completed **success at 2026-10-19T03:29:10Z**. Its target ZIP was
`zeno-mac-arm64-1.0.5.zip`, **434,047,989 bytes**, SHA-256
`0a2325f4c25beefc3a52fc3822141b224990efc8f0303b31494c30fb2dd47d87`.
The report's size/SHA-256 was independently compared with the live public
index; the corresponding native feed's size/SHA-512 matched that index.
Its baseline ZIP size/SHA-256 matches the preserved original-baseline evidence.

All eight phases passed, including a complete native download
**434,047,989 / 434,047,989 bytes (100%)**, Squirrel staging, real package
replacement and automatic restart. Original leaf-requirement verification and
the installed ASAR comparison passed. The final ASAR SHA-256 is
`f3922fa7b0a66df3df4f5c037cb60df7e73f68b10264488b1791a63f8a9d067a`.
Native and disk versions are both **1.0.5**. Profile, workspace file/registry,
stored session/message and embedded server were retained, with zero host
renderer exceptions. These native assertions ran on the hosted arm64 runner;
this audit did not download a large installer or recompute its ASAR locally.

`canvas.passed:true` records the observed actual protocol response
`200`, `Connection-Allowlist: ()`, and HTML content type. The installed lazy
module is 2,548,222 bytes, SHA-256
`2f6e7eccdb30041e3d198f6881e690a0a255785c6951acee4a4e7c9a431f8cee`,
matching the frozen build audit. Its loaded IIFE is 2,545,359 bytes, SHA-256
`b56da4564d6421ff3e58c7fc2977ec2c55de020ed6e296780961a94e485c5ebe`,
matching the separate actual-chart verification. The installed static shell
matches the unchanged production source, SHA-256
`a8a690241a0e017681604a49500d00a61261cfb0977dc4f4d0aa9627d4063e2b`.
Canvas/SVG interaction, Line/FlowGraph drawing, basic frame separation and
wrong-source rejection passed. Host state and native history remained intact
after probe disposal.

Only sanitized artifact **12161118995** was downloaded (60,128-byte ZIP).
Its archive SHA-256 was independently verified against GitHub's digest:
`c464b7f4504624e991e0af2082a7fe7ff56f3fb0ed8edd432fcf250f9da1677f`.
The three files were saved in their original bytes. Both PNGs were actually
viewed: a normal Chinese Zeno window with an empty key prompt and synthetic CI
workspace, and the synthetic board showing changed Canvas/SVG, the Line chart
and complete Chinese FlowGraph nodes/arrows. No key, private transcript or
error page is visible. Temporary native state was removed after processes exited.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [macos-arm64.json](macos-arm64.json) | 3,610 | `358c7a87407964a27344d0a0bf4bf2adbcf812894b974f5be05799aae205d62c` |
| [macos-arm64.png](macos-arm64.png) | 33,925 | `19a487746d49baaae34696147d4d01273a74c4d0037da231cced518fb292858f` |
| [macos-arm64-canvas.png](macos-arm64-canvas.png) | 30,760 | `8ccdfde6adc801d4acd78e90ba6eda10e4054ad411f4d8ea8821904852aefd93` |

## x64 attempt 2: same frozen target passed

The root task explicitly dispatched the x64-only
[retry run 39194711078](https://github.com/ryan-wong-coder/openwork/actions/runs/39194711078).
[Job 117874871747](https://github.com/ryan-wong-coder/openwork/actions/runs/39194711078/job/117874871747)
completed **success at 2026-10-19T03:40:49Z**. It used the same
`39d54d6087108f35d46174e02b52d2b0b3551168` checkout, original baseline build
`38883434626`, frozen target build `39189963114`, workflow, public feed and
verification budgets. No product code, tag, package or signing identity was
changed for the retry. It ran on a separate pristine hosted x64 runner.

The target was `zeno-mac-x64-1.0.5.zip`, **453,433,252 bytes**, SHA-256
`4aa2103b73ed496ff167d910ba9d9478a52f8f292119c20f7330167fcd703a25`.
Public index size/SHA-256 and native feed size/SHA-512 were independently
cross-checked again. Its original-baseline record matches the historical
baseline evidence. Native download reached **453,433,252 / 453,433,252 bytes
(100%)**, followed by successful Squirrel staging, actual bundle replacement
and automatic restart, with native/disk version **1.0.5**.

All eight phases passed. The final ASAR SHA-256 is the same
`f3922fa7b0a66df3df4f5c037cb60df7e73f68b10264488b1791a63f8a9d067a`;
same-leaf signing, profile, workspace, history and embedded-server checks passed,
with zero host renderer exceptions. The entire `canvas` report matches the
audited arm64 result: actual native policy response, installed-module/IIFE/shell
hashes, real interaction/drawing, basic isolation, disposal and post-probe
history retention. Temporary app/profile/fresh-run caches were removed only
after native processes exited.

Only small sanitized artifact **12161409137** was downloaded (69,950-byte ZIP).
Its archive SHA-256 was independently verified against GitHub's digest:
`a1ba7081a789d30de3273debadd8f5d8247ac28d870b20e2c62b1d3f95ee4a14`.
All three files were saved in their original bytes. Both PNGs were actually
viewed: the normal Chinese Zeno window with an empty key field and synthetic
workspace, and the complete synthetic Canvas/SVG, Line and Chinese FlowGraph
board. No private transcript, key or error page is visible.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [macos-x64.json](macos-x64.json) | 3,602 | `033d43cb62c57a446736a76244fd774b081ad30fb6649bacf68a54e6601be780` |
| [macos-x64.png](macos-x64.png) | 37,017 | `ded15b44602e982b8af433dd06d131231a611e79964ecbaa710869901ca163e9` |
| [macos-x64-canvas.png](macos-x64-canvas.png) | 39,398 | `e732a0ba6c3a4d92b0c139fd0a838743a9a1a388059d20ba6cb946bb55f27ef9` |

## Evidence boundaries

Successful installed-canvas verification requires both `report.passed` and
`report.canvas.passed`, plus actual inspection of that architecture's
`updated-app.png` and `native-canvas.png`. The probe uses the installed
production Ant lazy module and actual native custom-protocol shell, with a
synthetic board made by the matching release checkout's production document
builder. It checks real policy headers, Canvas/SVG interaction, Ant Line and
FlowGraph pixels, basic host/bridge/Node separation, wrong-source message
rejection, disposal and history retention.

That probe does not invoke the compiled Markdown/React entry point or duplicate
the separate HTTP/STUN/fresh-iframe/navigation isolation suite. It uses no model
credentials or external model calls. Native update evidence is scoped to macOS
x64/arm64 and self-signed identity continuity, not Apple notarization or actual
Windows/Linux installation.

The audited conclusion is **macOS arm64 and x64 both passed the real original
1.0.0 → 1.0.5 native update, automatic restart, data retention and installed
canvas integration checks**. All four success PNGs were actually viewed. The
first x64 transport failure remains separately preserved; the initial overall
run retains its failure status even though its arm64 job passed. This audit
downloaded only the three small sanitized evidence ZIPs, made no model calls,
and did not dispatch, retry, publish, modify product code or move a release tag.
