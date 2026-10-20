# Mainstream fitness assets: batch B

Original Zeno mascot work, generated from Zeno's existing `curl-reference.png`
identity. No restricted upstream exercise image, video, screenshot, or machine
geometry was used as a generation input. Canonical catalogue text and the
primary training sources recorded in each request were used only to check
general movement semantics.

| Canonical ID | Exact catalogue name | Media stem |
| --- | --- | --- |
| `0652` | pull-up | `pull-up` |
| `2330` | cable lat pulldown full range of motion | `lat-pulldown` |
| `0861` | cable seated row | `seated-row` |
| `0585` | lever leg extension | `leg-extension` |
| `0586` | lever lying leg curl | `lying-leg-curl` |
| `0200` | cable pushdown (with rope attachment) | `triceps-pushdown` |
| `0685` | run | `run` |
| `3094` | jumping jack | `jumping-jack` |
| `2138` | stationary bike run v. 3 | `stationary-bike` |

`*-request.json` records each complete built-in Image Gen prompt and intended
LibTV prompt/settings. `*-video-generation.json` records the actual official
CLI node/task IDs and expanded prompt. The final `provenance.json` records only
reviewed assets, complete SHA-256 values, actual format and frame-review notes.
Only entries in that provenance file have been promoted to the public directory.
The complete request and retry records are development assets, never runtime
generation instructions.

All LibTV project, upload, generation and download operations use its official
CLI. A completed paid generation is never resubmitted to recover a local
encoding error. Selected delivery files are silent H.264/yuv420p at 1024 pixels
wide with fast-start metadata, and WebP posters compressed with `cwebp`.

Every delivered clip has an actually inspected eight-frame contact sheet at
one-second intervals. Running and cycling also have five-frame-per-second
motion contact sheets to check continuity without sampling the same cycle
phase repeatedly. Review checks identity, visible limbs, exercise/equipment
match, grounded support, grip/contact and stable apparatus. These are stylized
mascot illustrations; no professional human technique or clinical validation
is claimed.

Eight entries are Image Gen/LibTV mascot illustrations. The ninth, `3094`
jumping jack, is an explicitly labelled **original movement diagram** rather
than a generated mascot video. Its adjacent SVG generator and rendering script
produce 192 frames at 24 fps using Sharp/libvips, then encode eight seconds with
FFmpeg. The retained open/closed SVGs and inspected contact sheet show the exact
full overhead arm extension synchronized with the feet opening and closing.

The first pull-up video cropped the head at the top of the movement and was
rejected. Its single retry uses a framing-only Image Gen correction with ample
headroom. The first jumping-jack clip stopped the paws near the sides of the
head and was rejected for incomplete overhead extension. Its single retry
explicitly requested a held, fully open position, but still stopped with bent
elbows beside the head. Both jumping-jack generations were rejected. The
accurate original SVG diagram is used instead; no third paid video was called.
Rejected results are excluded
from the public directory and final runtime mapping.
