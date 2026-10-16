# Dark motion postproduction

The dark welcome and nod clips reuse the existing compressed Zeno character
animation. They contain no new generated frames and incur no additional LibTV
credits. The page uses them only for its dark theme.

## Reproduce

From the repository root, with `uv`, FFmpeg and FFprobe available:

```sh
uv run --python 3.12 --no-project \
  --with opencv-python-headless==4.13.0.92 --with numpy==2.4.4 \
  python apps/zeno-site/scripts/prepare-dark-motion.py
pnpm --dir apps/zeno-site build:published
node apps/zeno-site/scripts/qa-motion.mjs
```

`prepare-dark-motion.py` reads `welcome-v2.mp4` and `nod-v2.mp4` and atomically
replaces the corresponding `*-dark-v2.mp4` files after encoding succeeds.
Intermediate files remain private to the processor and are removed on failure.
It streams the frames to FFmpeg rather than retaining an uncompressed movie.
Outputs use H.264, 800×800, 24 fps, `yuv420p`, no audio and MP4 fast start.
The RGB-to-YUV conversion explicitly uses the BT.709 matrix and records
limited-range BT.709 primaries with the source RGB's sRGB transfer function
(`iec61966-2-1`). Leaving the matrix or transfer unspecified caused Chrome to
display a different canvas than the CSS background in the first draft.

## Matte and evidence

Each frame estimates the paper color from its outer 12 pixels, finds only
paper-colored areas connected to the canvas edge, then fills the largest
character exterior contour. This preserves the pale face and belly even where
their colors resemble the paper. A one-pixel inward feather suppresses the old
paper fringe without introducing a broad glow. The destination is RGB
`#102626` before video encoding.

All 120 frames per clip are checked for an unexpectedly small, large or clipped
silhouette. All eroded interior pixels must be fully opaque; their RGB values
must exactly match the source before H.264 compression. These checks guard
against the internal holes produced by an ordinary color key. They are not a
claim of perfect automatic segmentation for arbitrary video.

[Per-frame measurements](verification/v2-local/dark-postproduction/postproduction.json)
include the input/output hashes, bounding boxes and silhouette areas.
The contact sheets show frames 0, 30, 60, 90 and 119:

- [Welcome](verification/v2-local/dark-postproduction/welcome-dark-contact.png)
- [Nod](verification/v2-local/dark-postproduction/nod-dark-contact.png)

The encoded-output sheets separately show decoded frames 0, 60 and 119:

- [Encoded welcome](verification/v2-local/dark-postproduction/welcome-dark-encoded-contact.png)
- [Encoded nod](verification/v2-local/dark-postproduction/nod-dark-encoded-contact.png)

[Browser QA](verification/v2-local/motion-qa.json) separately confirms that both
dark clips decode and advance in Chrome, their canvas matches CSS within two
8-bit RGB levels, user pause retains the frame and resumes from the same time,
rapid greetings keep the latest clip playing, the reduced-motion mode does not
load videos, and the direct CPU downloads expose real metadata at desktop and
phone widths. API data in this local run is explicitly a QA copy of the live release;
installer links are checked without downloading or accessing the clipboard.

## Limits

The matte is tuned to these two paper-backed clips. Retest every frame and
inspect the first, middle and final frames after changing either source. The
largest-contour step intentionally discards disconnected background artifacts;
it is unsuitable for multiple separate characters or detached props. Very fine
fur and whiskers at the silhouette may soften at a one-pixel boundary. H.264
4:2:0 compression can shift the dark canvas color by a few RGB levels and loses
some fine chroma detail. The browser checks verify playback and behavior;
the contact sheets and real-size page screenshots supply the visual review.
