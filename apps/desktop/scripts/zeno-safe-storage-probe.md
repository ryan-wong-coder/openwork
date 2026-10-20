Real OS credential integration scope
====================================

`zeno-safe-storage-smoke.yml` runs the current `createZenoPersonalService` source
in the lockfile's actual Electron version on fresh hosted macOS x64/ARM64,
Windows x64 and Linux x64. It creates no BrowserWindow and installs no production
application. Developer and self-hosted execution are refused by both the Node
launcher and the Electron main entry.

The two normal Electron main processes share one temporary userData directory.
The first authorizes a synthetic device through an injected in-memory HTTPS-URL
transport and writes `device.bin` with actual OS safeStorage. Both processes
verify that the ciphertext contains none of its plaintext credential markers,
that the unchanged production service can reload it, and that stale account,
device or generation bindings are rejected before dispatch. The second process
decrypts the persisted credential after a real process boundary, then proves
that disconnect requests revocation and removes the file. No actual account,
server, browser authorization or model is contacted.

The synchronous Electron API uses macOS Keychain and Windows DPAPI. Linux runs
GNOME Keyring on a private D-Bus session with temporary XDG directories and an
explicit `gnome-libsecret` backend. `basic_text`, `unknown` and unavailable
encryption fail the integration test. The public synthetic keyring password
unlocks only that disposable CI keyring. See the
[official Electron safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage).

Only the sanitized JSON report is retained. It contains fixed booleans, the OS
backend, platform/CPU and runtime versions. Native stdout/stderr are discarded;
private userData, synthetic ciphertext and the Linux keyring directory are
removed. The test does not establish production app signing/Keychain identity
continuity, real account pairing, Windows ACL security, or protection against
another process owned by the same logged-in Windows user.

Local checks must remain headless Node checks:

```sh
node --check apps/desktop/scripts/zeno-safe-storage-probe.mjs
node --test apps/desktop/test/zeno-safe-storage-probe.test.mjs
```

The unit tests include an unavailable/basic_text fixture to prove the production
service fails closed. They deliberately do not execute real OS safeStorage on a
developer machine. Only the hosted workflow provides that integration evidence.
