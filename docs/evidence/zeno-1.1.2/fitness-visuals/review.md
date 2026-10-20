# Fitness visuals: independent source and asset review

Reviewed on 2026-10-20. No actionable P1/P2 issue was found in the reviewed scope. This is a read-only product-code review plus local file/digest verification; it is separate from the implementation agent's real-browser QA. No additional browser, desktop, model or generation service was used, and no product source, feature flag, version, tag or deployment was changed for this review.

## Identity, anatomy and interaction

- `movement-scenes.ts` contains 11 explicit canonical exercise IDs. A scene requires both its canonical ID and exact catalogue English name; custom exercises are excluded. Canonical aliases resolve through the existing catalogue, without matching a similarly named technique. Exercises outside the allowlist report no demonstration.
- The three mascot mappings are exactly `0294` / dumbbell biceps curl → `curl`, `1197` / squat (body weight) → `squat`, and `0405` / dumbbell seated shoulder press → `shoulder-press`. In particular, the bodyweight squat clip does not map to barbell squat `3593`.
- Primary and secondary catalogue muscle keys are passed to the existing MuscleMap-derived geometry as intensities `1` and `0.4`; primary wins when duplicated. The front/back views use the corresponding existing geometry keys. Recognized Chinese custom labels map to those same keys; unknown labels are not guessed into an anatomical region. This checks software/data mapping, not anatomical, clinical or human technique validation.
- The original SVG starts static. Its native labelled range supports keyboard interaction, and scrubbing stops playback. The code observes reduced motion, disables SVG playback when requested, and cancels the animation loop on pause/unmount. Hiding the document stops the SVG and mascot video; returning does not automatically resume them. Mascot videos use explicit native controls, with no autoplay. This background-pause review is limited to the new SVG/mascot demonstrations, not existing user-uploaded `PrivateMedia` playback.
- Catalogue and workout detail buttons remain available in read-only mode, outside disabled editing fieldsets. Uploaded custom media is rendered first through the existing authenticated `store.readMedia` / blob-URL component; a custom media reference does not become a public asset URL. Record mutation controls retain their existing read-only gates.

Reviewed source: `apps/app/src/react-app/domains/zeno/{movement-scenes,exercise-visual,exercise-detail,exercise-picker,fitness-workout,personal-media}.tsx/ts`, with the existing `@zeno/fitness` catalogue and geometry. The code review does not assert browser playback, decoded frames, responsive rendering, installed-package inclusion or native update behavior; those require their separate QA evidence.

## Final public asset verification

All six runtime files exist, and their complete byte lengths and SHA-256 hashes match `apps/app/art-source/fitness/provenance.json`:

| Canonical ID | File under `apps/app/public/zeno/fitness/` | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `0294` | `curl.mp4` | 172313 | `6ae62c9fedd4cd8f2df21c620a1b437808963b78a8c5fc67fac4a30c32677cf8` |
| `0294` | `curl-poster.webp` | 18782 | `059b8d7b33ea805fafb7c110b2bd59c201a76bcb63a2faaa005bbde8f6476fb5` |
| `1197` | `squat.mp4` | 212931 | `0c6bee9d3ae7158b5e2e98f606043029b1aaed84349480899cbbedb72f6e1693` |
| `1197` | `squat-poster.webp` | 17112 | `9bd7ac0969be0d9f87abb8556c001493acac3da9acc8f0560114b215a5cdbc04` |
| `0405` | `shoulder-press.mp4` | 178474 | `ba27d9ecff1cdc2e635264dfc80f6e3a859a4fe290f017eff35bb76b093859f3` |
| `0405` | `shoulder-press-poster.webp` | 19898 | `368bab89da2d80e37e681136e605906e8d67730a29f445b04818439df802b15f` |

The three retained generated reference images and existing mascot identity reference also match their recorded sizes/hashes. Each selected contact-sheet path exists. The original generated video entries are explicitly marked `retained: false`; this review cannot rehash those removed originals and does not claim to have inspected video frames or contact-sheet pixels.

`mascotDemoForExercise` returns relative `zeno/fitness/<stem>` paths. `exercise-visual.tsx` prefixes both video and poster with `import.meta.env.BASE_URL`: the personal PWA config uses `/app/`, producing `/app/zeno/fitness/<file>`; the packaged Electron renderer config uses `./`, producing `./zeno/fitness/<file>`; ordinary web development uses `/`. None of the asset paths begins with an extra slash or overrides the configured base. This is source/path validation, not a new build or HTTP request.

The provenance coverage is accurately limited to 11 vector demonstrations, three of which also have mascot videos, among 5,632 canonical exercises. The remaining 5,621 have no exercise demonstration. Provenance tool/originality claims are retained as the implementation agent's generation record; digest agreement alone does not independently establish their provenance or technique quality.
