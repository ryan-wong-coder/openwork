# Zeno 1.0.0 发布验证

产品标签：`zeno-v1.0.0`，产品提交 `926880464`。标签后的修改仅涉及验收脚本、部署缓存配置和证据文档，安装包保持构建时的原始字节。

## 官网与下载

[官网](https://www.zeno.ryan-wong.cn) 使用独立 HTTPS 域名，证书自动续期已启用。服务器生成发布目录前，逐一核对全部原始产物的大小、SHA-256、SHA-512，再原子启用完整发布目录。版本包存放在持久目录，下一版本切换后旧更新链接仍可读取。

[正式下载验收](../../apps/zeno-site/verification/release-live.json) 覆盖 10 个安装包、6 套原生更新源、实际格式头与 CPU 架构、Range、缓存和清单哈希一致性。[真实浏览器验收](../../apps/zeno-site/verification/live-qa.json) 未替换线上 API，六种平台与架构选择通过，零运行时异常、零站外资源请求。桌面、手机及暗色截图见 [官网设计验收](../../apps/zeno-site/design-qa.md)。

## 六平台原生构建与运行

[Release Zeno 成功运行](https://github.com/ryan-wong-coder/openwork/actions/runs/38883434626) 的六个原生 runner 全部通过构建、包结构及包内运行验证：

| 平台 | CPU | 格式 |
| --- | --- | --- |
| macOS | x64、arm64 | DMG、ZIP |
| Windows | x64、arm64 | EXE |
| Linux | x64、arm64 | AppImage、DEB |

包内运行验证实际启动 Electron 的 Node 模式，检查原生 sqlite、node-pty、内置本地服务、网关状态与认证边界。OpenCode V1/V2 均随各架构的包内置。Windows/Linux 本轮验证范围为原生打包、模块加载、内置服务启动及更新器回归；未执行 GUI 完整升级测试。

## macOS 真实自动升级

[真实更新运行](https://github.com/ryan-wong-coder/openwork/actions/runs/38891812005) 使用一次性 GitHub 托管 Mac、独立应用副本、配置与工作区。内部基线版本为 `0.999.0`，只修改正式包的版本元数据及对应 ASAR 完整性信息，再使用同一持久证书签名；该基线不公开发布。

基线 ZIP 来自成功构建，并与真实官网 API 和更新源的尺寸及双哈希核对。原生更新器随后独立从官网检查、下载完整正式 ZIP，由 Squirrel 暂存、替换并实际自动重启。安装完成后再次核对原生版本、磁盘版本、正式 ASAR 字节及签名，并确认配置标记、工作区 ID/文件、会话与消息、内置服务保留，零渲染器异常。测试不手动重启目标版本。

两种架构均通过全部断言，并正常清理独立应用和配置，无手动重启或进程信号兜底：

| CPU | 实际官网下载 | 完整报告 | 重启后截图 |
| --- | --- | --- | --- |
| Apple Silicon | 431,100,608 bytes | [arm64](verification/1.0.0/macos-arm64.json) | [arm64](verification/1.0.0/macos-arm64.png) |
| Intel | 450,485,918 bytes | [x64](verification/1.0.0/macos-x64.json) | [x64](verification/1.0.0/macos-x64.png) |

macOS 使用长期自签证书，未进行 Apple 公证；Windows 包未签名。官网按平台说明首次安装时的系统确认步骤。Linux DEB 更新可能需要系统授权，AppImage 应放在用户可写位置。
