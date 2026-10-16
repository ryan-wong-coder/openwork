# 官网 1.0.3 真实上线验收

最终结果：**通过；首次固定时间断言失败已保留，下述第二轮使用原脚本通过。** 本轮未修改网站、客户端、素材、测试脚本或版本标签，1.0.2 历史证据保持不变。

- 网站：<https://www.zeno.ryan-wong.cn>，网站提交 `3e74875ff`。
- 实际 release API：`1.0.3`，10 个安装包、6 个平台/CPU 组合。
- 检查时间：2026-10-16 15:07–15:11 UTC；桌面 `1440×1000`、窄屏 `390×844`。
- 命令：`node apps/zeno-site/scripts/qa-live.mjs 1.0.3`；`node apps/zeno-site/scripts/qa-hero-live-v3.mjs 1.0.3 3e74875ff`。

## 实测结果

[下载与平台报告](live-qa.json)通过：页面展示真实版本，6 组平台/CPU 的下载地址及校验和与真实 API 一致；未下载大型安装包。

[首屏视频报告](hero-live-qa.json)的 13 项检查通过，包含实际解码三场景、自动静音行内循环、CPU 选择、文件元数据、安装说明、暗色、离屏暂停/返回继续、双向断点切换、窄屏、产品预览与归属。连续播放观察 **20,540 ms**，最高采样时间 **19.362406 s**，自然循环 **1 次**，中途暂停 **0 次**。两次桌面↔390px 切换均选择了正确横/竖片并实际推进时间；初始桌面只请求横片，窄屏媒体请求仅竖片，无额外横片请求。首屏覆盖视口，无横向溢出。

[媒体 HTTP 报告](hero-media-live.json)通过：横片、竖片及两个真实首帧 poster 的完整响应与本地交付文件逐字节一致，SHA256/SHA512、`video/mp4` / `image/webp` MIME、64 字节 Range 响应均通过。6 个参考 PNG 路径返回 404；独立网站 <https://www.party.ryan-wong.cn> 返回 200。

所有页面请求均为官网自身 origin，两个浏览器报告均为 **0 个运行时异常**。未拦截公网 API，未使用 fixture，未访问系统剪贴板，未修改真实配置，未启动原生客户端。仅创建并关闭自己的 target / browser context。这里验证网页与小型媒体交付，不据此宣称安装包安装或原生更新通过。

## 首次失败与复验边界

保留原始[首轮失败报告](attempts/hero-live-first-attempt.json)：桌面切换至窄屏后，固定等待 **350 ms** 的 `time > resizedMobile.time` 断言失败。该轮此前已完成真实整段播放与循环；未记录失败瞬间的 `readyState` 或加载耗时，故**根因未确认，只能记录为待定的时序波动**，不能认定为网络加载问题。

随后使用相同网站与原脚本重跑一次，双向 source 选择和两次 350 ms 时间推进断言均通过，完成全部 13 项检查。未放宽断言、修改等待时间或修改产品来获得本次通过。

## 视觉检查

已逐张实际查看以下 **13 张最终截图**。未发现可复现的 P0/P1/P2：三个场景可辨，白色品牌与青柠下载按钮对比清楚，手机双 CPU 按钮、元数据和安装说明均完整可用。全出血裁切仍会略裁到场景最外侧毛边，属于既有 P3 构图取舍。

| 范围 | 实际截图 |
| --- | --- |
| 下载回归 | [桌面](site-live-desktop.png)、[手机](site-live-mobile.png)、[手机暗色](site-live-mobile-dark.png) |
| 桌面三场景 | [编程](hero-live-01-desktop-coding.png)、[数据分析](hero-live-02-desktop-data.png)、[生活](hero-live-03-desktop-life.png) |
| 安装与暗色 | [安装说明](hero-live-04-install-help.png)、[桌面暗色](hero-live-05-desktop-dark.png) |
| 手机三场景 | [编程](hero-live-06-mobile-coding.png)、[数据分析](hero-live-07-mobile-data.png)、[生活](hero-live-08-mobile-life.png) |
| 其他状态 | [减少动态效果偏好](hero-live-09-mobile-reduced-motion.png)、[工作台预览](hero-live-10-workspace-preview.png) |

用户明确要求自动循环视频且不提供暂停或静态切换控件；本轮确认这一既定行为，包括减少动态效果偏好下仍播放视频、界面过渡关闭。此项不作为完整 WCAG 动效合规声明。设计规则与既有取舍见[官网 V3 设计验收](../../../design-qa-v3.md)。
