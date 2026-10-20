# Fitness visual completion

The accepted run uses the actual final production PWA bundle with its production Nginx CSP,
a real disposable loopback Bun API and synthetic accounts. No visible app/browser window,
real account, provider credential, external request or model request is used.

[Accepted browser report](accepted/browser-report.json): **12 checks / 8 screenshots passed**,
with zero renderer exceptions, console errors or enforced CSP violations. It includes:

- Actual catalogue detail with the correct individual exercise sketch and primary/secondary
  front/back muscle highlights.
- Static default, real Play/Pause actions, keyboard End scrubbing and system reduced motion.
- Real browser tab activation pauses SVG and video; returning does not resume either.
- 390 × 844 dark mobile viewport, 1440 × 1000 light/dark desktop, and horizontal-overflow guards.
- An unsupported dumbbell variant displays its actual muscle map and no borrowed animation.
- All three precise-ID local MP4 files really decode, remain paused by default, and switch to
  their corresponding vector demonstration. A change to reduced motion pauses video.
- Starting a synthetic workout, clicking its actual exercise title, and returning from detail
  leaves the persisted training record unchanged.

[Verification and frozen source/asset hashes](verification.json) record successful app
TypeScript checking, production PWA building and **19 tests / 24,842 assertions** across the
new mapping suite and existing personal-data tests. The normal Vite chunk-size advisory
remains. These checks do not establish a packaged native shell, authenticated public desktop
pairing, physical phone operation, professional technique review or clinical validation.

The final PWA index SHA-256 is
`449c944c1217fa0d86df756bd689539178e9a92a87a49ad1c93bd1c166e9f24a`.
The feature remains covered by the already-declared `fitnessTracking` flag. Stored history,
custom media, writes, account isolation and server interfaces are unchanged.

## Honest coverage

There are **11** original specific vector demonstrations, **3** independently generated
mascot posters/clips, and **5,621** catalogue entries with no demonstration yet. Every canonical
exercise retains its own muscle highlights from existing catalogue data. Custom authenticated
images/GIF/video take priority. Unknown/deleted custom exercises use their real saved muscle
snapshot without inheriting a built-in demonstration.

The original vector pose gallery is [original-keyframes.png](original-keyframes.png); it is
an inspection sheet, not an application screenshot. Asset prompts, actual LibTV model/task
IDs, encoding details, original and final SHA-256 and reviewed video contact sheets are in
[the asset source folder](../../../apps/app/art-source/fitness/README.md).
No restricted openGym/Gym visual media was copied, hotlinked, supplied to AI or derived.
Existing AGPL/MIT attributions and corresponding upstream source remain intact.

## Earlier attempts retained

- `attempt-01`: a test-expression quoting error before the exercise-detail assertion.
- `attempt-02` / `attempt-03`: successful initial motion/mobile checks, then an incorrect
  Escape return-to-search expectation for sibling dialogs; the final flow uses the visible
  top dialog's Close control to return to the catalogue.
- `attempt-04`: a broad text-prefix click selected a different curl/lunge variant. The strict
  ID assertion correctly failed; the test now clicks the exact displayed exercise title.
- `attempt-05`: successful three-video decoding, then a test read server state before the
  offline-first write queue had synchronized. The final test waits for that real persistence
  boundary before comparing the record.
- `attempt-06`: first complete 11-check pass. The final accepted build additionally captures
  the mounted video for cleanup and tests real video visibility/reduced-motion pause (12 checks).

Failures are preserved and are not counted as accepted UI checks. Each harness run removes
only its owned temporary database, browser profile and child process groups. All eight final
screenshots, the vector gallery, the three original posters and all selected video contact
sheets were actually viewed.
