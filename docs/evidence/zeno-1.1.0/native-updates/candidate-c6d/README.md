# Withdrawn 1.1.0 candidate: update mechanism evidence

This directory preserves the original sanitized reports and screenshots from
the withdrawn `zeno-v1.1.0-build.3` candidate. Both macOS updater mechanisms
passed, but **these results are not final product acceptance**. The user
reported that four desktop personal sidebar entries returned to new chat.
These probes did not click those entries. Windows/Linux were never dispatched
for this candidate, and formal publication was paused. The public latest/feed
was returned to 1.0.5 at 2026-10-20 06:58:47 UTC; versioned 1.1.0 files remain
available for in-flight downloads. No automatic downgrade is claimed.

Actual native run:
[39382045939](https://github.com/ryan-wong-coder/openwork/actions/runs/39382045939),
workflow `Zeno real macOS update smoke`, checkout
`aa62166338e9fbaf561b01a178298f3db98bcd90`, both architectures.
Original baseline 1.0.0 release build 38883434626 is anchored to
`92688046400df5d1e2807d63dce986431bc7623a`. Target release build
39373868155 used immutable product tag `zeno-v1.1.0-build.3`, actual product
checkout `c6d0f3f4a7bfba3617a0bcae754756c31731849d`; its orchestration SHA
`695a4114397395dd2e6bfcdf4e2ab1f12d617b92` only changed CI preflight timeout
and logging. Dispatch and activation provenance is in `dispatches.json`.

| Lane | Job | Small artifact | Independent artifact ZIP SHA-256 | Actual native download |
| --- | --- | --- | --- | --- |
| macOS ARM64 | 118493159575 | 12246606104 (64,679 B) | `20745b4738efff1330e4086f20f9ce4e6490808a3f93995a857326837a647e6d` | 437,038,232 / 437,038,232 B |
| macOS x64 | 118493159743 | 12246477267 (74,643 B) | `1877f35fa6ef8e5346e0912dc21c7785f10239075c76e66c213a2a5fd1052274` | 456,423,506 / 456,423,506 B |

Only these small GitHub artifacts were downloaded. Their ZIP SHA-256 values
were independently matched to GitHub's artifact digests. The report and PNG
members were then saved byte-for-byte, with each member's length and SHA-256
recorded in `macos-{arch}-artifact.json`. No installer, private profile,
credential, signing material or raw app log is part of this evidence.

Each original report records unmodified historical ZIP verification, same
signing leaf, own public feed, full target download, real Squirrel staging,
original process exit, bundle replacement and automatic restart into 1.1.0.
The final installed ASAR matched the published target on both architectures:
`a054181379afe4108bf5cd318628d1d76baaa6125d85cb7846a1ba42fd3ad0b6`.
Chromium marker, workspace file/identity, original native session/message
and embedded server were retained; host renderer exceptions were zero.
Private copies/profile/fresh caches were removed after native processes exited.

Both installed canvas probes observed the real custom-protocol response
status 200 and `Connection-Allowlist: ()`, loaded the installed offline Ant
runtime, verified local Canvas/SVG interaction and Line/FlowGraph pixels,
rejected a valid-token/wrong-source message and retained host state/history.
These are synthetic boards with no model calls. They do not repeat the full
network isolation suite or claim an OS-wide network audit.

All **four** original screenshots were actually viewed: the updated app
images show the Chinese sidebar and empty ModelHelm setup screen; the canvas
images show the interactive synthetic shape, line chart and Chinese flow
graph. Merely seeing the sidebar does not demonstrate its navigation.
The successor 1.1.1 acceptance adds actual four-entry click checks and must
be recorded separately with its own frozen product/build/run provenance.
