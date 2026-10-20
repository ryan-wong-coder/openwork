# Public website and PWA verification

The strict anonymous public check passed on 2026-10-20, starting at
06:45:45 UTC, using a fresh headless Chrome 155.0.8059.85 profile.
See [the full sanitized report](report.json).

The live release API returned version 1.1.0 and ten installers. The browser
selected all six OS/CPU combinations and verified each selected download URL
and SHA-256 against the release metadata. Installers were not downloaded or
executed by this check.

All eight `/app/` deep links returned the exact frozen PWA index, with strict
self-only script/connect CSP, frame protection, no-cache, nosniff, and
no-referrer headers. Entry assets, icons, manifest, and service worker matched
the final local build. The index SHA-256 remained
`29ed8c406a6635cb6e8fd832f5550dc4ce65a2a92ebd81de962c31f606f7d49c`.
The anonymous account endpoint returned 401. The service worker registered
under `/app/` and cached only public same-origin shell resources, excluding APIs
and query-bearing requests.

Desktop (1440×1000) and mobile (390×844) views had no horizontal overflow. Both
website video variants decoded, and both PWA screenshots show empty login
fields:

- [Website desktop](website-desktop.png)
- [Website mobile](website-mobile.png)
- [PWA desktop login](pwa-login-desktop.png)
- [PWA mobile login](pwa-login-mobile.png)

Observed page runtime exceptions, CSP violations, unexpected HTTP failures,
external requests, blocked mutations, installer requests, and model requests
were all zero. This covers the owned page's CDP events, same-origin CSP, and
external DNS denial; it is not an operating-system packet capture. No account
was authenticated, no administrator action or mutation was performed, and a
physical mobile installation was not tested.

The [first attempt](attempt-1.json) is retained. It stopped before browser
startup because the public manifest was served as `application/octet-stream`;
its [diagnostic](attempt-1-manifest-mime.json) records the exact unchanged file
hash. An exact Nginx location corrected the MIME to
`application/manifest+json`, preserving no-cache/nosniff/no-referrer. The second
run passed the original strict check without changing PWA bytes or weakening
the gate. The earlier [preflight](preflight.json) predates installer publication
and intentionally observed release 1.0.5; it is not the final release result.
