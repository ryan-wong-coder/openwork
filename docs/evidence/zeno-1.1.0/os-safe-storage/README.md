# Real OS safeStorage integration

[Hosted run 39367162500](https://github.com/ryan-wong-coder/openwork/actions/runs/39367162500)
passed all four native lanes on source commit
`c775b85bf3d91ae36cd882984625fda2d4213c47` on 2026-10-20. The downloaded
artifact reports were independently checked against the fixed report allowlist,
expected backend, runtime versions, all applicable checks and cleanup result.

| Native lane | Actual OS backend | Report |
| --- | --- | --- |
| macOS x64 | Keychain | [darwin-x64.json](darwin-x64.json) |
| macOS ARM64 | Keychain | [darwin-arm64.json](darwin-arm64.json) |
| Windows x64 | DPAPI | [win32-x64.json](win32-x64.json) |
| Linux x64 | GNOME libsecret | [linux-x64.json](linux-x64.json) |

Each lane used Electron 43.7.7, Node 24.21.0 and Chromium 150.0.7871.250.
Two normal Electron main processes created no BrowserWindow. The current native
service wrote a synthetic credential with actual OS encryption, proved that
`device.bin` contained no plaintext credential markers, reloaded it within the
first process and after a real process restart, rejected stale account/device/
generation bindings before dispatch, then revoked the synthetic device through
an injected transport and removed its credential file. Temporary files were
removed. Linux used a private D-Bus/keyring session and refused plaintext or
unknown storage; Windows POSIX mode checks are explicitly inapplicable.

This proves current-source service integration with the real OS backend. It
does not prove production signed-app/Keychain identity continuity across an
upgrade, real website account pairing, Windows ACL protection or mobile storage.
No real account, model request, user credential, raw native log or private path
was used or retained. The synthetic HTTPS-URL transport made no network request.

| Report | Original artifact JSON SHA-256 |
| --- | --- |
| darwin-x64 | `1fec2944ce53b4c9f8601de473f1cf93b995563bb69c2c4271a3742de3f5a010` |
| darwin-arm64 | `0095936d83ad2bfe5efbdf405c1fbc8337a8cd8dc86bfdcabbe17455b926fbde` |
| win32-x64 | `d8bdd8496c4dba20aa39660985e8b1f4725989e88f8a9673caf060c1fcf27298` |
| linux-x64 | `3192467abef37477049179ba7addb4d95c06e23a88a3286655f9d14dd64723a9` |
