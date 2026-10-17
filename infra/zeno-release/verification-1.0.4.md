# Zeno 1.0.4 验证记录

验证日期：2026-10-17（Asia/Shanghai）。产品标签为 `zeno-v1.0.4`，产品提交为
`87ad6877b778cb9e69493f61b6915e688bcbd6b5`。

本记录是冻结产品标签之后的文档，不修改产品源码、标签或安装包字节。源码回归、
固定原生引擎合成检查及两次真实图片识别已完成。六平台构建、官网更新源、下载
与历史链接检查均已通过。macOS 双架构原版实际升级通过，GitHub Release 已公开
并设为 latest；首次 arm64 下载中断记录及成功重试分别保留。

## 已完成：两个根因与修复

第一处根因在网关模型物化：旧版为所有对话模型写入 `attachment: false` 和
`modalities.input: ["text"]`，模型目录解析也没有保留图片输入能力。V1 和 V2
会依据该声明把图片替换为“不支持图片”的提示文本，再交给模型。因此用户看到的
拒绝可能来自本地引擎生成的提示，并不证明真实网关拒绝了图片。

对应的固定版本原始行为可查
[V1 1.18.30 的 unsupportedParts](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/provider/transform.ts#L385)
和 [V2 2.0.26 的 unsupportedMedia](https://github.com/anomalyco/opencode/blob/v2.0.26/packages/core/src/session/model-request.ts#L122)。
本版将经过校验的图片输入声明传到 V1 的 `modalities` 和 V2 的
`capabilities.input`；明确的 text-only 模型仍保持不支持图片。

第二处根因在客户端 V2 适配器：旧代码只把附件转换成名称标记和工作区路径说明，
原生 `/api/session/:id/prompt` 请求只有 `text`、`skills`，没有 `files`。这使
模型首轮收不到图片，需要额外读取文件。本版依据固定
[V2 PromptInput schema](https://github.com/anomalyco/opencode/blob/v2.0.26/packages/schema/src/prompt-input.ts)
传递 `files: [{uri, name?}]`，允许已知 PNG/JPEG/GIF/WebP 的 data URI 和 file URI。
data URI 保留原始 MIME 与字节；file URI 的真实 MIME 由原生引擎按字节识别。

原有混合文本、附件顺序标记、路径说明、skills、system、模型选择与 agent
迁移保留。普通文本不增加 `files`；PDF、未知二进制、未支持图片格式及远程 URL
维持原处理，不因这项修复自动改为原生图片附件。

## 已完成：31 个精确型号的能力证据与保守边界

离线补全表覆盖 **31 个完整 ModelHelm 路由 ID**。每个型号的对应厂商一手文档
已实际打开并核对图片输入声明，逐项映射和明确排除项见
[图片能力来源](../../apps/server/test/fixtures/gateway-image-capabilities-sources.md)。

该表仅适用于精确官方基址 `https://api.modelhelm.com/v1` 和列出的完整 ID。
它证明厂商声明的图片输入能力，**不表示 31 条 ModelHelm 路由全部做过真实传图**。
本版只有下文列出的两个型号做了真实网关图片识别；其余路由的实际可用性、限制和
协议兼容性没有用这两次结果代替验证。

解析器只保留 `{image?: boolean}`，支持文档列出的 input/vision 声明形状；有效
声明冲突时保留 false，明确远端 false 优先于离线表。`attachment`、模型名称、
同系列名称、图片输出、PDF/音视频或图片生成功能不构成图片输入证据。
新别名、未知型号及自定义 endpoint 没有猜测性补全；自定义网关可以通过自己的
有效目录声明图片输入。远程 SDK、URL、provider 和 options 不会随能力目录注入。

## 已完成：旧配置恢复、所有权与凭据绑定

有效私有目录缓存和无缓存旧配置均有离线启动恢复回归；无需为了本次补全重新填写
key。未配置、清空或无效绑定不会被标记为就绪。

旧版没有 provenance 时，只能识别完整旧生成形状：必要字段、text-only 声明及
允许的生成字段必须匹配，不能有额外自定义或不同值。复杂、明确自定义的输入声明、
SDK、options 等不靠名称推断为旧自动值，也不会被迁移规则直接替换。该形状判断
不是对历史配置来源的完整证明，不能声称识别出所有人工改动。

新生成配置在私有 provider options 中保存图片默认值 snapshot、显式覆盖标记及
周围非图片模型配置的稳定 signature。只有仍符合所属默认值且 signature 匹配的
图片字段才继续由程序管理；用户修改后的完整自定义 modalities、SDK 和 options
保留。显式 text-only 修改持久标记，反复目录重建和启动不会再次开启图片。

snapshot 另绑定 URL+key 的 `catalogFingerprint`，不保存上游明文 key。
生产 restore、save、sync 三条物化路径都传入绑定，构建继承、public readiness 和
readOnly readiness 都校验。换 endpoint/key 不继承旧覆盖；已有新 snapshot 而
catalog 缺失、同 endpoint 外部轮换 key 时，恢复移除旧 provider、返回未就绪，
等待当前绑定的目录同步。无绑定的旧版本兼容迁移与新绑定校验是不同路径。

交叉审查发现并修复的两个 P2 均已加入回归，二次只读审查未发现这两点的剩余 P2：

| 边界 | 修复与回归 |
| --- | --- |
| 旧默认为 text-only，用户增加自定义 SDK/options 并保留该输入声明，远端后来改为 `image:true` | 仅比较图片字段不足以判断所有权；新增周围模型配置 signature，变化后转为 explicit，连续三次 rebuild 保留 text-only、SDK、options。 |
| 新 snapshot 已有远端图片声明，catalog 缺失且同 endpoint 外部更换 key | snapshot 增加 URL+key 绑定，所有生产入口和 readiness 校验；恢复删除旧 provider，第二次启动幂等且不恢复旧声明。 |

对应实现与回归为
[gateway-image-config.ts](../../apps/server/src/gateway-image-config.ts)、
[网关物化与恢复](../../apps/server/src/gateway-config.ts) 和
[gateway-image-config.test.ts](../../apps/server/test/gateway-image-config.test.ts)。

## 已完成：回归、类型和打包静态检查

以下结果均在两个 P2 修复后成立；前端与后端分组独立，不把局部重跑重复累计。

| 分组 | 成功执行 | 结果与证明范围 |
| --- | --- | --- |
| 后端 8 文件 | 在 `apps/server` 执行 `pnpm exec bun test test/gateway.test.ts test/gateway-security.test.ts test/gateway-restore.test.ts test/gateway-model-capabilities.test.ts test/gateway-capability-restore.test.ts test/gateway-native-model-render.test.ts test/gateway-image-capabilities.test.ts test/gateway-image-config.test.ts` | **85 tests / 1026 assertions，0 fail**。覆盖能力解析、精确 ID、远端否定、缓存往返、V2 render、旧配置迁移、显式覆盖与绑定。 |
| 前端 V2 HTTP 适配器 | 在 `apps/app` 执行 `pnpm exec bun test tests/opencode-v2-image-prompt.test.ts tests/model-effort-v2-adapter.test.ts tests/opencode-v2-agent-map.test.ts` | **8 tests / 46 assertions，0 fail**。捕获真实 localhost `/prompt` 请求，核对混合文本、多图 data/file URI、文件名、非图片兼容、skills/system 和模型选择失败不发图。 |
| 两个 P2 的独立复跑 | 在 `apps/server` 执行 `pnpm exec bun test test/gateway-image-config.test.ts` | **13 tests / 60 assertions，0 fail**；这是上述 85 项的子集，不另加总。 |
| 类型检查 | `pnpm --dir apps/server typecheck`、`pnpm --dir apps/app typecheck` | 均通过；原生合成 fixture、共享上游及 opt-in live fixture 的独立 strict TypeScript 检查也通过。 |

前端具体回归在
[opencode-v2-image-prompt.test.ts](../../apps/app/tests/opencode-v2-image-prompt.test.ts)。
源码差异检查通过。本版没有新画 UI；上述检查不提供 GUI 端到端截图证据。

版本调整后的打包检查已通过：

```sh
node --test apps/desktop/test/zeno-packaging.test.mjs apps/desktop/test/zeno-artifacts.test.mjs infra/zeno-release/prepare-publication.test.mjs
node apps/desktop/scripts/zeno-update-smoke.mjs --self-test
```

第一条 **15 pass / 0 fail**；第二条 self-test 成功；后续开发验证提交扩展了架构
选择和脱敏诊断自测。self-test 不执行真实安装、更新或重启，与下方原生更新验收
是独立的证明范围。

## 已完成：固定原生引擎的四次首轮与两个负控

[合成原生原始安全结果](verification/1.0.4/synthetic-native-images.json)
使用最终生产物化器、V1 **1.18.30**、V2 **2.0.26**、真实原生 SDK 与认证 scoped
代理，固定官方目标仅在测试主进程内转至 localhost 合成上游。外部模型调用 **0**，
未读取真实凭据。

四次支持场景为：两个引擎分别对完整 `openai/gpt-6.1-sol` 和
`anthropic/claude-sonnet-5` 进行首轮传图。每次上游都收到同一份 76 字节、2×2
技术 PNG，MIME 与解码字节一致，SHA-256 均为
`8e546007599fa6df13786602a501cc2933ae498bb8ed8ff0fa4664f551cad2be`。
每轮恰好一个合成请求，没有 Read 工具续轮，也没有被替换为旧拒绝提示。

两个 text-only 负控各属于一个引擎，保留原生“不支持图片”的解释、发送图片块为
0。每个负控仍发出一个包含解释的普通合成文本请求；不把它写成“没有调用模型”。

复现入口和隔离范围见
[合成 fixture 说明](../../apps/server/test/fixtures/gateway-vision-native.md)，
代码为 [gateway-vision-native.ts](../../apps/server/test/fixtures/gateway-vision-native.ts)。
合成响应证明字节传递和引擎整合，不证明真实模型看懂了图。

## 已完成：恰好两次真实原生图片识别

Root 另外执行了恰好 **两次真实网关请求**，每个引擎一次，经过真实模型物化、
原生目录/SDK、scoped 本地代理及 ModelHelm。每次都是新生成、随机打乱四色象限的
128×128 技术 PNG，提示只要求报告方位颜色，没有透露正确顺序。返回顺序由主进程
在内存中与图像比较。

| 引擎与模型 | 实际协议 | 结果与安全证据 |
| --- | --- | --- |
| V1 1.18.30，`anthropic/claude-sonnet-5` | Native Claude `image.source/base64` | HTTP 200，SSE 结束，首轮 1 图片块，577 字节，四色顺序正确；[原始安全报告](verification/1.0.4/live-native-v1-claude.json)。 |
| V2 2.0.26，`openai/gpt-6.1-sol` | Compatible `image_url/dataURL` | HTTP 200，SSE 结束，首轮 1 图片块，501 字节，四色顺序正确；[原始安全报告](verification/1.0.4/live-native-v2-gpt.json)。 |

每次有 **512 输出 token 上限、60 秒请求超时、1 次外部请求、0 tools、0 重试、
0 续写**。这两次结果仅证明所测两条路由对这两张四色图的识别，不推广为所有模型、
所有图片格式、一般视觉准确率或工具长链通过。报告中的用量是网关观察值，不是
独立账单核验。

上述合成与真实图片原生检查均无 GUI，使用隔离的 HOME/XDG/数据库；macOS `sandbox-exec`
将原生子进程网络限制到 loopback。上游 key 只在受信主进程内存中，原生配置只含
scoped token。临时 profile 经 key 扫描后移除，原生日志丢弃；原生引擎可能在
临时 profile 中短暂保存普通会话，但清理后未归档会话、原始回答或 thinking。

报告只保留 MIME、尺寸、字节数、SHA-256 与比较布尔值，不保留图片 Base64、正确
颜色顺序、回答或 thinking。默认 dry-run 的
[opt-in live fixture](../../apps/server/test/fixtures/gateway-vision-live-native.md)
在读取配置或凭据之前退出；合成 preflight 不算真实识别证据。
[证据目录 README](verification/1.0.4/README.md) 详细记录执行范围和复现条件。

## 发布验收：已完成

| 项目 | 当前状态 | 证据与范围 |
| --- | --- | --- |
| 六平台原生构建 | **Passed**：[run 39035417871](https://github.com/ryan-wong-coder/openwork/actions/runs/39035417871)，目标 SHA 为 `87ad6877b778cb9e69493f61b6915e688bcbd6b5`。 | 六 lane 匹配 CPU 的包内服务、原生模块、clientStatus、hostBoundary 全通过；草稿 24 资产、10 安装包，安装包合计 3,897,091,283 字节。[构建审计](verification/1.0.4/build-release-audit.json)只下载 8 份小元数据，签名模式为 CI 声明，实际连续性由双 Mac 更新另验。 |
| 官网 1.0.4 API、六套 feed 与历史下载 | **Passed**。2026-10-17T13:34:00Z 激活。 | [发布门](verification/1.0.4/publication-gate.json)全量复核 22 个 lane 文件的大小/SHA-256/SHA-512；[实际 HTTPS 检查](verification/1.0.4/live-release.json)覆盖 10 安装包、6 feed、HEAD/Range/格式/缓存/摘要一致性；[历史链接](verification/1.0.4/download-history.json)保留 1.0.0、1.0.2、1.0.3 的 30 包 HEAD 和 60 个首尾 Range 样本，不等同历史整包公开下载哈希。 |
| 原版 macOS → 1.0.4 真实自动更新 | **x64 / arm64 Passed**：[x64 原 run](https://github.com/ryan-wong-coder/openwork/actions/runs/39037150576/job/117409189928)、[arm64 独立重试](https://github.com/ryan-wong-coder/openwork/actions/runs/39038757972)。 | 未修改或重签的原版 1.0.0 baseline run 38883434626，目标 build run 39035417871。[x64 报告](verification/1.0.4/macos-x64.json)、[arm64 报告](verification/1.0.4/macos-arm64.json)与两张实际查看的[截图](verification/1.0.4/README.md)证明同 leaf、官网完整下载、Squirrel 替换与自动重启，profile/工作区/历史/服务保留、0 renderer 异常。首次 arm64 失败单独保留，原 run 的整体 failure 不改写为成功。 |
| GitHub 公开 Release | **Passed**：[zeno-v1.0.4](https://github.com/ryan-wong-coder/openwork/releases/tag/zeno-v1.0.4)，2026-10-17T14:11:14Z 公开。 | Release 415817717，非草稿、非预发布且为 latest；[无认证核验](verification/1.0.4/release-public.json)确认 24 资产、3,899,677,309 字节，名称/大小/SHA-256 与冻结构建全部一致。 |

[官网实际下载选择验收](../../apps/zeno-site/verification/releases/1.0.4/README.md)
使用真实 1.0.4 API，六组平台/CPU 地址与 SHA-256 匹配，0 运行时异常、仅官网来源；
三张桌面/手机明暗截图均已实际查看。该检查没有触发安装包下载或重新验证整套影片。

macOS x64/arm64 的真实自动更新、安装及重启均已通过。Windows/Linux 的证明
范围仍限于原生 CPU 包内启动与模块、权限边界及发布格式/feed 检查，没有本版
完整 GUI 安装/自动更新/重启结果。图片原生请求、静态打包、官网和实际安装更新
各有独立证明范围。

## 原生验收首次下载中断与独立重试

Apple Silicon 首次运行在下载阶段返回 `download-failed`；[原始失败报告](verification/1.0.4/macos-arm64-attempt-1.json)
按原字节保留，没有成功后截图。[服务端脱敏传输证据](verification/1.0.4/macos-arm64-attempt-1-transport.json)
记录 2026-10-17T13:44:48Z 的 HTTP 200 响应体仅 419,291,136 字节，
小于应有 431,109,099 字节，支持 HTTP 传输未完成，但不确定哪个网络节点断开。
不能由客户端统一错误码推断 Squirrel 失败，也不能把该次运行改写为通过。

为在原 x64 验收继续运行时独立重试 arm64，提交
`e1cb9f414bab849658e6bdf889c2017dd27e2717` 只调整 workflow 与 smoke 脚本，
增加架构选择和清理前的白名单错误分类/有界数字进度诊断。默认双架构、原始
基线、官网 feed、签名/摘要检查、30 分钟下载预算、原生自动替换与重启验证均保留；
未改产品代码、版本、标签或安装包。架构 selector、自有日志脱敏/限长、数字边界
自测、语法与 diff 检查通过，独立审查无可行动 P1/P2。重试仍使用同一冻结
构建的完整安装包字节，不重新签名。

arm64 独立重试成功时原生进度为 431,109,099 / 431,109,099 字节、100%。
两架构最终 ASAR SHA-256 均为
`9291e03534deb064076b1d79b108e16de87853aacf8019253b046ee3eb8db832`。
两份成功报告、两张实际查看截图及首次失败报告均按原始字节保留；详细 artifact
ID、摘要和执行边界见[证据目录](verification/1.0.4/README.md)。

发布后已清理本任务的本地大包缓存、服务器私有传输 stage 和临时辅助脚本。
删除 stage 前逐项确认其与公开文件的 inode 不同；当前及历史下载文件保持不变，
官网页面仍使用原 `3e74875ff` 视觉部署。
