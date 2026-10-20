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
automatic retries are performed. This directory is separate from the unchanged
1.1.1 failed receipts.

## Observed results

| Lane | Actual result | Evidence boundary |
| --- | --- | --- |
| Linux x64 | Native functional and Chinese screenshot pass in attempt 2 | Both original AppImage runs passed actual upgrade and history/registry/sidebar gates. Original screenshots retain missing-glyph boxes; attempt 2 added explicit CJK host prerequisites and its two actually viewed screenshots have readable Chinese. |
| Windows x64 | Both attempts failed during real public download | Original NSIS and baseline history preparation passed. Downloads stopped at 217,137,098 bytes (55.56%) and 346,062,812 bytes (88.55%) of 390,804,422. Both sanitized updater-log scans contain `ERR_CONNECTION_RESET`. Neither attempt installed or relaunched the target; no target UI screenshot exists. |
| macOS x64 | Native functional and screenshot pass | Real ZIP download and Squirrel install/automatic restart, original signatures and published ASAR, isolated profile, both registries, history, native Canvas/SVG/Ant Design Charts, and four actual sidebar clicks passed. All three screenshots were actually viewed and Chinese is readable. |
| macOS arm64 | Both hosted runner acquisition attempts cancelled before execution | GitHub reports hosted capacity constraints in the `macos-15` and `macos-26` pools; neither assigned a runner or ran any steps. No native update verdict exists. Both original annotation responses and their digests are retained separately. |

The original Mac workflow's aggregate conclusion is failure because the ARM job
was not acquired; its Intel job independently passed. The explicitly authorized
ARM attempt 2 used the GA `macos-26` arm64 pool instead of `macos-15`. Linux
attempt 2 adds only CJK host prerequisites and a new-runner font inventory. Both
use the same immutable product builds and unchanged native acceptance gates.
All dispatched runs have ended. The four-lane acceptance is incomplete because
Windows has not reached target installation and ARM has not run on a native host.

Windows' failed checkpoint in both attempts is `update-download`. Its baseline process
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
