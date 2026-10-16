# Native Claude protocol verification

These protocol records cover product tag `zeno-v1.0.3`, commit
`5cbcc11f8d37b88e5e6772869bcfd1d974632dd2`. They do not independently
establish installer, publication, or update behavior. Those separate gates
and their current status are recorded in [verification-1.0.3.md](../../verification-1.0.3.md).

## Synthetic native engines

The three `synthetic-native-*.json` files are the unmodified, sanitized stdout
from the manual native fixtures. OpenCode 1.18.30 and 2.0.26 run without a
desktop window, with isolated configuration and only synthetic credentials.
The real `buildGatewayProvider` and scoped `/gateway/openai/messages` proxy
remain in the path. A test-only host fetch seam redirects the fixed ModelHelm
destination to loopback and refuses other external destinations.

Both native catalogs expose exactly `low`, `medium`, `high`, `xhigh`, and `max`
for all four allowlisted Claude model IDs. Native requests for
`anthropic/claude-opus-5.5` retain provider ID `modelhelm` and the complete model
ID. `high` performs a real read of one fixture-created synthetic file and a
second model turn; thinking text, signature, `tool_use`, and `tool_result`
survive the round trip. `xhigh` and `max` each perform one turn. The original
Chat Completions reasoning replay and GPT-6.1 Sol `high`/`max` cases remain.
There are no real model calls in these fixtures.

V1 uses `@ai-sdk/anthropic` and top-level `output_config.effort`. V2 uses
`@opencode/ai/providers/anthropic`; for Opus 5.5 it sends the selected effort in
a `role: system`, empty-content message with `output_config.effort` and the
pinned SDK's beta headers. The fixture accepts this actual native protocol
instead of manufacturing a top-level value. Adaptive/summarized thinking and
the SDK's automatic thinking block binding are preserved.

## Explicitly authorized live smoke

The two `live-native-*.json` files are the unmodified safe statistics from one
real Sonnet 5 `high` arithmetic request per engine, exactly two upstream calls
in total. Both use the real materializer, native Anthropic adapter, scoped
local proxy, and ModelHelm endpoint. The native body uses the complete
`anthropic/claude-sonnet-5` ID, top-level `output_config.effort: high`,
adaptive/summarized thinking, zero tools, and `max_tokens: 1024`.

Both requests returned HTTP 200, a completed SSE stream, text, and the expected
normalized integer. Token usage is an observed gateway response value; it is
not independently verified billing information. These calls do not establish
live tool execution or live support for every Claude model/effort combination.

The live harness uses an explicit synthetic session title, disables tools, and
enforces one external call per engine with no retry or continuation budget.
It rejects excessive output limits before egress and limits the upstream
timeout to 60 seconds. One V2 setup was rejected by that local tool-schema
guard before any upstream call; native wildcard tool denial then produced
the single permitted real V2 request.

Only the trusted host reads the existing upstream key into memory. Native
processes receive a scoped token. The isolated profiles were checked for the
upstream key and removed after the run; transcripts, thinking, native logs,
and credentials are not archived.

The reusable fixture is
`apps/server/test/fixtures/gateway-reasoning-live-native.ts`. Its default is a
dry run, before credential access or native startup. Real execution requires
`<v1|v2> --execute-approved-live` and a corresponding pinned
`OPENWORK_TEST_OPENCODE_BIN` or `OPENWORK_TEST_OPENCODE2_BIN`. It refuses a saved
custom gateway base URL before selecting its credential. It is not an
automatic CI test. The public fixture's additional credential/base guard was
checked statically and in dry-run mode; no extra real call was made.

## 原版 macOS 1.0.0 → 1.0.3 自动更新验收

[GitHub Actions run 38921258728](https://github.com/ryan-wong-coder/openwork/actions/runs/38921258728)
的两个 job 均为 **success**，验收代码与目标产品提交均为
`5cbcc11f8d37b88e5e6772869bcfd1d974632dd2`。

| 架构 | CI job | 最终结果 |
| --- | --- | --- |
| x64 | [117041476099](https://github.com/ryan-wong-coder/openwork/actions/runs/38921258728/job/117041476099) | success |
| arm64 | [117041475512](https://github.com/ryan-wong-coder/openwork/actions/runs/38921258728/job/117041475512) | success |

基线是构建 run `38883434626` 的原始 1.0.0 ZIP，CI 按公开历史发布索引核对大小、
SHA-256 和 SHA-512；没有修改 ASAR、Plist 或签名，也没有导入私钥。本次归档再次
独立核对了公开历史索引与两个报告中的基线大小和 SHA-256。

目标构建 run `38917178516` 的 1.0.3 ZIP 先与官网 API、对应原生 feed 的大小和
双哈希绑定，用来建立安装后 ASAR 的校验预期。真正的目标 ZIP 由原版应用的原生
更新器从官网对应架构 HTTPS feed 下载并校验，经 Squirrel staging 后退出、替换和
自动重启；验收脚本没有手动启动目标应用来代替更新重启。两架构最终 ASAR 的
SHA-256 均为 `8b1863af40222b17618d6f592f5bc87039a2748dc9ff932a8a8870f392dcaa65`，
与各自经过官网索引绑定的目标构建一致。

原版公开 leaf 证书导出的精确 requirement 验证原版、目标构建与最终安装包，严格
签名校验通过。这证明本次自签身份的连续性，不代表 Apple 公证。重启后原生与磁盘
版本均为 1.0.3；Chromium profile、工作区文件和注册表、已存会话与消息、内置服务
健康均验证成功，两个 renderer 的异常数均为 0。

这里只下载了两个小型脱敏 artifact，先核对其 ZIP 与 GitHub artifact digest，再将
`report.json` 和 `updated-app.png` 按原始字节保存为下列文件。两张 PNG 均已实际查看：
正常中文 Zeno 窗口、空密钥引导和合成 CI 工作区，无密钥、个人资料或错误页面。
临时 profile、日志与签名材料没有归档；CI 在原生进程退出后清理了临时状态。

本节只证明本次 macOS x64/arm64 的原生 1.0.0 → 1.0.3 更新。它不证明 Windows/Linux
的实际安装和重启，也不额外执行真实模型调用。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| macos-x64.json | 2096 | `ad7507a7015d914d7843e8f5be5cdd10d55442c1b22de1cd31b515f06b2707f0` |
| macos-x64.png | 37202 | `2384c98b5a5fe3f90579599f170283f1916a2e88f77894f34cbb45cf40490f7c` |
| macos-arm64.json | 2104 | `ac73f2974b5840579ebefff8a92c5137b9d7a1bcec77beee9907dd828977b364` |
| macos-arm64.png | 34025 | `779c14a263aae70fd5ea5cf31e33defe053d5de7d8b0c2b55dd9b6f32a025030` |
