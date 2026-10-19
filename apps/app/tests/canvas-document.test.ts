import { describe, expect, test } from "bun:test";
import { runInNewContext, Script } from "node:vm";
import { parseConversationCanvas } from "../src/components/markdown/canvas-parser";
import { buildCanvasDocument, CANVAS_MESSAGE_CHANNEL, parseCanvasMessage } from "../src/components/markdown/canvas-document";

function boards(text: string) {
  return parseConversationCanvas(text).flatMap(segment => segment.type === "canvas" ? [segment.fence] : []);
}

describe("conversation canvas fences", () => {
  test("commits only closed explicit boards and leaves ordinary HTML as source", () => {
    const text = 'Intro\n\n```html\n<button>Example</button>\n```\n\n```zeno-html title="预算模拟"\n<canvas></canvas>\n```\n\nAfter';
    const segments = parseConversationCanvas(text);
    expect(segments).toHaveLength(3);
    expect(segments[0]?.type).toBe("markdown");
    expect(boards(text)).toEqual([{ ordinal: 0, kind: "html", source: "<canvas></canvas>\n", complete: true, title: "预算模拟" }]);
    expect(boards('```ant-chart\n{"type":"Line"}')[0]?.complete).toBe(false);
    expect(boards('```svg\n<svg/>\n``')[0]?.complete).toBe(false);
  });

  test("does not execute fences quoted in lists, quotations, raw HTML or longer code examples", () => {
    for (const text of [
      '- Example\n  ```svg\n  <svg/>\n  ```',
      '> ```svg\n> <svg/>\n> ```',
      '````markdown\n```zeno-html\n<script>example()</script>\n```\n````',
      '<pre>\n```svg\n<svg/>\n```\n</pre>',
    ]) expect(boards(text)).toEqual([]);
  });

  test("retains stable board ordinals, tilde fences, prose and CRLF input", () => {
    const text = 'Before\r\n\r\n~~~html canvas\r\n<div>One</div>\r\n~~~~\r\n\r\nBetween\r\n\r\n```svg\r\n<svg/>\r\n```\r\n';
    const parsed = parseConversationCanvas(text);
    expect(boards(text).map(board => [board.ordinal, board.kind, board.complete])).toEqual([[0, "html", true], [1, "svg", true]]);
    expect(parsed.filter(segment => segment.type === "markdown").map(segment => segment.text)).toEqual(['Before\n\n', '\n\nBetween\n\n']);
    expect(boards(`${text}\nMore prose`)).toEqual(boards(text));
  });
});

describe("isolated canvas document", () => {
  test("keeps hostile source inside the inner frame, with valid scripts and restrictive policies", () => {
    const source = '<script>globalThis.__canvasEscape=true</script></body></html><script>parent.postMessage("escape","*")</script>';
    const result = buildCanvasDocument("html", source, "fixture-token-123");
    if (!result.ok) throw new Error(result.reason);
    expect(result.srcDoc).not.toContain(source);
    const script = /<script>([\s\S]*)<\/script>/.exec(result.srcDoc)?.[1];
    if (!script) throw new Error("Missing trusted shell");
    const attributes: Record<string, string> = {};
    const frame = { title: "", srcdoc: "", style: { cssText: "" }, contentWindow: {},
      setAttribute(name: string, value: string) { attributes[name] = value; } };
    const context = { window: { addEventListener() {} }, document: { createElement: () => frame, body: { append() {} } }, parent: {} };
    runInNewContext(script, context);
    expect(Reflect.get(context, "__canvasEscape")).toBeUndefined();
    expect(attributes.sandbox).toBe("allow-scripts");
    expect(result.srcDoc).toContain("frame-src about:");
    expect(frame.srcdoc).toContain("frame-src 'none'");
    expect(frame.srcdoc).toContain("connect-src 'none'");
    expect(frame.srcdoc).not.toContain("unsafe-eval");
    for (const match of frame.srcdoc.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new Script(match[1] ?? "")).not.toThrow();
    expect(frame.srcdoc).toContain("createElement('template')");
  });

  test("rejects incomplete/oversize content and non-object chart configuration", () => {
    expect(buildCanvasDocument("html", " ", "fixture-token").ok).toBe(false);
    expect(buildCanvasDocument("html", "x".repeat(1_000_001), "fixture-token").ok).toBe(false);
    expect(buildCanvasDocument("html", "<p>Hi</p>", '<script>unsafe</script>').ok).toBe(false);
    for (const source of ['[]', 'null', '"Line"', '{', '{"type":"constructor"}', '{"type":"<script>"}']) expect(buildCanvasDocument("ant-chart", source, "fixture-token").ok).toBe(false);
    expect(buildCanvasDocument("svg", "<svg/>", "fixture-token").ok).toBe(true);
    expect(buildCanvasDocument("ant-chart", '{"type":"Column","data":[]}', "fixture-token").ok).toBe(true);
  });

  test("accepts only the active channel/token and bounded finite resize messages", () => {
    const valid = { channel: CANVAS_MESSAGE_CHANNEL, token: "active-token", type: "height", height: 480 };
    expect(parseCanvasMessage(valid, "active-token")).toEqual({ type: "height", height: 480 });
    for (const data of [null, [], { ...valid, token: "stale-token" }, { ...valid, channel: "other" }, { ...valid, type: "open-file" },
      { ...valid, height: -1 }, { ...valid, height: NaN }, { ...valid, height: Infinity }, { ...valid, height: 100_001 }]) expect(parseCanvasMessage(data, "active-token")).toBeNull();
    expect(parseCanvasMessage({ ...valid, type: "ready", file: "/private/file" }, "active-token")).toEqual({ type: "ready" });
    expect(parseCanvasMessage({ ...valid, type: "error", stack: "private stack" }, "active-token")).toEqual({ type: "error" });
  });
});
