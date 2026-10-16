# Zeno 独立官网与发版

官网、下载和客户端更新统一使用 `https://www.zeno.ryan-wong.cn`。不需要 OpenWork 账号或官方发版服务。

## 构建与发布

1. 桌面版本在 `apps/desktop/package.json`。提交到 `personal` 后，推送匹配的 `zeno-vX.Y.Z` 标签；不要使用上游 `v*` 标签。
2. `.github/workflows/zeno-release.yml` 构建 macOS、Windows、Linux 的 x64 和 arm64。六个目标全部通过校验后创建草稿 GitHub Release；保留草稿状态完成后续部署与验收，再公开发布。
3. 下载该 Release 的所有文件到一个新目录，执行：

   ```sh
   node infra/zeno-release/prepare-publication.mjs RELEASE_DIRECTORY NEW_BUNDLE_DIRECTORY PUBLISHED_AT_ISO
   pnpm --filter @zeno/site build
   ```

   `PUBLISHED_AT_ISO` 使用 Release 实际发布时间。脚本验证十个安装包及六套原生更新元数据的尺寸、SHA-256 和 SHA-512，生成官网 API；任何目标缺失都拒绝发布。它不接受其他域名、路径逃逸或不支持更新的 macOS 临时签名。
4. 将 bundle 上传至服务器新的 `/srv/zeno/releases/<version>`，把它的 `downloads/<version>` 移到持久的 `/srv/zeno/downloads/<version>`，再将 bundle 中的 `downloads` 替换为指向 `/srv/zeno/downloads` 的符号链接。已发布的下载文件不可覆写。
5. 用临时符号链接加 `mv -T` 原子切换 `/srv/zeno/release-current` 到完整 bundle。静态官网单独放在 `/srv/zeno/site-releases/<commit>`，同样切换 `/srv/zeno/current`。旧目录可用于回退；保留旧版本下载。

Nginx 使用本目录 `nginx.conf`。只新增 Zeno 虚拟主机，不替换其他站点。证书通过 certbot webroot 签发，挑战目录 `/var/www/zeno-acme`，续期后执行 `nginx -t && systemctl reload nginx`。

## 接口和文件布局

| 路径 | 用途 |
| --- | --- |
| `/api/releases/latest.json` | 官网版本、实际安装包、尺寸、签名状态与校验和 |
| `/downloads/<version>/<filename>` | 持久安装包，支持 HTTP Range |
| `/updates/<platform>/<arch>/` | electron-updater 原生元数据、安装包与 blockmap；没有目录索引 |

`platform` 为 `darwin`、`win32` 或 `linux`；`arch` 为 `x64` 或 `arm64`。官网 HTML、JS、CSS 每次重新验证缓存，API 与更新元数据均不缓存。下载包按版本命名并长期缓存。更新只允许自身域名下对应架构的目录。Nginx 将版本文件映射到持久下载目录：即使检查更新后官网切到下一版，之前检查到的更新文件仍然可下载，不依赖新 bundle 里的当前版本链接。

## 签名连续性

macOS 自签包必须在所有版本使用同一长期代码签名证书。GitHub Actions 使用 `ZENO_MAC_CODESIGN_P12_BASE64` 和 `ZENO_MAC_CODESIGN_PASSWORD` secrets；私钥和密码永远不进入仓库、Release 或服务器公开目录。证书缺失时直接停止构建，不能悄悄换成临时签名。签名包装器仅在构建时导入私有临时钥匙串，结束后恢复原有搜索列表并删除临时钥匙串。

macOS 自签名没有 Apple 公证，首次安装可能需要在系统设置允许打开。Windows 未签名包可能提示未知发布者。Linux DEB 更新可能需要系统授权；AppImage 应放在用户可写位置。

## 客户端更新

仅正式 Zeno 安装包开启独立更新。启动约 45 秒后检查一次，此后每 6 小时检查，关于页也可手动检查。用户选择“更新并重启”后下载；待草稿、附件、队列、活动会话以及后台权限/问题请求全部处理完毕，再由本地服务重新确认空闲后安装重启。探测失败不代表空闲。关闭更新 feature 会停止检查与安装，并保留工作区和历史。

单测验证协议和状态逻辑；真实安装重启还必须使用同签名的两份安装包验证。跨平台包构建成功不能替代各系统的运行验证。

验证命令：`node --test infra/zeno-release/prepare-publication.test.mjs`；Linux 上运行 `python3 infra/zeno-release/test-nginx-history.py`，会使用私有 loopback Nginx 验证切换版本后十种历史包及 Range 仍可读取，测试文件不会进入公网。发布后执行 `node infra/zeno-release/verify-live.mjs` 和 `node apps/zeno-site/scripts/qa-live.mjs`，后者使用独立 headless CDP target、真实官网 API，不注入测试下载数据。
