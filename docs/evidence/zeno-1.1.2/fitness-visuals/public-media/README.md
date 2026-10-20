# Focused public fitness-media QA

Passed all five checks in `report.json` in one run starting 2026-10-20T09:07:20.432Z, after the PWA hot deployment. Command: `node apps/zeno-site/scripts/qa-public-fitness-media.mjs`.

- Public `/app/device` returned the exact local production index SHA-256 `449c944c1217fa0d86df756bd689539178e9a92a87a49ad1c93bd1c166e9f24a`, strict PWA CSP, `no-cache`, `nosniff` and `no-referrer`.
- All six public video/poster responses were read completely. Their lengths and SHA-256 values matched the local committed files and generation provenance. The three MP4 responses had `video/mp4`; the posters had `image/webp`. Each MP4 also returned an exact `bytes=0-1023` slice with HTTP 206 and the expected full-file length.
- A new owned headless Chrome profile opened the public anonymous `/app/` login page. Temporary same-origin video elements decoded and briefly played each clip, observed actual `requestVideoFrameCallback` frames, then paused and were removed. All were 1024×576; durations were 8.041667 s for curl/squat and 7.958008 s for shoulder press. This checks delivery and browser decoding, not movement technique quality or full-duration playback.
- Observed CSP violations, renderer exceptions, console errors, unexpected HTTP failures, external requests, mutation attempts and model attempts were all zero. Requests were restricted to an explicit same-origin read allowlist, with external DNS denial. This is owned-page observation, not system packet capture.

No account was created or used. No download installer, feed update, API write, generation call, model request, product build or deployment was performed by this QA. The owned browser and temporary profile were closed and removed. No screenshot of the temporary video elements was taken or presented as product UI.

This anonymous public/static/decode record is distinct from the implementation agent's 12-check loopback production-PWA UI run, which exercises the actual catalogue/workout detail, controls, read-only behavior and custom-media priority. It does not repeat or replace that UI coverage, native desktop verification, the earlier website architecture/download checks, or the authenticated device-approval acceptance.

Reviewed product source: `639285fed1d6b05c94d42af12336dfa6b98cb9ab`. Desktop installer publication and the download feed were outside this run's scope; the hot-deployed PWA must not be described as a newly published desktop installer on the strength of this record.
