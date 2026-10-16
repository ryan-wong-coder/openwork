# Zeno website motion v2 — provenance

Created 2026-10-16T12:00:12.478Z with LibTV CLI 1.1.1. No recipient names, account details, credentials, or signed download URLs are included.

## Canvas and tool

- Private canvas: [Zeno Website Motion V2](https://www.liblib.tv/canvas?projectId=db0382c32d814b22a7e8e689a0c4eb88).
- Canvas UUID: `db0382c32d814b22a7e8e689a0c4eb88`.
- Every upload, node operation, generation, and generated-resource download uses the official `libtv` CLI. Local canvas bindings, model schema snapshots, and process logs stay in ignored `tmp/zeno-motion-v2/`.
- Model: **Seedance 2.5**, model/tool key `star-video2.5`. The schema was fetched before creating nodes.
- Confirmed schema: `frames2video` accepts 1–2 images; duration 4–30 whole seconds; 1080p; 1:1 and 16:9; audio may be disabled.
- Parameters for all three nodes: `modeType=frames2video`, `count=1`, `resolution=1080p`, `enableSound=off`, `search_enabled=0`, `autoCompliance=0` (non-human artwork).
- These are generated opaque-background videos. No transparent/alpha-video capability is claimed.

## Existing identity references

- Mascot: `public/assets/mascot.webp`; SHA-256 `ef3ee149e48c6804a9992c9abf48233fb3120d18b9579c48ef5a2261410b6910`. Existing teal-grey otter, cream belly, lime strap and Z buckle.
- Full logo: `public/assets/logo.svg`; SHA-256 `757d8cccf604dc4fbe4eb3a10a36cd5a0ccb519240e9c0816f9f478329227fc6`. Existing SVG paths and English/Chinese wordmarks are preserved; the SVG itself was not changed.
- `public/assets/motion-v2/mascot-poster.png` is a conventional centered composite of the original transparent mascot on a 1024×1024 flat #F3F1E8 canvas. No character redraw or generative image edit. SHA-256 `264b7ca577c70cec3740297a19313b3a00b502ec332763a1ee7ce005c6a20bc9`.
- `public/assets/motion-v2/logo-poster.png` is conventional rasterization of the exact existing SVG, 880px wide, centered on a 1280×720 #F3F1E8 canvas. SHA-256 `2fd5106d5c4f6c9f1100442b0f70cd41aeed5288f5d59f1ae2e062a72ab5dbbb`. The opening frame is a blank canvas of the same size and color.

## Generation records

### mascot-welcome

- Node: `571e4833-6087-438f-8ce2-c54523a54739`.
- Requested duration/aspect: 5s, 1:1.
- References: `bd0bd530-ced3-49c2-8599-14c37f7b79a9` → `53d2b6c8-3a7e-43b6-81b0-b9e6ce3e7dd4`. The first and last reference images are identical original mascot composites.
- Intended output: `public/assets/motion-v2/mascot-welcome-source.mp4`.
- Status: generation completed; source downloaded with the LibTV CLI and visually accepted for optional decorative motion, subject to web encoding and the integration limits below.

Exact submitted prompt:

```text
Create a refined five-second mascot micro-animation from the exact first-frame otter, ending at the identical supplied final frame. Locked camera, fixed framing, full body and tail visible at all times. Preserve the exact same teal-grey plush otter, cream muzzle and belly, glossy black eyes, small round ears, whiskers, lime diagonal strap and embossed Z buckle. Preserve its exact proportions, facial identity, paw anatomy, limbs and silhouette. The already-raised paw gives ONE small, natural wrist wave; the other paw stays relaxed. Tiny slow breathing, one soft blink and a nearly imperceptible friendly nod. Settle smoothly into the original pose by 4.5 seconds and hold through 5.0 seconds, so the first and last poses match for looping. All motion is restrained, soft and intentional. Keep both feet and the tail anchored. Background must stay one perfectly flat paper-white color RGB 243,241,232 (#F3F1E8), identical everywhere and through every frame. No floor, no horizon, no cast shadow, no background texture, no camera movement, no zoom, no cuts, no added objects, no extra limbs or fingers, no morphing or stretching, no text, no sound.
```

### mascot-nod

- Node: `980e1251-d4c4-4263-9906-442d36bc5f19`.
- Requested duration/aspect: 5s, 1:1.
- References: `bd0bd530-ced3-49c2-8599-14c37f7b79a9` → `53d2b6c8-3a7e-43b6-81b0-b9e6ce3e7dd4`. The first and last reference images are identical original mascot composites.
- Intended output: `public/assets/motion-v2/mascot-nod-source.mp4`.
- Status: generation completed; source downloaded with the LibTV CLI and visually accepted for optional decorative motion, subject to web encoding and the integration limits below.

Exact submitted prompt:

```text
Create a polished five-second interactive mascot response using this exact plush otter. First frame and final frame must be the supplied identical original pose. Preserve its identity, head shape, cream belly, teal-grey fur, round glossy black eyes, whiskers, lime shoulder strap and embossed Z buckle, body proportions, exact number and shape of paws and limbs. Fixed camera and fixed full-body composition. At 0.6 seconds the otter gently glances toward screen-left as if acknowledging a nearby download button; make a small friendly head nod at 1.7 seconds, blink once naturally, and return its eyes and head to the viewer by 3.8 seconds. Hold the exact original pose for the last second. Do not turn the whole body. Keep the raised paw, other arm, feet and tail in their original positions, with only subtle breathing. Very restrained, warm, beautifully controlled character animation. The entire background is a constant flat paper-white RGB 243,241,232 (#F3F1E8). No ground plane, no horizon or cast shadow, no new props, no added limbs, no anatomy change, no exaggerated expression, no camera move or zoom, no scene cuts, no text or sound.
```

### logo-reveal

- Node: `f2dad61c-a919-443c-9162-3c4174db01c5`.
- Requested duration/aspect: 4s, 16:9.
- References: `2f61c2d9-d834-42e4-b869-4fc481c86299` → `38a3887f-cc6d-4f32-a43a-431630be8540`. Blank paper first frame → exact existing SVG rasterization last frame.
- Intended output: `public/assets/motion-v2/logo-reveal-source.mp4`.
- Status: generation completed; source downloaded with the LibTV CLI and visually accepted for optional decorative motion, subject to web encoding and the integration limits below.

Exact submitted prompt:

```text
A precise four-second premium 2D brand motion graphic. Begin with the supplied blank paper-white first frame and finish with the supplied exact Zeno logo image. Treat the final supplied logo as a fixed vector graphic: preserve every contour, spacing, thickness, lowercase English letter and the two Chinese characters exactly, without redrawing, replacing, misspelling or deforming anything. 0.0-0.5 seconds: empty flat paper-white. 0.5-1.8 seconds: reveal the exact dark-teal logo cleanly using a restrained left-to-right ink-mask wipe with smooth easing; keep every visible part in its final fixed position throughout the reveal. 1.8-2.3 seconds: one hairline lime (#D5EF5A) accent passes briefly below the symbol and disappears. 2.3-4.0 seconds: hold the exact supplied final logo absolutely still. The dark-teal ink is #163A3A. Background stays perfectly flat RGB 243,241,232 (#F3F1E8) through all frames. No 3D, no gradients, no bevels, no glow, no particle clouds, no shadows, no decorative lettering, no subtitles, no extra symbols, no camera movement, no zoom or sound.
```

## Acceptance and delivery

All three clips completed successfully and were downloaded with `libtv download --without-ai-watermark`. The CLI outputs the saved path rather than JSON; its optional watermark service emitted a 404 for two downloads but still saved the completed videos. Inspected first/middle/end frames and nine-frame contact sheets show no visible added watermark. No account or signed resource URL is published here.

The two mascot clips preserve the same face, ears, strap/buckle, body, two arms, two feet and tail throughout the sampled sequence. Motion is small and natural; both return to the original pose. The welcome clip includes a restrained raised-paw greeting and blink, and the response clip includes a small leftward glance, head response and blink. First/last supplied poses are the same, but generated frames are not claimed to be mathematically identical.

The logo clip reveals the correct lowercase English wordmark and Chinese characters and finishes at the supplied composition. At the decoded last frame, the 45% luminance-threshold ink mask and the exact SVG rasterization have the same 1320×456 bounding box at +300,+312 in a 1920×1080 frame; 733 mask pixels differ (0.122% of the trimmed mask). This is an encoding/antialiasing comparison, not a promise of vector identity. The main brand must continue using the exact existing SVG; this video is only optional user-played decorative content.

All source clips are silent (video stream only), opaque HEVC Main10 / yuv420p10le at 24fps. They require a browser-compatible H.264 / yuv420p encode with faststart before integration. The video exporter includes one extra frame: trim the web mascot copies to 5.000s and logo copy to 4.000s. No alpha is present or claimed.

The backgrounds have no horizon or cast shadow and stay within the warm paper-white family. Generative encoding introduces slight spatial/temporal drift of approximately +1 to +5 RGB values in sampled background points compared with #F3F1E8. The source does not have an exactly constant per-pixel matte. Use an appropriate paper-white blend/edge treatment at integration, or keep the exact static poster when a precise matte is required. Do not relabel it as a transparent video.

Site integration should use a static poster for reduced-motion and unsupported video playback, avoid continuous automatic looping, pause video when appropriate, and preserve the exact existing SVG as the primary logo. No HTML, JS, CSS or download/release API was changed by the motion-asset task.

## Delivered original video files

| File | Model task | Duration | Dimensions | Bytes | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `public/assets/motion-v2/mascot-welcome-source.mp4` | `20261016195903796268518` | 5.041667s | 1440×1440 | 2879694 | `87591af431e101d93387c22a5de9a44f4e576bbcfaff845493a6ed009cf26d9a` |
| `public/assets/motion-v2/mascot-nod-source.mp4` | `20261016195903456798518` | 5.041667s | 1440×1440 | 3255535 | `5d5af749ecb4ff28eea91a4105c1f97239b3def3495d4d5f63dbeabe63e25954` |
| `public/assets/motion-v2/logo-reveal-source.mp4` | `20261016195903988918518` | 4.041667s | 1920×1080 | 1772657 | `878a700676013f4a8d9f81ab826ee318e9289e72ce5efd29e8bcf04cd92f6fce` |

The website integration will make small H.264 derivatives named `welcome-v2.mp4`, `nod-v2.mp4`, and `logo-reveal-v2.mp4`. Those derivatives are not the original model outputs; their final encoding commands, dimensions, byte counts and hashes should be appended when created.

## Web delivery derivatives — 2026-10-16

The three original downloaded source clips above remain unchanged. The website
uses silent H.264 / `yuv420p` derivatives at 24 fps, trimmed to exactly 5 seconds
for the mascot and 4 seconds for the logo. All five web MP4s have their `moov`
box before `mdat` (fast start), verified by inspecting the actual files. The
published build excludes all `*-source.mp4` files.

The light derivatives conventionally resize and encode the source clips with
FFmpeg; no character frames or logo artwork were redrawn. Equivalent delivery
encoding for the light source clips is:

```sh
ffmpeg -i SOURCE.mp4 -t 5 -vf scale=800:800 -r 24 -an \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart OUTPUT.mp4
# Logo uses -t 4 and scale=1280:720.
```

This describes the delivery transform, not a promise of byte-identical output
across encoder versions or quality presets. The hashes below identify the
actual selected files.

| Web derivative | Dimensions | Duration | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `public/assets/motion-v2/welcome-v2.mp4` | 800×800 | 5s | 79748 | `040f6ad82ea640f784b5826f23e559bdabace9bbe1dccc3b823b727efa00f73c` |
| `public/assets/motion-v2/nod-v2.mp4` | 800×800 | 5s | 88049 | `80ecd0b2e4eaa3c77a2284fc4b6b94f3ae4f156a656f8b2328c882d4a9f4f44d` |
| `public/assets/motion-v2/logo-reveal-v2.mp4` | 1280×720 | 4s | 94151 | `689f62fc243e8e83b32c401ec3fcd940e91cc3fd92353ff73576bdbf2fddaee9` |
| `public/assets/motion-v2/welcome-dark-v2.mp4` | 800×800 | 5s | 98859 | `a30732da356619bb1221e2f0e0ee1b6cdf7b7371489c721b6a7f964d39e0ec58` |
| `public/assets/motion-v2/nod-dark-v2.mp4` | 800×800 | 5s | 122253 | `80486d38e7bcb434112d4f61e8fba074114447d837146456b64f0371fa7abe52` |

The two dark files are conventional video-postproduction derivatives of the
compressed light clips, composited on `#102626`. They use a filled character
silhouette rather than an ordinary color key, preserving the pale face and
belly. The processor, pinned tool versions, exact encoding command, per-frame
checks and limitations are in [motion-postproduction.md](motion-postproduction.md).
They consume no additional LibTV credits. Original generation prompts and
source provenance above are unchanged.

[Local motion QA](verification/v2-local/motion-qa.json) actually decodes the web
files and verifies time progression, explicit replay, pause/resume,
reduced-motion behavior and dark canvas colors. [Design QA](design-qa-v2.md)
records the real-size browser screenshots; generated video is decorative and
does not replace the exact SVG primary logo.
