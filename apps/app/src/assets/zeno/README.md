# Zeno brand assets

Product-neutral assets from the Zeno visual kit, used by the local interface.

- `zeno-*-primary.svg` and `zeno-*-reverse.svg` retain the real traced paths from the approved logo master. They are raster-derived path artwork, not a hand-calibrated vector master.
- `mascot.webp` is the approved transparent otter main illustration, cropped to its alpha bounds and resized to 502 × 768. Its alpha is preserved. It is not cut from the character state reference sheet.
- `mascot-thinking.webp` is a separate transparent 768 × 768 illustration generated through LibTV CLI from the approved otter reference. The original 2048 × 2048 RGBA source is `Zeno 思考状态.png` in the Zeno visual kit. Conversion uses Lanczos resizing and WebP quality 92, with the original alpha and full composition retained. It is an independent generated pose, not a crop of the state reference sheet.
- `favicon.ico` contains the approved application icon sizes.

Use `components/brand/zeno-brand.tsx` so theme switching and accessible names stay consistent. The artwork is decorative by default; use `decorative={false}` when it carries meaning without adjacent text.

`ZenoMascot` accepts `pose="welcome" | "thinking"`. Keep its display box fixed when changing posture. The thinking pose decorates an unsent draft; it does not report model activity, progress, or execution state.

The palette lives in `styles/zeno.css` behind `html[data-zeno-interface="true"]`. Control radii and compact type continue to follow the product's `DESIGN.md`.
