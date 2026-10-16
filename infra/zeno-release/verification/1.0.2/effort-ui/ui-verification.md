# 1.0.2 思考深度 UI 验证

Result: passed

关联产品提交 `672ec6556`。本地检查真实 `ModelSelect`、`ModelPickerList`、Base UI
原语与现有 app CSS；目录、工作区等 hooks 使用明确的合成数据。截图标有
“QA 合成模型能力”，[报告](report.json) 标记 `fixtureOnly: true`。
这组证据证明界面状态，不证明具体供应商能力，也不替代打包后原生推理验证。

## 四项实际检查

| 状态 | 实测行为 | 截图 |
| --- | --- | --- |
| 已声明推理、无手动档位 | 显示“模型自动控制”，深度菜单禁用。 | [automatic](automatic.png) |
| 未提供推理/档位能力 | 显示“未提供可调深度”，不从模型名字推断能力。 | [unknown](unknown.png) |
| 已声明手动档位 | 显示默认、轻量、均衡、深入、最高；选择“最高”仍回调原生 ID `max`。 | [manual](manual.png) |
| 已保存档位未列入当前目录 | 原值可见且未静默清除；恢复菜单仅提供“默认”，显式操作回调 `null`。 | [saved state](saved-state.png)、[recovery](saved.png) |

五张 900×720 截图均已实际查看。四项检查通过，0 Runtime exception。

## 测试与规则

- `pnpm --dir apps/app exec bun test tests/model-effort.test.tsx`：9 项通过，
  34 个断言，包含两个选择器的旧设置恢复与已知中文标签/原生 ID 保持。
- `pnpm --dir apps/app exec bun test tests/model-effort-v2-adapter.test.ts`：
  1 项通过，12 个断言。真实 `createClientV2(...).provider.list()` 仅访问临时
  localhost fixture 的三条 GET，验证 native reasoning/variants 经适配器和目录
  到 UI 状态的完整映射；未导出私有转换函数来绕过调用链。
- App typecheck 两轮通过，相关文件 `git diff --check` 通过。
- DESIGN.md **P1**：报告当前真实能力状态；**P3**：只在用户打开时显示档位或恢复
  操作；**P5 / S7**：复用现有 Base UI 浮层与控件；**P10**：保留实际截图证据；
  **C6**：未列出的旧设置保留明确恢复方向。没有以 saved value 伪造可调能力。

## 隔离与边界

截图运行在独立临时 Chrome browser context 和 target。Harness 不调用后端 API，
选项回调仅更新临时 React 状态；没有真实网关、默认模型或其他配置写操作，也没有
模型调用、安装包下载、系统剪贴板访问或原生 app 启动。外部模型图标 GET 被 harness
在网络发出前阻断，报告只保留请求方法与非敏感路径；这不代表真实产品网络审计。

结束后 target、browser context 和临时静态服务器均已关闭。归档报告移除了临时
浏览器标识，只保留清理成功布尔值。证据没有模型密钥、凭据、私人姓名或客户内容。
