# 泽诺官网

面向 `https://www.zeno.ryan-wong.cn` 的独立静态官网。部署由自有服务器的 operator 执行，不创建 OpenAI Sites 项目，不依赖 Den、登录或遥测。生日信和私人署名仅留在客户端，不属于官网内容。

## 本地

无需安装新依赖，不改仓库 lockfile：

```sh
pnpm --dir apps/zeno-site check
pnpm --dir apps/zeno-site build
pnpm --dir apps/zeno-site dev
```

构建产物为 `apps/zeno-site/dist/`；预览默认仅监听 `127.0.0.1:5197`。可用 `ZENO_SITE_PORT` 改端口。开发静态服务器不伪造 API；没有真实发布数据时，页面显示可重试的不可读取状态，下载按钮不可用。

源码使用原生 HTML/CSS/ES modules、原生 select/details 和现有泽诺美术资源。没有第三方 CDN、字体请求、登录、分析代码、service worker 或浏览器持久化。

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
```

脚本只拦截自己新建 target 的本地发布 API，使用明显命名为 `fixture-` 的测试安装包记录。fixture 不进入 `dist/`，不执行安装包下载。覆盖缺失 API、加载、空产物、外链拒绝、平台/芯片、复制校验和的成功/拒绝回退、键盘 disclosure、390px 与暗色；剪贴板用页面级 stub，避免改动系统剪贴板。截图与结果保存在 `verification/`，结束关闭自己的 target。

浏览器 fixture 证明交互，不能证明真实安装包已构建、签名或发布。正式发布还须对真实 manifest、文件大小/哈希、HTTPS 和实际下载做 operator 验收。

## 安装说明依据

macOS 自签安装的安全选项参考 [Apple 的应用安全说明](https://support.apple.com/en-us/102445)。Windows 只保留系统策略与管理员检查方向，参考 [Microsoft 应用与浏览器控制](https://support.microsoft.com/en-us/windows/security/windows-security/app-browser-control-in-the-windows-security-app)，不提供关闭安全保护的命令。未从当前打包配置确认的系统最低版本不作承诺。

视觉与文案遵循仓库 DESIGN.md：P1/P2/P3/P5/P7/P10、S1/S3、V1–V7。版本/安装包是数据状态；签名、安装帮助与完整许可渐进展开。主导航仅下载、预览、关于。
