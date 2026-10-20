# Zeno 1.1.0 verification

This directory records the calendar, fitness, independent account/sync service,
mobile PWA and computer-local AI implementation. A passing fixture is not
evidence of an installed application, an OS keychain or a live deployment.

The `c6d0f3f4` installer candidate has a confirmed desktop personal-navigation
regression: workspace normalization sends all four personal entries back to
the empty chat. Its public latest feed was rolled back to 1.0.5 on
2026-10-20 at 06:58 UTC while 1.1.1 is verified. Versioned files remain intact;
installed clients are not downgraded. The passing checks below retain their
stated scope and do not constitute final acceptance of this candidate.

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
- [Final deployed code](live-final-deployment.json): API/PWA hashes from
  `15a286a5` and a fresh private restoration after the final HTTPS acceptance.
  The final `c6d0f3f4` installer tag changes packaging; its API, PWA, core and
  feature inputs have an empty source diff against that deployed revision.
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
  `c6d0f3f4` installer source. The successful final run uses the unchanged
  product checks with a bounded CI preflight.
- [Six native build lanes](build-native-audit.json): run `39373868155`
  completed successfully, including the 74/74 native preflight. Each matching
  CPU ran its packaged Electron Node smoke, loaded personal modules and
  checked required archived license texts. This is separate from installed
  GUI, genuine OS storage and automatic update evidence.
- [Release metadata](release-metadata-audit.json): all 24 GitHub upload
  names, sizes and SHA-256 digests agree with the frozen six-lane index.
  This audit independently downloaded only eight small documents (14,530
  bytes), checked six YAML feeds and compared release notes. Full installer
  byte verification belongs to the separate distribution gate.
- [Source provenance](release-source-provenance.json): the installer remains
  frozen at `c6d0f3f4`; API/PWA business code and built bytes remain at `15a286a5`.
  The later [manifest MIME correction](manifest-mime-fix.json) is an independent
  Nginx deployment configuration change, with no PWA or installer byte change.
- [Complete distribution integrity](distribution-integrity.json): all 24
  assets (3,948,721,956 bytes) were transferred and fully hashed on the server
  against the independently frozen GitHub asset metadata.
- [Atomic website publication](publication-gate.json): all 22 indexed files
  passed full SHA-256/SHA-512 verification before switching the release feed.
  The 80 historical files retained their metadata and passed edge sampling
  plus public HEAD/Range checks; this is not a full historical-file rehash.
- [Live downloads and update feeds](live-release.json): all ten installer
  choices and six native feeds advertise 1.1.0 with working public paths.
- [Public website/PWA](public-site-pwa/README.md): actual anonymous HTTPS and
  headless desktop/mobile browser checks, four screenshots, and zero observed
  CSP, runtime or external-request failures. The first manifest MIME failure
  and the successful unchanged strict recheck are both retained.
- Original 1.0.0 installed GUI updates remain a separate release gate; the
  final GitHub release remains a draft until those checks complete.

UI review follows `DESIGN.md` P1/P2/P3/P5/P8/P10/P11 and S1/S2/S6: progressive
disclosure, native controls, clear actual state, keyboard access, restrained
copy, coherent spacing and separate mobile layouts. Screenshots in this
directory use synthetic data only.
