# Actual public media verification

The [report](report.json) independently checked the deployed PWA's exact index
and strict headers, all 64 complete asset SHA-256 values and MP4/WebP MIME, and
32 correct HTTP 206 responses containing the exact first 1,024 video bytes.

A fresh owned headless Chrome loaded the anonymous PWA, then created temporary
same-origin video elements to decode, play and pause every public video. Actual
frame callbacks, dimensions and duration matched source. External, model and
mutating requests, CSP/renderer/console errors and unexpected HTTP failures were
zero. The temporary profile was removed. This is public-byte/playback proof;
product interactions and screenshots are covered separately in `../browser/`.
