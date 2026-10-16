import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StructuredConfigEditor } from "../app/(den)/dashboard/_components/structured-config-editor";
import { readStructuredProvider, readStructuredValue, structuredInitial, structuredKind, structuredProviderModelCount, updateStructuredAtPath, updateStructuredValue, type StructuredKind } from "../app/(den)/dashboard/_components/structured-config-value";

describe("Den structured provider configuration", () => {
  test("preserves arbitrary provider options and nested model metadata during field edits", () => {
    const original = readStructuredProvider(JSON.stringify({ id: "fixture", npm: "vendor-adapter", env: ["FIXTURE_KEY"],
      models: [{ id: "model", name: "Model", limit: { context: 128000 }, options: { unusual: [false, null, { rate: 0.5 }] } }],
      vendorConfig: { enabled: true, nested: { value: "keep" } } }));
    const edited = updateStructuredValue(original, ["models", 0, "options", "unusual", 2, "rate"], 0.7);
    expect(edited).toMatchObject({ vendorConfig: { enabled: true, nested: { value: "keep" } }, models: [{ options: { unusual: [false, null, { rate: 0.7 }] } }] });
    expect(readStructuredProvider(JSON.stringify(edited))).toEqual(edited);
    expect(original).toMatchObject({ models: [{ options: { unusual: [false, null, { rate: 0.5 }] } }] });
  });
  test("all value types, new options, lists, removal and resets round-trip", () => {
    let value = readStructuredProvider('{"models":["one","two"],"options":{"old":true}}');
    value = updateStructuredValue(value, ["models", 0], undefined);
    value = updateStructuredValue(value, ["options", "old"], undefined);
    value = updateStructuredValue(value, ["options", "list"], ["text", 3, false, null, {}]);
    expect(value).toEqual({ models: ["two"], options: { list: ["text", 3, false, null, {}] } });
    const kinds: StructuredKind[] = ["string", "number", "boolean", "object", "array", "null"];
    expect(kinds.map((kind) => structuredKind(structuredInitial(kind)))).toEqual(kinds);
  });
  test("rejects invalid documents and reserved keys without altering prototypes", () => {
    expect(() => readStructuredProvider("[]")).toThrow("一组选项");
    expect(() => readStructuredProvider("not a document")).toThrow();
    expect(() => updateStructuredValue({}, ["__proto__", "polluted"], true)).toThrow("不可用");
    expect(Object.hasOwn({}, "polluted")).toBe(false);
  });
  test("renders existing and unknown fields through controls without a payload textarea", () => {
    const html = renderToStaticMarkup(createElement(StructuredConfigEditor, {
      text: JSON.stringify({ id: "fixture", api: "https://gateway.example.invalid/v1", options: { vendorOption: [false, null] }, models: [{ id: "model", reasoning: true }] }), onChange: () => {},
    }));
    expect(html).toContain('data-testid="structured-provider-config"');
    expect(html).toContain('aria-label="标识"');
    expect(html).toContain('aria-label="接口地址"');
    expect(html).toContain("vendorOption");
    expect(html).toContain('role="switch"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".json,.jsonc,application/json"');
    expect(html).toContain("导入配置文件");
    expect(html).not.toContain("<textarea");
  });
  test("model counts cover provider arrays, maps and wrapped engine documents", () => {
    expect(structuredProviderModelCount('{"models":[{"id":"one"},{"id":"two"}]}')).toBe(2);
    expect(structuredProviderModelCount('{"models":{"one":{},"two":{}}}')).toBe(2);
    expect(structuredProviderModelCount('{"provider":{"fixture":{"models":{"one":{}}}}}')).toBe(1);
    expect(structuredProviderModelCount("invalid")).toBe(0);
  });
  test("workflow inputs and schemas support primitive roots and nested unions", () => {
    expect(readStructuredValue("true")).toBe(true);
    expect(readStructuredValue("null")).toBeNull();
    expect(readStructuredProvider('\uFEFF{"models":[],"options":{"enabled":false}}')).toEqual({ models: [], options: { enabled: false } });
    expect(readStructuredProvider('{/* existing provider */"models":[],"options":{"enabled":false,},}')).toEqual({ models: [], options: { enabled: false } });
    expect(() => readStructuredProvider('{"models":[],"options":')).toThrow("无法读取");
    expect(updateStructuredAtPath(true, [], { anyOf: [{ type: "string" }, { type: "null" }] })).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(updateStructuredAtPath([false, { items: [1, null] }], [1, "items", 0], 2)).toEqual([false, { items: [2, null] }]);
    const html = renderToStaticMarkup(createElement(StructuredConfigEditor, { text: "true", allowRootValue: true, label: "输入格式", suggestions: false, onChange: () => {} }));
    expect(html).toContain('aria-label="输入格式"');
    expect(html).toContain('role="switch"');
    expect(html).not.toContain("<textarea");
  });
});
