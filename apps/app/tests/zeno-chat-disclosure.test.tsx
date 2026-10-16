import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "ai";

let zenoEnabled = true;
mock.module("../src/app/lib/zeno-identity", () => ({ isZenoInterfaceEnabled: () => zenoEnabled }));
GlobalRegistrator.register({ url: "http://localhost/" });
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { PlatformProvider, createDefaultPlatform } = await import("../src/react-app/kernel/platform");
const { MessageListProvider } = await import("../src/components/chat/message-list-provider");
const { MessageList } = await import("../src/components/chat/message-list");
let mounted: { root: Root; host: HTMLDivElement } | undefined;
afterEach(async () => {
  if (mounted) { await act(async () => mounted!.root.unmount()); mounted.host.remove(); mounted = undefined; }
  zenoEnabled = true;
});
afterAll(async () => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct); await GlobalRegistrator.unregister(); });

async function render(options: { live?: boolean; failed?: boolean } = {}) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounted = { root, host };
  const messages: UIMessage[] = [{ id: "user", role: "user", parts: [{ type: "text", text: "Review the local files" }] }, {
    id: "assistant", role: "assistant", metadata: { opencode: { created: 1000, completed: options.live ? undefined : 2000 } },
    parts: [{ type: "dynamic-tool", toolName: "read", toolCallId: "read_fixture", input: { filePath: "/workspace/example.txt" },
      ...(options.failed ? { state: "output-error", errorText: "File unavailable" } : { state: "output-available", output: "Local file contents" }) },
    { type: "text", text: "Here is the review." }],
  }];
  await act(async () => root.render(createElement(PlatformProvider, { value: createDefaultPlatform(), children: createElement(MessageListProvider, {
    workspaceId: "workspace_fixture", sessionId: "session_fixture", showThinking: true, developerMode: false, displaySuggestions: false,
    providerConnectedCount: 1, dispatchAction: () => {}, setPrompt: () => {}, onRevertToUserMessage: () => {}, onForkAtMessage: () => {},
    onEditUserMessage: () => {}, onMcpReconnect: async () => { throw new Error("Unexpected reconnect"); }, onMcpReopenAuthorization: async () => {},
    children: createElement(MessageList, { messages, status: options.live ? "streaming" : "ready", activityStatus: options.live ? "responding" : "idle" }),
  }) })));
  return host;
}

test("a completed short run collapses while its answer stays visible and can be expanded", async () => {
  const host = await render();
  const rail = host.querySelector<HTMLButtonElement>('button[data-testid="completed-work-rail"]');
  expect(rail).not.toBeNull();
  expect(rail!.getAttribute("aria-expanded")).toBe("false");
  expect(host.textContent).toContain("Here is the review.");
  await act(async () => rail!.click());
  expect(rail!.getAttribute("aria-expanded")).toBe("true");
  expect(host.textContent).toContain("example.txt");
});

test("failed steps remain visible for recovery", async () => {
  const host = await render({ failed: true });
  expect(host.querySelector('button[data-testid="completed-work-rail"]')).toBeNull();
  expect(host.textContent).toContain("File unavailable");
});

test("live steps stay visible", async () => {
  const host = await render({ live: true });
  expect(host.querySelector('button[data-testid="completed-work-rail"]')).toBeNull();
  expect(host.querySelector('[data-live-steps]')).not.toBeNull();
});

test("turning Zeno off restores the original short-run presentation", async () => {
  zenoEnabled = false;
  const host = await render();
  expect(host.querySelector('button[data-testid="completed-work-rail"]')).toBeNull();
  expect(host.querySelector('[data-live-steps]')).not.toBeNull();
});
