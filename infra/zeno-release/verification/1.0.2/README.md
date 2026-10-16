# macOS 原版 1.0.0 → 1.0.2 更新验收

[GitHub Actions run 38909991676](https://github.com/ryan-wong-coder/openwork/actions/runs/38909991676) 的两个 job 均为 **success**。验收代码提交为 `8ccf2cfca5d0356f5588e22d1a6d16a5bfc219d5`，目标产品构建提交为 `672ec6556b46d288cf07a4f71c9645e6f6411035`。

| 架构 | CI job | 最终结果 |
| --- | --- | --- |
| x64 | [117003111928](https://github.com/ryan-wong-coder/openwork/actions/runs/38909991676/job/117003111928) | success |
| arm64 | [117003112142](https://github.com/ryan-wong-coder/openwork/actions/runs/38909991676/job/117003112142) | success |

- baseline：构建 run `38883434626` 的原始 1.0.0 ZIP，按公开历史发布索引核对大小、SHA-256、SHA-512；未改 ASAR、Plist 或签名，未导入私钥。
- target：构建 run `38904606377` 的 1.0.2 ZIP，先与官网 API、原生 manifest 的大小和双哈希一致，用于生成安装后 ASAR 的校验预期。两架构目标 ASAR 的 SHA-256 均为 `e7f569bf551e628c30ce594c273c08b4bc0143ed3d1d872dfcdd72c7bd096954`。
- 原版应用自行从官网对应架构 HTTPS feed 下载真实目标 ZIP，经 Squirrel staging 后退出、替换、自动重启。验收脚本没有手工启动目标包来代替更新重启。
- 原版公开 leaf 证书导出的精确 requirement 校验原版、目标构建和最终安装包；严格签名验证通过。这证明本次自签身份连续性，不代表 Apple 公证。
- 重启后原生与磁盘版本均为 1.0.2；ASAR、Chromium profile、工作区文件及注册表、已存会话和消息、内置服务健康均验证成功，renderer 异常为 0。
- 每个 job 使用独立临时托管 runner、合成工作区与无真实密钥的 profile；报告与 PNG 按 CI 原始字节保存。两张 PNG 均已实际查看：正常中文 Zeno 窗口，空密钥引导和合成 CI 工作区，无密钥、个人资料或错误页面。

本证据仅覆盖本次 macOS 两架构原生更新。它不证明 Windows/Linux 的安装与重启，也不包含后续新增 6.1 能力修复；该修复不在已构建的 1.0.2 产品中。

## 归档 SHA-256

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| macos-x64.json | 2096 | `16deec5d768ee9dbf57dc16858209c5a7ed58777ece6519d3fa5d2811e2bbcbd` |
| macos-x64.png | 37384 | `2ec20597c30e49af7a3639b9ed5568bd27d40f31e05168335e136e8c34d9d280` |
| macos-arm64.json | 2104 | `140f86e4c94fa82c07c362c59602f569c7cd38dd9c82539b07825428342cbf10` |
| macos-arm64.png | 34216 | `a0515d3b0d6a74b413436293b407c570e9e04ca541a8f4969261aa517a472d54` |
