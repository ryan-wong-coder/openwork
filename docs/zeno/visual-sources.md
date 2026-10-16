# 泽诺视觉资源来源

日期：2026-10-16。仓库只接入通用 Zeno 品牌、角色和产品参考图；私有原始套件未整体复制进仓库。

## 图像生成与设计参考

品牌标志、应用图标、水獭主形象及首页概念来自本次使用内置 imagegen 制作并确认的视觉套件。模型网关参考随后使用内置 imagegen，基于已经确认的 Zeno 界面方向生成。它们是栅格设计参考，图中的连接状态、模型名和按钮不代表真实保存、连接或部署结果。

| 参考 | 用途与记录 |
| --- | --- |
| [首页参考](visuals/home-reference.png) | 1487 × 1058；真实应用结构与已确认品牌作为参考输入；[生成提示词](visuals/home-reference-prompt.txt)摘录自原始生成记录 |
| [模型网关参考](visuals/gateway-reference.png) | 1487 × 1058；沿用同套品牌，以紧凑字段和折叠高级选项说明方向；[生成提示词](visuals/gateway-reference-prompt.txt)保留实际请求文本 |

实际界面遵循 [`DESIGN.md`](../../DESIGN.md) 的紧凑工作界面规范。保留概念中的纸白 `#F3F1E8`、墨青 `#163A3A`、少量青柠 `#D5EF5A` 和雾青 `#B9CECA`，以语义 token 同时适配深浅色。正文使用 13px，标题不超过 20px，控件沿用现有圆角。生成图中放大的展示文字、宽松侧栏与较大角色没有直接搬入工作界面。

首页保留一处主要输入器、三个简短动作入口与固定 160px 的角色容器；设置使用紧凑行、细分隔线与可折叠内容。没有把参考图做成整张界面贴图，也没有增加渐变、玻璃层或装饰卡片。真实功能、权限、失败状态与响应式布局保留在应用组件中。实际截图及差异记录见 [视觉与交互验收](design-qa.md)。

## LibTV 画布与独立思考姿态

本次通过 LibTV 官方 CLI 导入品牌参考，并以同一水獭主形象生成一张独立姿态。以下标识来自实际 CLI 创建与运行结果：

| 项目 | 记录 |
| --- | --- |
| 私有画布 | [Zeno 视觉画布](https://www.liblib.tv/canvas?projectId=e03fe0863e4a4e2e9c44e6f4b5fd0d42)；访问仍需原有 LibTV 权限 |
| Project UUID | `e03fe0863e4a4e2e9c44e6f4b5fd0d42` |
| 品牌总览参考节点 | `a80deabc-8026-474e-8578-c6fe86c2b795` |
| 水獭主形象参考节点 | `84b0eb77-e992-45e9-8758-88c94d7f6690` |
| 首页参考节点 | `ef639c32-c006-4dd5-be0e-910dadd59128` |
| 思考姿态节点 | `d3d699ad-99c3-428d-ad0f-2e872d754afc`，名称 `Zeno 思考状态` |
| 运行任务 | `20261016140703292738518`，已完成；image-to-image，单图、1:1、high、2K、transparent |
| 模型 | 请求标识 `lib-image-2.5-s`；完成结果显示 `Lib Image 2.5 Pro` |
| 原始输出 | `Zeno 思考状态.png`，2048 × 2048 RGBA；保留在原始套件中 |

[实际思考姿态提示词](visuals/mascot-thinking-prompt.txt)保留请求时的 `{{Image 1}}` 引用；CLI 运行记录将它解析为上述水獭参考节点。已实际打开结果检查身份、完整构图、透明背景与水印情况。画布链接用于来源追溯，应用运行时不依赖 LibTV 画布或其 CDN。

## 运行资源与转换

运行资源位于 [`apps/app/src/assets/zeno`](../../apps/app/src/assets/zeno/README.md)，由 [`ZenoMark`、`ZenoWordmark`、`ZenoMascot`](../../apps/app/src/components/brand/zeno-brand.tsx) 统一使用。

| 资源 | 来源与处理 |
| --- | --- |
| `zeno-logo-{primary,reverse}.svg` | 已确认的透明 logo 原稿经 Potrace 1.16 自动轮廓描摹；保留真实路径，无嵌入位图。它是栅格原稿的矢量衍生稿，非人工校准的原生矢量母版 |
| `zeno-mark-{primary,reverse}.svg` | 同一 logo 原稿中的独立 Z 标志，沿用真实轮廓 |
| `favicon.ico` 与桌面图标 | 已确认的应用图标整图缩放、常规格式转换，保留原方形底图；由平台应用蒙版 |
| `mascot.webp` | 已确认的独立水獭主图按 alpha 边界裁切后缩放为 502 × 768，保留透明通道 |
| `mascot-thinking.webp` | LibTV 独立输出完整画面经 Lanczos 缩放为 768 × 768、WebP quality 92；保留原透明通道，未重绘或重新抠图 |

两张 WebP 已按实际文件检查，均带真实 alpha，包含完全透明与完全不透明的像素；不是把棋盘格当作背景，也不是从九宫格状态表裁成独立素材。角色保持墨青毛色、奶油口鼻与腹部、青柠背带及 Z 扣。

| 文件 | SHA-256 |
| --- | --- |
| `mascot.webp` | `ef3ee149e48c6804a9992c9abf48233fb3120d18b9579c48ef5a2261410b6910` |
| `mascot-thinking.webp` | `abfeeaaed07c09482ece0a9da97abd73339376ef2dab36495c994f3d4899b3d7` |

`ZenoMascot` 的 `welcome` / `thinking` 姿态在同一固定容器中切换，默认作为装饰。当前思考姿态用于存在未发送草稿的首页，不报告模型正在运行、任务进度或执行成功；生成提示词中的“等待状态”没有被用作真实运行状态的依据。
