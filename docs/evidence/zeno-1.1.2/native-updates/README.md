# Original 1.0.0 to 1.1.2 native update acceptance

These are real updater runs on disposable GitHub-hosted machines, using original
1.0.0 installers from release run `38883434626` and the frozen 1.1.2 target from
release run `39431901305` / tag `zeno-v1.1.2` / product commit
`46e5e38a5d7c4a147b0888d3a50e4788f045385e`. The initial development harness checkout was
`4e2adbb95c4a313555488bbdb11e920b30d0f678` and includes the shared server-registry
fixture. Later exact checkouts and their correction reasons are recorded with
each run in [dispatches.json](dispatches.json).

The two workflows were dispatched together only after explicit confirmation of
the complete website publication and independent confirmation that the public
release API served 1.1.2. No target application is launched by the harness and no
workflow is rerun without explicit approval. This directory is separate from the unchanged
1.1.1 failed receipts.

## Observed results

| Lane | Actual result | Evidence boundary |
| --- | --- | --- |
| Linux x64 | Native functional and Chinese screenshot pass in attempt 2 | Both original AppImage runs passed actual upgrade and history/registry/sidebar gates. Original screenshots retain missing-glyph boxes; attempt 2 added explicit CJK host prerequisites and its two actually viewed screenshots have readable Chinese. |
| Windows x64 | Native functional and Chinese screenshot pass in attempt 10 | On the identical checkout as attempt 9, all 60 Windows tests passed. Original saved V1/history, first full download without retry, automatic original NSIS restart, target ASAR/version/new browser, exact profile/realpath, both registries and historical data passed. Stable OS-owned allowed port 9224 matched the actual browser. Four actual sidebar clicks and both actually viewed screenshots passed. |
| macOS x64 | Native functional and screenshot pass | Real ZIP download and Squirrel install/automatic restart, original signatures and published ASAR, isolated profile, both registries, history, native Canvas/SVG/Ant Design Charts, and four actual sidebar clicks passed. All three screenshots were actually viewed and Chinese is readable. |
| macOS arm64 | Native functional and screenshot pass in attempt 4 | On `xcode-27`, the original package and signatures, real 444,118,404-byte public download, Squirrel installation, automatic restart, both registries, profile/history, native canvas and four actual sidebar clicks passed. All three screenshots were actually viewed with readable Chinese and no clipping. Earlier capacity cancellations and the stale preflight failure remain unchanged. |

The original Mac workflow's aggregate conclusion is failure because the ARM job
was not acquired; its Intel job independently passed. The explicitly authorized
ARM attempt 2 used the GA `macos-26` arm64 pool instead of `macos-15`. Linux
attempt 2 adds only CJK host prerequisites and a new-runner font inventory. Both
use the same immutable product builds and unchanged native acceptance gates.
The final ARM image candidate runs only that architecture, with the same original
builds and all native gates. Image qualification is not proof of an independent
pool or available capacity; its observed runner acquisition is recorded
separately. Attempt 3's raw workflow log is privately retained; its SHA and the
fixed selector mismatch are recorded in `attempt03-macos-arm64-preflight.json`.
It produced zero artifacts and no native report or PNG is fabricated. All
dispatched runs have ended. Both Mac architectures, Linux and Windows have passing
native functional and screenshot receipts within the scope described here. Native-defaults attempts 5 through
7 did not complete their intended V1 history setup. Attempt 8 verified the original
saved V1 setting and baseline history; the updated target history was not verified.
Attempt 10 verified original saved V1 and target history preservation. Original
default V2 history and earlier isolated Windows attempts remain separate acceptance boundaries.

Windows attempt 3 keeps the same original packages, process, profile, workspace
and historical chat. Its explicitly selected retry limit is 2 (default 0), with
fresh log windows admitting only a newly observed connection reset. Each retry
uses the original UI download bridge and restarts the whole download; it is not
range resume, cache seeding or a manual installation. The receipt records one
actual whole-file download, successful attempt 1, 100 percent, and no retry
request. Allowing retries did not exercise a retry in this run. See
`attempt03-download-trajectory.json` for the observed process facts and the
distinct unknown target-installation state.

Attempt 4 again succeeded on its first whole-file download without exercising a
retry. It verified the frozen target version and ASAR on disk, while the fixed
CDP port refused the connection (`ECONNREFUSED`, page-list shape still pending).
The owned-process listener probe succeeded and found no expected listening port.
Its same-executable count excludes only `--type` processes; a no-type
`ELECTRON_RUN_AS_NODE` helper can remain, so the candidate count does not prove a
new browser PID or target restart.
These facts are recorded in `attempt04-download-trajectory.json`; they do not
establish installation failure or loss of target process environment. The fixed
ASAR reader improves this new run's disk evidence without retrospectively
explaining attempt 3's unreadable diagnostic.

Attempt 5 explicitly selected `native-defaults`; its original report and artifact
use a new filename prefix. It stopped at `windows-native-pristine` with an
AssertionError before NSIS, V1 settings/history or app launch. The exact leaf or
registry condition was not recorded, so no cause is inferred and no existing
state is erased. Its 46/46 Windows tests include the five cases skipped on the
earlier macOS developer machine. The failed precondition is not evidence of a
product installation failure.

Attempt 6's fixed diagnostics establish a more precise result on its own
machine: Node accepted 17 native leaves, 8 shortcuts and 29 check-only leaves;
PowerShell rejected `known-folder-environment` with `known-folder-mismatch`,
`scope: process`, `variable: appdata`. The underlying mismatch cause and actual
values were not recorded. This does not prove a NODE_PATH issue or explain
attempt 5 retrospectively. Its 50 Windows tests all ran and passed without skips.


Attempt 7 corrects the reproduced JS-to-PowerShell separator-regex escaping
error while preserving the strict KnownFolder comparison and other guards.
All 52 Windows tests ran and passed, followed by successful Node and PowerShell
pristine checks. The original NSIS installed and registered in its exact native
default location without re-signing. The baseline browser PID, exact effective
profile and owned expected CDP listener were observed. Preparation then failed at
`baseline-native-v1-setting` with `errorKind: Error`; the last recorded HTTP
observation is `engine-activity: 200`. Neither the original receipt nor failed-step
workflow log records the underlying settings error, request method or settings
response. Saved V1 and historical chat were not verified. There was no updater
download, retry, target installation or target screenshot. These facts do not
establish an updater failure or retrospectively explain any earlier attempt.
See `attempt07-native-defaults-trajectory.json`.


Attempt 8 adds only fixed setting-step/completion flags and safe summaries of the
same existing activity request. Its 55 Windows tests all ran and passed. Both
pristine checks, the original default NSIS installation, fresh V2 setting,
selection/readback/saved V1 and idle check passed. One activity read reported V1
idle with zero busy sessions and zero waiting requests; V2 was null. The baseline
workspace, server registry, historical session and message were verified without
a model call. The first 390,804,422-byte whole-file public download completed in
335,966 ms without requesting or exercising any retry. The original baseline
exited and frozen 1.1.2 version/ASAR were verified on disk. The following target
CDP connection was refused (`ECONNREFUSED`, page-list shape pending), with no
expected owned listener or identified actual target browser. Target profile,
history and UI remain unverified. No screenshot was produced. These observations
do not retrospectively explain attempt 7's unknown setting failure or establish
target environment loss. See `attempt08-native-defaults-trajectory.json`.


Attempt 9 adds target-only native-defaults CDP discovery from unique stable OS
ownership in the source-defined allowed default range, while retaining the
shared timeout and all original target identity/history gates. All 60 Windows
preflight tests ran and passed, including the actual Windows-only cases. Both
pristine checks, original default NSIS installation and observed baseline browser,
effective profile and owned listener passed. The run then stopped earlier at
`runtime-workspace-ready`, with `lastReadError: TimeoutError` and last HTTP endpoint
`workspace-session-list` without a recorded status. No native V1-setting or target
connection facts were produced. Historical session creation, download and the new
target-only discovery were not reached, so this run cannot establish that
change's outcome or explain attempt 8 retrospectively. No screenshot was produced.
See `attempt09-native-defaults-trajectory.json`.


Attempt 10 is the explicitly authorized single fresh-host controlled repeat of
attempt 9 at the identical checkout. All 60 Windows tests ran and passed. Original
saved V1 and historical session/message preparation passed. Its first
390,804,422-byte whole-file public download completed in 331,521 ms without
requesting or exercising a retry. The original updater installed and automatically
launched frozen 1.1.2. The actual allowed port was 9224; stable OS ownership,
old-browser absence and actual browser PID matching the listener owner were
verified before completing all target gates. Published version/ASAR, new browser
PID, exact effective profile and realpath, profile marker, both workspace
registries, workspace file, historical session/message and saved V1 were retained.
Four actual sidebar clicks passed without renderer exceptions. Both original
screenshots were actually viewed with clear Chinese and complete layouts. This
establishes the native-defaults saved-V1 scenario; it does not explain earlier
unknown failure causes or accept default V2 history retrospectively. See
`attempt10-native-defaults-trajectory.json`.

Windows' failed checkpoint in the first two attempts is `update-download`. Its baseline process
remained running and the target was absent from disk; the effective baseline
profile check passed. This failure does not establish an NSIS install/relaunch
problem. No cause is inferred from missing command-line debug/profile arguments.
The two separate network diagnostics distinguish each receipt's AssertionError
from its captured private updater-log reset signal. The raw workflow logs do not
contain that literal reset code; their hashes are recorded without publishing
the logs or claiming hashes for unavailable private updater-log files.

The original Linux report did not run a font inventory, so its two original
missing-glyph screenshots remain unchanged and their old-host cause is not
retroactively asserted. The new runner's original font receipt records 0 Chinese
font families before installation and 15 afterward, with `fonts-noto-cjk` version
`1:20230817+repack1-3`; the Chinese glyphs in both new screenshots were actually
viewed and are readable. This inventory describes only the new machine.
The native functional result does not attest authenticated account
forms, credential storage, actual fitness media, or model execution; those are
separate acceptance surfaces.

## Receipt integrity

Each `*-artifact.json` records the GitHub artifact identity and digest, the
independently downloaded original ZIP SHA-256 and byte count, plus hashes of each
extracted file. Each native JSON and PNG is copied byte-for-byte from that ZIP;
they are never rewritten to change a verdict. Original ZIPs and raw workflow logs
remain private temporary operator files, outside the public source tree.

The authored [visual review](visual-review.json) records actual image inspection
and its limits. Passing a job or a digest alone is not visual acceptance.
