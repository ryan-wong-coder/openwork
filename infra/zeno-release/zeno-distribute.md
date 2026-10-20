# Private relay of an existing release

`.github/workflows/zeno-distribute.yml` transfers the original artifacts from a
successful **Release Zeno** run. It checks all six native lanes and the frozen
tag/version, then runs that tag's existing Node-only assembler. It does not
install dependencies, rebuild, sign, publish, update a feed, or modify a tag.

Push the workflow to `personal` once to register it. That push only runs the
registration job. An operator then dispatches it on `personal`:

```sh
gh workflow run zeno-distribute.yml --ref personal \
  -f source_run_id=39373868155 \
  -f release_tag=zeno-v1.1.0-build.3
```

Before dispatch, the operator supplies three temporary repository secrets:
`ZENO_UPLOAD_SSH_KEY`, `ZENO_UPLOAD_KNOWN_HOSTS`, and `ZENO_UPLOAD_HOST`.
The known-host entry must be pinned independently; the workflow never uses
`ssh-keyscan` or accepts an unknown host. The unencrypted one-purpose key must
authenticate only as `zeno-release-upload`, with a server-side forced receiver,
no shell, no forwarding, and no public-directory write access.

The receiver must accept only the exact 24 expected files into a private staging
directory, reject unsafe archive entries, and compare every size and SHA-256 to
the independently frozen GitHub release audit. The workflow uses hard-link
dereferencing so every archive entry contains its original file bytes. A
successful SSH transfer is not publication or proof that the public endpoint
changed. Promotion still requires the existing full digest/publication gates.

The transfer has a 40-minute process limit and SSH keepalives. Credentials and
private diagnostics are written only below `RUNNER_TEMP`, with private modes,
and removed by an always-run cleanup step. The operator must revoke the key,
remove the temporary account/receiver authorization, and delete all three
repository secrets after the single relay completes or fails. No credential,
endpoint, raw receiver log, or signed asset URL belongs in release evidence.
