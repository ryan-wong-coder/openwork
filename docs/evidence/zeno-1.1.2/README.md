# Zeno 1.1.2 verification

The current set covers 32 exact mainstream exercises with 32 posters and 32 videos:
30 generated mascot demonstrations and two original SVG diagram videos labelled
“动作图解”. Eleven original interactive vector scenes remain available. Custom
media keeps priority, matching variants stay distinct, and active workouts open
the same detail. Completed demonstrations appear first within matching results.

- [Prompts and provenance](../../../apps/app/art-source/fitness/README.md) preserve
  exact identities, equipment, all 64 hashes, actual generation records and rejected
  attempts. No restricted upstream visual media was used.
- [Browser acceptance](mainstream/browser/browser-report.json) passed 15 checks
  against the actual production PWA and a disposable real local API. All 12
  screenshots were viewed, covering desktop/mobile themes, video-only and diagram
  details, playback, reduced motion, background pause and unchanged workout data.
- [Independent review](mainstream/source-review.json) checked all 64 complete media
  hashes, mapping/custom boundaries and ten other-batch final contact sheets.
- [Source and build checks](mainstream/source-verification.json) cover type checks,
  semantic regressions and all 64 media bytes in both actual production builds.
  Installer packaging separately rejects missing, modified or unexpected media.
- [Live deployment](mainstream/deployment.json) atomically published all 167 PWA
  source files at `46e5e38a5`, retaining ten earlier hashed assets and the previous
  directory. The API, account data, private media, landing page and native feeds
  were untouched.
- [Public media acceptance](mainstream/public-media/README.md) independently read
  all 64 complete assets, checked 32 real Range responses, and actually decoded,
  played and paused all 32 public videos in a fresh anonymous headless browser.

The second-tab device-approval correction is included; real public approval,
PKCE/device binding and exact synthetic cleanup are recorded under
[the approval evidence](../zeno-1.1.1/device-approval/README.md). The route fix also
remains included. The earlier three-video phase under `fitness-visuals/` and
`../zeno-fitness-visuals/` remains historical evidence, not current coverage.

The immutable tag `zeno-v1.1.2` points to
`46e5e38a5d7c4a147b0888d3a50e4788f045385e`; six-target build `39431901305`
completed successfully from that source. [Independent release metadata](release-metadata/README.md)
links the six actual runtime/media receipts and the complete manifest audit.
[Website distribution](distribution/README.md) passed complete byte verification
and activated 1.1.2 for all six targets while preserving historical downloads.
The [real website acceptance](site-downloads-attempt02/README.md) passed 14
checks; all eleven successful screenshots were viewed. Its earlier selector
failure remains preserved separately.
The [native receipts](native-updates/README.md) distinguish actual upgrade
successes, download connection resets and hosted-runner capacity cancellations.
Actual native upgrades and GitHub stable publication remain separate pending
gates. Historical 1.1.1 native reports, including failed
Windows/Linux attempts, remain unchanged in
[the prior native evidence](../zeno-1.1.1/native-updates/README.md).
