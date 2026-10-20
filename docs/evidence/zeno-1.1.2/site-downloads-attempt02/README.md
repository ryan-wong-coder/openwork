Zeno 1.1.2 已激活后的真实官网检查通过：`hero-live-qa.json` 记录 14 项检查，11 张原始截图均已实际查看，见 `visual-review.json`。使用独立、临时、无登录的 headless Chrome 页面，未拦截发布接口、替换 UI API、调用系统剪贴板或点击安装器链接。发布操作方确认 landing 使用 commit `15a286a5c`；此处将该部署来源记录在报告中，实际检查对象为公开网站。

- `actual-public-release.json` 是实际 `/api/releases/latest.json` 响应。10 个安装包的架构、大小和 SHA-256/SHA-512 与独立审计的冻结 index 相同。
- `public-feed-checks.json` 独立 GET 六份已激活的更新 YAML，并对原始响应字节重新计算 SHA-256/SHA-512，与已审计的 GitHub metadata 一致。
- 逐条点击全部 10 个安装包的“校验和”展示按钮，核对架构选项、选中的真实下载 URL 和页面中的完整哈希值；“复制”按钮从未激活。SHA 输入框内长内容按原生输入框滚动，未出现页面水平溢出。
- 验证桌面／手机三段场景、19.5 秒完整连续播放及循环、暗色、视口切换、手机独立视频源和预览展开。产品图实际加载，OpenWork 归属说明保留。浏览器 runtime exceptions 为零，浏览器请求均留在本站，没有安装器请求。
- `hero-media-live.json` 保留原有 QA 对四份实际 hero 媒体完整字节和 Range 的验证，以及源图不可公开访问检查。
- `owned-browser-cleanup.json` 记录两个自建 headless 进程和临时 profile 已清理；没有接管现有浏览器或打开桌面窗口。

第一轮原始证据保留在 `../site-downloads/`，其中 `hero-live-qa.json` 的 `passed:false` 未改写：12 项检查和 10 张截图完成后，继承的旧 QA 脚本试图点击已移除的 `#previewNav`，报 `Uncaught`。实际公开 HTML 使用 `#workspacePreview > summary`；`selector-observation.json` 记录公开 HTML hash 和观察。只更正私有测试选择器并重新使用新目录、新 Chrome/profile 跑完整检查，官网源码与部署未修改。两个目录合计 21 张截图都已实际查看。

本检查验证真实官网的选择、元数据、原始 feed 和媒体渲染；没有重复下载大型安装包，也未验证真实安装、OS keychain、原版升级或复制 API 行为。大型包完整字节及 HTTP 安装包/Range 校验由发布操作方另行执行。
