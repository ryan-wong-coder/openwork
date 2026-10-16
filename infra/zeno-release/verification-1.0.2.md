# Zeno 1.0.2 验证记录

产品标签：`zeno-v1.0.2`，产品提交：`672ec6556`。客户端安装包保持该标签构建的原始字节；标签后的官网、验证脚本和证据提交不改写安装包或产品标签。本记录分别说明源码、隔离原生引擎、合成 UI、安装包与线上部署的验证边界。

## 已完成：自动任务标题

根因已从本地诊断确认：主对话使用当前网关提供方，标题生成却优先读取历史全局 `small_model`，将请求发给旧提供方并收到 HTTP 401。公共证据使用 `legacy-provider/retired-model` 等合成标识，不收录原始私人日志、凭据或对话。

修复提交：`056aa2273`，包含于本次产品标签。独立模式将全局小模型偏好限制在当前对话的提供方内；无法匹配时由原生引擎选择当前提供方的小模型或当前对话模型。显式 `agent.title.model` 和 connected 模式保持原行为。修复只作用于合并后的引擎内存配置，不改用户配置文件，也没有删除失败提醒。

已完成检查：

- `bun test apps/server/test/title-model-routing.test.ts`：8 项通过、0 失败；覆盖旧提供方、完整模型 ID、同提供方偏好、其他自部署提供方、显式标题配置、connected 模式及原型属性边界。
- `pnpm --dir evals exec vitest run --config vitest.config.ts --project pr ../apps/server/test/session-title-sigv4.vitest.test.ts`：10 项通过、0 失败。该配置提供 `@openwork/testkit` alias，检查签名 header 保留、普通请求不受影响及 HTTP 失败分类。
- 固定 OpenCode V1 `1.18.30` 的[真实标题回归 fixture](../../apps/server/test/fixtures/title-model-routing-native.ts) 已执行成功：隔离 HOME/XDG、保留失效旧小模型配置，使用合成 localhost 网关生成真实会话标题。标题与主回复均走当前模型，旧提供方端点收到 0 次请求。
- 标题 fixture 使用与生产插件相同的 Node 目标 bundle，仅安装单个插件输出后仍可运行，确认新增路由 helper 不依赖缺失的源码相对路径。V2 的原生插件列表不加载该 V1 插件。
- 只读核对确认：重启后仅打开历史占位标题会话不会重新启动 31 秒标题监测。监测要求本次真实发送写入未持久化的 run-start 记录；已有失败会话未做批量标题补写。

原生复现命令：

```sh
OPENWORK_TEST_OPENCODE_BIN=/path/to/opencode-1.18.30 bun apps/server/test/fixtures/title-model-routing-native.ts
```

## 已完成：思考深度能力与迁移

ModelHelm 已认证 `GET /v1/models` 实测返回 70 项，字段只有 `id`、`object`、`created`、`owned_by`，没有推理能力或档位声明；原 materializer 也只生成通用文本模型配置，导致前端拿不到可调 variants。

修复保留目录显式声明，并对官方 ModelHelm 地址下有精确来源的型号做离线补全。未知型号、不同路由命名空间和自定义网关不按名字猜能力。MiniMax M2.x 的内置推理与可调深度分开表达；供应商未声明的档位显式禁用，避免 V1 合并推断默认值后重新出现。完整型号、档位和逐项来源见[能力来源及验证边界](../../apps/server/test/fixtures/gateway-reasoning-sources.md)。

已有配置通过启动恢复自动补全，覆盖有效私有目录缓存与旧版无缓存配置。迁移保留完整的本地显式模型字段，包括自定义 variant 的温度、thinking 预算、`interleaved`、options 和 limits；连续第二次启动幂等。只有同一受管提供方、同一本地代理地址与同一网关地址允许继承这些覆盖。更换密钥或端点，以及目录绑定失效后重新同步，均不携带旧覆盖配置。

下列文件均以独立 Bun 进程执行，避免 mock 污染，共 **45 项通过、0 失败**：

| 命令 | 通过数 |
| --- | ---: |
| `bun test apps/server/test/gateway-model-capabilities.test.ts` | 8 |
| `bun test apps/server/test/gateway-capability-restore.test.ts` | 8 |
| `bun test apps/server/test/gateway-restore.test.ts` | 6 |
| `bun test apps/server/test/gateway-security.test.ts` | 7 |
| `bun test apps/server/test/gateway-proxy.test.ts` | 8 |
| `bun test apps/server/test/gateway.test.ts` | 8 |

这些回归包含显式 false、disabled、空声明、完整 ID、缓存往返、未知能力、配置清除、原有认证/流式/取消行为，以及跨密钥和端点的迁移边界。

## 已完成：原生参数与前端目录链

固定原生引擎的两个 fixture 均已执行成功：

| 引擎 | 已确认的实际行为 | 复现文件 |
| --- | --- | --- |
| V1 `1.18.30` | 原生目录只列声明的档位；选择 `high` 后，通过真实 scoped-auth 本地代理，在合成上游捕获完整模型 ID 和 `reasoning_effort: "high"`；第二轮保留 assistant `reasoning_content`。 | [V1 fixture](../../apps/server/test/fixtures/gateway-reasoning-native-v1.ts) |
| V2 `2.0.26` | 原生目录的可调模型和 builtin-only 模型均保留 reasoning 输出能力；前者有正确的 high settings，后者 variants 严格为空；两轮上游请求保留完整 ID、`reasoning_effort: "high"` 和推理内容回放。 | [V2 fixture](../../apps/server/test/fixtures/gateway-reasoning-native-v2.ts) |

```sh
OPENWORK_TEST_OPENCODE_BIN=/path/to/opencode-1.18.30 bun apps/server/test/fixtures/gateway-reasoning-native-v1.ts
OPENWORK_TEST_OPENCODE2_BIN=/path/to/opencode2-2.0.26 bun apps/server/test/fixtures/gateway-reasoning-native-v2.ts
```

上述检查使用隔离配置、合成凭据和 localhost 上游，并在结束后清理。它们证明原生参数传递及普通两轮推理回放，不代表已测工具调用回环、模型回答质量或安装包自动升级。

前端已执行 **10 项通过、0 失败**，与后端合计为本次思考深度相关 **55 项通过**；标题的 18 项检查另列，不计入这 55 项：

| 命令 | 通过数 |
| --- | ---: |
| `pnpm --dir apps/app exec bun test tests/model-effort.test.tsx` | 9 |
| `pnpm --dir apps/app exec bun test tests/model-effort-v2-adapter.test.ts` | 1 |

第二项通过真实 `createClientV2(...).provider.list()`，从合成原生目录经标准 ProviderList、`runtimeModelOptions` 到界面状态，确认 reasoning 与 variants 没有在适配时丢失。builtin-only 保持 reasoning 为真、只有默认选项并显示自动控制；未知能力不会被提升。

## 已完成：类型检查与 UI 证据

- 服务端：`pnpm --filter openwork-server typecheck` 通过。
- App：`pnpm --dir apps/app typecheck` 通过；相关源码 `git diff --check` 通过。
- 使用真实 `ModelSelect`、`ModelPickerList`、Base UI 原语与现有 app CSS 的隔离 headless Chrome 检查已完成，四种状态通过、0 runtime exception。目录 hooks 使用明确合成能力，截图不代表真实网关能力。

完整边界、测试和设计规则见 [UI 验证记录](verification/1.0.2/effort-ui/ui-verification.md)，机器报告见 [report.json](verification/1.0.2/effort-ui/report.json)。五张截图均已实际查看：

| 状态 | 实测行为 | 截图 |
| --- | --- | --- |
| 内置推理、无档位 | 显示“模型自动控制”，菜单禁用。 | [automatic](verification/1.0.2/effort-ui/automatic.png) |
| 未声明能力 | 显示“未提供可调深度”，不按模型名字推断。 | [unknown](verification/1.0.2/effort-ui/unknown.png) |
| 手动档位 | 中文标签可选；“最高”仍提交原生 ID `max`。 | [manual](verification/1.0.2/effort-ui/manual.png) |
| 已保存但未列出的值 | 原值保留；仅显式选择默认才回调 `null`。 | [saved state](verification/1.0.2/effort-ui/saved-state.png)、[recovery](verification/1.0.2/effort-ui/saved.png) |

## 未完成：真实网关生成

已授权的最小合成请求中，DeepSeek V4 Flash 和 GPT-5.5 携带 `reasoning_effort: low` 均收到 HTTP 503。同一 DeepSeek 模型、同一合成 prompt、不带思考参数的对照请求也返回 503。两次 DeepSeek 请求的脱敏输出另记录了 `system_error`；GPT 请求的脱敏输出未单独保留错误类型，本记录只确认其 HTTP 状态。三次请求后已停止真实调用，未保留完整响应、密钥或私人对话。

因此目前不能声称 ModelHelm 实际生成成功，或其在线路由已经接受并执行思考档位。该限制与本地目录修复、原生传参验证分别记录；详见[请求条件与状态表](../../apps/server/test/fixtures/gateway-reasoning-sources.md#live-gateway-check-limitation)。

## 已完成：六平台原生构建

[Release Zeno 38904606377](https://github.com/ryan-wong-coder/openwork/actions/runs/38904606377) 的六个原生 runner 全部成功，提交严格为 `672ec6556b46d288cf07a4f71c9645e6f6411035`。各 lane 的实际包内运行结果、版本、架构、更新源和全部 GitHub 资产尺寸/摘要保存在 [构建审计](verification/1.0.2/build-release-audit.json)。该审计在 GitHub Release 仍为草稿时采集，不能将其中 `isDraft: true` 当作最终发布状态。

| 平台 | CPU | 格式 | 包内运行 |
| --- | --- | --- | --- |
| macOS | x64、arm64 | DMG、ZIP | 两架构 `runtimeSmoke: passed`，长期自签证书。 |
| Windows | x64、arm64 | EXE | 两架构 `runtimeSmoke: passed`，未签名。 |
| Linux | x64、arm64 | AppImage、DEB | 两架构 `runtimeSmoke: passed`。 |

共 24 份资产、10 个安装包，安装包合计 3,897,206,401 bytes。包内检查实际加载原生 sqlite、node-pty，启动内置服务并检查版本和更新配置。版本 bump 后的打包、产物及发布相关 15 项检查通过，更新 smoke 的 self-test 通过。Windows/Linux 未执行完整 GUI 安装升级测试。

## 已完成：官网更新 API、feed 与历史下载

2026-10-16T13:40:59Z 原子激活 1.0.2。服务端先用 [prepare-publication.mjs](prepare-publication.mjs) 完整读取 22 份原生清单、包和 blockmap，核对尺寸、SHA-256、SHA-512、六架构、安装格式及自有域名 feed，全部通过后才创建并启用发布目录。[发布门记录](verification/1.0.2/publication-gate.json) 记录实际执行边界；本地下载的全部 24 份 GitHub 资产也已核对其 GitHub SHA-256 摘要。

[真实 HTTPS 下载检查](verification/1.0.2/live-release.json) 通过：API 为 1.0.2、10 个安装包、6 套原生 feed，实际格式头、架构、尺寸、清单哈希对应关系、Range 和缓存策略正确。API/feed 使用 no-store，版本文件 immutable。

发布切换保留 1.0.0 持久目录。对切换前捕获的 10 个旧安装链接，切换后实际比较 HEAD 尺寸与首尾各 64 字节的 20 次 Range 请求；均完全一致，详见 [历史链接检查](verification/1.0.2/download-history.json)。这项检查没有重新完整读取所有旧文件，不声称为旧文件全量重新哈希。

## 已完成：原版 macOS 真实升级

[原版 1.0.0 → 1.0.2 真实更新运行](https://github.com/ryan-wong-coder/openwork/actions/runs/38909991676) 的 macOS x64、arm64 两个 job 均为 success。使用公开历史构建的原始 1.0.0 ZIP，未修改 ASAR、Plist 或签名，也未导入私钥。原版、目标构建和最终安装包的公开 leaf requirement 一致，严格签名检查通过。

原版原生更新器从官网真实下载 x64 450,487,844 bytes、arm64 431,102,583 bytes 的 1.0.2 ZIP，经 Squirrel staging 后退出、安装并自动重启，没有手动启动目标包替代更新。重启后原生版本与磁盘版本均为 1.0.2，目标 ASAR 精确匹配；Chromium profile、工作区 ID/文件、会话与消息、内置服务均保留，两个渲染器异常计数均为 0。

完整来源与归档摘要见 [升级验收记录](verification/1.0.2/README.md)，两份 [x64 报告](verification/1.0.2/macos-x64.json)、[arm64 报告](verification/1.0.2/macos-arm64.json) 和实际查看的 [x64 截图](verification/1.0.2/macos-x64.png)、[arm64 截图](verification/1.0.2/macos-arm64.png) 按 CI 原始字节保存。该范围不包含 Windows/Linux 的 GUI 安装重启，也不代表 Apple 公证。

## 已完成：官网影片与正式发布

官网当前部署 `3e74875ff`，全屏三场景影片来自内置 imagegen 参考帧与 LibTV Seedance 2.5。无暂停或静态模式控件，手机首次加载只请求竖片，跨窗口断点重新选择影片。真实公网 13 项视频检查和六种平台/架构下载选择通过，13 张线上截图已实际查看、0 runtime exception；媒体全字节与本地构建相同，MIME、SHA-256/SHA-512 和 Range 通过。详情见 [官网 v3 设计及线上验收](../../apps/zeno-site/design-qa-v3.md)。

[Zeno 1.0.2 正式发布](https://github.com/ryan-wong-coder/openwork/releases/tag/zeno-v1.0.2) 已公开。未登录的 GitHub API 确认非草稿，24 份资产的尺寸与摘要与构建审计一致；详见 [正式发布检查](verification/1.0.2/release-public.json)。1.0.1 草稿及历史标签未改写。

## 后续发现的边界

用户在发布验收中另指出 GPT-6.1 与 Claude 档位缺失。1.0.2 的精确补全表不含这些型号，不能称作已修复它们，也不能据此认定上游不支持。后续真实 6.1 调用已获得成功，相关补丁及新探针记录在后续源码提交中；它们不属于本次 `672ec6556` 安装包。上面的初批 HTTP 503 记录保留当时状态，不代表所有后续模型请求持续失败。
