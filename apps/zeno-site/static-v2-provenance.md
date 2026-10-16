# Zeno website static mascot assets v2

Generated on 2026-10-16 using the **built-in imagegen tool** (`image_gen.imagegen`), reference-guided generation/edit mode with `transparent_background: true`. No CLI, API key, external image service, Python image editing, manual retouching, matte removal, crop, resize, or alpha modification was used. The selected PNG files were copied byte-for-byte from the tool's saved originals. Existing SVG and WebP assets were not modified.

Canonical identity reference for both selected images:
`/Users/ryan/Documents/openwork/apps/zeno-site/public/assets/mascot.webp`

## mascot-peek-v2.png

- Repository path: `apps/zeno-site/public/assets/static-v2/mascot-peek-v2.png`
- Original generated path: `/Users/ryan/.codex/generated_images/01a1434c-8a23-7c83-8dce-5f89db3eaee6/exec-15170ebd-69cc-4ddf-a93f-37c28b4654aa.png`
- Mode: built-in imagegen, reference-guided new pose, one canonical reference image; `transparent_background: true`.
- Output: 1536 × 1024, RGBA PNG.
- Selection: fresh reference-guided generation after two exploratory peek attempts. The exploratory assets are retained in the generated-images directory and are not installed in the website.
- Final prompt (verbatim):

```text
Use case: stylized-concept
Create a production-ready transparent PNG of the exact same Zeno otter shown in the reference image, in a new pose. Preserve the same rounded head, small round ears, glossy black eyes, rounded black nose, cream muzzle and belly, thin whiskers, deep ink-teal short plush fur, lime diagonal strap and rounded Z buckle. Match the same premium 3D character and soft studio illumination.

Pose: the otter peeks up toward the viewer, showing only its head and upper torso. It leans slightly forward with a gentle closed-mouth smile, with both arms reaching forward and both complete paws at the same horizontal height in the lower portion of the image, like it is resting its paws over the top edge of a website product preview. That website edge is imaginary and must not be drawn. Lower torso ends naturally behind this invisible horizontal alignment. No legs, feet or tail are visible.

Framing: wide landscape image, centered character, full head, ears, whiskers and both paws safely inside the canvas. Generous clear margins to the left, right and above. The otter is a solid opaque foreground character with finely detailed fur edges, isolated on a genuinely transparent background with an alpha channel.

Only render the otter. No visible ledge, table, frame, panel, support, ground, cast shadow, glow, halo, haze, gradient, background, checkerboard, props, other characters, watermark or added text. The existing embossed Z buckle is retained. All empty space is transparent.
```

## mascot-rest-v2.png

- Repository path: `apps/zeno-site/public/assets/static-v2/mascot-rest-v2.png`
- Original generated path: `/Users/ryan/.codex/generated_images/01a1434c-8a23-7c83-8dce-5f89db3eaee6/exec-6823ca4d-d0c8-47fa-be91-343d3e1570e7.png`
- Mode: built-in imagegen, reference-guided new pose, one canonical reference image; `transparent_background: true`.
- Output: 1014 × 1551, RGBA PNG.
- Selection: first generated resting pose.
- Final prompt (verbatim):

```text
Use case: stylized-concept
Asset type: production website mascot cutout, true transparent RGBA PNG.
Input image 1 is the sole canonical identity reference for Zeno. Create exactly the SAME otter in a new restful seated pose, not a redesigned character. Preserve its precise rounded head and muzzle proportions, small round ears, glossy black oval eyes, rounded black nose and fine whiskers; deep ink-teal short plush fur; cream-white muzzle, throat and large belly patch; and the same lime diagonal crossbody strap with a rounded embossed Z buckle. Match the reference character's refined 3D materials and soft studio illumination.
Pose: the COMPLETE FULL BODY otter is sitting comfortably upright, both feet visible and its tail resting naturally to one side, fully visible and uncut. Both hands rest softly together in front of its lower belly. Head slightly tilted, looking toward the viewer with a tiny calm closed-mouth smile, a quiet companion. The posture feels relaxed and balanced, not waving or holding anything.
Composition: one centered full-body mascot with transparent margin on all sides, enough room for the tail. Keep head, ears, whiskers, paws, feet and tail entirely within the image. No parts clipped. A gentle three-quarter body angle is acceptable while preserving the recognizable face. No setting, furniture, floor, props or other characters.
Background and alpha: genuine 100% transparent pixels outside the character, clean fine-fur alpha edges. This is an isolated web asset for use on cream or dark teal websites. Do not render a backdrop, gradient, black matte, checkerboard, colored halo, glow, fog, floor, solid support or ground shadow.
Constraints: preserve the same character, face, fur colors, proportions, lime diagonal strap and Z buckle. No added text except the existing embossed Z buckle. No watermark, logos in the background, scene elements or accessories. Only the otter silhouette and true transparent surrounding pixels.
```

## Verification

Read-only inspection confirmed RGBA channels, transparent exterior pixels and foreground alpha. Both original PNGs were rendered without modification in a separate headless Chrome instance against `#F3F1E8` and `#163A3A`. This browser rendering, rather than the image tool's RGB preview, confirmed clean transparent surroundings without a visible halo, surface, frame or matte. The head, ears, paws and (for the seated pose) feet and tail remain inside the image. Both poses retain the canonical otter's teal fur, cream face and belly, glossy dark eyes, lime diagonal strap and Z buckle. The seated PNG contains a few near-transparent alpha=1 exterior pixels emitted by the generator; their original alpha is preserved, and no visible background appears in browser inspection.

No website HTML, JavaScript, CSS or existing assets were changed for this asset task.

## Web delivery derivatives — 2026-10-16

The original generated PNGs remain unchanged. The website uses conventional
`cwebp -q 85` derivatives at the original dimensions; this is delivery
compression, not a new generation or a character edit. Read-only decoded
comparison confirms that the alpha channel of each WebP is pixel-for-pixel
identical to its PNG source. The lossy RGB channels are not claimed to be
identical. The published build omits these original PNGs from `static-v2`.

| Web derivative | Dimensions | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `public/assets/static-v2/mascot-peek-v2.webp` | 1536×1024 | 134562 | `8cb171991e15c57627d9bd2818dd8ef7b5553aa4702b0172315e4b718249b91c` |
| `public/assets/static-v2/mascot-rest-v2.webp` | 1014×1551 | 152158 | `6aa533a970f17eaf4c09c09500df08c5fb5670df7a90a41aa4f171aa2180f551` |

Unchanged source PNG SHA-256 values:

- Peek: `6ff108f221ef6137002cd10dacceeb213bd17500e15b17f4ed6fb4093b7927d3`.
- Rest: `b35f25495a718f573040118a664e152fc83cbe9d3f56ae7322e08e5d0edc5b3d`.

Real-size light, dark and reduced-motion browser evidence is recorded in
[design-qa-v2.md](design-qa-v2.md). No extra generation credits were used for
these delivery derivatives.
