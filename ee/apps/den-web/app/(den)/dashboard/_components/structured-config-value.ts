import { parse, type ParseError } from "jsonc-parser";

export type StructuredValue = string | number | boolean | null | StructuredValue[] | StructuredObject;
export type StructuredObject = { [key: string]: StructuredValue };
export type StructuredKind = "string" | "number" | "boolean" | "object" | "array" | "null";
export type StructuredPath = (string | number)[];

export function isStructuredValue(value: unknown): value is StructuredValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isStructuredValue);
  return typeof value === "object" && Object.values(value).every(isStructuredValue);
}
export function isStructuredObject(value: unknown): value is StructuredObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(isStructuredValue);
}
export function structuredKind(value: StructuredValue): StructuredKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}
export function structuredInitial(kind: StructuredKind): StructuredValue {
  switch (kind) {
    case "object": return {};
    case "array": return [];
    case "boolean": return false;
    case "number": return 0;
    case "null": return null;
    case "string": return "";
  }
}
export function readStructuredProvider(text: string): StructuredObject {
  const value = readStructuredValue(text);
  if (!isStructuredObject(value)) throw new Error("提供商选项必须是一组选项。");
  return value;
}
export function readStructuredValue(text: string): StructuredValue {
  const errors: ParseError[] = [];
  const value: unknown = parse(text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true });
  if (errors.length) throw new Error("选项内容无法读取。");
  if (!isStructuredValue(value)) throw new Error("选项内容无法读取。");
  return value;
}
export function structuredProviderModelCount(text: string): number {
  try {
    let provider = readStructuredProvider(text);
    if (isStructuredObject(provider.provider)) {
      const providers = Object.values(provider.provider).filter(isStructuredObject);
      if (providers.length !== 1) return 0;
      provider = providers[0];
    }
    if (Array.isArray(provider.models)) return provider.models.length;
    return isStructuredObject(provider.models) ? Object.keys(provider.models).length : 0;
  } catch { return 0; }
}
export function updateStructuredValue(root: StructuredObject, path: StructuredPath, value: StructuredValue | undefined): StructuredObject {
  const next = updateStructuredAtPath(root, path, value);
  if (!isStructuredObject(next)) throw new Error("提供商选项必须是一组选项。");
  return next;
}
export function updateStructuredAtPath(root: StructuredValue, path: StructuredPath, value: StructuredValue | undefined): StructuredValue {
  if (!path.length) return value === undefined ? null : value;
  const update = (current: StructuredValue, depth: number): StructuredValue => {
    const key = path[depth];
    if (Array.isArray(current) && typeof key === "number") {
      const next = [...current];
      if (depth === path.length - 1) {
        if (value === undefined) next.splice(key, 1);
        else next[key] = value;
      } else next[key] = update(current[key] ?? {}, depth + 1);
      return next;
    }
    if (isStructuredObject(current) && typeof key === "string") {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("此选项名称不可用。");
      const next = { ...current };
      if (depth === path.length - 1) {
        if (value === undefined) delete next[key];
        else Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
      } else Object.defineProperty(next, key, { value: update(current[key] ?? {}, depth + 1), enumerable: true, configurable: true, writable: true });
      return next;
    }
    throw new Error("选项结构已变化，请重新打开后再修改。");
  };
  return update(root, 0);
}

export const structuredLabels: Record<string, string> = {
  id: "标识", name: "显示名称", npm: "适配包", env: "凭据环境变量", doc: "文档地址", api: "接口地址",
  provider: "提供商", models: "模型列表", options: "额外参数", headers: "请求标头", variants: "思考等级与变体",
  baseURL: "网关地址", apiKey: "访问密钥", enterpriseUrl: "企业接口地址", timeout: "请求超时（毫秒）",
  headerTimeout: "响应标头超时（毫秒）", chunkTimeout: "片段超时（毫秒）", setCacheKey: "设置缓存标识",
  attachment: "支持附件", reasoning: "支持思考", tool_call: "支持工具调用", structured_output: "支持结构化输出",
  temperature: "支持随机性调节", release_date: "发布日期", last_updated: "更新日期", open_weights: "公开模型权重",
  family: "模型系列", status: "发布状态", experimental: "实验模型", disabled: "停用", interleaved: "思考内容传输",
  cost: "使用费用", input: "输入", output: "输出", cache_read: "缓存读取", cache_write: "缓存写入", context_over_200k: "长上下文费用",
  limit: "容量限制", context: "上下文容量", modalities: "内容类型", field: "字段名称", whitelist: "允许的模型", blacklist: "排除的模型",
  reasoningEffort: "思考强度", maxOutputTokens: "最大输出词元数", topP: "采样范围", response_format: "响应格式",
};
export const structuredSchemaLabels: Record<string, string> = {
  type: "值类型", title: "标题", description: "说明", properties: "字段", items: "列表项目", required: "必填字段",
  additionalProperties: "其他字段规则", enum: "可选值", const: "固定值", default: "默认值", examples: "示例",
  anyOf: "满足任一条件", oneOf: "仅满足一个条件", allOf: "满足全部条件", not: "排除条件",
  minimum: "最小值", maximum: "最大值", exclusiveMinimum: "大于", exclusiveMaximum: "小于", multipleOf: "数值步长",
  minLength: "最短文本长度", maxLength: "最长文本长度", pattern: "匹配规则", format: "内容格式",
  minItems: "最少项目数", maxItems: "最多项目数", uniqueItems: "项目不可重复", minProperties: "最少字段数", maxProperties: "最多字段数",
  $schema: "格式定义地址", $id: "格式标识", $ref: "引用", $defs: "可复用定义", definitions: "旧版可复用定义",
};
export const structuredSuggestions: { value: string; label: string; kind: StructuredKind }[] = Object.entries(structuredLabels).map(([value, label]) => ({
  value, label,
  kind: ["models", "env", "whitelist", "blacklist"].includes(value) ? "array"
    : ["provider", "options", "headers", "variants", "cost", "limit", "modalities", "context_over_200k", "response_format"].includes(value) ? "object"
      : ["attachment", "reasoning", "tool_call", "structured_output", "temperature", "open_weights", "experimental", "disabled", "setCacheKey"].includes(value) ? "boolean"
        : ["timeout", "headerTimeout", "chunkTimeout", "input", "output", "context", "cache_read", "cache_write", "maxOutputTokens", "topP"].includes(value) ? "number" : "string",
}));
