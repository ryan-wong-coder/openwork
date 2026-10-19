# 官网 1.0.5 下载回归验收

结果：**通过**。报告起始时间 `2026-10-19T03:19:38.966Z`
（Asia/Shanghai 11:19）。官网为 <https://www.zeno.ryan-wong.cn>。

执行既有 `node apps/zeno-site/scripts/qa-live.mjs 1.0.5`，使用独立临时 profile
的 headless Chrome 和私有 loopback CDP；没有使用用户浏览器、拦截 API、注入
fixture 或触发大型安装包下载。只在本目录新增验证记录和截图，未改产品 UI、
网站素材、QA 脚本或部署。

[真实公网报告](live-qa.json)确认 API 为 **1.0.5**、共有 **10 个安装包**。
macOS、Windows、Linux 各自 x64/arm64 共 **6 组**选择，取得的真实下载地址、
平台、架构和 SHA-256 均与 API 一致。macOS 选择 CPU 前隐藏下载按钮的行为也通过。

桌面 `1440×1000`，手机 `390×844`，手机无横向溢出。对应横/竖视频实际解码后
截图。运行时异常 **0**，所有页面请求均只访问官网自身 origin。

以下 **3 张截图均已逐张实际查看**：版本 `v1.0.5`、平台与 CPU、下载按钮、
安装包大小、格式、签名状态和安装说明清晰可见；吉祥物视频与品牌构图正常，
未发现本轮可复现的 P0/P1/P2。

| 实际截图 | 范围 |
| --- | --- |
| [桌面](site-live-desktop.png) | 横向视频、macOS Apple Silicon 和 1.0.5 下载状态。 |
| [手机](site-live-mobile.png) | 竖向视频、窄屏选择器和下载状态。 |
| [手机暗色](site-live-mobile-dark.png) | 暗色偏好下的同一真实版本状态。 |

本轮仅回归实际 release API 和下载交互，没有重跑完整电影专项。页面检查不代表
安装包全量摘要、原生安装或自动更新重启验收；这些由独立发布流程记录。完成后
已停止本次创建的 Chrome，并移除其临时 profile。
