# 会话画板

Zeno 可以在助手的 Markdown 回答里直接呈现交互画板。适合过程说明、方案比较、参数模拟、设计关系图和数据分析；简单回答仍使用文字。

## 输出格式

使用完整的顶层代码围栏。普通 `html` 代码示例、用户输入、引用和工具输出不会自动执行。

````markdown
```zeno-html title="方案比较"
<label class="form-label">每月预算
  <input class="form-range" type="range" min="100" max="1000" value="500">
</label>
<output>500 元</output>
<script>
const input = document.querySelector('input');
const output = document.querySelector('output');
input.addEventListener('input', () => { output.textContent = `${input.value} 元`; });
</script>
```
````

画板支持 HTML、内联 CSS/JavaScript、SVG 和 Canvas。独立 SVG 也可使用 `svg` 围栏。宿主提供布局与控件样式、中文标题，以及亮色和深色主题；复杂 Canvas 应带简短的文字说明和有标签的键盘可用控件。

Ant Design Charts 已本地打包，使用 `ant-chart` 围栏传入 JSON：

````markdown
```ant-chart
{"type":"Column","title":"示例：三种方案的用时（小时）","data":[{"方案":"A","小时":3},{"方案":"B","小时":5},{"方案":"C","小时":4}],"xField":"方案","yField":"小时"}
```
````

支持 `Line`、`Area`、`Column`、`Bar`、`Pie`、`Scatter`、`Heatmap`、`Radar`、`Funnel`，以及 `FlowGraph`、`MindMap`、`OrganizationChart`、`NetworkGraph`、`IndentedTree`。选项遵循 [Ant Design Charts 官方文档](https://charts.ant.design/manual/introduction)，数据必须内联；JSON 中的字符串不会作为回调执行。示例数据应明确标注，实际分析必须使用可验证的数据。

在 `zeno-html` 中可先 `await ZenoCharts.ready`，再调用 `ZenoCharts.render(element, config)`。返回的实例提供 `ready`、`update(config)`、`resize()` 和 `destroy()`，可由本地控件驱动图表变化，无需导入库或连接 CDN。

## 呈现与兼容

流式输出中，只有闭合围栏会执行。未完成的新画板保留固定占位；已经运行的画板在后续文字、检索高亮、生成结束或源码切换时保留实例和交互状态。修改中的代码会等到新围栏闭合才替换旧画板。

生成内容在独立的 opaque-origin sandbox 中运行，无法使用宿主的文件、凭据或桌面桥接。独立静态外壳的 `Connection-Allowlist: ()` 响应头提供原生网络限制，另有 CSP 限制资源、导航和表单。

- 桌面端通过内部 `zeno-canvas:` 协议提供外壳，并在 Chromium 启动前启用所需的原生策略。
- 自部署网页由 OpenWork Server 或 Vite 提供同一个外壳响应头；网页需要 Chromium 152 或更新版本。其他静态服务器也须为 `/zeno-canvas-shell.html` 配置该响应头。
- 不支持策略或外壳未正确配置时，画板显示可复制的源码，避免执行生成的脚本。

功能注册项 `conversationCanvas` 默认关闭；Zeno 独立本地部署由共享的 `LOCAL_GATEWAY_OPERATOR_FEATURES` 配置启用。提示词和渲染器使用同一个配置来源，关闭后不再注入画板提示词，Markdown 恢复普通代码显示。

验证证据见 [组件浏览器验证](../apps/app/verification/conversation-canvas/README.md) 和 [网络隔离验证](../apps/app/verification/canvas-isolation/README.md)。已完成网页生产构建、Electron 相对资源路径构建，以及实际 Chrome / Electron 隔离检查；提示词覆盖 V1 和 V2 两条调用路径。功能注册的 Helm 配置和 API 合约也已同步，当前机器未安装 Helm，因此未执行可选的 Helm 模板渲染检查。

这些验证使用合成数据，未调用真实模型，不代表已发布安装包或已上线部署。
