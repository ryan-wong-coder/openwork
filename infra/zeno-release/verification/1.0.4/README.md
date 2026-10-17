# 1.0.4 image-input verification

Verified on **2026-10-17 (Asia/Shanghai)**. This directory contains safe,
unmodified JSON stdout from the final synthetic native run and the root task's
two explicitly bounded live image-recognition requests. It contains no real
credential, native log, temporary profile, image Base64, raw answer or thinking.

## Evidence boundaries

The capability fallback covers **31 exact full ModelHelm routing IDs** whose
primary vendor documentation declares image input. The complete mapping and
sources are in
[gateway-image-capabilities-sources.md](../../../../apps/server/test/fixtures/gateway-image-capabilities-sources.md).
That table is documentation evidence for input capability. It does **not** mean
all 31 ModelHelm routes received a live image request. The fallback is limited
to the exact official ModelHelm base, retains explicit catalog negatives and
does not infer image support from a family name, attachment flag, image output,
PDF, video or audio support.

Actual live gateway image recognition was checked for **two models only**:

| Engine and exact model | Protocol | Result | PNG | External requests |
| --- | --- | --- | --- | --- |
| V1 1.18.30 — `anthropic/claude-sonnet-5` | Native `image.source/base64` | HTTP 200, streamed answer, correct four-quadrant order | 128 × 128, 577 bytes | 1 |
| V2 2.0.26 — `openai/gpt-6.1-sol` | Compatible `image_url/dataURL` | HTTP 200, streamed answer, correct four-quadrant order | 128 × 128, 501 bytes | 1 |

The root task executed exactly these **two live image requests**, each capped
at 512 output tokens and a 60-second request timeout, with no tools, retries or
continuations. Each technical PNG used a freshly shuffled four-colour layout;
the prompt requested position names without disclosing their colour answers.
The host compared the returned colour sequence in memory. The reports retain
only a success boolean and each image's byte count/MIME/SHA-256, not the image,
colour ordering or answer. Reported token usage is gateway-observed metadata;
it is not independent billing verification.

The separate final synthetic run made **zero external model calls**. It used
the final production model materializer, both pinned native engines, their real
SDKs and the authenticated scoped gateway proxy against localhost upstreams:

- **Four supported first turns:** GPT-6.1 and Claude Sonnet 5 on each engine.
  Each upstream received the same 76-byte 2 × 2 technical PNG, byte for byte,
  through the expected native image content part. Each turn used one model
  request, with no file-read tool continuation and no unsupported-image
  placeholder. The PNG SHA-256 was
  `8e546007599fa6df13786602a501cc2933ae498bb8ed8ff0fa4664f551cad2be`.
- **Two text-only negative controls:** one per engine. Each engine retained
  an explanatory unsupported-image message and sent zero image blocks. Each
  control made one ordinary synthetic text request containing that explanation.

Both native engines ran headlessly with isolated temporary HOME/XDG/database
directories. macOS `sandbox-exec` permitted native subprocess networking only
to loopback. The live upstream key remained in the trusted host process; native
configuration contained only the scoped proxy token. Live profile scans found
no upstream key. All profiles were removed and native logs discarded. Native
engines may transiently store their ordinary chat in those temporary profiles;
no transcript or response was retained after cleanup. No desktop window or GUI
was opened, and no other live request was made by these verification fixtures.

## Files and reproduction

- [synthetic-native-images.json](synthetic-native-images.json): final
  credential-free native transport run, including all four image turns and two
  negative controls.
- [live-native-v1-claude.json](live-native-v1-claude.json): the root task's one
  native Claude image-recognition request.
- [live-native-v2-gpt.json](live-native-v2-gpt.json): the root task's one
  compatible GPT image-recognition request.
- [Synthetic fixture and command](../../../../apps/server/test/fixtures/gateway-vision-native.md).
- [Opt-in live fixture and execution limits](../../../../apps/server/test/fixtures/gateway-vision-live-native.md).

The final synthetic run passed after the configuration ownership signature and
credential-fingerprint boundary changes. Strict TypeScript checking passed for
the synthetic fixture, its upstream helper and the opt-in live fixture. Both
live-fixture dry-run modes and credential-free synthetic preflights passed;
preflight generated answers are transport checks and are not counted as remote
visual-recognition evidence. These results do not establish GUI end-to-end
behaviour, arbitrary attachment formats, all-model gateway availability, or
general visual recognition accuracy beyond the two tested four-colour images.

## macOS 原版自动更新验收：保留首次 arm64 失败记录

[Run 39037150576](https://github.com/ryan-wong-coder/openwork/actions/runs/39037150576)
使用产品提交 `87ad6877b778cb9e69493f61b6915e688bcbd6b5`，历史构建
`38883434626` 的未修改 1.0.0 基线及目标构建 `39035417871`。
[arm64 job 117409190095](https://github.com/ryan-wong-coder/openwork/actions/runs/39037150576/job/117409190095)
在原生 `download()` 阶段失败。最后成功步骤为
`native-check-real-public-feed`，原生调用返回
`{ok:false, reason:"download-failed"}`；尚未达到更新 staging、替换或重启。

此前已通过：原始基线 ZIP 和目标 ZIP 与公开索引/feed 的大小及双哈希绑定、
原版无修改和同 leaf 签名校验、1.0.0 内置服务健康、合成历史消息持久化、官网
发现 1.0.4。下载开始于 13:36:47Z，失败于 13:44:55Z。产品统一错误码不能区分
HTTP 下载错误与后续原生 Squirrel staging 错误，当前报告和 CI 日志没有更具体
原因，不能仅凭此统一错误码将失败归因于 Squirrel，也不能将此运行描述为 macOS
更新通过。

Root 随后[核查官网 nginx 传输记录](macos-arm64-attempt-1-transport.json)：该 arm64 ZIP 请求于 13:44:48Z 结束，HTTP
200，但实际响应体仅发送 **419,291,136 字节**，小于目标 ZIP 应有的
**431,109,099 字节**。这一独立服务端记录支持 HTTP 传输未完成，先于 13:44:55Z
的下载断言失败；它不表明安装包或签名需要修改。本次失败记录保留，后续重试需
单独记载，不能覆盖为成功。

小型脱敏 artifact `12101899915` 的 ZIP SHA-256 已独立核对为
`4d88c1f30a0e9ffd7218527c62c99b60b1cfdf846f08824c2f2eb820c285df29`。
其中只有 [原始失败报告](macos-arm64-attempt-1.json)，没有成功后截图；
报告按原字节归档，临时原版副本/profile/缓存已由 CI 在进程退出后清理。
没有下载大型安装包到本地，没有修改或重签应用，没有额外模型请求。

## macOS x64 原版 1.0.0 → 1.0.4 已通过

上述 run 的 [x64 job 117409189928](https://github.com/ryan-wong-coder/openwork/actions/runs/39037150576/job/117409189928)
最终为 **success**。目标 ZIP 为 `zeno-mac-x64-1.0.4.zip`，450,494,346 字节，
SHA-256 为 `671018234bd5803740795c387a13c7185783ff66820f1517887b064c50389842`。
其大小、SHA-256、SHA-512 已在 CI 绑定公开官网索引和该架构原生 feed，并与原版
1.0.0 历史发布索引核对基线。归档时再次独立核对了报告中的版本、大小、SHA-256
与历史/官网元数据，以及官网索引和原生 feed 的 SHA-512 一致性。

原版应用的原生更新器从官网 HTTPS feed 下载目标 ZIP 并完成 Squirrel staging，
退出后发生真实包替换与自动重启；验收没有手动启动目标包代替重启。原始、目标和
最终安装包均通过同一原版 leaf requirement 的严格签名校验。最终 ASAR SHA-256
为 `9291e03534deb064076b1d79b108e16de87853aacf8019253b046ee3eb8db832`，
与经过官网索引绑定的目标构建一致。原生及磁盘版本均为 1.0.4；Chromium profile、
工作区文件/注册表、已存会话/消息及内置服务健康均保留，renderer 异常数为 0。
这证明自签身份连续性，不代表 Apple 公证或 Windows/Linux 实际安装验收。

只下载了小型脱敏 artifact `12102819444`（ZIP 33,521 字节），独立核对 GitHub
artifact digest 为
`30746d0d5dc6a9feb7785b79d753cdfcdb0cfd2c1a4d21acd8596bba0de8b890`，
再按原始字节归档下列两文件。PNG 已实际查看：正常中文 Zeno 窗口、空密钥引导和
合成 `Zeno update CI` 工作区，无密钥、个人资料或错误页面。临时 profile/日志/
原版副本/缓存均已由 CI 在原生进程退出后清理；没有额外真实模型请求。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| [macos-x64.json](macos-x64.json) | 2096 | `fca5b30a45593de750a33a9a3077f4308735b728f771f3fbc92ee4e2179597ed` |
| [macos-x64.png](macos-x64.png) | 36682 | `13a9a56c5afda49e3ee54cdf727733e321dcc3fa8838b09de5d923226fd29aad` |

## macOS arm64 重试通过，双架构原版更新验收完成

仅 arm64 的新 [run 39038757972](https://github.com/ryan-wong-coder/openwork/actions/runs/39038757972)
及其 [job 117413811568](https://github.com/ryan-wong-coder/openwork/actions/runs/39038757972/job/117413811568)
均为 **success**。该次验收 checkout 为
`e1cb9f414bab849658e6bdf889c2017dd27e2717`，与产品提交相比仅修改 workflow 架构
选择及 smoke 脚本的可选脱敏诊断。已独立核对差异只有这两个开发验证文件；产品
tag、应用包、基线和目标构建没有改变。此重试没有删除或覆盖首次失败记录。

仍使用原版 1.0.0 构建 `38883434626` 和冻结的 1.0.4 构建 `39035417871`。
目标 `zeno-mac-arm64-1.0.4.zip` 为 431,109,099 字节，SHA-256 为
`69851571145612d8a8218e2bc4ff3d6eb6204834ebf62dc286c6a054d364f464`。
本地只读取了小型公开索引/feed 和脱敏 artifact；完整 ZIP 校验由 CI 执行，归档时
再次核对报告的基线/目标版本、大小、SHA-256 及索引/feed 的 SHA-512 绑定。

本次原生进度最终为 **431,109,099 / 431,109,099 字节、100%**，随后完成真实
Squirrel staging、原进程退出、应用包替换及自动重启；没有手工启动目标应用。
原版 leaf 精确 requirement 的严格签名校验通过。最终原生/磁盘版本均为 1.0.4，
ASAR SHA-256 同 x64 一致，为
`9291e03534deb064076b1d79b108e16de87853aacf8019253b046ee3eb8db832`。
Chromium profile、工作区文件/注册表、历史会话/消息、内置服务健康均保留，renderer
异常为 0。可选进度诊断不参与修改健康判定，没有放宽时间预算或更新校验。

小型脱敏 artifact `12103074315`（ZIP 32,257 字节）的 GitHub digest 已核对为
`1bbbf893d40ba50b3aa632c804d8c875a94d6c6cc87c3b08ab744610f8848f80`。
下列报告和 PNG 按原始字节归档；PNG 已实际查看，呈现正常中文 Zeno、空密钥引导
和合成 CI 工作区，无密钥、个人资料或错误页面。两张 Mac 成功后截图现均已实际
查看，两个运行均完成临时状态清理，没有额外真实模型请求。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| [macos-arm64.json](macos-arm64.json) | 2272 | `e9c140f36b8b1ba89b8a66cd129b0a5c066a92fdd57a4317f439473858c5c012` |
| [macos-arm64.png](macos-arm64.png) | 34133 | `f23d7b0461366a9c235d1cfb118da5b324455f4f3978cc3bb43c9e0e0dfdeb7b` |

最终结论为 **macOS x64 和 arm64 均通过真实原版 1.0.0 → 1.0.4 自动更新、安装、
重启及数据保留验收**。首次 arm64 传输失败仍单独保留。本节不扩展为 Windows/
Linux 的实际安装验收，也不代表 Apple 公证或其他模型已完成 live 识图测试。

## Distribution publication

The frozen build [39035417871](https://github.com/ryan-wong-coder/openwork/actions/runs/39035417871)
passed all six matching-CPU package runtime checks. [Build audit](build-release-audit.json)
records 24 assets and 10 installers. [Publication gate](publication-gate.json) verified
all 22 indexed lane files in full before the website feed activation at
2026-10-17T13:34:00Z. [Live HTTPS checks](live-release.json) cover the 10 installers
and six native feeds; [historical download checks](download-history.json) retain
30 installers from 1.0.0/1.0.2/1.0.3 by HEAD and 60 first/last range samples.
Those historical samples are not full public-download hashes.

[GitHub Release](https://github.com/ryan-wong-coder/openwork/releases/tag/zeno-v1.0.4) was published at 2026-10-17T14:11:14Z.
The [unauthenticated public audit](release-public.json) confirms it is latest,
non-draft, non-prerelease, and all 24 asset names/sizes/SHA-256 digests match the
frozen build (3,899,677,309 bytes total). [Live site QA](../../../../apps/zeno-site/verification/releases/1.0.4/README.md)
verified six platform/CPU download selections and three actually viewed screenshots.
Full fix, regression and release boundaries are in the [main report](../../verification-1.0.4.md).
