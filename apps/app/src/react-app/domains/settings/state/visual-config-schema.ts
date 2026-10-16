import type { Config } from "@opencode-ai/sdk/v2/client";
import { configValueKind, isConfigObject, type ConfigObject, type ConfigValue, type ConfigValueKind } from "./visual-config-document";

export type ConfigField = {
  label: string;
  kinds: ConfigValueKind[];
  properties?: Record<string, ConfigField>;
  additional?: ConfigField;
  items?: ConfigField;
  choices?: { value: string; label: string }[];
  initial?: ConfigValue;
  multiline?: boolean;
  secret?: boolean;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  required?: string[];
  validate?: (value: ConfigValue) => string | null;
};

const text = (label: string, multiline = false): ConfigField => ({ label, kinds: ["string"], multiline });
const number = (label: string, minimum = 0, integer = true): ConfigField => ({ label, kinds: ["number"], minimum, integer });
const toggle = (label: string): ConfigField => ({ label, kinds: ["boolean"] });
const object = (label: string, properties: Record<string, ConfigField> = {}, additional?: ConfigField): ConfigField => ({ label, kinds: ["object"], properties, additional });
const list = (label: string, items: ConfigField = text("项目")): ConfigField => ({ label, kinds: ["array"], items });
const choice = (label: string, choices: { value: string; label: string }[]): ConfigField => ({ label, kinds: ["string"], choices, initial: choices[0]?.value ?? "" });

/** Arbitrary SDK/plugin values are edited as typed fields, never a raw text blob. */
export const customConfigField: ConfigField = {
  label: "自定义选项", kinds: ["string", "number", "boolean", "object", "array", "null"],
};
const stringMap = (label: string, secret = false): ConfigField => object(label, {}, { ...text("值"), secret });
const booleanMap = (label: string): ConfigField => object(label, {}, toggle("启用"));
const permissionAction = choice("执行方式", [
  { value: "ask", label: "每次询问" }, { value: "allow", label: "允许" }, { value: "deny", label: "阻止" },
]);
const permissionRule: ConfigField = { ...permissionAction, kinds: ["string", "object"], additional: permissionAction };
const permission: ConfigField = {
  ...permissionRule, label: "操作权限",
  properties: {
    read: { ...permissionRule, label: "读取文件" }, edit: { ...permissionRule, label: "编辑文件" },
    glob: { ...permissionRule, label: "查找文件" }, grep: { ...permissionRule, label: "搜索内容" },
    list: { ...permissionRule, label: "列出目录" }, bash: { ...permissionRule, label: "运行命令" },
    task: { ...permissionRule, label: "子任务" }, external_directory: { ...permissionRule, label: "外部目录" },
    todowrite: { ...permissionAction, label: "任务清单" }, question: { ...permissionAction, label: "向用户提问" },
    webfetch: { ...permissionAction, label: "读取网页" }, websearch: { ...permissionAction, label: "网络搜索" },
    lsp: { ...permissionRule, label: "代码分析" }, doom_loop: { ...permissionAction, label: "重复操作" },
    skill: { ...permissionRule, label: "使用技能" },
  },
};

const agent = object("助手", {
  model: text("模型"), variant: text("思考等级"),
  temperature: { ...number("随机性", 0, false), maximum: 2 },
  top_p: { ...number("采样范围", 0, false), maximum: 1 },
  prompt: text("工作指令", true), tools: booleanMap("可用工具"), disable: toggle("停用"),
  description: text("说明", true), mode: choice("使用范围", [
    { value: "subagent", label: "子助手" }, { value: "primary", label: "主助手" }, { value: "all", label: "全部" },
  ]), hidden: toggle("在选择器中隐藏"), options: object("额外参数", {}, customConfigField),
  color: text("标识颜色"), steps: number("最多执行步数", 1), maxSteps: number("旧版最多执行步数", 1), permission,
}, customConfigField);
const cost = object("使用费用", {
  input: number("输入单价", 0, false), output: number("输出单价", 0, false),
  cache_read: number("缓存读取单价", 0, false), cache_write: number("缓存写入单价", 0, false),
});
const model = object("模型", {
  id: text("模型标识"), name: text("显示名称"), family: text("模型系列"), release_date: text("发布日期"),
  attachment: toggle("支持附件"), reasoning: toggle("支持思考"), temperature: toggle("支持随机性调节"),
  tool_call: toggle("支持工具调用"), interleaved: {
    label: "思考内容传输", kinds: ["boolean", "string", "object"], properties: { field: text("思考字段") },
  },
  cost: { ...cost, properties: { ...cost.properties, context_over_200k: { ...cost, label: "超过二十万词元的费用" } } },
  limit: object("容量限制", { context: number("上下文容量", 1), input: number("最大输入", 1), output: number("最大输出", 1) }),
  modalities: object("内容类型", {
    input: list("输入类型", choice("类型", [
      { value: "text", label: "文本" }, { value: "image", label: "图片" }, { value: "audio", label: "音频" },
      { value: "video", label: "视频" }, { value: "pdf", label: "PDF 文档" },
    ])),
    output: list("输出类型", choice("类型", [
      { value: "text", label: "文本" }, { value: "image", label: "图片" }, { value: "audio", label: "音频" },
      { value: "video", label: "视频" }, { value: "pdf", label: "PDF 文档" },
    ])),
  }),
  experimental: toggle("实验模型"), status: choice("发布状态", [
    { value: "active", label: "正式" }, { value: "alpha", label: "内部测试" },
    { value: "beta", label: "公开测试" }, { value: "deprecated", label: "已弃用" },
  ]),
  provider: object("模型接口", { npm: text("适配包"), api: text("接口地址") }),
  options: object("调用参数", {}, customConfigField), headers: stringMap("请求标头", true),
  variants: object("思考等级与变体", {}, object("变体", { disabled: toggle("停用") }, customConfigField)),
});
const timeout: ConfigField = { ...number("请求超时（毫秒）", 1), kinds: ["number", "boolean"], validate: (value) => value === true ? "请选择超时数值，或关闭超时。" : null };
const provider = object("模型提供方", {
  api: text("接口地址"), name: text("显示名称"), env: list("凭据环境变量"), id: text("提供方标识"), npm: text("适配包"),
  whitelist: list("允许的模型"), blacklist: list("排除的模型"),
  options: object("连接选项", {
    apiKey: { ...text("访问密钥"), secret: true }, baseURL: text("网关地址"), enterpriseUrl: text("企业接口地址"),
    setCacheKey: toggle("设置缓存标识"), timeout, headerTimeout: { ...timeout, label: "响应标头超时（毫秒）" },
    chunkTimeout: number("响应片段超时（毫秒）", 1),
  }, customConfigField), models: object("模型列表", {}, model),
});
const mcp: ConfigField = { ...object("工具连接", {
  type: choice("连接方式", [{ value: "local", label: "本地程序" }, { value: "remote", label: "服务地址" }]),
  command: list("启动命令与参数"), cwd: text("工作目录"), environment: stringMap("环境变量", true),
  enabled: toggle("启用"), timeout: number("调用超时（毫秒）", 1), url: text("服务地址"), headers: stringMap("请求标头", true),
  oauth: {
    label: "授权选项", kinds: ["object", "boolean"], properties: {
      clientId: text("客户端标识"), clientSecret: { ...text("客户端密钥"), secret: true }, scope: text("授权范围"),
      callbackPort: { ...number("回调端口", 1), maximum: 65535 }, redirectUri: text("回调地址"),
    },
    validate: (value) => value === true ? "自定义授权选项需要填写参数，或关闭自动授权。" : null,
  },
}), validate: (value) => {
  if (!isConfigObject(value)) return null;
  if (value.type === "local" && (!Array.isArray(value.command) || !value.command.length || !value.command.every((part) => typeof part === "string" && part.trim()))) return "本地连接需要填写启动命令。";
  if (value.type === "remote" && (typeof value.url !== "string" || !value.url.trim())) return "服务连接需要填写地址。";
  if (!Object.hasOwn(value, "type") && typeof value.enabled !== "boolean") return "请选择连接方式，或设置启用状态。";
  return null;
} };
const reference: ConfigField = {
  label: "参考资料", kinds: ["string", "object"], properties: {
    repository: text("代码仓库地址"), branch: text("分支"), path: text("本地路径"),
    description: text("说明", true), hidden: toggle("隐藏"),
  },
};
const formatter = object("格式化工具", {
  disabled: toggle("停用"), command: list("启动命令与参数"), environment: stringMap("环境变量", true), extensions: list("文件扩展名"),
});
const lsp = object("代码分析服务", {
  disabled: toggle("停用"), command: list("启动命令与参数"), extensions: list("文件扩展名"),
  env: stringMap("环境变量", true), initialization: object("初始化选项", {}, customConfigField),
});

/** Record<keyof Config,…> makes upstream SDK additions a typecheck failure until mapped. */
export const opencodeConfigFields: Record<keyof Config, ConfigField> = {
  $schema: text("配置格式地址"), shell: text("命令解释器"),
  logLevel: choice("日志详细程度", [
    { value: "DEBUG", label: "调试" }, { value: "INFO", label: "常规" },
    { value: "WARN", label: "警告" }, { value: "ERROR", label: "错误" },
  ]),
  server: object("本地服务", {
    port: { ...number("端口", 1), maximum: 65535 }, hostname: text("监听地址"), mdns: toggle("局域网发现"),
    mdnsDomain: text("发现域名"), cors: list("允许访问的网页来源"),
  }),
  command: object("快捷指令", {}, { ...object("指令", {
    template: text("指令内容", true), description: text("说明"), agent: text("使用助手"), model: text("使用模型"),
    variant: text("思考等级"), subtask: toggle("作为子任务运行"),
  }), required: ["template"] }),
  skills: object("技能来源", { paths: list("技能目录"), urls: list("技能地址") }),
  references: object("参考资料", {}, reference), reference: object("旧版参考资料", {}, reference),
  watcher: object("文件监控", { ignore: list("忽略的路径模式") }), snapshot: toggle("保存文件快照"),
  plugin: list("插件", { label: "插件", kinds: ["string", "array"], items: customConfigField }),
  share: choice("分享方式", [
    { value: "disabled", label: "关闭分享" }, { value: "manual", label: "手动分享" }, { value: "auto", label: "自动分享" },
  ]),
  autoshare: toggle("旧版自动分享"), autoupdate: {
    label: "引擎自动更新", kinds: ["boolean", "string"], choices: [{ value: "notify", label: "仅通知" }],
  },
  disabled_providers: list("停用的模型提供方"), enabled_providers: list("仅启用的模型提供方"),
  model: text("默认模型"), small_model: text("轻量任务模型"), default_agent: text("默认助手"),
  subagent_depth: number("子助手最大层数", 1), username: text("显示名称"),
  mode: object("旧版运行模式", {}, agent), agent: object("助手配置", {}, agent), provider: object("模型提供方", {}, provider),
  mcp: object("工具连接", {}, mcp), formatter: { label: "代码格式化", kinds: ["boolean", "object"], additional: formatter },
  lsp: { label: "代码分析", kinds: ["boolean", "object"], additional: lsp }, instructions: list("附加指令文件"),
  layout: choice("旧版布局", [{ value: "auto", label: "自动" }, { value: "stretch", label: "填满窗口" }]),
  permission, tools: booleanMap("工具开关"),
  attachment: object("附件", {
    image: object("图片", {
      auto_resize: toggle("自动缩放"), max_width: number("最大宽度", 1), max_height: number("最大高度", 1),
      max_base64_bytes: number("最大编码字节数", 1),
    }),
  }),
  enterprise: object("企业连接", { url: text("服务地址") }),
  tool_output: object("工具输出限制", { max_lines: number("最多行数", 1), max_bytes: number("最大字节数", 1) }),
  compaction: object("上下文整理", {
    auto: toggle("自动整理"), prune: toggle("清理旧工具输出"), tail_turns: number("保留最近对话轮数"),
    preserve_recent_tokens: number("保留最近词元数"), reserved: number("预留词元数"),
  }),
  experimental: object("实验选项", {
    disable_paste_summary: toggle("停用粘贴摘要"), batch_tool: toggle("批量工具调用"), openTelemetry: toggle("运行追踪"),
    primary_tools: list("主工具"), continue_loop_on_deny: toggle("操作被拒绝后继续"), mcp_timeout: number("连接超时（毫秒）", 1),
    policies: list("模型使用规则", { ...object("规则", {
      action: choice("操作", [{ value: "provider.use", label: "使用模型" }]),
      effect: choice("处理方式", [{ value: "deny", label: "阻止" }, { value: "allow", label: "允许" }]), resource: text("资源模式"),
    }), required: ["action", "effect", "resource"] }),
  }),
};

export const opencodeConfigSchema = object("引擎配置", opencodeConfigFields, customConfigField);
const nullable = (field: ConfigField): ConfigField => ({
  ...field,
  kinds: field.kinds.includes("null") ? field.kinds : [...field.kinds, "null"],
  ...(field.properties ? { properties: Object.fromEntries(Object.entries(field.properties).map(([key, child]) => [key, nullable(child)])) } : {}),
  ...(field.items ? { items: nullable(field.items) } : {}),
});
export const openworkConfigSchema = object("工作区选项", Object.fromEntries(Object.entries({
  workspace: object("工作区", { name: text("名称"), preset: text("预设") }),
  authorizedRoots: list("可访问的目录"), reload: object("应用配置", { auto: toggle("自动应用修改"), resume: toggle("应用后恢复任务") }),
  blueprint: object("工作区模板", {
    emptyState: object("空白页", {
      title: text("标题"), body: text("正文", true),
      starters: list("快捷操作", object("操作", {
        id: text("标识"), kind: choice("操作类型", [{ value: "prompt", label: "发送提示" }, { value: "session", label: "打开对话" }, { value: "action", label: "执行操作" }]),
        title: text("标题"), description: text("说明"), prompt: text("提示内容", true),
        action: choice("执行操作", [{ value: "connect-openai", label: "配置模型连接" }]),
      })),
    }),
    sessions: list("预置对话", object("对话", {
      id: text("标识"), title: text("标题"), openOnFirstLoad: toggle("首次打开时显示"),
      messages: list("消息", object("消息", {
        role: choice("发言者", [{ value: "user", label: "用户" }, { value: "assistant", label: "助手" }]), text: text("内容", true),
      })),
    })),
  }),
}).map(([key, field]) => [key, nullable(field)])), customConfigField);

export function configFieldInitial(field: ConfigField): ConfigValue {
  if (field.initial !== undefined) return field.initial;
  switch (field.kinds[0]) {
    case "object": return Object.fromEntries((field.required ?? []).map((key) => [key, configFieldInitial(field.properties?.[key] ?? customConfigField)]));
    case "array": return [];
    case "number": return field.minimum ?? 0;
    case "boolean": return false;
    case "null": return null;
    default: return "";
  }
}

export function configFieldForKey(schema: ConfigField, key: string): ConfigField {
  if (schema.properties?.[key]) return schema.properties[key];
  if (schema.additional) return { ...schema.additional, label: `${schema.additional.label}：${key}` };
  return { ...customConfigField, label: key };
}

export function validateConfigFields(value: ConfigValue, schema: ConfigField, path = schema.label): string[] {
  const errors: string[] = [];
  if (!schema.kinds.includes(configValueKind(value))) errors.push(`${path}的值类型不正确。`);
  const customError = schema.validate?.(value);
  if (customError) errors.push(`${path}：${customError}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}不能小于 ${schema.minimum}。`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}不能大于 ${schema.maximum}。`);
    if (schema.integer && !Number.isInteger(value)) errors.push(`${path}必须是整数。`);
  }
  if (typeof value === "string" && schema.choices && !schema.choices.some((option) => option.value === value)) {
    errors.push(`${path}的值不在可选范围内。`);
  }
  if (Array.isArray(value)) value.forEach((item, index) => errors.push(...validateConfigFields(item, schema.items ?? customConfigField, `${path}第 ${index + 1} 项`)));
  else if (value !== null && typeof value === "object") {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}缺少${configFieldForKey(schema, key).label}。`);
    for (const [key, child] of Object.entries(value)) errors.push(...validateConfigFields(child, configFieldForKey(schema, key), `${path} / ${configFieldForKey(schema, key).label}`));
  }
  return errors;
}

/** Internal bookkeeping stays preserved, outside the authorable workspace fields. */
export function workspaceEditableConfig(value: ConfigObject): ConfigObject {
  const next = Object.fromEntries(Object.entries(value).filter(([key]) => !["version", "cloudImports", "cloudSync", "materialized"].includes(key)));
  if (isConfigObject(next.workspace)) next.workspace = Object.fromEntries(Object.entries(next.workspace).filter(([key]) => key !== "createdAt"));
  if (isConfigObject(next.blueprint)) next.blueprint = Object.fromEntries(Object.entries(next.blueprint).filter(([key]) => key !== "materialized"));
  return next;
}

export function completeWorkspaceConfig(original: ConfigObject, edited: ConfigObject): ConfigObject {
  const editable = workspaceEditableConfig(original);
  const protectedValues = Object.fromEntries(Object.entries(original).filter(([key]) => !Object.hasOwn(editable, key)));
  const next = { ...protectedValues, ...edited };
  if (isConfigObject(original.workspace) && Object.hasOwn(original.workspace, "createdAt")) {
    next.workspace = { ...(isConfigObject(next.workspace) ? next.workspace : {}), createdAt: original.workspace.createdAt };
  }
  if (isConfigObject(original.blueprint) && Object.hasOwn(original.blueprint, "materialized")) {
    next.blueprint = { ...(isConfigObject(next.blueprint) ? next.blueprint : {}), materialized: original.blueprint.materialized };
  }
  return next;
}
