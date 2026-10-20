Zeno 1.1.2 独立发布审计已通过。冻结产品标签 `zeno-v1.1.2` 的 annotated-tag 对象为 `f576d0e877eabe611d1ea0af9400e3b16f8aa60e`，前后两次 GitHub REST 解析的 commit 均为 `46e5e38a5d7c4a147b0888d3a50e4788f045385e`。实际 [Release Zeno run 39431901305](https://github.com/ryan-wong-coder/openwork/actions/runs/39431901305) 已完成且成功；审计时 release ID `418463565` 为草稿。

- `native-build-audit.json`：六个匹配 CPU 的实际构建 job 全部成功。逐个读取最终 job 日志中的原始 verifier 回执，每 lane 都是 `runtimeSmoke: passed`；原生模块、内嵌服务器、合成工具／本地调度／持久化回执／重启不重放检查通过。每个实际包均完整读取并匹配 32 组、64 个媒体文件，共 7,125,941 字节。
- `preflight-regressions.json`：实际 CI 日志确认真实 electron-builder 文件收集和 AsarPackager 用五份完整原始许可证做字节比较，缺失／空文件拒绝及重复 staging 保真回归也通过。六个真实架构包中的许可证检查范围是归档文件存在和内容标记，未将其扩大为六次全部许可证逐字节比较。
- `release-assets-audit-attempt02.json`：独立读取 24 个 uploaded asset 的 GitHub 计算 SHA-256 和大小，总 4,019,823,853 字节。只下载 8 份小元数据，共 14,263 字节，并重新计算它们的 SHA-256／SHA-512。10 个安装包、6 个 blockmap、6 份 YAML 和 2 份元数据集合无多漏；22 项 index 记录完整覆盖所有安装包、blockmap 与 YAML。
- `validated-tuples-attempt02.json`：可供发布程序比较的完整元组。每 lane 的文件名集合严格匹配；6 份原始 YAML 的版本、主路径、无重复的完整安装包路径集合、大小及 SHA-512 均与 index 一致；YAML 原始字节也与 index、GitHub digest 一致。10 个 feed 安装包引用与 6 个目标吻合。
- `final-consistency.json`：把六个实际 native job 的 checkout、原生 smoke、签名模式和媒体数与独立下载的六个 index/feed 目标逐项关联。
- `cross-audit-match.json`：独立冻结的 24 组 `name/size/sha256` 与发布操作方的期望清单逐项相同。
- `documents/`：独立下载并验证过的原始 index、发布说明及 6 份 YAML。发布说明同时与冻结源文件匹配。此发布配方不另外发布 SHA256SUMS；校验值在 index 和 GitHub asset digests 中。
- `workflow-wiring.json`：构建结束前保存的冻结源码检查与预期 64 媒体哈希，保留了当时“run 尚在进行”的时间范围；最终结果以以上回执为准。

未重复下载或完整读取大型安装包／blockmap；这里的安装包 SHA-512 检查证明 index 与 feed 一致，安装包 SHA-256 和大小来自 GitHub asset 元数据。完整本地／服务器镜像字节验证由发布操作方另行执行。本审计没有修改标签、GitHub release、官网 feed 或服务器；也未声称已经验证安装后的 GUI、原版升级、实际 OS keychain 或真实模型调用。

保留所有失败观察：`inflight-log-availability.json` 是 run 未结束时 gh CLI 暂不提供单 job 日志；`draft-lookup-availability.json` 是 draft 的按 tag REST 查询返回 404，随后 authenticated release list/by-ID 取得现有草稿；`release-assets-audit.json` 的 Failed 是审计脚本把 Buffer 直接交给 YAML.parse 造成 TypeError。修正为 UTF-8 文本后输出独立的 `attempt02` 成功报告，原失败记录未覆盖。该 TypeError 未指向产物内容错误。

公开证据采用白名单字段，未保存认证信息、临时签名下载地址、完整原始构建日志或上传者账号信息。
