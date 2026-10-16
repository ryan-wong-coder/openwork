# 泽诺官网 v3：全屏场景影片

final result: passed (local implementation and deployed HTTPS verification; explicitly requested presentation scope)

2026-10-16。仅官网改版，未修改客户端、版本/tag、更新 feed 或发布包。本地
`build:published` 已完成；本报告不把本地结果写成正式 HTTPS 部署通过。

首屏采用水獭编程、分析数据、日常生活三场景影片，白色原 SVG logo、一句标题
与青柠下载操作覆盖画面；桌面右侧保留角色，390px 使用真实竖版裁切。移除旧的
白底站立区、打招呼、暂停和 Logo 第二视频。完整生成/后处理记录见
[影片来源](hero-film-v3-provenance.md)。

## 独立真实上线验收：1.0.2

本节独立于下方的本地 fixture 历史。官网初次提交 **`8ccf2cfca`** 已部署，
窗口断点修复后的当前提交为 **`3e74875ff`**，实际访问
[正式官网](https://www.zeno.ryan-wong.cn)，实际发布 API 与客户端下载版本为
**1.0.2**。2026-10-16 13:54–13:56 UTC 对修复版本重新实际执行：

```sh
node apps/zeno-site/scripts/qa-live.mjs 1.0.2
node apps/zeno-site/scripts/qa-hero-live-v3.mjs 1.0.2 3e74875ff
```

[live-qa.json](verification/releases/1.0.2/live-qa.json) 确认真实 API 的
10 个产物、六种平台/CPU 组合与对应 SHA-256，3 张实际截图、0 Runtime exception，
页面请求仅本站 origin。安装包只核对链接，未触发下载。

[hero-live-qa.json](verification/releases/1.0.2/hero-live-qa.json) 为
**13 项通过、10 张截图、0 Runtime exception**，`fixtureOnly: false`、
`apiIntercepted: false`。独立 browser context/target，未启用 Fetch 拦截，也未
伪造自动播放所需 user gesture。先不 seek 连续观察 **20,536ms**，真实媒体时间
最高 **19.358s**，自动 wrap **1 次**、pause **0 次**，证明 19.5s 整轮实际播放
并自动循环；之后单独 seek 取三场景证据。其余检查包含真实 CPU href、安装说明、
离屏暂停/回视口继续、无暂停/静态切换控件、低动效下按用户要求持续影片、真实
产品预览。390×844 首次导航只请求 `hero-worklife-v3-mobile.mp4`，没有先下载
横片；对应首帧 poster 正确，元数据与安装入口处于首屏内，无横向溢出。

13 张修复后线上图（10 张影片/交互 + 3 张通用 live）均已实际查看，无未处理的
P0/P1/P2。独立设计复核也确认本地桌面/手机层级、按钮可辨与生活场景识别正常。

首次线上审查发现 P2：桌面窗口缩窄时浏览器保留横片，手机焦点会裁到空墙。
[修复前手机](verification/releases/1.0.2/before-resize-fix/site-live-mobile.png) 与
[采集状态](verification/releases/1.0.2/before-resize-fix/capture.json) 保留原样。
修复仅在跨 700px 断点时先同步 poster、再 load 原生 source 并按可见性恢复播放；
首次加载不调用 load，不重复下载影片，未更改构图或素材。
本地 [5 项专项](verification/v3-local/resize/resize-qa.json) 和线上新增第 13 项均
确认横→竖、竖→横 source 正确且时间推进，muted/loop 保留；首次横片/竖片均只
请求一次。本地还实测离屏 resize 保持暂停、回视口继续。通用 live 脚本的截图
另等待新 source 解码，避免把正常异步加载瞬间误当最终画面。

| 实际线上状态 | 证据 |
| --- | --- |
| 桌面：编程 / 数据 / 生活 | [编程](verification/releases/1.0.2/hero-live-01-desktop-coding.png) · [数据](verification/releases/1.0.2/hero-live-02-desktop-data.png) · [生活](verification/releases/1.0.2/hero-live-03-desktop-life.png) |
| 手机：编程 / 数据 / 生活 | [编程](verification/releases/1.0.2/hero-live-06-mobile-coding.png) · [数据](verification/releases/1.0.2/hero-live-07-mobile-data.png) · [生活](verification/releases/1.0.2/hero-live-08-mobile-life.png) |
| 真实安装说明与产品预览 | [安装](verification/releases/1.0.2/hero-live-04-install-help.png) · [预览](verification/releases/1.0.2/hero-live-10-workspace-preview.png) |
| 暗色偏好 / 低动效偏好 | [桌面暗色](verification/releases/1.0.2/hero-live-05-desktop-dark.png) · [手机低动效](verification/releases/1.0.2/hero-live-09-mobile-reduced-motion.png) |
| 通用线上下载选择 | [桌面](verification/releases/1.0.2/site-live-desktop.png) · [手机](verification/releases/1.0.2/site-live-mobile.png) · [暗色手机](verification/releases/1.0.2/site-live-mobile-dark.png) |

[hero-media-live.json](verification/releases/1.0.2/hero-media-live.json) 记录真实 HTTPS
全量获取四份最终媒体（仅 1.85MB/1.29MB 影片与两个小型 poster）：字节数与本地
`dist` 完全相等，SHA-256/SHA-512 已记录；MP4 的 MIME 为 `video/mp4`，WebP 为
`image/webp`。四文件 `bytes=0-63` 均真实返回 **206**、正确 Content-Range 和前
64 字节。三参考 PNG 在 `/assets/hero-film-v3/` 与 `/art-source/hero-film-v3/`
的六个公开探测路径均 **404**；既有
[party 网站](https://www.party.ryan-wong.cn) 真实返回 **200**。

此轮没有替换公网 API、下载大型安装包、访问剪贴板、写真实配置或改变客户端。
浏览器测试结束自有 target/context 均已关闭。V2 的 live 证据保持原样，未用于
这次 v3 passed；本节也不替代原生安装/更新的独立验收。下方低动效/无暂停的
用户明确取舍及少量 cover 裁切限制继续适用。

## 实际证据与比较

本轮 [hero-qa.json](verification/v3-local/hero-qa.json) 为
`passed: true`：**11 项检查、10 张截图、0 Runtime exception**。只在独立
browser context/target 的本地 API 响应一次真实官网 manifest 的副本，
`fixtureOnly: true`；读取时真实客户端发布版本为 **1.0.0**。不会把官网“v3”
称作客户端 3.0，也不从页面截图推断 1.0.2 的发布状态。

桌面 **1440×1000**、窄屏 **390×844**、像素密度 1；前后图同视口、同为 Mac
UA/CPU 未选。窄屏保留 Mac UA 是为了检验两条 CPU 下载入口，不代表手机会被
自动识别为 Mac。Before 来自已归档 v2 本地真实发布副本验收，After 为本轮：

| 状态 | Before（v2 历史） | After（v3 本轮） |
| --- | --- | --- |
| 桌面 | [1440×1000](verification/v2-local/01-desktop-motion.png) | [1440×1000](verification/v3-local/01-desktop-coding.png) |
| 窄屏 | [390×844](verification/v2-local/05-mobile-light.png) | [390×844](verification/v3-local/06-mobile-coding.png) |

前后构图变化由用户明确要求：不再纸白分栏与独立站姿角色，改为全出血场景影片。
没有逐像素克隆生成参考图；界面保留 13px 基础字号/20px 标题，大尺寸品牌是
准确的既有 SVG。安装帮助从默认信息区移到页下，同时首屏保留短入口。（P1/P3/P7/V1）

10 张最终图均已逐张实际查看。角色面部和身份特征正常，三场景可辨，
高对比 CTA 与文件元数据未被画面遮挡；未发现阻断本次视觉或下载流程的问题。

| 实际状态 | 图 |
| --- | --- |
| 桌面编程 | [01](verification/v3-local/01-desktop-coding.png) |
| 桌面数据 | [02](verification/v3-local/02-desktop-data.png) |
| 桌面生活 | [03](verification/v3-local/03-desktop-life.png) |
| 首屏安装入口展开并滚达 | [04](verification/v3-local/04-install-help.png) |
| 暗色偏好桌面 | [05](verification/v3-local/05-desktop-dark.png) |
| 窄屏编程 | [06](verification/v3-local/06-mobile-coding.png) |
| 窄屏数据 | [07](verification/v3-local/07-mobile-data.png) |
| 窄屏生活 | [08](verification/v3-local/08-mobile-life.png) |
| 低动效偏好，影片仍按要求循环 | [09](verification/v3-local/09-mobile-reduced-motion.png) |
| 真实工作台预览展开 | [10](verification/v3-local/10-workspace-preview.png) |

## 五个必查面

| 面向 | 检查与结果 |
| --- | --- |
| 字体/层级 | 系统中文字体，无外部字体；13px 基础控件、20px 标题。左侧品牌和下载构成同一焦点，元数据用 10–11px 安静小字，未放到仅悬停可见的 title 中。V1/P6/P7。 |
| 间距/结构 | 100svh 首屏、透明页头，平面操作区，无玻璃卡片或卡片套卡片；信息详情位于页下原生 disclosure。桌面有系统滚动条时影片填满可用内容宽度，窄屏 390px 完整覆盖且无横溢。P2/P3/S1/S3。 |
| 颜色/状态 | 墨青场景、白色原标识和青柠主操作，暗衬底保障对比；正常状态不用警告色。错误、加载、空发布、未发布架构分别保留真实状态和重试/选择方向。V2/V3/V7。 |
| 图像/影片 | 实际解码横版 1920×1080、竖版 720×1280，19.5s、无音轨；三场景均查看。25% 手机焦点位置改善 cover 对左耳的裁切；生活场景最左毛边仍略裁切，不影响面部或操作。原生 media source 使手机只请求竖片，poster 是同一影片真实首帧。P5/P10/V5。 |
| 文案/内容 | 一句标题、真实版本/格式/大小/签名，安装入口短标签；完整 SHA、安装安全方向和 MIT/OpenWork 归属保留。没有公开生日信、私人署名、假下载或官方账号入口。P1/P2/P3/C1/C5/C6。 |

影片上的暗色渐变仅用于保持文字对比，不是额外品牌装饰。网站继续沿用既有
Zeno 自有品牌变量；未把官网构图或配色反向改到客户端。

## 11 项真实浏览器检查

执行 `node apps/zeno-site/scripts/qa-hero-v3.mjs`，没有给自动播放检测伪造
user gesture。结果见 [报告](verification/v3-local/hero-qa.json)：

1. 原生 autoplay、loop、muted、playsinline；真实解码与时间推进；仅一个 video，
   无暂停/招呼/静态切换/第二 Logo 视频节点。
2. 默认 Mac 两条快捷链接对应实时公开 manifest 的 Apple Silicon / Intel 产物；
   格式和真实 MiB 可见，不显示禁用主操作占位。
3. 编程、数据、生活三个实际时间点解码并截图。
4. 临近 19.5s 片尾后 native 循环回到开头，未人工重启播放器。
5. 明确选择 CPU 后唯一下载 href 对应正确的公开产物。
6. 安装入口展开并滚达正确说明，自签/Apple 公证方向保留；离屏影片暂停、回到
   可见区域继续。隐藏文档的暂停由 visibilitychange 实现，未把它另算浏览器实测。
7. 暗色偏好仍有正常影片和文字对比，桌面无横溢。
8. 390×844 首次加载只请求竖版 MP4，尺寸正确；三场景均截图，文件元数据和
   安装入口在首屏内，横向 scrollWidth=390。
9. 低动效偏好仍按用户要求播放影片；界面过渡为 0s、滚动 auto，未错误声称静态模式。
10. 用户展开真实工作台预览后图像加载正常，OpenWork 与许可入口保留。
11. 0 Runtime exception、无外部页面请求、无安装包请求。没有访问系统剪贴板，
    测试结束 target 关闭、browser context 销毁。

## 功能回归和构建

`pnpm --dir apps/zeno-site check`：**5 单元测试通过**，三份生产 JS 语法检查通过。

`node apps/zeno-site/scripts/qa-v3-regression.mjs`：10 张场景截图、0 Runtime
exception，独立 target 已关闭。原 [v2 脚本](scripts/qa.mjs) 和历史证据不变。
本轮结果在 [browser-qa.json](verification/v3-local/regression/browser-qa.json)：

- 本地真实缺失 API：无下载 href；加载中保留目的区域。
- Mac CPU 未选/已选、缺少架构、空 artifacts、非法外站 URL 后重试。
- 全部包、按具体格式切换对应 SHA；SHA-256 复制成功与 SHA-512 拒绝回退均为
  页面级 stub，未写系统剪贴板。
- 原生 details 的 Enter 展开、390px 安装帮助、暗色/低动效布局。

构建还实际执行默认 `build` → 明确 `build:published`：默认产物 HTML 与
`classic/index.html` 完全相同，未交付 motion.js、hero-film-v3、motion-v2 或
static-v2；随后恢复新版。新版 hero 目录严格仅有四份最终影片/poster，不包含
参考 PNG、源视频或旧站姿动画；缺失/空资源在移除旧 dist 前明确抛错。旧站点
安全回退不依赖 Den 或访问者存储。（P10/C6）

## 明确约束与边界

- 用户明确要求“不需要提供暂停和静态背景”。影片因此在低动效偏好下仍自动
  循环，不提供用户可见的停止控件。这是本次明确设计取舍，**不声明完全符合
  WCAG 暂停/停止动效或 DESIGN V6 的低动效要求**。未通过隐藏按钮或伪造静图
  报告来规避这个限制。浏览器限制播放时只保留技术首帧 poster。
- 技术离屏/隐藏暂停用于节省资源；不会生成用户模式或修改持久化偏好。
  BFCache 返回继续已实现，但未把它计入 11 项实际检查。
- 首轮检查发现的窄屏 cover 左耳轻微裁切已调整焦点并重建、重新截图；最终
  三场景均查看；生活场景最左毛边仍有少量 cover 裁切，作为非阻断 P3 限制保留。横片/竖片的 0.5s 交叉淡化是有意衔接，未伪称完全没有混合帧。
- 本地检查不证明公网影片 MIME/Range/hash、HTTPS 部署、客户端下载或自动更新。
  正式部署验收应在独立上线证据中追加，不挪用 v2 的 live passed。
- 未做完整读屏、所有浏览器/系统/缩放、慢网或省流模式审计；未新增第三方请求、
  私人内容、密钥或签名访问 URL。

[design-qa-v2.md](design-qa-v2.md) 和 [design-qa.md](design-qa.md) 保留历史。
