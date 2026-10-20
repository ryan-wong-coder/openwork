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

Calendar, fitness, account isolation, synchronization, local AI tools and real
OS secure storage retain the exact scopes recorded in the
[1.1.0 implementation evidence](../zeno-1.1.0/README.md). Those checks did not
cover the missing full-client navigation path. The affected 1.1.0 candidate
remains unaccepted even though its domain checks and packaged update mechanism
passed separately.

Full-client screenshots, installed navigation, six target builds, public bytes
and original-version upgrades remain separate gates. A draft release or a
successful build is not final acceptance.
