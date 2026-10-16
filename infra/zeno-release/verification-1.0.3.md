# Zeno 1.0.3 验证记录

产品标签：`zeno-v1.0.3`，产品提交：`5cbcc11f8d37b88e5e6772869bcfd1d974632dd2`。
本文件是标签后的文档记录，不修改产品源码、安装包字节或标签。验证日期为
2026-10-16。源码回归、合成原生引擎、真实网关、六平台构建、官网发布、
双 Mac 原版升级及 GitHub 公开发布均已分别验收。各项证明边界保留在下文。

## 已完成：GPT-6.1 档位遗漏修复

已认证 ModelHelm `GET /v1/models` 返回 HTTP 200、70 个模型，字段只有 `id`、
`object`、`created`、`owned_by`，没有 reasoning 或 variants。目录中存在完整
`openai/gpt-6.1-sol`，但 1.0.2 的精确补全表没有该 ID，已有配置恢复也因此没有
可调档位。前端按实际能力禁用菜单，没有从名称猜测支持程度。

修复对官方 `https://api.modelhelm.com/v1` 下的该精确 ID 补全 `low`、`medium`、
`high`、`xhigh`、`max`，显式禁用不支持的 `none`、`minimal`，避免引擎再合并
推断档位。来源为 [OpenAI GPT-6.1 Sol 合同](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
和 [reasoning 协议](https://developers.openai.com/api/docs/guides/reasoning)。
自定义 URL、相似名称和其他命名空间不套用该表，显式有效配置仍优先。

[实际网关 wire 记录](verification/1.0.3/gateway-wire-checks.json) 进一步区分了
模型官方合同与当前 ModelHelm 路由的实际行为：

| 检查 | 已观察结果 | 证明边界 |
| --- | --- | --- |
| 同一合成小题，Chat Completions 的 low / high | 均 HTTP 200，答案存在；响应分别报告 58 / 68 reasoning tokens。 | 有效参数被接受；单次 token 差异不代表质量或用量保证。 |
| 同路由故意无效的 effort | HTTP 400，验证器列出上述五档。 | 网关确实验证该字段；没有据名称猜档位。 |
| Responses 的 low、无工具请求 | HTTP 200，简单答案存在。 | 仅验证此无工具请求，不证明完整 agent 兼容。 |
| 当前 ModelHelm CC 的两轮合成 calculate 工具调用 | 首轮 HTTP 200 / `tool_calls` / 一个匹配调用；回传 assistant 消息和合成 tool result 后 HTTP 200 / `stop` / 答案匹配。 | 证明该网关兼容路由的一次工具回环，不泛化到所有工具或长链。 |

OpenAI 的直接 GPT-6.1 API 要求工具调用使用 Responses；ModelHelm 的上述兼容
路由证据单独成立。本版保留既有 Chat Completions 路由，没有仅凭一次无工具
Responses 请求就迁移协议。原生 GPT fixture 的工具验证仍为 false：它们证明
参数传递，与后来直接网关的两轮工具检查是不同范围。

## 已完成：Claude 原生协议与混合提供方

旧 ModelHelm 提供方统一使用 OpenAI-compatible SDK，Claude 请求也走 Chat
Completions。[Claude 官方兼容文档](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)
明确说明 `reasoning_effort` 被忽略。实际 Sonnet 5 的 low、high、无效值均返回
200；384-token 合成算术请求以 `length` 结束、报告 0 reasoning tokens。
因此 HTTP 200 不能证明旧 CC 路由应用了 Claude 深度。

[ModelHelm 官网](https://modelhelm.com/) 发布独立的 Claude 路由，
[公开站点状态](https://modelhelm.com/api/status) 给出其服务器地址；实际有效入口是
`https://api.modelhelm.com/claude/v1/messages`。不同的 `/v1/messages` 实测为 404。
公开页面证明入口，认证 header 与完整路由 ID 另由已授权真实请求确认，详见
[能力来源及探针条件](../../apps/server/test/fixtures/gateway-reasoning-sources.md)。

仅对官方 URL 与以下四个完整 ID，在本地生成原生 Claude 模型配置：

- `anthropic/claude-fable-5`
- `anthropic/claude-opus-5`
- `anthropic/claude-opus-5.5`
- `anthropic/claude-sonnet-5`

每个模型使用五档 native `effort`，配合
`thinking: {type: "adaptive", display: "summarized"}`，不伪装为 OpenAI
`reasoningEffort`。[Claude effort 合同](https://platform.claude.com/docs/en/build-with-claude/effort)
与实际网关的有效/无效值对照共同支持该选择。四个型号的 native low 均实测
HTTP 200；Sonnet 5 / Opus 5.5 的 high、无效值及 xhigh 流式检查另有 wire 记录。
这不表示已经对四个型号的每个档位都做过真实生成。

实现保留提供方 ID `modelhelm`、完整模型 ID 与 scoped 本地代理基址。V1 以模型级
`provider.npm: "@ai-sdk/anthropic"` 选 SDK；V2 映射到内建 allowlist 中的
`@opencode/ai/providers/anthropic`。同一提供方下的 GPT 和 compatible 模型保持
原适配器，远程目录不能注入任意 npm、provider、API 或 options。

原生请求通过 `/gateway/openai/messages`，由受信主进程访问固定官方目的地。
原生引擎配置只含 scoped token，上游 key 由受信主进程读取；代理验证认证、
拒绝冲突双 header、保持完整
模型 ID，固定 `anthropic-version: 2023-06-01`。已测请求字段 allowlist、尺寸上限、
错误凭据脱敏、禁止重定向、即时 SSE、thinking/signature/tool 数据保真及取消超时。
Node transport 实测双向 HTTP 流关闭；Bun 取消测试只声称后续读取被拒绝，不将其
当作上游 socket 关闭证据。这些检查没有执行 Electron 打包后 transport 验收。

## 已完成：显式覆盖、目录边界与启动迁移

有效私有目录缓存与旧版无缓存配置都在启动恢复时补全缺失字段，连续两次启动
幂等。本地完整 variants、温度、thinking 预算、`interleaved`、options、limits
均保留；只有同一受管提供方、同一 scoped 本地代理和同一网关绑定才可继承。
换 key、换 endpoint 或失效目录重新同步不跨绑定继承旧覆盖，未配置网关不被
标记为就绪。两项交叉审查发现的 P2 已修复并回归：

| 边界 | 修复与覆盖 |
| --- | --- |
| 精确 Claude ID 已有显式 CC/custom SDK，但没有 variants | 同时修复 fill 和 build 两条路径；保留显式 provider/options/variants，不注入 native thinking/effort。无 variants 时用禁用项阻止引擎自行推断。覆盖 legacy、valid-cache、build(existing) 及 V2 render。 |
| 任意远程目录声明 `variants[id].effort` | 发现层归一化为 compatible `reasoningEffort`；只有官方精确 Claude 的本地原生 materializer 转为 native effort/thinking。覆盖 custom URL 与非 Claude，明确本地配置不经远程 sanitizer 重写。 |

## 已完成：回归、类型与前端适配

以下是分别执行的成功分组，不能把 62 与 24 直接相加。两组都包含
`gateway-security.test.ts` 的 7 项，重复部分明确保留在各自执行记录中。

| 分组 | 实际成功命令 | 结果与范围 |
| --- | --- | --- |
| 目录、物化、恢复、模型级 SDK | `bun test apps/server/test/gateway.test.ts apps/server/test/gateway-security.test.ts apps/server/test/gateway-restore.test.ts apps/server/test/gateway-model-capabilities.test.ts apps/server/test/gateway-capability-restore.test.ts apps/server/test/gateway-native-model-render.test.ts` | 62 tests / 495 assertions，0 fail；包括上述两个 P2 及缓存迁移。 |
| 原生与既有代理、安全及取消 | `pnpm --dir apps/server exec bun test test/gateway-proxy.test.ts test/gateway-native-proxy.test.ts test/gateway-security.test.ts` | 24 tests，0 fail；其中 native proxy 7、proxy 10、共享 security 7。 |
| 真实前端 V2 目录链 | 在 `apps/app` 中执行 `bun test tests/model-effort-v2-adapter.test.ts` | 1 test / 21 assertions，0 fail。真实 `createClientV2.provider.list()` 经三个 localhost GET、标准归一化、`runtimeModelOptions` 到 effort 状态；GPT/Claude 五档及 native 参数保留。 |

`pnpm --dir apps/server typecheck`、`pnpm --dir apps/app typecheck` 和相关
`git diff --check` 均通过。四个原生 fixture 的独立 strict TypeScript 检查也通过。
GPT-6.1 修复阶段还实跑了 9 项 / 34 断言的既有 effort UI 回归；最终前端适配器
断言已扩为上述 21 项。

本版没有重画深度控件。既有真实组件的[四状态 UI 证据](verification/1.0.2/effort-ui/ui-verification.md)
证明可调、自动控制、未知能力和旧设置恢复的界面行为；其截图使用合成能力，
属于 1.0.2 的界面验收，不能冒充本版已打包的 GPT-6.1/Claude 真实会话截图。

版本调整后的打包检查也已执行成功：

```sh
node --test apps/desktop/test/zeno-packaging.test.mjs apps/desktop/test/zeno-artifacts.test.mjs infra/zeno-release/prepare-publication.test.mjs
node apps/desktop/scripts/zeno-update-smoke.mjs --self-test
```

前一命令 15 pass / 0 fail；后一命令输出
`Zeno update smoke self-test passed (historical/target integrity only; no native update was run).`
该 self-test 没有运行真实原生更新，不能代替本版安装包或升级验收。

## 已完成：固定原生引擎的合成协议与工具回环

三份 JSON 是实际 fixture 的脱敏 stdout，未以手工摘要替换：

| 引擎与场景 | 证据 |
| --- | --- |
| V1 `1.18.30`：compatible DeepSeek、Claude 原生 | [synthetic-native-v1-deepseek.json](verification/1.0.3/synthetic-native-v1-deepseek.json) |
| V1 `1.18.30`：GPT-6.1 high/max、Claude 原生 | [synthetic-native-v1-six.json](verification/1.0.3/synthetic-native-v1-six.json) |
| V2 `2.0.26`：compatible 回放、builtin-only、GPT-6.1、Claude 原生 | [synthetic-native-v2.json](verification/1.0.3/synthetic-native-v2.json) |

两版均真实经过 materializer、原生目录/SDK、scoped 认证代理，到合成 localhost
上游。四个 Claude 型号都在目录中使用原生 SDK 和精确五档；Opus 5.5 的 high
执行实际单个 fixture 文件的原生 read 工具与第二轮请求，合成 thinking 文本、
signature、tool-use 身份和 tool result 回放均保留。xhigh/max 另有请求捕获。
GPT-6.1 的完整 ID、high/max 参数，以及既有 CC `reasoning_content` 回放不回退。

V1 Claude 捕获顶层 `output_config.effort`；V2 Opus 5.5 捕获原生 message update
形状。SDK 自动产生的 `thinking.block_binding` 保持原样，没有强改为另一协议。
所有合成执行使用隔离 HOME/XDG、合成凭据，固定官网目标仅在测试进程内重定向
至 loopback，拒绝其他外部目标，结束后清理。外部模型调用为 0。

复现入口及隔离说明见[原生验证 README](verification/1.0.3/README.md)；代码为
[V1 fixture](../../apps/server/test/fixtures/gateway-reasoning-native-v1.ts)、
[V2 fixture](../../apps/server/test/fixtures/gateway-reasoning-native-v2.ts) 和
[共享合成上游](../../apps/server/test/fixtures/gateway-reasoning-native-upstream.ts)。
这些结果证明真实 SDK/代理/工具整合与回放，不证明真实 Claude 模型的工具推理
或所有长链行为。

## 已完成：真实原生两次调用与 V2 message effort 对照

另有恰好两次已授权的真实原生调用，每个引擎一次，均选 Sonnet 5 / high，经过
真实 build、五档目录、对应 Anthropic SDK、scoped 本地代理和官方 native 入口：

| 引擎 | 真实结果 | 原始安全统计 |
| --- | --- | --- |
| V1 `1.18.30` | HTTP 200、SSE 完整、文本存在、合成算术的归一化整数匹配。 | [live-native-v1-sonnet-high.json](verification/1.0.3/live-native-v1-sonnet-high.json) |
| V2 `2.0.26` | HTTP 200、SSE 完整、文本存在、同项算术匹配。 | [live-native-v2-sonnet-high.json](verification/1.0.3/live-native-v2-sonnet-high.json) |

两次均为 `max_tokens: 1024`、tools 0、重试/续写预算 0、完整模型 ID，effort
位于顶层；不声称做了真实 native 工具回环。上游 key 仅主进程内存持有，原生
配置只含 scoped token；临时 profile 经 key 扫描并移除，未归档原生日志、原始
回答或 thinking。[公开 opt-in fixture](../../apps/server/test/fixtures/gateway-reasoning-live-native.ts)
默认只 dry run；复现真实调用需要另外明确的执行参数，不是自动 CI 测试。

不同的真实 wire 对照专门验证 V2 Opus 5.5 的原生协议：
`messages[0]` 为 system、空 content、带 `output_config.effort`，无顶层
output config；三项 pinned beta headers 与 SDK 自动 block binding 均保留。
high 返回 HTTP 200、`end_turn`、文本，但**严格整数答案比较不匹配**，这里只
确认合法格式被接受。相同结构的无效 effort 返回 HTTP 400，明确校验
`messages.0.output_config.effort` 并列出五档。没有为绕过该协议而关闭
`supportsEffortUpdates`。此例与前述 Sonnet 原生算术成功是不同请求，不混写为
同一次成功。具体字段见 [wire JSON](verification/1.0.3/gateway-wire-checks.json)。

早期 DeepSeek / GPT-5.5 的三次 HTTP 503 仍是其当时真实限制，见[历史记录](../../apps/server/test/fixtures/gateway-reasoning-sources.md#initial-live-gateway-check-limitation)。
后续 GPT-6.1 和 Claude 的成功证据不抹去该记录，也不代表那些型号已恢复。

## 发布验收：Passed

| 项目 | 当前记录 | 待回填的证据 |
| --- | --- | --- |
| 六平台原生构建 | **Passed**：[run 38917178516](https://github.com/ryan-wong-coder/openwork/actions/runs/38917178516)，产品 SHA 完全匹配。 | [完整审计](verification/1.0.3/build-release-audit.json)：六 lane 的包内原生服务 smoke 均 passed；品牌、版本、架构、签名声明和独立官网 feed 均匹配。草稿 415075932 的 24 项资产、10 个安装包共 3,897,129,118 字节，GitHub 尺寸与 SHA-256 对齐构建 index。 |
| 官网 1.0.3 API / 六套 feed / 历史链接 | **Passed**，2026-10-16T15:05:20.000Z 原子激活。 | [服务器发布门](verification/1.0.3/publication-gate.json) 全量复核 22 项文件的尺寸、SHA-256、SHA-512；[真实 HTTPS 检查](verification/1.0.3/live-release.json) 通过 10 安装包、6 套 feed、Range、架构文件头、缓存及摘要对应；[历史链接](verification/1.0.3/download-history.json) 通过 1.0.0/1.0.2 共 20 个安装包的 HEAD 与 40 个首尾 Range 样本。样本检查不等同于再次全量下载历史包。 |
| 原版 macOS → 1.0.3 真实更新 | **Passed**：[run 38921258728](https://github.com/ryan-wong-coder/openwork/actions/runs/38921258728)，x64 job 117041476099、arm64 job 117041475512 均 success。 | [x64 原始报告](verification/1.0.3/macos-x64.json)、[arm64 原始报告](verification/1.0.3/macos-arm64.json) 及两张[实际截图与哈希说明](verification/1.0.3/README.md)：从未改动/未重签的原始 1.0.0，经官网真实下载 1.0.3 ZIP、Squirrel staging、退出、替换、自动重启，profile/工作区/历史会话及消息/内置服务均保留，renderer exception 均为 0。 |
| GitHub 公开 Release | **Passed**：[泽诺 Zeno 1.0.3](https://github.com/ryan-wong-coder/openwork/releases/tag/zeno-v1.0.3)，2026-10-16T15:28:02Z 发布，Release ID 415075932。 | [无认证 REST 验证](verification/1.0.3/release-public.json)：非草稿、非预发布、24 个 uploaded 资产的尺寸与 SHA-256 均和冻结构建审计一致。 |

双 Mac 使用的是本版独立升级任务，不复用 1.0.2 的通过状态。原始 baseline 绑定
1.0.0 公开历史 index，目标 ZIP 绑定 1.0.3 的公开 API/feed 与构建产物双哈希；
CI 下载的 target artifact 只用于预期代码与签名校验，真正安装源是官网更新 ZIP。
两架构均通过同一 leaf requirement 严格签名校验，更新后 native/disk 为 1.0.3，
实际 ASAR 均为 `8b1863af40222b17618d6f592f5bc87039a2748dc9ff932a8a8870f392dcaa65`，
与各自冻结 target 完全相同。报告与 PNG 是原样脱敏 artifact，已实际查看两图，
临时 profile、原包副本与缓存在托管 VM 内退出后清理；未在开发者电脑打开窗口。

官网电影独立部署于 `3e74875ff`。除历史 [v3 / 1.0.2 验收](../../apps/zeno-site/design-qa-v3.md)
外，本版另跑了[真实 1.0.3 官网验收](../../apps/zeno-site/verification/releases/1.0.3/README.md)：
10 产物/6 平台 CPU 的 href 与校验码正确；视频专项 13 项通过，13 张最终截图
均实际查看。19.5 秒影片连续观察 20,540ms，自然循环一次、暂停 0；桌面/手机
双向换源并推进、手机首载仅竖片、4 媒体全量哈希/MIME/Range、6 原始参考图
404、无关站点 200 均通过。页面 0 runtime exception，仅访问官网自身 origin。

首轮专项在 resize-mobile 的固定 350ms 推进断言失败，原始 failed JSON 保留。
未捕获该时刻的 readyState 或实际加载时长，因此根因未确认；同代码、同原脚本
第二轮通过，未修改素材、QA 或产品。最终无可复现 P0/P1/P2。官网验收不代替
客户端升级验收；Windows/Linux 的本版完整 GUI 安装重启未在本记录中验证。
