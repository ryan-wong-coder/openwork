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
`static-v2` 资源。官网不通过 Den 或访问者偏好打开此开关。

自有服务器 operator 明确采用新版时：

```sh
pnpm --dir apps/zeno-site build:published
pnpm --dir apps/zeno-site dev
```

`build:published` 读取本目录 `operator-profile.json` 中显式的
`{"features":{"zenoWebsiteRefresh":true}}`。也可直接执行
`node apps/zeno-site/scripts/build.mjs --profile /absolute/path/profile.json`；
profile 仅允许这个布尔开关，非法输入会停止构建。设置 `false` 或重新执行普通
`build` 即生成旧版。构建每次重建 `dist/`，不会混入上次的新版入口。

构建产物始终为 `apps/zeno-site/dist/`；预览仅服务这个目录，默认监听
`127.0.0.1:5197`，可用 `ZENO_SITE_PORT` 改端口。因此预览前需确认最后一次构建
选择的是所需版本。开发静态服务器不伪造 API；没有真实发布数据时，页面显示
可重试的不可读取状态，下载按钮不可用。

线上回退仍由 operator 将已验证的旧版构建原子部署到此网站独立目录；构建命令
本身不发布。保留上一份站点构建，不删除或改写持久化的安装包、发布 API、原生
更新 feed 或其他 vhost。网页视觉开关不改变原生 updater。

源码使用原生 HTML/CSS/ES modules、原生 select/details 和现有泽诺美术资源。没有第三方 CDN、字体请求、登录、分析代码、service worker 或浏览器持久化。

## 动效与无障碍

新版使用真实 Zeno logo、现有水獭、两张新姿态和真实产品截图。工作台预览默认
折叠，内部图片使用浏览器原生 lazy loading。默认 Mac 不猜测 CPU：Apple Silicon / Intel
两条操作直接对应真实发布产物，大小、格式和签名状态在按钮下可见；选择芯片后
使用唯一主下载按钮。

角色自动招呼仅播放一次；可暂停、从当前时间继续或再次招呼。用户暂停保留当前
视频帧，继续入口失焦后仍可达；快速重复招呼保留最后一次播放。离开视口、隐藏
页面、切换低动效或播放结束后回到静态图。`prefers-reduced-motion: reduce`
默认使用坐姿静图，不设置视频 `src`、不自动请求 MP4；显式操作仍可播放。Logo
动效在原生 details 展开前没有 `src`，展开也不自动播放。

原生 select/details 保留键盘与焦点行为；暂停、继续与下载使用真实按钮或链接。
浅色与暗色分别使用品牌资产，暗色视频通过常规视频后处理合成，不新增生成费用。
完整来源见 [静图记录](static-v2-provenance.md)、[动效记录](assets-v2-provenance.md)
及 [暗色后处理说明](motion-postproduction.md)。

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

使用已有 headless Chrome 的独立 target，始终不触碰首个产品 tab：

```sh
ZENO_SITE_CDP=http://127.0.0.1:<port> node apps/zeno-site/scripts/qa.mjs
ZENO_SITE_CDP=http://127.0.0.1:<port> node apps/zeno-site/scripts/qa-motion.mjs
```

先运行 `build:published` 并在 `5197` 启动本地预览。两个脚本都只拦截自己新建
target 的本地发布 API，不触碰产品 app tab，结束关闭自己的 target：

- `qa.mjs`：明确命名为 `fixture-` 的包记录，10 张场景截图，覆盖缺失 API、
  加载、空发布、非法 URL 拒绝与重试、平台/芯片、每包校验和、剪贴板成功/拒绝
  回退、原生键盘 disclosure、390px 与暗色。剪贴板为页面级 stub，不写系统
  剪贴板。结果在 `verification/v2-local/regression/`。
- `qa-motion.mjs`：从真实官网复制一次发布 JSON，仅在自己的本地 target 响应，
  标记 `fixtureOnly: true`。12 项检查、8 张截图，验证 CPU 链接与可见元数据、
  实际视频解码和时间推进、自动一次、暂停/继续、快速招呼、离屏暂停、低动效
  不下载视频、显式 Logo 播放、暗色视频底色与手机布局。只检查安装包 href，
  不下载、不访问剪贴板。结果在 `verification/v2-local/`。

两个脚本的 API 替换数据都不进入 `dist/`。截图不会等待闭合 details 中尚未
加载的 lazy 图片解码。新版视觉报告见 [design-qa-v2.md](design-qa-v2.md)；
[design-qa.md](design-qa.md) 保留旧版历史。

浏览器 fixture 证明交互，不能证明真实安装包已构建、签名或发布。正式发布还须对真实 manifest、文件大小/哈希、HTTPS 和实际下载做 operator 验收。

部署后可运行 `node apps/zeno-site/scripts/qa-live.mjs <version>`。它不拦截线上
API、不触发安装包下载，实际确认版本、10 个产物、六个平台/CPU 组合及
桌面/手机/暗色截图；证据在 `verification/releases/<version>/`。安装包与
更新 feed 的 HTTPS、Range、尺寸和哈希检查仍由发布流程单独完成。

## 安装说明依据

macOS 自签安装的安全选项参考 [Apple 的应用安全说明](https://support.apple.com/en-us/102445)。Windows 只保留系统策略与管理员检查方向，参考 [Microsoft 应用与浏览器控制](https://support.microsoft.com/en-us/windows/security/windows-security/app-browser-control-in-the-windows-security-app)，不提供关闭安全保护的命令。未从当前打包配置确认的系统最低版本不作承诺。

视觉与文案遵循仓库 DESIGN.md：P1/P2/P3/P5/P7/P10、S1/S3、V1–V7。版本/安装包是数据状态；签名、安装帮助与完整许可渐进展开。新版导航仅下载、工作台、关于。
