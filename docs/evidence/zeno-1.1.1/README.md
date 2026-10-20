# Zeno 1.1.1 verification

The personal sidebar entries reached their registered routes, but the shared
workspace initialization treated those routes as chat and replaced their URL
with an empty workspace session. This patch preserves the personal destination
while retaining the active workspace and existing chat inventory.

- [Route regression](route-regression.json): the nine new cases failed on
  the original hook; all 27 cases and 406 assertions pass after the fix.
  These cover both engines, all four deep links, refresh, history navigation,
  and returning to normal chat. This is not a full-renderer browser test.
- [Source and production build](source-verification.json): installer source
  is frozen at `afb3ca5b6`, tag `zeno-v1.1.1`. Typecheck and the desktop renderer
  production build passed. The separately rebuilt mobile PWA has the same
  index bytes as the deployed `15a286a5` PWA; API and data contracts are unchanged.
- [Candidate feed rollback](candidate-feed-rollback.json): the website stopped
  recommending the affected 1.1.0 candidate while this patch is verified.
  No versioned files or user data were removed, and no client was downgraded.
- [Six target build audit](build-native-audit.json): all six matching CPU
  packaged runtime and license checks passed. The separate preflight passed
  74 native and 27 route tests. [Metadata audit](release-metadata-audit.json) independently
  downloaded eight small documents; it does not replace installer byte checks.
- [Headless-client attempt](headless-client-incomplete/README.md): incomplete.
  The fresh fixture's global health endpoint returned HTTP 200, but workspace
  reads returned 502 and the renderer remained loading. No personal entry
  assertion or screenshot ran. The
  candidate proof is archived outside automatic CI; actual installed desktop
  navigation remains the acceptance gate.
- [Distribution integrity](distribution-integrity.json): all 24 release files,
  totaling 3,948,929,703 bytes, were fully read and SHA-256 matched against
  frozen GitHub asset digests on the server. This is separate from installation.
- [Atomic website publication](publication-gate.json) and
  [public release checks](live-release.json): ten installers and six native
  feeds now advertise 1.1.1. Existing versioned downloads retain their metadata,
  sampled first/last 64 KiB and public download paths; historical files were
  not fully rehashed.
- [Public website and mobile PWA](public-site-pwa/README.md): the strict
  anonymous browser run passed, with four reviewed screenshots, exact PWA
  assets and all architecture choices. Authenticated records and installed
  desktop navigation are outside that check's scope.
- [Staging cleanup](staging-cleanup.json): only the two completed private
  release transfer directories were removed after confirming public download
  files resolve independently. Account data, backups, installed profiles and
  signing keys were preserved.
- [Administrator setup](admin-setup.json): a private one-time password setup
  link was issued to the operator and the bootstrap plaintext was deleted.
  No account identifier or token is included in this evidence, and user
  completion is not claimed.

Calendar, fitness, account isolation, synchronization, local AI tools and real
OS secure storage retain the exact scopes recorded in the
[1.1.0 implementation evidence](../zeno-1.1.0/README.md). Those checks did not
cover the missing full-client navigation path. The affected 1.1.0 candidate
remains unaccepted even though its domain checks and packaged update mechanism
passed separately.

Installed navigation and original-version upgrades remain separate pending
gates. A draft release, website publication or successful build is not final
acceptance.
