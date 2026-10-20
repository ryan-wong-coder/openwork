Windows / Linux original-package update validation
=================================================

`.github/workflows/zeno-update-portable-smoke.yml` adds two hosted x64 lanes to
the separate existing macOS update workflow. Dispatch it on `personal` only
after the checked-out target has completed `Release Zeno` and its public website
feeds are active. `baseline_run_id` defaults to the original 1.0.0 run
`38883434626`; `target_run_id` must identify the successful target build.
`windows_download_retries` defaults to `0`. Explicit `1` or `2` allows at most
that many additional Windows download attempts; Linux-only dispatch rejects a
nonzero value. The existing 75-minute job limit remains unchanged.
`windows_profile_mode` defaults to `isolated`. The optional `native-defaults`
choice requires an explicit Windows-only dispatch (`platform=win32`); both and
Linux reject that choice. It uses the same installers and all existing upgrade
gates. A local test pass does not prove that either native scenario passes.

The harness refuses developer machines, self-hosted runners, another branch,
another CPU, and artifact paths outside `RUNNER_TEMP`. Its local tests launch no
application:

```sh
node --test apps/desktop/test/zeno-update-portable-smoke.test.mjs
node --check apps/desktop/scripts/zeno-update-portable-smoke.mjs
```

Both original installers are pinned by size, SHA-256 and SHA-512: the baseline
to the public historical GitHub release index, the target to the live official
website API and native feed. Target resources are extracted only to obtain a
reference ASAR hash. Extracting those resources does not count as an upgrade.

The default isolated Windows mode silently installs the unchanged baseline NSIS into a private directory.
The native updater subsequently downloads the real public target EXE, invokes
NSIS, and automatically starts the updated installation. Because NSIS uses
`ExecShellAsUser`, non-secret isolated paths and the CDP port are also published
to this disposable hosted login's user environment, broadcast to Explorer and
restored afterwards. Existing OpenWork/Zeno installation registrations are
refused. No application identity, signature or updater setting is patched.

The optional native-defaults mode starts the original 1.0.0 installer with `/S`
and no `/D`. Its expected per-user installation leaf is computed from the two
original statically extracted ASAR package names, public distribution identity
and actual top-level payload executable names using the pinned electron-builder
26.15.3 NSIS/sanitize-filename rule. Both package identities must agree. The
updater cache leaf is read from each original `app-update.yml`, validated as a
single safe Windows filename, checked against the same pinned identity rule and
required to agree. No copied state, seed file, junction, resigned binary or
target launch is used. The 7-Zip Unicode payload listing uses `-sccUTF-8`;
PowerShell paths travel only as ASCII Base64 containing UTF-8 JSON.

This mode reads the actual Windows user SID and Known Folders, including
`FOLDERID_UserProgramFiles`. `KF_FLAG_DONT_VERIFY` reads that path without
creating it. Redirected home/AppData/UserProgramFiles layouts are outside this
strict fixture: they fail before installation. Process, User and Machine
environment scopes must have no pre-existing storage/engine overrides or
provider credentials covered by the prerequisite check. No User/Machine
environment is written. Child OS paths and native temporary directories are
retained, while fixture variables and authentication tokens are stripped.
Ambient APPDATA, LOCALAPPDATA and ProgramData must agree with their actual
Known Folders; explicit conflicting values in any of those three environment
scopes are refused instead of sending the baseline outside the ledger.
Process ProgramData must be nonempty: the original managed loader otherwise
falls back to C:/ProgramData, which must not silently differ from a Known Folder.

Before installation the ownership ledger requires these exact leaves absent,
including their link/reparse checks (H=user home, R=Roaming, L=Local AppData):

* Native UserProgramFiles/package leaf, `R/com.differentai.openwork`, and
  `L/<actual updaterCacheDirName>`.
* `R/openwork` (server configuration, runtime SQLite, tokens, env and saved
  engine setting), `L/openwork` (bootstrap), and legacy `H/.config/openwork`.
* `H/.config/opencode`, the engine's home `H/.opencode` configuration directory,
  `H/.local/share/opencode`, `R/opencode`, `L/opencode`,
  `H/.cache/opencode`, `H/.local/state/opencode`, native TEMP/opencode.
* `H/.openwork/openwork-server`, legacy `H/.openwork/openwork-orchestrator`, and
  the real first-launch `H/OpenWork Chat` directory.

Additional read-only configuration checks do not grant deletion/ownership:
the original V1 managed loader reads CommonApplicationData/opencode/opencode.json
and opencode.jsonc. Those two exact files must be absent, and their ancestry
must have no reparse points; CommonApplicationData itself is never owned or
removed. `OPENCODE_TEST_MANAGED_CONFIG_DIR` is already refused by the scoped
OPENCODE prefix check. The original V2 discovery also reads H/.claude, H/.agents
and exact .opencode/.claude/.agents/opencode.json(c) entries along the private
workspace's bounded ancestor chain. These check-only entries must be absent;
they are never read, modified or deleted by the fixture.

Exact OpenWork/Zeno Start Menu/Desktop shortcut leaves and protocol/application
registrations must also be absent. HKCU/HKLM, both 32/64-bit registry views,
are checked for the original APP_GUID, uninstall identity, public app ID,
`openwork` protocol and executable associations. Existing installations are
also refused by the original registration gate. After baseline installation,
its real HKCU InstallLocation must equal the verified default leaf. These are
account/Known Folder/pristine ownership checks, not an assertion that every
Windows ACL owner is the current SID. Native files and registrations remain
for disposal of the entire hosted VM on success or failure; HOME and AppData
are never recursively removed.

All original production CDP candidates 9223–9227 must be free before installing
and immediately before launching the baseline. The native baseline uses the
original first choice 9223. Only the automatic native-defaults target may use
another port in the product's original 9223–9227 range: the original shared
180-second page-read window first requires the old PID absent and exactly one
stable new installed-EXE PID/creation-time/127.0.0.1 listener tuple. No owned
listener means wait; multiple tuples fail closed before HTTP. Exact duplicate
rows are one tuple. Unknown OS reads cannot admit a connection. Both debugger
WebSockets must stay on that confirmed host and port; OS identity and listener
ownership are checked again before connection and after SystemInfo, whose
actual browser PID must equal the OS owner. There is no port environment
override or manual target start. Isolated Windows, Linux and the baseline keep
their fixed-port behavior. The actual CDP SystemInfo browser PID, exact original installed EXE, file resources,
original read-only IPC userData and the profile's realpath must all agree;
the automatic target must have a different actual browser PID. A same-EXE
process candidate or listener diagnostic is never restart/profile proof.

True zero-state startup selects V2. This fixture observes that original setting,
then uses the original authenticated `PUT /experimental/engine-v2-preview` to
select `{chatRouting:false,enabled:false}` before writing any history. It reads
the real status, persisted default engine-state file and idle activity before
creating the V1 no-reply conversation. The existing V1 mounted readiness reads
before that selection perform no model request or history mutation. After the
upgrade the target only verifies the same saved choice; it never reapplies it.
The report explicitly identifies historical V1, original settings selection
and default-path/profile preservation. It does not claim default V2 history,
account pairing or provider/credential-storage acceptance.

Earlier isolated failures remain unchanged. A refused expected port and known
installed target bytes do not establish the target process environment, its
profile, when NSIS completed or the actual browser's startup age. This second
scenario does not retroactively resolve those unknowns or extend a timeout.

Native target connection reports retain only the discovery source, prior
expected and actual allowed ports, and a sanitized last OS observation. The
observation contains five port-presence/owned-listener booleans and at most 16
same-EXE process role/age/session summaries. Roles name only known script-entry
arguments or Electron-child markers; an unclassified process is not a browser
proof. Ages cap at 86400 seconds. PIDs, exact creation times, executable paths,
command lines and environment values are never reported. Attempt 08 remains
unresolved by these source-based changes; no prior port switch is inferred.

Native prerequisite diagnostics are recorded before either guard is asserted.
`nativeDefaultsPrerequisites.node` and `.powershell` retain only fixed enums,
booleans and bounded numeric indices/counts. A failed Node filesystem walk
identifies `owned-leaf`, `shortcut` or `check-only`, a zero-based array index,
ancestor depth, and `existing-state`, `reparse` or `api-error`. The original
ordered ledgers above define those indices; no path is printed. ENOENT remains
the only filesystem error that permits continuing.

PowerShell additionally classifies scoped environment by process/user/machine
and a fixed variable class (for example `node-path` or `openwork-prefix`), known
folder mismatches, matching application-process counts, and registry hive/view
plus a fixed key kind. Unknown API failures retain the current fixed check with
`api-error`; a missing/invalid command response remains an unknown failed read.
Private values, unknown variable names, paths, error text and registry contents
are never retained. PowerShell transports a structured failed verdict instead
of losing it in a command exception; the harness records it and then strictly
asserts success. Incomplete, malformed or contradictory success records fail
closed. None of these classifications ignore a prerequisite or clean state.
The original native-defaults attempt 05 had no such classified receipt and
cannot be attributed retrospectively to one of these categories.

Known-folder regression coverage reads the predicate from the generated
PowerShell, rather than testing a second handwritten expression. It accepts
native drive paths with backslashes as well as forward slashes; the Windows
test executes that actual predicate with synthetic Unicode paths, case and
dot-segment normalization, and rejects different roots, relative paths,
drive-relative paths and UNC paths. The template escapes both JavaScript and
the emitted regular expression. No live environment value is printed or
changed by these tests.

The native V1 setting check retains separate baseline/target receipts with a
fixed substep and completion booleans for the original fresh V2 observation,
V1 selection response, status, saved setting and idle verification. Each
activity read is summarized before the original idle predicate: only object
shape, `idle`/`busy`/`unknown`/`invalid` verdicts, and known nonnegative counts
are retained. Counts and read totals cap at 512 with an explicit capped flag;
unreadable counts stay unknown. Read failures retain only the fixed error
class/code allowlist and the existing last HTTP endpoint/status, never a
response body, path, credential or raw error. The idle predicate and original
30-second deadline are unchanged. Earlier attempt 07 did not contain these
receipts, so its `engine-activity` HTTP 200 does not prove an idle verdict or
identify the underlying engine condition.

An opted-in retry uses the original 1.0.0 UI bridge's existing `download` action
in the same verified baseline process, Chromium profile and historical session.
It does not run `check` again, restart the baseline, seed the updater cache,
manually install the target, or launch the target. The pinned updater removes
failed temporary downloads, so each attempt downloads the complete file from
zero; this is not resume support. Before each additional attempt the harness
rechecks the actual browser PID, baseline version, effective profile, workspace
and original stored conversation.

Retry admission requires a new actual connection-reset error header in the
complete appended byte windows of both owned stdout/stderr logs. The harness
captures each file's identity, offset and preceding bytes before each download;
it rejects missing, replaced, truncated, oversized, incomplete or unreadable
windows, other error codes, integrity/TLS/HTTP/cancellation failures and unknown
error messages. It waits only 500 ms for log flushing. Cumulative diagnostic
tails never authorize a retry, so an older reset cannot admit a newer failure.
The original bridge swallows the underlying error code; this strict private-log
check does not change the original application. A reset alone does not identify
which server, client or transport component caused it.

Linux starts the unchanged baseline AppImage from a private versionless path.
The AppImage runtime's documented `APPIMAGE_EXTRACT_AND_RUN=1` mode keeps FUSE
out of the hosted-VM requirement; its private `TMPDIR` survives automatic
relaunch. The actual AppImageUpdater still must replace the original executable,
and the application's own relaunch must create the target process. See the
[AppImage runtime documentation](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#extract-and-run-type-2-appimages).
The hosted Ubuntu AppArmor restriction on unprivileged user namespaces is
disabled only in the disposable VM, so Electron can retain its sandbox. The
harness supplies no `--no-sandbox` switch.

Passing requires the original process to exit naturally and a different browser
PID to appear without any harness target launch. It then checks the installed
target version and frozen ASAR hash; Linux additionally checks the full replaced
AppImage hash. Chromium localStorage, the workspace ID/registry and file,
embedded server, original conversation ID/title and stored no-reply message
must survive. No model is called. New 1.1.0 account pairing, OS credential
storage, ARM64 Windows/Linux, Debian package upgrades and system-wide network
isolation are outside this test's scope.

Only `report.json`, synthetic updated-app/navigation screenshots and the Linux
font-prerequisite inventory are uploaded. Raw
logs, profiles, runtime authorization and private paths remain on the disposable
runner. Failure diagnostics contain bounded allowlisted error classifications
and numeric transfer progress. Every download attempt retains its own fixed
reason/signal, numeric progress, timestamps and retry-request flag. A passed
report identifies which complete download attempt succeeded; its earlier failed
attempts remain failures. Installation, automatic relaunch, frozen-code identity
and historical-data checks must still all pass. Separate workflow reruns retain
separate evidence rather than replacing an earlier report.
