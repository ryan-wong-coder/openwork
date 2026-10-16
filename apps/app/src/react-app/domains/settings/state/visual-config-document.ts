import { applyEdits, findNodeAtLocation, modify, parse, parseTree, printParseErrorCode, type ParseError } from "jsonc-parser";

export type ConfigValue = string | number | boolean | null | ConfigValue[] | ConfigObject;
export type ConfigObject = { [key: string]: ConfigValue };
export type ConfigPath = (string | number)[];
export type ConfigValueKind = "string" | "number" | "boolean" | "object" | "array" | "null";

export function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every(isConfigValue);
}

export function isConfigValue(value: unknown): value is ConfigValue {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
    || (Array.isArray(value) && value.every(isConfigValue)) || isConfigObject(value);
}

export function configValueKind(value: ConfigValue): ConfigValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

export function initialConfigValue(kind: ConfigValueKind): ConfigValue {
  switch (kind) {
    case "object": return {};
    case "array": return [];
    case "boolean": return false;
    case "number": return 0;
    case "null": return null;
    case "string": return "";
  }
}

export function parseConfigDocument(content: string): ConfigObject {
  if (!content.trim()) return {};
  const errors: ParseError[] = [];
  const parsed: unknown = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    const first = errors[0];
    const line = content.slice(0, first.offset).split("\n").length;
    throw new Error(`配置文件第 ${line} 行无法读取（${printParseErrorCode(first.error)}）。请先修复原文件，再重新加载。`);
  }
  if (!isConfigObject(parsed)) throw new Error("配置文件的根节点必须是一组选项。请修复原文件后重新加载。");
  return parsed;
}

export function configValuesEqual(left: ConfigValue, right: ConfigValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => configValuesEqual(value, right[index]));
  }
  if (isConfigObject(left) && isConfigObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
      && keys.every((key) => Object.hasOwn(right, key) && configValuesEqual(left[key], right[key]));
  }
  return false;
}

export function updateConfigValue(root: ConfigObject, path: ConfigPath, value: ConfigValue | undefined): ConfigObject {
  if (!path.length) {
    if (!isConfigObject(value)) throw new Error("配置的根节点必须是一组选项。");
    return value;
  }
  const visit = (current: ConfigValue, depth: number): ConfigValue => {
    const key = path[depth];
    if (Array.isArray(current) && typeof key === "number") {
      const result = [...current];
      if (depth === path.length - 1) {
        if (value === undefined) result.splice(key, 1);
        else result[key] = value;
      } else result[key] = visit(current[key] ?? {}, depth + 1);
      return result;
    }
    if (isConfigObject(current) && typeof key === "string") {
      if (key === "__proto__" || key === "prototype" || key === "constructor") throw new Error("此选项名称不可用。");
      const result = { ...current };
      if (depth === path.length - 1) {
        if (value === undefined) delete result[key];
        else Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
      } else Object.defineProperty(result, key, {
        value: visit(current[key] ?? {}, depth + 1), enumerable: true, configurable: true, writable: true,
      });
      return result;
    }
    throw new Error("配置结构已变化，请重新加载后再修改。");
  };
  const next = visit(root, 0);
  if (!isConfigObject(next)) throw new Error("配置的根节点必须是一组选项。");
  return next;
}

/** Apply only changed leaves so comments and unknown provider options survive. */
export function writeConfigDocument(content: string, original: ConfigObject, next: ConfigObject): string {
  let output = content.trim() ? content : "{}\n";
  const edit = (path: ConfigPath, value: ConfigValue | undefined) => {
    // jsonc-parser 3.x's last-array-item deletion leaves a character behind
    // in compact arrays. Use the parsed node boundaries for that operation.
    const index = path[path.length - 1];
    if (value === undefined && typeof index === "number") {
      const root = parseTree(output);
      const parent = root ? findNodeAtLocation(root, path.slice(0, -1)) : undefined;
      const children = parent?.children;
      const removed = children?.[index];
      if (parent?.type === "array" && children && removed && index === children.length - 1 && index > 0) {
        const previous = children[index - 1];
        const offset = previous.offset + previous.length;
        output = applyEdits(output, [{ offset, length: removed.offset + removed.length - offset, content: "" }]);
        return;
      }
    }
    output = applyEdits(output, modify(output, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    }));
  };
  const visit = (before: ConfigValue, after: ConfigValue, path: ConfigPath) => {
    if (configValuesEqual(before, after)) return;
    if (isConfigObject(before) && isConfigObject(after)) {
      for (const key of Object.keys(before)) {
        if (!Object.hasOwn(after, key)) edit([...path, key], undefined);
      }
      for (const [key, value] of Object.entries(after)) {
        if (Object.hasOwn(before, key)) visit(before[key], value, [...path, key]);
        else edit([...path, key], value);
      }
      return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      for (let index = before.length - 1; index >= after.length; index -= 1) edit([...path, index], undefined);
      for (let index = 0; index < after.length; index += 1) {
        if (index < before.length) visit(before[index], after[index], [...path, index]);
        else edit([...path, index], after[index]);
      }
      return;
    }
    edit(path, after);
  };
  visit(original, next, []);
  if (!configValuesEqual(parseConfigDocument(output), next)) throw new Error("配置未能完整保存，请重新加载后重试。");
  return output.endsWith("\n") ? output : `${output}\n`;
}
