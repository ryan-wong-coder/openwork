# 泽诺官网

面向 `https://www.zeno.ryan-wong.cn` 的独立静态官网。部署由自有服务器的 operator 执行，不创建 OpenAI Sites 项目，不依赖 Den、登录或遥测。生日信和私人署名仅留在客户端，不属于官网内容。

## 构建与安全回退

无需安装新依赖，不改仓库 lockfile：

```sh
pnpm --dir apps/zeno-site check
pnpm --dir apps/zeno-site build
```

`zenoWebsiteRefresh` 在 feature registry 中仅面向 `self_hosted`，**默认关闭**。
普通 `build` 生成 `classic/` 旧版；不加载 `motion.js`，不包含新版动效或
`hero-film-v3`、`motion-v2` 或 `static-v2` 资源。官网不通过 Den 或访问者偏好打开此开关。

自有服务器 operator 明确采用新版时：

```sh
pnpm --dir apps/zeno-site build:published
pnpm --dir apps/zeno-site dev
```

`build:published` 读取本目录 `operator-profile.json` 中显式的
`{"features":{"zenoWebsiteRefresh":true}}`。也可直接执行
`node apps/zeno-site/scripts/build.mjs --profile /absolute/path/profile.json`；
profile 仅允许这个布尔开关，非法输入会停止构建。设置 `false` 或重新执行普通
`build` 即生成旧版。资源齐备后构建会重建 `dist/`，不会混入上次的新版入口。新版构建先检查横/竖两部成片与对应技术首帧海报；缺失或空文件会在删除旧 `dist/` 之前明确失败，不静默复用旧动画。

构建产物始终为 `apps/zeno-site/dist/`；预览仅服务这个目录，默认监听
`127.0.0.1:5197`，可用 `ZENO_SITE_PORT` 改端口。因此预览前需确认最后一次构建
选择的是所需版本。开发静态服务器不伪造 API；没有真实发布数据时，页面显示
可重试的不可读取状态，下载按钮不可用。

线上回退仍由 operator 将已验证的旧版构建原子部署到此网站独立目录；构建命令
本身不发布。保留上一份站点构建，不删除或改写持久化的安装包、发布 API、原生
更新 feed 或其他 vhost。网页视觉开关不改变原生 updater。

源码使用原生 HTML/CSS/ES modules、原生 select/details 和现有泽诺美术资源。没有第三方 CDN、字体请求、登录、分析代码、service worker 或浏览器持久化。

## 场景视频与交互

新版首屏是真实 `100svh` 全出血场景视频：水獭编程、分析数据、日常生活，三段
自然衔接为 19.5 秒。白色原 SVG logo、一句中文标题与青柠下载操作覆盖其上，
没有大玻璃卡片。安装说明入口紧随下载元数据，点击后展开页下原生 details；
产品预览、全部包、校验和、许可均在首屏之后渐进呈现。内部产品图片使用浏览器
原生 lazy loading。

影片 `autoplay loop muted playsinline`，无声音、无播放/暂停/招呼/静态模式控件。
这按本轮用户明确要求实现；**低动效偏好下影片仍自动循环**，仅移除界面过渡与
平滑滚动，因此不把本实现宣称为遵守 WCAG 暂停/停止动效的完整方案。技术 poster
直接取对应成片首帧，仅用于加载或浏览器拒绝播放时的回退，不是可选择的背景模式。
影片离屏或文档隐藏时技术性暂停，回到可见区域继续；浏览器返回缓存页时恢复。

原生 `<source media>` 在 700px 以下直接选择 720×1280 手机片，其余选择
1920×1080 横片，不先请求大横片再用 JS 替换。手机保持角色面部可见，下方加深
衬底保障操作对比。发布构建只允许四份最终压缩交付：两份 H.264/yuv420p/24fps/
faststart 无声 MP4 与两份 WebP poster。原参考帧和源片在 `art-source/`，不进
`dist/`。完整生成与编码来源见 [v3 影片来源](hero-film-v3-provenance.md)。

默认 Mac 不猜测 CPU：Apple Silicon / Intel 两条操作直接对应真实发布产物，
大小、格式和签名状态可见；选择芯片后使用唯一下载按钮。原生 select/details
保留键盘与焦点行为，所有下载均为真实链接。没有读取、保存或发送私人内容。

## 自有服务器接入

只发布 `dist/` 内容到此网站独立的站点根目录，保留现有服务器应用。静态网站不会修改桌面更新配置、上游服务或其他 vhost。

服务器需提供同源、公开只读接口：

```text
GET /api/releases/latest.json
```

协议由发布流程生成，包含真实版本、ISO 发布时间、短中文 notes 和 artifacts。每项产物包含 platform、arch、format、name、`/downloads/<version>/<name>` URL、字节 size、sha256、sha512 和 signature。前端只接受本站版本目录下、名称一致、大小与校验和有效的产物。SHA-256 接受 64 位十六进制，SHA-512 接受 128 位十六进制或标准 Base64。空 artifacts 诚实显示尚未发布；不得用测试文件占位。

先上传不可变安装包并验证大小与哈希，再原子替换 `latest.json`。下载服务负责真实文件响应、正确 Content-Type、Range 和缓存；前端不会虚构或补齐缺失平台。部署建议返回 HTML 的安全头并只让该 vhost 的 API 指向发布目录；项目内 CSP 限定资源和连接为同源。

官网不会读取或持有模型密钥、host-token、客户端访问凭据或 SSH 信息。

## 浏览器验收

先 `build:published` 并在 5197 启动本地预览，再用已有 headless Chrome。
以下脚本各自新建并关闭自己的 target，不触碰产品 app tab，不启动 native app：

```sh
ZENO_SITE_CDP=http://127.0.0.1:<port> node apps/zeno-site/scripts/qa-hero-v3.mjs
ZENO_SITE_CDP=http://127.0.0.1:<port> node apps/zeno-site/scripts/qa-v3-regression.mjs
```

- `qa-hero-v3.mjs`：独立 browser context，只拦截自己本地发布 API，响应真实官网
  manifest 的一次 QA 副本并标记 `fixtureOnly: true`。实际验证影片解码与时间推进、
  native 循环、静音/inline、手机专属 source、三场景、首屏元数据、CPU 链接、
  安装入口、离屏暂停/返回继续、低动效下明确要求的影片行为、产品预览与请求边界。
  不下载安装包、不访问剪贴板。证据在 `verification/v3-local/`。
- `qa-v3-regression.mjs`：明确命名 `fixture-` 的包记录，只用于自己 target 的 API。
  覆盖缺失 API、加载、空发布、非法 URL 拒绝/重试、未发布组合、每包校验和、
  原生键盘 disclosure、390px 与暗色。复制成功/拒绝均是页面级 stub，不改系统
  剪贴板。10 张场景截图与结果在 `verification/v3-local/regression/`。

替换数据都不进入 `dist/`。截图不等待闭合 details 中尚未加载的 lazy 图片。
新版记录见 [design-qa-v3.md](design-qa-v3.md)；[v2 设计验收](design-qa-v2.md)、
[v2 动效 QA](scripts/qa-motion.mjs)、[最初版本](design-qa.md) 保留原样作为历史，
其中“自动一次/低动效静图”等是当时的行为，不能用于声称 v3 已通过这些检查。

本地 fixture 证明交互，不能证明线上安装包、签名、部署或原生更新成功。
部署后由 operator 运行 `node apps/zeno-site/scripts/qa-live.mjs <version>`；
它不拦截线上 API、不触发安装包下载，检查真实发布记录与桌面/手机/暗色图，
证据在 `verification/releases/<version>/`。影片 HTTPS/MIME/Range/全量哈希及
安装包与更新 feed 仍须单独执行正式发布验收。

V3 的真实媒体验收另用
`node apps/zeno-site/scripts/qa-hero-live-v3.mjs <version> <website-commit>`：
不拦截公网 API，连续实际播放一整轮后确认循环，重新导航验证手机只取竖片，
采集三场景并核对四份小型媒体的全量哈希/MIME/Range、参考 PNG 的 404 与
既有 party 站点的 200。不下载大型安装包。当前网站提交 `3e74875ff`（首版 `8ccf2cfca` 后补断点切换修复）、客户端下载
1.0.2 已分别真实验收；结果与截图在 `verification/releases/1.0.2/`，详见
[独立上线记录](design-qa-v3.md#独立真实上线验收102)。

## 安装说明依据

macOS 自签安装的安全选项参考 [Apple 的应用安全说明](https://support.apple.com/en-us/102445)。Windows 只保留系统策略与管理员检查方向，参考 [Microsoft 应用与浏览器控制](https://support.microsoft.com/en-us/windows/security/windows-security/app-browser-control-in-the-windows-security-app)，不提供关闭安全保护的命令。未从当前打包配置确认的系统最低版本不作承诺。

视觉与文案遵循仓库 DESIGN.md：P1/P2/P3/P5/P7/P10、S1/S3、V1/V2/V3/V5/V7；V6 的低动效影片例外如上明确记录。版本/安装包是数据状态；签名、安装帮助与完整许可渐进展开。新版导航仅下载、工作台、关于。
