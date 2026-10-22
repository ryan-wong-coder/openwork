# Zeno 1.1.4 publication evidence

Frozen desktop commit: `ec55654e5b6d78deebeca35bb4c4e133a91ea1ac`, immutable lightweight tag `zeno-v1.1.4`, Release Zeno run `39749400834`, GitHub release `420508455`.

This release repairs personal Agent queries: real built-in/custom exercise discovery and canonical IDs, routine lookup and paginated/searchable personal records, current workspace/effective-folder metadata, and consistent V1/V2 discovery/context. Shared validation rejects missing, deleted and foreign exercise references. Full domain and discovery checks are recorded in `../zeno-personal-tool-completeness/`.

## Evidence boundaries

- `release-metadata/build-audit.json` records all nine CI jobs and six native package/runtime smoke checks. Its point-in-time fields are preserved; later installed-upgrade acceptance is separate.
- `release-metadata/frozen-github-assets.json` freezes the original 24 asset names, sizes and SHA-256 digests. No installer was rebuilt or substituted after this freeze.
- `release-metadata/distribution-integrity.json` records a second complete server read of all 24 mirrored files. `publication-gate.json` verifies SHA-256/SHA-512, atomic update-feed activation and 144 unchanged historical download files.
- `release-metadata/public-distribution.json` independently checks complete public feed hashes and both versioned package paths. Large installers and blockmaps receive HEAD and exact 64-byte Range checks; these do not imply full public-file hashes. `live-distribution.json` separately checks cache policy and update metadata agreement.
- `release-metadata/transfer-recovery.json` summarizes transport interruptions and verified resume. Raw private network diagnostics remain private. `publication-attempt01.json` preserves a rejected helper assertion before any public mutation; the frozen historical snapshot had 144 unique paths.
- `website/` and `apps/zeno-site/verification/releases/1.1.4/` record the real public landing page, ten packages, six selector combinations, decoded mascot video and three actually viewed desktop/mobile screenshots.

## Acceptance status

The existing GitHub draft was published once after all distribution and native gates. Anonymous reads of the latest stable release, tagged release and immutable tag agree with the website and all 24 unchanged asset digests. `release-metadata/github-publication.json` and `public-github-latest.json` record actual publication and public verification.

`native-updates/summary.json` accepts four real original 1.0.0 → 1.1.4 installed upgrades: macOS x64/ARM64, Windows x64 and Linux x64. Native download, automatic installation/restart, matching frozen application code, workspaces and historical chats were checked. All ten accepted screenshots were actually viewed; each visual receipt binds original PNG hashes. `release-metadata/independent-native-audit.json` records a second read-only review of GitHub metadata, original ZIP/file hashes, reports and all ten screenshots.

macOS ARM64 first lost network connectivity at 317,046,730 of 462,290,667 bytes. Its original failure report and authoritative ZIP receipt remain unchanged. An explicit new first-attempt workflow on a fresh host passed using the same frozen baseline/target packages. The other three lanes passed on their first host; no release asset was rebuilt, replaced or retagged.

This acceptance covers original 1.0.0 → 1.1.4 upgrades. It does not claim a direct 1.1.3 installed upgrade, authenticated personal forms, OS credential storage, Windows/Linux ARM64 installed upgrades, default V2 history or real model execution. Windows validates the original settings flow and saved V1 history in the real default profile. macOS additionally checks signature continuity and packaged canvas isolation/charts; Linux records CJK font prerequisites.

The website shell, standalone personal PWA, account API process, database and private media are not redeployed by this release. Original media coverage remains 110 demonstration entries, with no claim of 1000 finished techniques. OS credential storage, authenticated personal forms and real model calls are not inferred from the public/headless checks.
