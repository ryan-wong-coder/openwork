# Zeno 1.0.5 发布证据

产品 tag `zeno-v1.0.5` 固定于 `51310c0200874451e07b46e3c9345d63b681e527`。
后续验证脚本与证据提交不移动 tag，不改动或重新签署产品包。

- [主验证记录](../../verification-1.0.5.md)：功能、源码与发布验收范围。
- [冻结构建审计](build-release-audit.json)：六平台构建
  [39189963114](https://github.com/ryan-wong-coder/openwork/actions/runs/39189963114)
  全部成功；24 个文件、10 个安装包及六个 matching-CPU runtime smoke。
  `isDraft: true` 是审计当时的状态，最终公开状态以独立公开记录为准。
- [服务器发布门](publication-gate.json)：全部 24 个上传文件按冻结审计完整校验，
  索引内 22 个 lane 文件再完整核对双哈希；2026-10-19T03:18:44.256Z 原子切换。
- [官网 HTTPS 检查](live-release.json)：10 个安装包与六个原生更新 feed。
- [历史下载检查](download-history.json)：40 个历史安装包的下载/updater HEAD，
  80 次首尾 Range 与切换前私有快照一致，服务器文件身份未改变。
- [真实官网页面](../../../../apps/zeno-site/verification/releases/1.0.5/README.md)：
  六组下载选择和三张已实际查看的桌面/手机截图，运行时异常为 0。
- [Mac 原版更新与安装后画板](macos-native-update.md)：原始报告、artifact digest、
  已实际查看的截图和按架构、attempt 区分的验收边界，保留首次 x64 传输失败。
- [GitHub 匿名公开验证](release-public.json)：2026-10-19T03:42:23Z 正式公开，
  非预发布并设为 latest；24 个文件与冻结构建一致，产品 tag 未移动。
- [发布缓存清理](cleanup.json)：22 个公开 lane 文件再次完整 SHA-256 校验，
  副本 inode 独立、无私有 stage 链接依赖，40 个历史包保留，仅删除任务私有缓存。

所有记录不含密钥、签名私钥、临时 profile、原生日志或模型对话。历史 Range
检查不是完整下载哈希；Windows/Linux 构建与资源检查也不代表其 GUI 安装、升级
或重启验收。两种 Mac 架构均已完成真实更新、重启、数据保留和安装后画板验收。
