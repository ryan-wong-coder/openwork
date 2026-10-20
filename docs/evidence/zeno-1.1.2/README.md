# Zeno 1.1.2 verification

This patch adds exercise detail from both the catalogue and the active workout,
front/back primary and secondary muscle maps, eleven exact-ID vector scenes,
and three independently generated mascot videos. The remaining 5,621 exercises
show their real muscle/instruction data without borrowing another movement's
demonstration. Custom authenticated media takes priority.

- [Visual implementation and real browser acceptance](../zeno-fitness-visuals/README.md):
  12 checks and eight reviewed screenshots on the production PWA with a real
  isolated API. Playback, keyboard scrubbing, background/reduced-motion behavior,
  exact variants, mobile themes and unchanged workout records are covered.
- [Generation prompts and provenance](../../../apps/app/art-source/fitness/README.md):
  built-in Image Gen, official LibTV CLI and our own mascot reference. All three
  selected videos were reviewed as contact sheets and decoded in the browser.
  No restricted upstream exercise media was used.
- [Independent review](fitness-visuals/review.md): mapping, custom-media boundary,
  base URLs and all six complete media hashes; no additional native claim.
- [Source and renderer build](source-verification.json): production renderer
  build and missing/corrupted packaged-media regression passed. Installer
  packaging separately verifies all six actual media files against source.
- [PWA deployment](fitness-visuals/deployment.json) and
  [public media checks](fitness-visuals/public-media/README.md): independent static
  deployment at `639285fed`, all 109 source files fully hashed, prior assets
  retained, strict CSP and actual public MP4 decode/Range verified. The API,
  account database, user media and installer feeds were unchanged.
- [Device approval fix](../zeno-1.1.1/device-approval/README.md): second-tab
  server authorization no longer depends on the local record-writer lease.
  Its feature/owner checks and local record write protections remain. The
  real public two-tab approval and PKCE/device binding passed before the
  fitness static deployment; exact synthetic cleanup is recorded separately.

All prior route corrections remain included. Six-target installers, publication
and actual native upgrades are pending independent acceptance; source, web
screenshots or a successful build alone do not establish those results.
