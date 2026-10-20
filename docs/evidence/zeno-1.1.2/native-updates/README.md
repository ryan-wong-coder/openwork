# Original 1.0.0 to 1.1.2 native update acceptance

These are real updater runs on disposable GitHub-hosted machines, using original
1.0.0 installers from release run `38883434626` and the frozen 1.1.2 target from
release run `39431901305` / tag `zeno-v1.1.2` / product commit
`46e5e38a5d7c4a147b0888d3a50e4788f045385e`. The development harness checkout is
`4e2adbb95c4a313555488bbdb11e920b30d0f678` and includes the shared server-registry
fixture. See [dispatches.json](dispatches.json) for run and job identities.

The two workflows were dispatched together only after explicit confirmation of
the complete website publication and independent confirmation that the public
release API served 1.1.2. No target application is launched by the harness and no
workflow is rerun without explicit approval. This directory is separate from the unchanged
1.1.1 failed receipts.

## Observed results

| Lane | Actual result | Evidence boundary |
| --- | --- | --- |
| Linux x64 | Native functional and Chinese screenshot pass in attempt 2 | Both original AppImage runs passed actual upgrade and history/registry/sidebar gates. Original screenshots retain missing-glyph boxes; attempt 2 added explicit CJK host prerequisites and its two actually viewed screenshots have readable Chinese. |
| Windows x64 | Attempt 3 downloaded fully, then failed target attachment | Attempts 1 and 2 stopped during public download with reset signals. In attempt 3, the first whole-file download completed all 390,804,422 bytes without retry; the old baseline then exited, but the fixed CDP page-list gate failed. Target disk metadata could not be read, so target installation/restart identity is unverified. No target screenshot exists. |
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
It produced zero artifacts and no native report or PNG is fabricated. Four-lane
All dispatched runs have ended. Mac both architectures and Linux have passing
native receipts; four-lane acceptance remains incomplete because Windows target
attachment has not passed.

Windows attempt 3 keeps the same original packages, process, profile, workspace
and historical chat. Its explicitly selected retry limit is 2 (default 0), with
fresh log windows admitting only a newly observed connection reset. Each retry
uses the original UI download bridge and restarts the whole download; it is not
range resume, cache seeding or a manual installation. The receipt records one
actual whole-file download, successful attempt 1, 100 percent, and no retry
request. Allowing retries did not exercise a retry in this run. See
`attempt03-download-trajectory.json` for the observed process facts and the
distinct unknown target-installation state.

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
