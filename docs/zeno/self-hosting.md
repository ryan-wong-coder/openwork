# 泽诺的安装与自部署构建

泽诺桌面与自部署 Web 默认使用 `local-gateway`：中文界面、泽诺视觉、自行配置的模型网关，不要求 OpenWork 官方账户。部署在自己的服务器上同样使用这套配置；部署位置不会自动开启 Den 登录。

本文记录构建入口与运行边界，不表示已发布安装包、已部署公网服务或完成生产环境验收。视觉来源见 [资源来源](visual-sources.md)，界面检查见 [视觉与交互验收](design-qa.md)。

## Web 构建

```sh
pnpm dev:web
pnpm build:web
```

根目录的 `dev:web` 启动泽诺应用前端，`build:web` 调用 `@openwork/app` 的 `build:selfhost`。它们不会启动 Den 账号控制台。

| 入口 | 用途 |
| --- | --- |
| `pnpm --filter @openwork/app build:selfhost` | 直接构建泽诺自部署 Web |
| `pnpm --filter @openwork/app build:web` | 与 `build:selfhost` 相同的应用构建 |
| `pnpm --filter @openwork/app build:cloud` | 显式 `connected`、要求官方登录的旧受管构建，非泽诺默认入口 |
| `pnpm dev:den:web` | 显式启动原 Den 控制台，非泽诺应用开发入口 |

自部署构建生成 `apps/app/dist` 静态前端。运行任务仍需要与之匹配的服务端、OpenCode 引擎与自行配置的模型网关；单独发布静态目录不会提供这些能力。

默认入口不注入 `VITE_DEN_REQUIRE_SIGNIN=1`。明确设置该变量、`VITE_OPENWORK_CLIENT_PROFILE=connected`，或安装已有 `requireSignin` / `requireActivation` 策略时，保护仍然生效。泽诺分发不携带这些受管配置。

## 首次使用

未配置网关的个人安装会直接进入 ModelHelm 密钥填写页。保存时验证模型目录，沿用当前地址与模型设置；已有工作区还会确认运行中的引擎已加载对话模型。密钥保存于服务端既有私有环境存储，浏览器不持久化密钥，之后启动不重复要求填写。也可选择稍后设置，或从网关设置管理可用模型。

无 host 管理权限的自部署 Web 不收集无法保存的密钥，由部署者在服务器完成配置；它继续使用只读状态确认可用性。首次引导不会取消管理权限、要求官方账号或把 host-token 放入前端。设置中的“关于泽诺”页包含产品来源、生日祝福与折叠的内核许可。

## 服务端与访问凭据

从源码构建前端后，可以让服务端在同一来源提供 UI 与 API：

```sh
OPENWORK_WEB_ROOT="$PWD/apps/app/dist" pnpm --filter openwork-server exec bun src/cli.ts web --client-profile local-gateway
```

命令默认仅监听 `127.0.0.1:8787`，适合在安装者自己的机器上使用。服务端默认浏览器引导会向页面提供客户端 token，省去官方账号流程；能够访问该页面的人也能获得这个客户端权限。对外提供服务前，应在反向代理处完成访问控制并保持 HTTPS、API 路径与 token 来源一致。若已有受控的客户端凭据分发流程，可加 `--no-bootstrap-token` 关闭自动引导；此时必须先向客户端提供有效访问 token，不能把静态页面本身当成完整可用的部署。独立服务地址必须由安装者明确配置。

服务端进程默认采用独立配置，也可由部署进程设置 `OPENWORK_CLIENT_PROFILE=local-gateway`。它是可信启动参数，不从工作区配置、浏览器请求或用户环境变量编辑器读取。显式旧受管进程使用 `--client-profile connected` / `OPENWORK_CLIENT_PROFILE=connected`；带 Den 托管标记且未明确选择配置的旧进程仍保留受管行为。

免 OpenWork 官方账号不会取消服务端鉴权。本地 API bearer token、host-token、工作区权限、协作者范围与网关代理 token 继续生效。

| 操作 | 凭据与返回范围 |
| --- | --- |
| `GET /gateway/status` | 客户端 bearer token；只读返回 `configured`、`ready`、`chatModel` 与必要的 `readinessReason`，供聊天判断是否可用 |
| `GET /gateway/config` | host-token；读取管理配置与已保存密钥的末四位 |
| `PUT /gateway/config`、目录同步、测试连接 | host-token；由安装者管理地址、密钥、模型与连接测试 |

`/gateway/status` 不返回上游 API 密钥、密钥末四位、上游地址或 host-token，也不赋予管理权限。普通聊天客户端无需获得 host-token 来读取就绪状态。

不要把 host-token、上游 API 密钥或共享客户端 token 写入公开 `VITE_*` 变量、静态 bundle、示例配置、截图或仓库。host-token 仅由可信安装者持有；客户端 token 通过受控的运行时连接流程提供，并继续按服务地址绑定。`VITE_*` 编译结果对访问前端的人可见，不能承担密钥存储。

## 独立配置的网络范围

独立配置禁止 OpenWork 模型目录后台刷新、Den 提供商同步、Connect 技能/自动化目录拉取、托管心跳和官方免费推理，不删除保留的凭据。自行配置的模型网关和其他 MCP 继续工作。默认通过 OpenCode 实际支持的 `OPENCODE_DISABLE_MODELS_FETCH=1` 停止目录下载；自行提供的非官方 `OPENCODE_MODELS_URL` 镜像仍可使用。

这不是离线运行开关。首次运行可能需要安装 OpenCode 引擎，用户选择的模型提供方与 MCP 也会使用网络。上游模型请求仍经过原有代理和 token 校验。

## 桌面构建

```sh
pnpm --filter @openwork/desktop package:electron:zeno
```

这个入口生成使用泽诺名称与应用图标的桌面包，不向上游仓库发布。构建可能需要当前平台的 sidecar、原生依赖、签名与打包环境；源代码配置通过检查不等于安装包已经构建或完成系统实机验收。

泽诺桌面包不加载官方自动更新器，也不检查、下载或恢复官方发行版本。版本由安装者自行维护。

它沿用 `com.differentai.openwork`、`openwork://` 和已有配置目录，使工作区与历史可继续使用。显示名称在原 `userData` 路径固定后应用，已有登录或激活要求不会因为改名而被清除。原生 OpenWork 内核的版权、协议和诊断标识保留。
