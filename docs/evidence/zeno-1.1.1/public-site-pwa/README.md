# Public website and PWA verification

The single strict anonymous public run passed on 2026-10-20, starting at 08:03:49 UTC, using a fresh headless Chrome 155.0.8059.85 profile. The existing script ran unchanged with `--version 1.1.1`. See the [sanitized report](report.json).

The public release API returned 1.1.1 and ten installers. All six OS/CPU selections exposed a download URL and SHA-256 matching that metadata. Desktop and mobile hero video variants decoded at their expected widths. No installer was downloaded or executed.

All eight `/app/` deep links returned the exact frozen PWA index with strict self-only script/connect CSP, frame protection, no-cache, nosniff and no-referrer headers. Entry assets, icons, manifest MIME/content and service worker matched the current local production files. The unchanged PWA index SHA-256 is `29ed8c406a6635cb6e8fd832f5550dc4ce65a2a92ebd81de962c31f606f7d49c`. Anonymous `/api/zeno/v1/me` returned 401. The worker registered under `/app/` and its cache contained only public same-origin shell resources, excluding APIs and query-bearing requests.

All four screenshots were actually viewed, and their byte sizes and SHA-256 values were independently matched to the report. The 1440×1000 desktop and 390×844 mobile views had no horizontal overflow; login fields were empty and the website displayed v1.1.1:

- [Website desktop](website-desktop.png)
- [Website mobile](website-mobile.png)
- [PWA desktop login](pwa-login-desktop.png)
- [PWA mobile login](pwa-login-mobile.png)

Observed page runtime exceptions, CSP violations, unexpected HTTP failures, external requests, blocked mutations, installer requests and model requests were all zero. This is owned-page CDP observation with same-origin CSP and external DNS denial, not an operating-system packet capture. The owned browser and temporary profile were cleaned up.

This check covers the public website and anonymous PWA boundary. It does not cover authenticated personal records, the packaged desktop sidebar route guard, native installation/update/restart, or physical mobile installation; those require their separate acceptance evidence.
