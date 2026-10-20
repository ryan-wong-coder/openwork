# Native upgrade fixture preparation

This is a source review and local harness regression result, not a new native
upgrade verdict. No hosted run was dispatched and no updater product code changed.
The original Windows/Linux failure JSON and artifact bytes remain untouched under
`../zeno-1.1.1/native-updates/`.

## Readiness read

The fixture now reads the workspace-scoped `GET /session` list before its single
session creation. The original `1.0.0` source commit
`92688046400df5d1e2807d63dce986431bc7623a` already uses that route in
`apps/server/src/opencode-plugins/openwork-extensions-preview.ts:714` and parses
it as an array. The installed SDK declares the response as `Array<Session>`.
The harness requires an array whose entries have nonempty string identities;
HTTP 200 with an error object does not admit the workspace.

The previous 404 at `/session/status` does not establish its cause. The original
SDK and server also refer to that path, so it is not evidence by itself that the
old engine lacks the route. The list read proves the workspace's actual business
read contract rather than relying on global host health. It keeps the same
120-second readiness window. Session and message writes are still single-shot.

## Server workspace registry

Source review of the same original `1.0.0` commit confirms two separate state
surfaces. `workspaceCreate` in `apps/desktop/electron/main.mjs:1825` calls only
the Electron workspace store. `engineStart` can return an already running server
at `apps/desktop/electron/runtime.mjs:2117`; when starting a server with an
existing config, `seedWorkspacePathsForEmbeddedServer` omits the legacy list.
Creating the Electron entry therefore does not prove that the runtime registry
contains it. This is a concrete fixture risk; the old 404 receipts do not contain
enough private response detail to attribute their failures conclusively.

The fixture now follows the original app's own server API flow. It reads
`GET /workspaces`, requires exactly one matching absolute local folder and uses
that record's actual ID to build the engine mount. Only the baseline may register
a missing folder, using exactly one `POST /workspaces/local` with the real host
credential and requiring HTTP 201, `persisted: true` and a successful readback.
That mutation is outside every retry loop. A failed or unknown registration is
never retried. The overall preparation still shares one 120-second deadline.

After automatic upgrade, registration is prohibited: the registry must retain
the same server ID/path, alongside the existing Electron legacy ID/path and all
conversation/file markers. A missing record fails rather than being repaired.
No server database or config file is edited by the harness. Registry bodies can
contain engine credentials, so only private ID/path pairs are retained in memory;
evidence contains fixed status categories and successful-check booleans.

The original source implements this API in
`apps/server/src/routes/core.ts` and `apps/server/src/routes/workspaces.ts`.
`apps/app/src/app/lib/openwork-server.ts` forwards both client and host credentials
for its own `createLocalWorkspace` operation.

## Shared Mac and portable preparation

Both launchers now import `zeno-update-runtime-fixture.mjs`, a standalone helper
that uses only the Node standard library. It does not import either launcher or
start a native process; the portable launcher's existing Mac utility imports do
not create a circular dependency. The Mac baseline uses the same actual server
registry read and one-time host registration, then the upgraded Mac app must
retain that exact server ID/path and mount with no replacement registration.
The legacy Electron workspace ID/path and all historical markers remain separate
required checks. New registry assertions use fixed messages rather than
serializing expected or actual private identity values.

Mac signature verification, published installer and ASAR integrity, Squirrel
installation, automatic restart, new process identity, existing isolated-profile
guards, native canvas verification and four actual sidebar clicks are unchanged.
The Mac workflow's existing `--self-test` also runs the four shared HTTP contract
fixtures. It does not launch Electron or constitute native upgrade acceptance.

## Effective native profile

The original `1.0.0` main source has `getOpenworkUiMcpEnvironment` at line 1908,
returning `OPENWORK_UI_CONTROL_DISCOVERY` directly from
`path.join(app.getPath("userData"), "openwork-ui-control.json")`. The original
preload's `invokeDesktop` at line 159 forwards that existing handler.

After the actual browser PID's private executable is verified, the harness now
calls this read-only IPC and requires the entire returned discovery path to equal
the expected isolated profile path. It does not invoke a reset, change an
environment variable, start a shell, or install a tool. This checks the live
Electron directory directly on both Windows and Linux. Linux `/proc` environment
checks remain available as post-failure diagnostic booleans, instead of serving
as a proxy for the actual Electron directory.

The new precise browser-PID diagnostics distinguish that connected browser from
other processes sharing the private executable. They expose only fixed booleans,
including whether the effective profile matched; no PID, path, command line,
environment value or discovery payload is serialized. Private executable
ownership, immutable installer and ASAR hashes, automatic new-PID restart,
random Chromium marker, workspace identity/file, historical session/message and
actual sidebar clicks all remain required. The target still must be installed
and relaunched by the updater, without a target launch from the harness.

## Local checks

`node --test apps/desktop/test/zeno-update-portable-smoke.test.mjs` passed 21 tests;
the two real Windows PowerShell cases were correctly skipped on macOS. The
readiness fixture covers a failed read, a malformed successful response, a real
empty list, zero `/session/status` requests and exactly one failed POST. The
profile fixture rejects wrong filenames, another directory, environment-only
claims, missing/malformed results and an unavailable bridge. Registry checks cover
baseline creation/readback, unchanged target identity, lost target records,
duplicate paths, a failed or unpersisted single registration, and missing host
credentials. Target validation cannot enable baseline registration. Syntax and
`git diff --check` passed. No desktop window was opened. The standalone shared
HTTP contract suite passed all four tests, and the Mac smoke self-test passed.

The next native acceptance must use the built and published `1.1.2` target.
The current checkout version must not be used to test an older `1.1.1` target.
