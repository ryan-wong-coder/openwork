import { expect, test } from "bun:test";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { gatewayImageMatchesWorkspace, gatewayImageResult } from "../src/components/tools/gateway-image-result";
import { createV2EventTranslationState, translateV2Event } from "../src/app/lib/opencode-v2-adapter";
import { parseDynamicToolUIPart } from "../src/react-app/domains/session/sync/parse-tool-parts";

const result = { ok: true, path: "artifacts/页面配图-12345678.png", workspaceId: "fixture-workspace", mimeType: "image/png", width: 1254, height: 1254 };
const part = (output: unknown): DynamicToolUIPart => ({ type: "dynamic-tool", toolName: "openwork_image_generate", toolCallId: "fixture", state: "output-available", input: { prompt: "图片" }, output });

test("native V1 and V2 tool parts accept only local generated image artifacts", () => {
  expect(gatewayImageResult(part(JSON.stringify(result)))).toEqual(resultWithoutOk());
  const native: ToolUIPart = { type: "tool-openwork_image_generate", toolCallId: "fixture-static", state: "output-available", input: {}, output: result };
  expect(gatewayImageResult(native)).toEqual(resultWithoutOk());
  expect(gatewayImageMatchesWorkspace(result, "fixture-workspace")).toBe(true);
  expect(gatewayImageMatchesWorkspace(result, "other-workspace")).toBe(false);
  expect(gatewayImageMatchesWorkspace(result, "")).toBe(false);
});

function resultWithoutOk() {
  return { path: result.path, workspaceId: result.workspaceId, mimeType: result.mimeType, width: result.width, height: result.height };
}

test("remote URLs, traversal, active content, incomplete and failed outputs never become previews", () => {
  for (const path of ["https://example.test/image.png", "file:///tmp/image.png", "../artifacts/image.png", "/artifacts/image.png", "artifacts/../image.png", "artifacts/escape/image.png", "artifacts\\image.png", "artifacts/%2e%2e.png", "artifacts/image.svg", "artifacts/image.png?redirect=evil", "artifacts/image.png#fragment"]) {
    expect(gatewayImageResult(part({ ...result, path }))).toBeNull();
  }
  for (const output of [{ ...result, ok: false }, { ...result, workspaceId: "" }, { ...result, mimeType: "image/svg+xml" }, {}, "{bad", { url: "https://example.test/image.png" }]) {
    expect(gatewayImageResult(part(output))).toBeNull();
  }
  expect(gatewayImageResult({ ...part(result), toolName: "untrusted_image_generate" })).toBeNull();
  expect(gatewayImageResult({ type: "dynamic-tool", toolName: "openwork_image_generate", toolCallId: "error", state: "output-error", input: {}, errorText: "网关超时" })).toBeNull();
});

test("absolute paths and arbitrary URL metadata are ignored", () => {
  expect(gatewayImageResult(part({ ...result, absolutePath: "/private/outside.png", url: "https://example.test/collect", width: -1, height: 100_000 }))).toEqual({
    path: result.path, workspaceId: result.workspaceId, mimeType: result.mimeType, width: undefined, height: undefined,
  });
});

test("native V2 content survives the shared event and tool-part adapters", () => {
  const state = createV2EventTranslationState();
  const context = { sessionID: "ses_fixture", messageID: "msg_fixture", callID: "call_image" };
  const events = [
    { type: "session.tool.input.started", created: 1, data: { ...context, name: "openwork_image_generate" } },
    { type: "session.tool.called", created: 2, data: { ...context, input: { prompt: "图片" } } },
    { type: "session.tool.success", created: 3, data: { ...context, content: [{ type: "text", text: JSON.stringify(result) }] } },
  ].flatMap(event => translateV2Event(event, state) ?? []);
  const completed = events.flatMap(event => {
    if (event.type !== "message.part.updated" || event.properties.part.type !== "tool") return [];
    const mapped = parseDynamicToolUIPart(event.properties.part);
    const image = mapped ? gatewayImageResult(mapped) : null;
    return image ? [image] : [];
  });
  expect(completed).toEqual([resultWithoutOk()]);
});
