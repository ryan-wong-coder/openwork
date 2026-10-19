# Zeno 1.0.5 验证记录

验证日期：2026-10-19（Asia/Shanghai）。产品标签 `zeno-v1.0.5` 冻结于
`51310c0200874451e07b46e3c9345d63b681e527`。后续原生验收脚本与证据提交不修改
产品标签、安装包或签名。

## 功能与源码验证

本版新增助手 Markdown 中的 HTML、Canvas、SVG 交互画板，包含本地打包的
Ant Design Charts 2.6.5，支持九种统计图和五种关系图。只有完整闭合的顶层围栏
会执行；追加文字、生成结束、高亮、主题和源码切换均保留画板实例与控件状态。
V1/V2 系统提示词同步引导中文标签、有效交互和适度使用可视化。

专用静态 shell 的 `Connection-Allowlist: ()` 响应头提供原生网络限制，另有
opaque-origin sandbox、CSP 与消息来源/令牌校验。网页需要 Chromium 152+；
桌面端为打包的 Chromium 150 启用对应原生策略。不支持的网页环境保持源码可读，
不执行生成脚本。功能默认关闭，由独立本地部署的共享 operator 配置启用。

| 验证 | 结果与范围 |
| --- | --- |
| 源码回归 | 画板解析/文档 6 项、React 生命周期/桥接 8 项、服务端提示/静态响应 13 项、共享 feature 9 项、原生协议 3 项、Vite 响应 1 项均通过。 |
| 真实组件浏览器 | 14 项检查通过；100 次流式更新后重新加载为 0、状态保留，手机/平板/桌面和明暗模式通过。使用生产组件 fixture，不代表完整应用或真实模型回答。 |
| Ant 图表 | 明暗各 14 类通过实际 canvas 与页面截图像素、缩放、tooltip、筛选、主题和销毁检查；无外部运行时请求、Worker、CSP 违规或渲染异常。 |
| 网络隔离 | Chrome 155 HTTP shell 与 Electron 43.7.7 / Chromium 150 原生协议均有 HTTP/STUN 正向控制；隔离区请求为 0，宿主读取、伪造消息与导航检查通过。 |
| 类型和构建 | app/server/Electron 类型检查、网页生产构建、Electron 相对资源路径构建通过。功能合约与 Helm 配置已生成；可选 Helm 模板渲染因本机未安装 Helm 而未执行。 |
| 发布准备 | 打包/发布门 18 项、updater self-test、官网 5 项通过。实际 server/features 编译结果、原生接线与 Vite chunk 也通过临时 ASAR 布局检查；该检查本身不代表安装包运行。 |

以上均使用合成数据，未调用真实模型。源码与浏览器证据见
[画板说明](../../docs/conversation-canvas.md)、
[组件截图](../../apps/app/verification/conversation-canvas/README.md)、
[图表验证](../../apps/app/verification/canvas-charts/README.md) 和
[网络隔离](../../apps/app/verification/canvas-isolation/README.md)。

## 发布验收

[固定构建 39189963114](https://github.com/ryan-wong-coder/openwork/actions/runs/39189963114)
的六个原生 CPU lane 全部成功，覆盖 macOS、Windows、Linux 各 x64/arm64。
每个 lane 均通过打包后的 server、原生模块、client status 和 host boundary 检查，
以及画板 shell、原生桥接、V1/V2 提示词、共享 feature 与离线 Ant chunk 的存在及
接线门。这里的 Windows/Linux 结果不是桌面 GUI 安装或自动更新验收。

[冻结构建审计](verification/1.0.5/build-release-audit.json) 记录 24 个发布文件、
10 个安装包，合计 3,923,106,602 字节（安装包 3,920,501,918 字节）。全部文件在
上传前已逐一完成完整大小和 SHA-256 校验；原生 feed 的大小与 SHA-512 也与发布
索引一致。自签 Mac 包沿用原版更新身份，未更换签名或移动产品 tag。

[发布门](verification/1.0.5/publication-gate.json) 在服务器端完整核对 24 个上传文件
的大小/SHA-256，并对索引内全部 22 个 lane 文件完整核对大小/SHA-256/SHA-512。
官网于 `2026-10-19T03:18:44.256Z` 原子切换到 1.0.5；官网前端沿用已有部署，
动态读取新的发布 API，未改动视频、样式或其他站点。Nginx 配置检查通过。

[公网 HTTPS 验证](verification/1.0.5/live-release.json) 通过 10 个安装包的 HEAD、
Range、文件头/架构和缓存策略检查，以及六个原生 feed 与公开索引的版本、大小、
SHA-512 一致性检查。[历史下载验证](verification/1.0.5/download-history.json)
保留 1.0.0/1.0.2/1.0.3/1.0.4 共 40 个安装包，公开下载与 updater 路径 HEAD
均通过，80 次首尾 64 字节 Range 与切换前快照一致。这些历史样本不代表完整
公网重新下载的哈希；服务器还确认了历史文件 inode、大小、mtime 未改变。

[真实官网页面验收](../../apps/zeno-site/verification/releases/1.0.5/README.md) 通过六组
平台/CPU 下载 URL 和 SHA-256 检查、macOS 未选 CPU 的下载引导以及手机无横向
溢出检查。桌面、手机、手机暗色三张真实截图已实际查看，页面运行时异常为 0，
请求仅访问官网 origin；未用 mock API 或触发大型安装包下载。

[Mac 原版升级记录](verification/1.0.5/macos-native-update.md) 中，首轮
[run 39194107527](https://github.com/ryan-wong-coder/openwork/actions/runs/39194107527)
的 arm64 已通过真实 1.0.0 → 1.0.5 下载、Squirrel 替换与自动重启，原生和磁盘
版本一致，profile、工作区、会话/消息和内置 server 保留，renderer 异常为 0。
安装后画板使用实际原生 shell 与已安装 Ant lazy module，通过真实策略响应头、
Canvas/SVG 交互、Line/FlowGraph 像素、宿主边界和清理后的历史保留检查；更新后
与画板截图均已实际查看。这是无模型调用的合成画板，不冒充完整 Markdown UI
端到端或所有网络攻击测试，后者由独立源码/浏览器记录覆盖。

首轮 x64 在下载约 11% 时出现 `ERR_CONNECTION_RESET`，尚未进入 staging、
安装、重启或画板检查。[原始失败报告](verification/1.0.5/macos-x64-attempt-1.json)
和[独立服务器传输记录](verification/1.0.5/macos-x64-attempt-1-transport.json)
分别保留：服务器仅发送 52,731,904 / 453,433,252 字节；两端计数差异不能定位
哪个网络节点重置连接。仅 x64 使用相同原版/目标构建与验证提交的
[重试 39194711078](https://github.com/ryan-wong-coder/openwork/actions/runs/39194711078)
已于 `2026-10-19T03:40:49Z` 成功，完整下载 453,433,252 字节，真实替换、自动
重启、签名/ASAR、数据保留及安装后画板检查均通过。两种 Mac 架构现均通过完整
验收，四张成功截图已实际查看；首次 x64 失败及首轮总体失败状态仍单独保留。

[GitHub 1.0.5 正式发行版](https://github.com/ryan-wong-coder/openwork/releases/tag/zeno-v1.0.5)
于 `2026-10-19T03:42:23Z` 公开并设为 latest。
[匿名公开验证](verification/1.0.5/release-public.json) 确认非草稿、非预发布、最新
稳定版，24 个文件的名称、大小和 SHA-256 与冻结构建一致，产品 tag 仍指向原始
`51310c0200874451e07b46e3c9345d63b681e527`。

[发布缓存清理记录](verification/1.0.5/cleanup.json) 在删除本次私有服务器 stage
前，再次完整验证全部 22 个公开 lane 文件的大小/SHA-256，确认公开副本 inode
独立、链接不指向私有 stage，40 个历史安装包身份未改变。仅删除任务临时缓存，
公开下载、已部署站点、历史版本和持续使用的签名配置保留。
