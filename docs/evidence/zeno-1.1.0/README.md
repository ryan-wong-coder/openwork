# Zeno 1.1.0 verification

This directory records the calendar, fitness, independent account/sync service,
mobile PWA and computer-local AI implementation. A passing fixture is not
evidence of an installed application, an OS keychain or a live deployment.

## Source verification

The independent OpenAPI and generated `ZenoClient` match the actual route and
shared Zod sources. The feature registry declares all four additions off;
the self-hosted distribution and private server profile explicitly enable them.
Den contracts and SDK were regenerated with `pnpm features:sync`.

| Check | Recorded result | Scope |
| --- | --- | --- |
| Shared calendar/contracts | 11 tests / 55 assertions | Timezone, recurrence, ICS, schemas, compiled CSP and real multipart media cases |
| Fitness | 240 tests / 2,605 assertions | Fixed upstream algorithms and native domain integration; see package verification |
| Account/data API | 25 tests / 1,110 assertions | Real disposable SQLite and HTTP dispatcher, synthetic users/media |
| Native account/tools | 31 tests | Production native modules, media names, synthetic transport and mocked encryption |
| Personal UI | 19 tests / 81 assertions | Sync/undo, actual React forms, account shutdown, signed-out recovery and workspace association |
| Local scheduler/thread recovery | 33 tests | Window/sleep gates, manual missed work, durable admission, scoped recovery |
| Packaging | 3 tests | Actual Electron 43.7.7 Node mode and synthetic ASAR; no window or OS keychain |
| Desktop build | Passed | Renderer, staged runtime, compiled server, syntax and 37-method bridge check |

No model keys, real account identities, private media, bearer credentials or
raw model responses belong in this directory.

## Separate acceptance records

- [PWA browser interaction](pwa-browser.md): production bundle, real disposable
  Bun API and an owned headless Chrome profile. The report lists exact checks,
  screenshots, CSP findings and limits.
- [Native V1/V2 AI](ai-personal-validation.md): actual isolated engines and
  bounded ModelHelm requests. This is separate from public account pairing.
- [Live HTTPS API](live-https-api.json): dedicated synthetic accounts against
  the deployed service; secure cookies, invite-only registration, PKCE,
  isolation, private media, conflicts, reset and revocation.
- [Real OS storage](os-safe-storage/README.md): hosted macOS x64/ARM64, Windows
  x64 and Linux x64 with genuine Keychain/DPAPI/libsecret and two processes.
- [Live service deployment](live-service-deployment.json): actual unprivileged
  service, private SQLite/media backup restoration and a separately scoped
  matching-policy kernel network probe.
- [Final deployed code](live-final-deployment.json): tag-matching API/PWA
  hashes and a fresh private restoration after the final HTTPS acceptance.
- [Post-acceptance cleanup](server-post-acceptance-cleanup.json): only the
  owned synthetic accounts/media and disposable candidate service were removed;
  the production service, administrator and a fresh backup remain available.
- [First build attempt](build-attempt-1.json) and [second build attempt](build-attempt-2.json):
  both were unpublished. The first reached Node's default heap limit; the second
  built packages but the required ASAR license gate rejected them. The original
  `zeno-v1.1.0` tag remains fixed. The corrected source uses
  `zeno-v1.1.0-build.3`, while the application/update version remains `1.1.0`.
  A new regression uses the pinned builder's actual matcher, collector and
  `AsarPackager` in a separate Node process, then compares all five archived
  texts byte for byte. Missing/empty inputs fail before packaging.
- [Third attempt](build-attempt-3.json): a session-runner fixture failed and
  remained alive, so the run was cancelled before any installer build. The
  separate [fixture regression](session-runner-fixture-regression.json) records
  the reproduced temporary-directory cleanup race, stronger durable-outbox
  checks and test-only repair. This maintenance does not change the frozen
  `c6d0f3f4` installer source; the next run uses the full unchanged product
  checks with a bounded CI preflight.
- Real OS storage, six target installers, public website/PWA and original
  1.0.0 updates are separate release gates. Do not infer their result from the
  source checks above; their reports are added when those runs finish.

UI review follows `DESIGN.md` P1/P2/P3/P5/P8/P10/P11 and S1/S2/S6: progressive
disclosure, native controls, clear actual state, keyboard access, restrained
copy, coherent spacing and separate mobile layouts. Screenshots in this
directory use synthetic data only.
