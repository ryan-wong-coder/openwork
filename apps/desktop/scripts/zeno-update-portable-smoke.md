Windows / Linux original-package update validation
=================================================

`.github/workflows/zeno-update-portable-smoke.yml` adds two hosted x64 lanes to
the separate existing macOS update workflow. Dispatch it on `personal` only
after the checked-out target has completed `Release Zeno` and its public website
feeds are active. `baseline_run_id` defaults to the original 1.0.0 run
`38883434626`; `target_run_id` must identify the successful target build.

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

Windows silently installs the unchanged baseline NSIS into a private directory.
The native updater subsequently downloads the real public target EXE, invokes
NSIS, and automatically starts the updated installation. Because NSIS uses
`ExecShellAsUser`, non-secret isolated paths and the CDP port are also published
to this disposable hosted login's user environment, broadcast to Explorer and
restored afterwards. Existing OpenWork/Zeno installation registrations are
refused. No application identity, signature or updater setting is patched.

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

Only `report.json` and the updated synthetic app screenshot are uploaded. Raw
logs, profiles, runtime authorization and private paths remain on the disposable
runner. Failure diagnostics contain bounded allowlisted error classifications
and numeric transfer progress. A failure remains a failed attempt; retry evidence
must be retained separately rather than replacing the first report.
