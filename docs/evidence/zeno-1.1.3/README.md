# Zeno 1.1.3 publication evidence

Desktop product commit: `b17c3574e6ed9c5e7a3334511e3eb4fe7871e225`, immutable lightweight tag `zeno-v1.1.3`, Release Zeno run `39595241854`, GitHub release `419523921`.

The existing draft was published once after the distribution and native checks. An independent unauthenticated read confirms it is the public latest stable release, with all 24 unchanged asset names, sizes and SHA-256 digests. The website offers ten installer formats across six platform/architecture combinations and six native update feeds.

## Evidence boundaries

- `release-metadata/build-audit.json` is the original point-in-time six-platform build/runtime audit. Its then-unverified native/signing fields remain unchanged; later acceptance is separate.
- `release-metadata/distribution-integrity.json` fully rehashes all 24 mirrored files on the server. `publication-gate.json` verifies SHA-256/SHA-512, atomic feed promotion and 128 unchanged historical downloads. `public-distribution.json` verifies public feed bodies and both public package paths. Its first local TLS-EOF attempt is retained separately.
- `release-metadata/github-publication.json` and `public-github-latest.json` record actual publication and independent unauthenticated public verification.
- `mainstream/` establishes 110 original demonstration entries, 220 full public media hashes, 110 exact ranges and 110 browser video decodes. This is 76 additional distinct techniques plus two supplemental duplicate-label entries beyond the original 32; it does not claim 1000 completed techniques.
- `native-updates/summary.json` binds four successful original 1.0.0 → 1.1.3 native upgrade jobs: macOS x64 and ARM64, Windows x64 and Linux x64. All ten success screenshots were actually opened. Original Linux and ARM download failures remain separate; their fresh-host successes do not rewrite earlier results. Windows verifies a real saved V1 setting before history, not default V2 history. Windows/Linux ARM64 have native package/runtime checks, not full installed upgrade acceptance.
- `public-site-pwa/` and `apps/zeno-site/verification/releases/1.1.3/` record the original public landing/PWA checks. These point-in-time original receipts are retained.

## Subsequent web-only account scroll repair

The standalone PWA shell expanded beyond the globally clipped root. A bounded dynamic viewport height restores the inner scroller. The embedded desktop branch is unchanged. Web source `974795834e387455f6490dfaaa70d142e79075eb` is a separate commit; the desktop tag and packages were not rebuilt or replaced.

`account-scroll/` contains the real local API regression before/after (21 synthetic users, 44 invitations), sixteen actually viewed screenshots, exact server/public build verification, strict unchanged CSP and a separate fresh-profile public PWA pass. The public PWA now uses index SHA-256 `b3d17abd7d1444b844ac02785dbff5395a56d860c602b0dd040e73d74bf4da20`.

No real account, invitation, password reset, model request or OS credential storage test is implied by the public/headless checks. Account API code/process, database and private media were not changed by these static deployments. Long-term signing material and historical public downloads are retained.
