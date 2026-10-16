import { describe, expect, test } from "bun:test";
import {
  configValuesEqual, parseConfigDocument, updateConfigValue, writeConfigDocument,
} from "../src/react-app/domains/settings/state/visual-config-document";
import {
  completeWorkspaceConfig, configFieldForKey, opencodeConfigFields, opencodeConfigSchema, openworkConfigSchema, validateConfigFields, workspaceEditableConfig,
} from "../src/react-app/domains/settings/state/visual-config-schema";

describe("visual configuration documents", () => {
  test("changing one field preserves comments, unknown provider options and exact value types", () => {
    const content = `// device preferences\n{\n  // preferred model\n  "model": "gateway/first",\n  "provider": { "gateway": { "options": { "vendorFlag": false, "retry": 3, "nested": [null, { "value": "keep" }] } } },\n  "futureEngineOption": { "enabled": true },\n}\n`;
    const original = parseConfigDocument(content);
    const next = updateConfigValue(original, ["model"], "gateway/second");
    const written = writeConfigDocument(content, original, next);
    expect(written).toContain("// device preferences");
    expect(written).toContain("// preferred model");
    expect(written).toContain('"vendorFlag": false, "retry": 3, "nested": [null, { "value": "keep" }]');
    expect(parseConfigDocument(written)).toEqual({ ...original, model: "gateway/second" });
    expect(original.model).toBe("gateway/first");
  });

  test("nested dictionary edits, deletion and array additions round-trip without flattening", () => {
    const content = '{\n  "mcp": { "tool": { "type": "local", "command": ["node", "first.js", "--old"], "environment": { "KEEP": "value", "REMOVE": "old" } } },\n  "tools": { "old": false }\n}\n';
    const original = parseConfigDocument(content);
    let next = updateConfigValue(original, ["mcp", "tool", "command", 2], undefined);
    next = updateConfigValue(next, ["mcp", "tool", "command", 1], "second.js");
    next = updateConfigValue(next, ["mcp", "tool", "command", 2], "--new");
    next = updateConfigValue(next, ["mcp", "tool", "command", 3], "4");
    next = updateConfigValue(next, ["mcp", "tool", "environment", "REMOVE"], undefined);
    next = updateConfigValue(next, ["tools"], { another: true });
    expect(parseConfigDocument(writeConfigDocument(content, original, next))).toEqual(next);
    expect(next.mcp).toEqual({ tool: { type: "local", command: ["node", "second.js", "--new", "4"], environment: { KEEP: "value" } } });
  });

  test("removing multiple trailing array entries keeps valid comma placement", () => {
    const content = '{"plugin": ["one", "two", "three", "four"]}';
    const original = parseConfigDocument(content);
    expect(parseConfigDocument(writeConfigDocument(content, original, { plugin: ["one"] }))).toEqual({ plugin: ["one"] });
  });

  test("invalid or scalar files are rejected without silently replacing them", () => {
    expect(() => parseConfigDocument('{ "model": ')).toThrow("无法读取");
    expect(() => parseConfigDocument('["model"]')).toThrow("根节点");
    expect(() => parseConfigDocument("null")).toThrow("根节点");
    expect(parseConfigDocument("  ")).toEqual({});
  });

  test("empty files and custom option types can be created and reset", () => {
    const next = { custom: { number: 4, flag: false, nothing: null, values: ["a", true] } };
    expect(parseConfigDocument(writeConfigDocument("", {}, next))).toEqual(next);
    expect(parseConfigDocument(writeConfigDocument("{\"old\": true}", { old: true }, {}))).toEqual({});
  });

  test("dictionary ordering does not create a false unsaved change", () => {
    expect(configValuesEqual({ a: 1, b: [true, null] }, { b: [true, null], a: 1 })).toBe(true);
    expect(configValuesEqual({ a: 1 }, { a: "1" })).toBe(false);
    expect(configValuesEqual([1, 2], [2, 1])).toBe(false);
  });

  test("dangerous property names cannot alter the editor's object prototypes", () => {
    expect(() => updateConfigValue({}, ["__proto__", "polluted"], true)).toThrow("不可用");
    expect(() => updateConfigValue({}, ["constructor"], {})).toThrow("不可用");
    expect(Object.hasOwn({}, "polluted")).toBe(false);
  });

  test("workspace edits can remove user settings while preserving generated identity and sync state", () => {
    const original = { version: 1, workspace: { name: "Before", createdAt: 123 }, cloudImports: { provider: true },
      blueprint: { sessions: [{ title: "Template" }], materialized: { sessions: { hydratedAt: 42 } } }, reload: { auto: true } };
    const editable = workspaceEditableConfig(original);
    expect(editable).not.toHaveProperty("version");
    expect(editable).not.toHaveProperty("cloudImports");
    expect(editable.workspace).toEqual({ name: "Before" });
    expect(editable.blueprint).toEqual({ sessions: [{ title: "Template" }] });
    const next = completeWorkspaceConfig(original, { workspace: { name: "After" } });
    expect(next).toEqual({ version: 1, workspace: { name: "After", createdAt: 123 }, cloudImports: { provider: true }, blueprint: { materialized: { sessions: { hydratedAt: 42 } } } });
    expect(next).not.toHaveProperty("reload");
  });
});

describe("visual configuration coverage", () => {
  test("includes every supported engine configuration area and keeps custom fields editable", () => {
    expect(Object.keys(opencodeConfigFields).sort()).toEqual([
      "$schema", "shell", "logLevel", "server", "command", "skills", "references", "reference", "watcher", "snapshot", "plugin", "share", "autoshare", "autoupdate", "disabled_providers", "enabled_providers", "model", "small_model", "default_agent", "subagent_depth", "username", "mode", "agent", "provider", "mcp", "formatter", "lsp", "instructions", "layout", "permission", "tools", "attachment", "enterprise", "tool_output", "compaction", "experimental",
    ].sort());
    expect(configFieldForKey(opencodeConfigSchema, "future_option").kinds).toContain("object");
    const provider = configFieldForKey(opencodeConfigFields.provider, "my-gateway");
    expect(provider.label).toContain("my-gateway");
    expect(provider.properties?.options.additional?.kinds).toContain("array");
    expect(provider.properties?.models.additional?.properties?.variants.additional?.additional?.kinds).toContain("null");
  });

  test("validates numbers, choices, permissions and connection requirements before save", () => {
    expect(validateConfigFields({ server: { port: 70000 }, agent: { helper: { temperature: 4 } } }, opencodeConfigSchema)).toHaveLength(2);
    expect(validateConfigFields({ permission: { bash: { "git *": "ask" } }, mcp: { local: { type: "local", command: ["node", "tool.js"] } } }, opencodeConfigSchema)).toEqual([]);
    expect(validateConfigFields({ permission: { bash: "invalid" }, mcp: { local: { type: "local" } } }, opencodeConfigSchema)).toHaveLength(2);
    expect(validateConfigFields({ compaction: { auto: "true" } }, opencodeConfigSchema)).toHaveLength(1);
    expect(validateConfigFields({ reload: null, workspace: { name: null }, blueprint: { emptyState: null, sessions: null } }, openworkConfigSchema)).toEqual([]);
  });
});
