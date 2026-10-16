# Zeno hero film V3 provenance

Status: all three scene generations, desktop/mobile film encoding, technical posters and asset playback verification completed on 2026-10-16. Website-only assets; no client changes. Live website integration/publication is tracked separately.

## Reference images

Generated with the built-in imagegen tool, opaque environmental frames, using `apps/zeno-site/public/assets/mascot.webp` as the canonical identity reference. Scenes 2 and 3 also referenced the accepted scene 1 room. Originals remain in the imagegen output directory. Reference PNG copies are kept outside `public` in `art-source/hero-film-v3`, so the website build does not publish them.

### coding

Reference: `art-source/hero-film-v3/coding-reference.png` (1672 × 941).

Complete prompt:

```text
Use case: stylized-concept
Create the opening reference frame for a premium animated brand film for Zeno, a personal AI workspace. Use the supplied mascot as the sole character identity reference: exactly the same cute otter, same rounded face and head proportions, tiny round ears, cream muzzle and belly, glossy black oval eyes, rounded black nose and fine whiskers, deep ink-teal short plush fur, and lime crossbody strap with its existing rounded embossed Z buckle. No redesign.

Scene 1, programming at night: the otter sits on a comfortable dark teal desk chair on the RIGHT THIRD of a sophisticated cozy studio, gently typing at a compact keyboard with its natural furry paws. A dark charcoal monitor at the far right shows only a few abstract thin lime and pale teal code-like strokes, not readable text or a real app UI. The face is visible in a friendly three-quarter view, concentrating calmly. Show an actual environmental scene with the otter at work, not an isolated mascot.

Studio continuity: a broad dark matte charcoal desk, elegant deep teal walls, a large curved-top window at the right with distant blurred blue city lights, one small warm amber desk lamp behind the monitor, a quiet plant silhouette at far right. Tactile 3D fur, polished restrained materials, soft cinematic night lighting, subtle lime monitor bounce on the muzzle and paws, thin cool rim light. Refined animated feature film rendering, visually rich but calm.

Composition is critical: landscape 16:9 cinematic frame, intended for a full-screen 1920x1080 website video. The LEFT 55% remains very dark, uncluttered, low-detail negative space with a softly graduated ink-teal wall; no mascot, furniture edges, screens, lamps, bright points or graphic elements on that left half. All action and bright visual interest sit in the right 45%. Leave comfortable margins so the mascot and workstation remain readable when the outer image edges are cropped responsively.

Camera: static wide shot at desk height, natural 50mm perspective, no dramatic wide-angle distortion. The desk forms a quiet grounded foreground on the right only. Soft depth of field. No text, captions, watermarks, additional logos, extra characters, lens flares, fog, bloom halos, split panels or collages. Only the small existing Z buckle is retained. Fully rendered opaque environmental frame, no transparency.
```

### data

Reference: `art-source/hero-film-v3/data-reference.png` (1672 × 941).

Complete prompt:

```text
Use case: stylized-concept
Create a second reference frame in the exact same continuous premium animated Zeno brand film. The first supplied image is the canonical mascot identity; the second image is the approved studio and cinematography reference. Preserve the exact same cute otter identity, same face proportions, small round ears, cream muzzle and belly, glossy black eyes, deep ink-teal short plush fur, lime crossbody strap and rounded embossed Z buckle. Do not redesign the mascot.

Scene 2, data analysis: same otter, same nighttime studio, same desk and same right-third placement, camera distance and angle. The otter is seated at its compact keyboard, one furry paw resting on the trackpad and the other lightly touching its cheek in a thoughtful but friendly pose. Its face is visible in three-quarter profile as it calmly considers a large monitor at the right edge. The screen has elegant abstract chart geometry: a restrained thin lime upward curve, a few soft teal bars and simple dots against charcoal. These are merely graphic light shapes, no letters, digits, readable text, real UI, logos, floating dashboards or additional screens.

Keep the same broad matte dark desk, deep teal walls, curved-top window on the right with distant soft blue city lights, warm amber desk lamp and small dark plant at far right. Tactile premium 3D fur and physical materials, cinematic ink-teal night atmosphere, subtle lime screen bounce on muzzle and paws and thin cool rim light. Camera locked off at desk height in a wide 16:9 shot with natural 50mm perspective and soft depth of field.

Critical layout: preserve the LEFT 55% as dark, uncluttered, low-detail negative space: softly graduated ink-teal wall, no character, screens, light points, window, plants or furniture edges there. All scene action, desk detail and bright points remain in the right 45%. Subject safely inset with generous upper margin. This is a real environmental scene in the same room, not an isolated standing mascot. Calm, intelligent companionship. No captions, watermarks, dramatic flares, haze, bloom, other characters or collages. Fully opaque 16:9 environmental image intended for a 1920x1080 full-screen website film.
```

### life

Reference: `art-source/hero-film-v3/life-reference.png` (1672 × 941).

Complete prompt:

```text
Use case: stylized-concept
Create scene 3 of the same premium animated Zeno brand film. Image 1 is the canonical mascot identity and image 2 is the approved room/cinematography. Preserve exactly the same adorable otter: same rounded head and face proportions, tiny round ears, cream muzzle and belly, glossy black eyes, round black nose and delicate whiskers, deep ink-teal short plush fur, lime crossbody strap with the existing rounded embossed Z buckle. No redesign.

Scene 3, quiet work and life: same otter seated on the same comfortable dark teal chair at the same matte charcoal desk on the RIGHT THIRD, the same nighttime studio and camera. The otter takes a peaceful brief break and cradles a small plain warm ceramic cup with both furry paws in front of its cream belly, subtly tilting its head toward the curved city window at the right. It wears a tiny contented closed-mouth smile. Its face remains clearly visible in three-quarter view. A faint thread of steam rises only near the cup. The monitor at the far right is dim with a simple soft teal glow and no content or text. An open blank notebook with no writing rests near the keyboard. Nothing floating in space.

The exact same studio continues: dark charcoal desk, deep teal walls, curved-top window at right with blurred blue night city lights, small warm amber desk lamp, quiet plant at the far right. Lighting becomes gently warmer around the cup, paws and cheek without brightening the left. Refined tactile cinematic 3D, premium soft short fur, understated materials, soft depth of field, subtle cool rim light. Comfort and companionship, not a dramatic performance.

Critical framing: cinematic wide 16:9 for a 1920x1080 full-screen website background, natural 50mm desk-height view. LEFT 55% is almost empty very dark softly graduated ink-teal wall, no characters, light sources, plants, window, screen, floating interface, furniture edges or decoration. All scene detail, seated mascot, warm lamp and window remain in the right 45%. Leave enough margin around the head. Do not make a cutout or plain-background standing mascot. No text, captions, extra logos, watermark, other characters, flares, fog, strong bloom, split panels or collage. Retain only the little Z buckle. Fully opaque environmental image.
```

## Video generation

LibTV CLI schema inspected using `libtv model search Seedance -t video` and `libtv model star-video2.5` on 2026-10-16. Model: **Seedance 2.5**, key `star-video2.5`; canvas `8e25bf5a3fe14de2b6721a8fb47858ed` (`Zeno Hero Film V3`). Every source scene uses `modeType=image2video`, `count=1`, `ratio=16:9`, `resolution=1080p`, `duration=7`, `enableSound=off`, `search_enabled=0`, `autoCompliance=0`. Non-human character, so auto compliance was explicitly disabled. Reference resources were uploaded through `libtv upload`, connected with `--left`; generation uses `libtv node create ... --run` without HTTP workarounds.

### coding

Resource node: `c00f5fd5-ff9c-4ca2-8370-e501ba805eda`.

Complete video prompt:

```text
以连接的参考图作为严格首帧，制作7秒精致3D电影质感的泽诺品牌氛围镜头。保持同一只深墨青短绒水獭、奶油白腹部和脸型、黑亮眼睛、青柠斜挎带与Z扣，保持整个工作室、桌子、椅子、右侧拱形城市夜景窗和暖色台灯完全一致。水獭在右侧安静编程，双爪小幅自然敲击键盘，眼睛偶尔自然眨眼，头部轻微随注意力移动，胸口细微呼吸。右边显示器仅抽象青柠和浅青代码短线轻微更新，不能出现可读文字、数字、字幕、真实产品UI或新屏幕。固定广角构图，镜头完全锁定，不推拉摇移，不切镜；左55%始终是干净低细节深墨青暗墙，绝对不往左增加任何物体、光点或动画。动作克制、速度舒缓、无夸张表情；毛发身份、手爪形态稳定。没有其他角色、没有闪光、没有眩光、没有大面积亮度变化。头尾姿态尽量接近以便循环。无声。
```

### data

Resource node: `f0471be1-c4c2-46a6-aedc-328e307b026b`.

Complete video prompt:

```text
以连接的参考图作为严格首帧，制作7秒精致3D电影质感的泽诺品牌氛围镜头。保持同一只深墨青短绒水獭、奶油白脸腹部、黑亮眼睛、青柠斜挎带和Z扣，工作室和右侧桌椅、拱形城市夜景窗、暖台灯、植物位置完全一致。右侧水獭安静分析数据，托腮的爪子稳定，一只爪子轻微操控鼠标，视线从图表的一处自然移向另一处，偶尔眨眼，轻轻点头一次。显示器上的抽象青柠曲线和青色柱形缓慢生长或微微变化，只有图形不能有可读文字或数字；不出现悬浮界面、额外屏幕或新道具。镜头完全锁定在参考图的宽画幅，不推拉摇移、不切镜。左55%全程保持干净低细节的深墨青暗墙，不加入光点、物体或运动。动作很小很慢，保持脸和手爪自然稳定，电影级细腻毛发和柔和灯光，城市光点轻微呼吸而不闪烁。不添加角色、字幕、水印、爆闪或镜头光斑。头尾姿态尽量相近便于循环。无声。
```

### life

Resource node: `d02a0fed-e7e3-4e25-8104-f0b5181c15ca`.

Complete video prompt:

```text
以连接的参考图作为严格首帧，制作7秒精致3D电影质感的泽诺品牌氛围镜头。保持同一只深墨青短绒水獭、奶油白脸腹部、黑亮眼睛、青柠斜挎带与Z扣，保持原来的夜色墨青工作室、桌椅、右侧拱形城市窗、暖台灯与空白笔记本位置。水獭在右侧安静抱着咖啡杯休息，双爪轻轻捧杯保持完整稳定，呼吸细微，头轻轻转向窗景后回到开始的方向，温柔自然眨眼，闭嘴微笑；杯口只有一缕很淡的蒸汽缓缓上升。不要喝水或杯子遮脸，不新增物体、文字或角色。显示器保持暗淡青色，窗外夜景细微柔和，不闪烁。镜头完全锁定，不推拉、不摇移、不切镜，左55%始终是空净低细节的墨青暗墙，不加入任何物体、光源或运动。动作舒缓克制，柔和暖光，不爆闪、不眩光、不改变角色外形，电影级细腻3D材质。头尾尽量同姿态方便循环。无声。
```

## Final source tasks and files

All three CLI runs reached terminal `status=2`, `progress=100%`.

| Scene | Video node | Task ID | Original source (local, not published) |
| --- | --- | --- | --- |
| Coding | `06964a12-0633-4ed3-bc6e-95347c2e6bbf` | `20261016212403590738518` | `tmp/zeno-hero-film-v3/raw/Zeno V3 coding film.mp4` |
| Data | `89a43044-7a4b-4760-a5bd-ac64445bdee5` | `20261016212403597628518` | `tmp/zeno-hero-film-v3/raw/Zeno V3 data film.mp4` |
| Life | `546a6716-87cd-4c14-b05b-2b808ec52d00` | `20261016212403033728518` | `tmp/zeno-hero-film-v3/raw/Zeno V3 life film.mp4` |

Reference imagegen originals remain under `$CODEX_HOME/generated_images/01a1434c-8a23-7c83-8dce-5f89db3eaee6/`:

- Coding: `exec-13f223b0-3e67-4a23-aab0-5f296558a41b.png`
- Data: `exec-0cdfb98d-08d6-4e2c-86ce-f349cb9686c2.png`
- Life: `exec-da9f9b4d-d9b0-4c7b-a9b3-9c99458a2704.png`

Original videos were downloaded through the CLI, for example:

```sh
libtv download -n 06964a12-0633-4ed3-bc6e-95347c2e6bbf \
  -p 8e25bf5a3fe14de2b6721a8fb47858ed \
  -o tmp/zeno-hero-film-v3/raw --without-ai-watermark
```

The optional LibTV video-watermark helper returned HTTP 404, but the CLI successfully downloaded each original video and exited 0. The SHA-256 of each downloaded source equals the content hash in its generated source filename. Actual frames show no added watermark. No custom download/API workaround was used.

## Ordinary video postproduction

No semantic image editing, drawn replacement mascot, generated fake product screen, or synthetic still animation was used. FFmpeg only normalizes frame timing, trims, dissolves, crops, compresses, and extracts the actual video first frame. The reference images are generated opaque environmental scenes, not transparent assets.

The three source files are each 1920 × 1080, 24 fps, 169 frames / 7.041667 seconds, HEVC 10-bit, with no audio stream. Each is trimmed to 168 frames / 7 seconds. Cross-dissolves of 12 frames / 0.5 seconds join coding → data, data → life, and life → coding. Trimming the opening 0.5 seconds after the final wraparound dissolve creates a 468-frame / 19.5-second loop. Cross-dissolves intentionally briefly blend the adjacent poses; they are not extra character limbs in a source scene.

Exact desktop encode (from repository root):

```sh
ffmpeg -hide_banner -loglevel warning \
  -i 'tmp/zeno-hero-film-v3/raw/Zeno V3 coding film.mp4' \
  -i 'tmp/zeno-hero-film-v3/raw/Zeno V3 data film.mp4' \
  -i 'tmp/zeno-hero-film-v3/raw/Zeno V3 life film.mp4' \
  -filter_complex '[0:v]fps=24,trim=duration=7,setpts=PTS-STARTPTS,setsar=1,split=2[a][h];[h]trim=duration=0.5,setpts=PTS-STARTPTS[head];[1:v]fps=24,trim=duration=7,setpts=PTS-STARTPTS,setsar=1[b];[2:v]fps=24,trim=duration=7,setpts=PTS-STARTPTS,setsar=1[c];[a][b]xfade=transition=fade:duration=0.5:offset=6.5[ab];[ab][c]xfade=transition=fade:duration=0.5:offset=13[abc];[abc][head]xfade=transition=fade:duration=0.5:offset=19.5,trim=start=0.5:end=20,setpts=PTS-STARTPTS,format=yuv420p[out]' \
  -map '[out]' -an -c:v libx264 -preset slow -crf 23 \
  -maxrate 2300k -bufsize 4600k -profile:v high -level:v 4.1 \
  -movflags +faststart -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -y apps/zeno-site/public/assets/hero-film-v3/hero-worklife-v3.mp4
```

The mobile derivative uses the same finished film and timing, cropped around the right-hand mascot/workstation: source crop `608:1080:1040:0`, then Lanczos scale to 720 × 1280. The face, ears, both paws, strap/buckle and keyboard are kept in frame. This is a video source for mobile, not a user-selectable static mode.

```sh
ffmpeg -hide_banner -loglevel warning \
  -i apps/zeno-site/public/assets/hero-film-v3/hero-worklife-v3.mp4 \
  -vf 'crop=608:1080:1040:0,scale=720:1280:flags=lanczos,setsar=1' \
  -an -c:v libx264 -preset slow -crf 23 -maxrate 1400k -bufsize 2800k \
  -profile:v high -level:v 4.0 -pix_fmt yuv420p -movflags +faststart \
  -y apps/zeno-site/public/assets/hero-film-v3/hero-worklife-v3-mobile.mp4
```

Both technical posters are their corresponding finished video's decoded frame 0. FFmpeg extracts a PNG without modifications, then `cwebp -quiet -q 86` encodes it. They are only for loading/browser decode fallback; no pause or static-mode control was designed.

## Delivered website assets

| File under `public/assets/hero-film-v3/` | Properties | Bytes |
| --- | --- | ---: |
| `hero-worklife-v3.mp4` | H.264 High 4.1, yuv420p, 1920 × 1080, 24 fps, 468 frames, 19.5s, no audio | 1,850,779 |
| `hero-worklife-v3-mobile.mp4` | H.264 High 4.0, yuv420p, 720 × 1280, 24 fps, 468 frames, 19.5s, no audio | 1,291,194 |
| `hero-worklife-v3-poster.webp` | 1920 × 1080, opaque, actual desktop frame 0 | 54,868 |
| `hero-worklife-v3-mobile-poster.webp` | 720 × 1280, opaque, actual mobile frame 0 | 43,532 |

Both MP4s have their `moov` atom at byte 32, before `mdat` (desktop byte 6476; mobile byte 6498), confirming faststart rather than assuming the encode flag worked.

## Actual inspection and playback verification

Completed on 2026-10-16:

- Viewed all three generated reference images at full preview size, then inspected four samples from each generated source clip (0/2/4/6 seconds). Same otter identity and room, stable face/paws, gentle movement, no extra character or visible watermark, no readable fake UI.
- Viewed the six-sample finished film sheet `art-source/hero-film-v3/film-contact.jpg` (frames 0, 96, 192, 288, 384, 467).
- Viewed `art-source/hero-film-v3/transitions-contact.jpg`: rows are coding→data, data→life, life→coding; each has pre-transition, start, midpoint and final transition frames. The brief middle exposure is an intentional 0.5-second dissolve. No hard flash or scene-camera cut appears.
- Viewed the mobile poster and independent 390 × 844 browser preview. Right-side crop preserves the mascot's head, paws and keyboard; mobile website overlay integration is owned by the website UI task and is outside this asset verification.
- Both finished files passed `ffmpeg -v error -xerror -i FILE -f null -` with exit 0.
- Independent headless Chrome (no shared default target) successfully decoded both videos at `readyState=4`, `paused=false`, correct intrinsic dimensions and duration 19.5. Each was played then sought to 19.2s; after 0.9 seconds each wrapped to approximately 0.30s with `error=null`, confirming real loop playback.
- This verifies the assets and browser decoding; live site/network publication and full website QA remain with the root and website UI task.

## SHA-256

```text
e0a2d75607370e67d30a77947dd7e79b8be3cccd1b41d44f6d6c0f9ba5e24ae4  art-source/hero-film-v3/coding-reference.png
80c9a8e3e4a656cd214a94734a3e6edd2184bd14e7c3fd96f3fe1ef79036d4d8  art-source/hero-film-v3/data-reference.png
867357c0fdb1e1b64db28acf7baede7cf56d2ff2c4b839f75d66f41b9f78686a  art-source/hero-film-v3/life-reference.png
e541d9c52837d31a631e8e49d1c15ec10b7af1491185faab68ba5265be94bd5d  tmp/zeno-hero-film-v3/raw/Zeno V3 coding film.mp4
60525170f5e11ba4849bac5f834448c800d3d3d59731ac7e8cfeb160f257d35c  tmp/zeno-hero-film-v3/raw/Zeno V3 data film.mp4
ba1ef5121801b1aa75cc3df72d858f4a50a02c4d10cd7bf4c7a4845234ab5a78  tmp/zeno-hero-film-v3/raw/Zeno V3 life film.mp4
8e367f00d7c3c1e2ccb59de28d7def61835ec8ee058f815ccfb130d2bc316d97  public/assets/hero-film-v3/hero-worklife-v3.mp4
fab71f2fbd0d2ca8bd49aa75977eb2e5d75e0179642e95d89460f8e621092a31  public/assets/hero-film-v3/hero-worklife-v3-mobile.mp4
25608f0e5d6ba9ad162dc87480e231f6adfefea7306e3dd991a81e48f1aaffe4  public/assets/hero-film-v3/hero-worklife-v3-poster.webp
e353c3285bb7398d03493f2f667dbabddaf550f40eac6b018c2131b4ad4ffd91  public/assets/hero-film-v3/hero-worklife-v3-mobile-poster.webp
```


