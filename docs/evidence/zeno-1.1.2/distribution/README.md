# Zeno 1.1.2 website distribution

The website's native release pointer was atomically switched to 1.1.2 at
2026-10-20 14:18 UTC. The product source is the immutable `zeno-v1.1.2` tag at
`46e5e38a5d7c4a147b0888d3a50e4788f045385e`, successful build `39431901305`.
The separate PWA deployment and its 32 actual video playback checks are recorded
under [mainstream](../mainstream/public-media/README.md).

- `distribution-integrity.json`: all 24 GitHub release files, totalling
  4,019,823,853 bytes, were completely downloaded and SHA-256 checked locally,
  mirrored into private server staging, and completely SHA-256 checked there.
  A second independent complete server read then matched the frozen GitHub
  digests. Transfer reused detached copies of prior packages; published history
  was never opened for writing or hard-linked into staging.
- `publication-gate.json`: all 22 indexed files were completely read for both
  SHA-256 and SHA-512 before activation. The publication script required the
  exact independently validated 24-asset and 22-index tuples, including the six
  original YAML manifests audited in [release metadata](../release-metadata/README.md).
  The resulting release has ten installers and six architecture-specific feeds.
- The same gate preserved all 112 historical download files, totalling
  27,419,514,014 bytes: size, inode, mtime and first/last 64 KiB hashes were
  unchanged. Both public download and native update paths passed HTTPS HEAD and
  exact Range checks. This historical check is **not** a full-file rehash.
- `public-feeds.json`: a separate anonymous public check matched the real
  ten-installer API, all six complete YAML bodies and both SHA digests. All
  sixteen versioned installers/blockmaps passed HEAD and exact first-64-byte
  Range checks on both download and native-feed URLs. No installer body was
  fully downloaded in this public HTTP check.

These receipts prove distribution integrity and availability. The GitHub stable
release and actual native installations/upgrades remain separate acceptance
gates; no native success is inferred from these files.
