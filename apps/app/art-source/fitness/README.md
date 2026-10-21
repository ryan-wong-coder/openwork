# Zeno original fitness visuals

The frozen 1.1.2 baseline covers **32 mainstream exact catalogue exercises** with
32 original posters and 32 local videos: **30 mascot demonstrations and two original diagram videos**.
Additional independently generated mascot posters and videos are recorded under
`expansion-1000/`. Its `selection.json` is a 1,000-item production plan, while
`progress.json` and the runtime/provenance manifests report only accepted media.
The identity reference is Zeno's established otter mascot; no openGym/Gym visual exercise
image, animation, video, screenshot or prompt reference was used.

`mainstream/selection.json` records every exact canonical ID, English name, equipment and
asset stem. The runtime `mascot-demos.json` contains only completed, reviewed media.
Different equipment or variants never borrow a technique. The catalogue places these
completed demonstrations first within matching search results, keeping exact-name matches,
equipment/muscle filters and custom exercises available.

The four batch folders under `mainstream/` contain the complete final built-in Image Gen
prompts, official LibTV CLI task/model/prompt records, eight-frame contact sheets, rejected
attempt records and encoding provenance. All accepted final app files are fully hashed in
`provenance.json`. Accepted mascot clips use local silent H.264/yuv420p with fast-start
metadata, and the matching posters are local WebP. No generation runs in the product.

`0612` lunge and `3094` jumping jack use original SVG/Canvas poses recorded to MP4 after
the bounded generated-video attempts failed review. Their UI is labelled “动作图解”; they
are not presented as mascot animation. The corresponding generators, pose sources and
recording verification are in `mainstream/native/` and `mainstream/b/`. The other 30
videos are independently generated mascot scenes. Each selected eight-frame contact sheet
was actually viewed; professional human technique or clinical validation is not claimed.

## Original three-asset batch

The initial batch below remains part of the 32 completed movements. Its generation records,
original references and selected contacts retain their original provenance.

| Exact canonical exercise | Poster and video stem |
| --- | --- |
| `0294` 哑铃二头弯举 | `curl` |
| `1197` 深蹲（自重） | `squat` |
| `0405` 哑铃坐姿肩部推举 | `shoulder-press` |

`image-prompts.json` preserves the built-in Image Gen prompts. The three
`*-video-generation.json` files preserve the official LibTV CLI's actual model, prompt,
node/task ID and settings. `provenance.json` records complete SHA-256, sizes, formats,
precise mapping and the final encoding steps. It intentionally contains no account
information, credentials or vendor retrieval URL. Original downloaded video bytes were
removed after hashing, contact-sheet inspection and encoding; their `retained` field is false.

The 8-frame contact sheets were visually inspected at one-second intervals. The shoulder
press generation contained two repetitions; only its first four seconds were selected and
slowed twofold into one 7.96-second repetition. Curl and squat retain their single full
8.04-second repetition. The selected shoulder contact sheet is
`shoulder-press-selected-contact.jpg`; the other shoulder sheet documents the original output.
All final MP4 files are silent H.264/yuv420p, 1024 pixels wide, with fast-start metadata.
Application files live in `apps/app/public/zeno/fitness/` and work with the desktop and PWA
build bases. Generation is not needed at runtime.

## Coverage and attribution

`movement-scenes.ts` supplies **11** original vector keyframe demonstrations, all included
in the original 32 selected movements. At that baseline 5,600 canonical exercises
lacked a demonstration; current coverage is recorded in `provenance.json`.
Uncovered exercises report that state rather than displaying another
technique. Their own primary/secondary muscle data still powers the front/back muscle map.
Custom exercise pictures/GIF/video use the existing authenticated media store and take
priority over built-in art. Historical custom muscle snapshots remain readable.

The vector coordinates and two recorded diagram sources are original Zeno work. Anatomy outlines come from the existing
MIT MuscleMap-derived geometry in `@zeno/fitness`; the retained MIT and AGPL notices are in
`packages/zeno-fitness/{NOTICE,UPSTREAM-NOTICE}.md` and its corresponding source remains
in the repository. These files do not expand the upstream Gym visual media permission.
The sketches and mascot clips illustrate movement; no professional human technique,
clinical, safety or efficacy validation is claimed.

The actual catalogue's Chinese steps remain under their existing source licenses.
General movement semantics were checked against the primary training sources below;
no photographs or diagrams from these pages were used as image/video input or copied:

- NASM, [Barbell deadlift](https://www.nasm.org/resource-center/exercise-library/barbell-deadlift).
- NASM, [Push-up](https://www.nasm.org/resource-center/exercise-library/push-up).
- NASM, [Bench press setup](https://blog.nasm.org/how-to-increase-bench-press-max).
- NASM, [Squat movement](https://blog.nasm.org/sports-performance/front-squat-back-squat-choose).
- NASM, [Lateral raise range and lunge scaling](https://blog.nasm.org/fitness/exercise-progressions-and-regressions-how-tos-of-scaling-movement).
- NASM, [Standing calf raise movement](https://www.nasm.org/resource-center/blog/training/calf-training-how-to-program-this-stubborn-muscle-group-for-clients).

The detail uses existing Base UI dialogs/buttons, semantic color tokens, progressive
step disclosure and static-by-default motion. Completed video-only movements also offer
their real starting poster; the original eleven retain the scrub-able vector view.
SVG playback supports pause, keyboard
scrubbing, system reduced motion and actual tab visibility changes. Video playback is
explicit through native controls; tab hiding and changes to reduced-motion preference
pause it. No animation automatically resumes after returning to the tab.
Design rules applied: DESIGN.md P1, P3, P5, P10, S7 and V2/V6.
