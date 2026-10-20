# Original-release native updates to 1.1.1

Status at 2026-10-20 09:17 UTC: **both macOS lanes passed**. Linux's first
attempt and Windows' third attempt were explicitly cancelled after an
unobservable long-running verifier; their already-written original reports
record failure points below. Windows' first two attempts stopped during
baseline preparation. A subsequent both-platform diagnostic run ended in
ordinary failure at the specific checks below. This is not a four-lane
passing verdict.

The immutable original 1.0.0 baseline is release build `38883434626`, product
commit `92688046400df5d1e2807d63dce986431bc7623a`. The target is release build
`39383996080`, tag `zeno-v1.1.1`, product commit
`afb3ca5b629c5b219fd6ed942fd32811ca671532`. The operator completed the entire
24-asset server integrity gate, publication gate and live 1.1.1 feed check
before authorizing these runs. `dispatches.json` preserves the actual
workflow commits and the serial scheduling decision.
The website's later `e166` static PWA authorization hotfix is a separate
deployment. It is not part of these immutable `afb3ca5` native installers,
and its public pairing result is not used as a native-updater verdict here.

| Lane / attempt | Run | Job | Small evidence artifact | Verdict |
| --- | --- | --- | --- | --- |
| macOS ARM64 / 1 | [39390775189](https://github.com/ryan-wong-coder/openwork/actions/runs/39390775189) | 118521515791 | 12249787857 | Passed |
| macOS x64 / 1 | Same macOS run | 118521515858 | 12250374162 | Passed |
| Windows x64 / 1 | [39392398870](https://github.com/ryan-wong-coder/openwork/actions/runs/39392398870) | 118526859572 | 12250820198 | Failed before target execution; cause unknown |
| Windows x64 / 2 | [39394366327](https://github.com/ryan-wong-coder/openwork/actions/runs/39394366327) | 118533346641 | 12251810367 | Failed at baseline session creation; exact HTTP result unknown |
| Windows x64 / 3 | [39395634492](https://github.com/ryan-wong-coder/openwork/actions/runs/39395634492) | 118537616884 | 12252051912 | Cancelled; original failed report at restarted renderer discovery |
| Windows x64 / 4 | [39398559935](https://github.com/ryan-wong-coder/openwork/actions/runs/39398559935) | 118547327406 | 12254590473 | Failed at original workspace readiness, HTTP 404 |
| Linux x64 / 1 | First Windows/Linux run | 118526859556 | 12252306860 | Cancelled; original failed report after native download |
| Linux x64 / 2 | Both-platform diagnostic run | 118547327809 | 12254780648 | Failed at restarted renderer private identity |

Only small sanitized GitHub artifacts are downloaded for this audit. Each
ZIP's SHA-256 is independently matched to GitHub's artifact digest before
its report and PNG members are saved **byte-for-byte**. Each
`*-artifact.json` records run/job/artifact IDs, ZIP digest, member lengths
and member SHA-256 values. Private profiles, raw logs, credentials and signing
material are excluded. All runs use disposable hosted runners; no ordinary
desktop app or user profile is opened on the development machine.

## macOS: real upgrade, restart, data and four entries

Both architectures used unmodified original 1.0.0 ZIPs and the same original
signing identity. The verified target release ZIPs were:

| Target | Bytes | Release ZIP SHA-256 | Native download progress |
| --- | --- | --- | --- |
| `zeno-mac-arm64-1.1.1.zip` | 437,037,793 | `83c2dadf157270346a1934de55695d7ab172024fd22df60103408ad7a7604256` | 437,037,793 / 437,037,793, 100% |
| `zeno-mac-x64-1.1.1.zip` | 456,423,068 | `936aa54d6db521f5ca7cedaf8dce3561af3793cf46692ab82de705bee873d891` | 456,423,068 / 456,423,068, 100% |

Each report proves a real own-public-feed download, Squirrel staging,
original process exit, native bundle replacement and automatic restart into
1.1.1. The installed ASAR matched the frozen published target on both lanes:
`c98199fd9a0e048644f59890330453d5abad1199eba6128472553cb97f8bc954`.
The Chromium marker, workspace identity/file, original native session/message
and embedded server were retained. Host renderer exceptions were zero.

The actual installed AppSidebar was clicked with CDP mouse press/release
events for **日历、健身、任务、账号**, without direct URL mutation or a fake
bridge/session. Each exact `/personal/{section}` route, active sidebar entry
and real **连接你的账号** gate remained visible for at least 1.2 seconds,
with no chat composer or application error screen. The workspace session
identity set and original message remained unchanged after all four clicks.

The upgraded profiles are deliberately **unpaired**. This proves the four
packaged entry routes and actual account connection gate, **not authenticated
personal forms, pairing or OS credential storage**. The 42-case PWA functional
evidence for those separate browser business flows is recorded in
[`../../zeno-1.1.0/pwa-browser-report.json`](../../zeno-1.1.0/pwa-browser-report.json).
No real account, model call or external business data was used.

Both installed canvas probes observed the actual custom-protocol response
200 with `Connection-Allowlist: ()`, imported the installed offline chart
runtime, rendered/changed Canvas and SVG, and rendered Ant Line/FlowGraph
pixels. Parent/Node/native-bridge access was unavailable, a valid-token but
wrong-source message was rejected, and host state/history survived cleanup.
This small packaged integration probe does not repeat the full isolation
suite or claim an OS-wide network audit.

All six macOS PNGs were actually viewed: `macos-{arch}.png` shows the
updated Chinese app with its empty ModelHelm setup prompt;
`macos-{arch}-canvas.png` visibly shows the synthetic shape, line chart and
Chinese flow graph; `macos-{arch}-navigation.png` shows the account entry
selected and the genuine connection gate. The final screenshot covers the
last entry; the report contains the actual checks for all four entries.

## Windows: preserved unsuccessful attempts

Attempt 1 verified both original installer hashes and installed the original
1.0.0 NSIS package into its private directory. Its last successful phase is
`original-nsis-installed`; target execution, download, automatic relaunch,
history and navigation are all unproven. The original report has no specific
checkpoint or HTTP status, so its exact cause remains **unknown**.

Attempt 2 used the same original installers and target. Development-only
commit `4f25b4c5fc943e6a683e26b28826b85ce2447da7` added fixed allowlisted
checkpoints/error metadata and corrected PowerShell process-path transport
to ASCII Base64 containing UTF-8, preserving the exact private-executable
identity check. The actual Windows PowerShell synthetic Chinese-path fixture
passed, as independently recorded in `windows-harness-encoding.json`; this
does not retrospectively establish attempt 1's cause.

Attempt 2 reached `baseline-session-create` and then recorded
`AssertionError / ERR_ASSERTION`. It had already passed the private CDP
process identity, original build/updater channel, workspace creation,
engine start and global host health gates. It failed before the historical
session was seeded and before any updater operation. The checkpoint covers
the session POST's HTTP-200 assertion and returned-ID assertion; this report
does not contain the HTTP result and cannot establish a 502 or its cause.
No unsuccessful report is replaced by a later attempt.

Attempt 3 used development-only commit
`d0d37f1bf4814065e7e3f3520075ee17f69a3442`. The original 120-second readiness
loop additionally required this workspace's actual read-only
`session/status` response to be HTTP 200 with an object body before seeding
history; POST requests were never retried. Its original report records
baseline history successfully created at 08:48:03 UTC and a successful native
download of the 383,746,839-byte target completed at 08:53:29 UTC. Failure is
at `attach-page-list`, with fixed `Error / TypeError` metadata; the most recent
HTTP result was `engine-activity / 200`. By the code's sequence, the idle
gate, install request and original-process exit had been reached before
looking for the automatically restarted owned renderer. Installed target
identity, automatic restart, preserved target history and navigation remain
unproven. The report does not identify why that renderer was unavailable.

## Linux and verifier interruption

Linux's original report records unmodified baseline AppImage bytes, private
installation, actual baseline session/message creation at 08:19:37 UTC and
successful native target download at 08:25:37 UTC (317,994,145 bytes). Its
last phase is `native-public-download-completed`; this older harness had no
specific active checkpoint. The subsequent idle/install/process/renderer
failure cannot be distinguished from this report. Target replacement,
automatic restart, preserved history and personal navigation are unproven.

At 08:56:32 UTC the operator explicitly authorized cancellation of only the
remaining Linux run and Windows attempt 3. The reason is preserved in
`operator-cancellations.json`: **unobservable long-running verifier; potential
lifecycle risk, not a proved product failure**. Both workflow jobs ended
`cancelled`, and their always-upload steps retained the original report
bytes. Their `*-artifact.json` records therefore mark acceptance interrupted,
even while preserving each original JSON's `passed: false` value. No PNG was
produced by either interrupted attempt.

The developer harness had a confirmed liveness risk: failed private child
process/socket handles could outlive the completed verifier. The subsequent
development-only commit `3e845cce5` makes the guarded CI entry explicitly exit
1 only after `main()` has completed its entire `finally`, environment
restoration and synchronous JSON write; a successful verification still
exits normally. This change is not in the cancelled runs and is not a
retrospective passing verdict or proof of their underlying failed check.

Any further explicitly authorized attempt must receive its own original
report and screenshot review before it can be declared passed. The immutable
product tag and installers are unchanged by all development-only harness
work. No failed or cancelled attempt is deleted or replaced.

## Completed diagnostic run: exact observed facts

The final run above used workflow checkout
`8128c19b09d94d7ccee509fce01ef4305d15e843`, whose desktop version remained
1.1.1. Its later visual source changes do not alter the target: both installers
were still verified against the immutable `afb3ca5` build 39383996080.
The corrected verifier lifecycle ended both failed jobs promptly and retained
their small artifacts, without operator cancellation or manual target launch.

Windows attempt 4 stopped at `runtime-workspace-ready`: the actual workspace
`session/status` endpoint returned **HTTP 404** within the unchanged readiness
bound. Target update did not begin. The failure snapshot found the original
browser still present, one matching private executable process, baseline
ASAR rather than target ASAR on disk, and the two expected User registry
environment values still matching. Expected debug/profile OS command-line
arguments were absent; these values are diagnostic only and do not replace
the original CDP/profile identity gates. This exact 404 result belongs only
to this attempt; it does not establish the HTTP result in attempts 1 or 2.
The actual hosted Windows PowerShell wire and exact-executable CIM synthetic
fixtures passed, recorded in `windows-harness-fixtures.json`.

Linux attempt 2 created the baseline history and completed its native download
at 09:15:29 UTC. The installed versionless AppImage's **entire file hash matched
the frozen target**, and both the original browser PID and launched baseline
process had exited. A new renderer with an owned private file URL was found,
CDP connected, and the browser PID query succeeded. It then failed at
`attach-profile-identity`, which still combined two strict requirements:
the browser's `/proc` environment must contain the expected private profile,
and its real executable must match the renderer's private AppImage runtime.
This report cannot distinguish those two subchecks.

The broader private extracted-executable scan found seven candidates without
the expected flags/environment. That scan excludes explicit Chromium
`--type` arguments but may include Node/other workers; it does **not** prove
seven genuine browser main processes or establish which candidate owns the
new CDP renderer. No process IDs, paths, command lines, environment values or
raw logs are saved. A proposed development-only refinement separates the
two checks and inspects only the actual CDP browser PID after exact executable
ownership proof; it is not evidence of a successful rerun.

Linux's target bytes were installed and a new CDP renderer existed, so this
result must not be described as simply “the target never started.” Equally,
live target identity, private-profile continuity, retained target history and
the four personal entries did not pass their gates. These failed attempts
produced no PNGs. Only the six passing macOS PNGs are available and have been
actually viewed; the planned ten successful-lane images were not achieved.
