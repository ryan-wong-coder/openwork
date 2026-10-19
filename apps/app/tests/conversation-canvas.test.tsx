import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";

const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
// This suite exercises React lifecycle and authenticated bridge messages. The
// actual sandbox documents run in the separate headless-browser fixture.
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { createRoot } = await import("react-dom/client");
const { MarkdownBlock } = await import("../src/components/markdown/markdown");
const { ConversationCanvas } = await import("../src/components/markdown/conversation-canvas");
const { setClientProfileBootstrap } = await import("../src/app/lib/client-profile");
const { localClientFeatureEnabled } = await import("../src/app/lib/local-client-features");
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
const previousBridge = window.__OPENWORK_ELECTRON__;
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><circle cx="160" cy="120" r="50" fill="teal" /></svg>';
const board = `\`\`\`svg\n${svg}\n\`\`\``;

beforeEach(() => {
  window.__OPENWORK_ELECTRON__ = { conversationCanvas: {
    shellUrl: "zeno-canvas://shell/zeno-canvas-shell.html", networkPolicy: "connection-allowlist",
  } };
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => {
  setClientProfileBootstrap({ requireSignin: false, requireActivation: false });
  window.__OPENWORK_ELECTRON__ = previousBridge;
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
  if (ownsDom) await GlobalRegistrator.unregister();
});

async function render(text: string, streaming = false, highlightQuery = "", assistantCanvas = true) {
  await act(async () => root.render(<MarkdownBlock text={text} streaming={streaming} highlightQuery={highlightQuery} assistantCanvas={assistantCanvas} />));
}
function iframe() {
  const frame = host.querySelector("iframe");
  if (!frame) throw new Error("Missing conversation canvas iframe");
  return frame;
}

test("a complete canvas keeps its iframe and control state through trailing tokens, settlement and highlighting", async () => {
  expect(localClientFeatureEnabled("conversationCanvas")).toBe(true);
  await render(`Before\n\n${board}\n\nAfter`, true);
  const original = iframe(); const originalDocument = original.src; const originalWindow = original.contentWindow;
  Reflect.set(original, "fixtureControlValue", 7);
  await render(`Before\n\n${board}\n\nAfter more prose`, true);
  await render(`Before\n\n${board}\n\nAfter more prose`, false);
  await render(`Before\n\n${board}\n\nAfter more prose`, false, "After");
  expect(iframe()).toBe(original);
  expect(iframe().contentWindow).toBe(originalWindow);
  expect(iframe().src).toBe(originalDocument);
  expect(iframe().hasAttribute("srcdoc")).toBe(false);
  expect(new URL(iframe().src).protocol).toBe("zeno-canvas:");
  expect(Reflect.get(iframe(), "fixtureControlValue")).toBe(7);
  expect(iframe().getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe().getAttribute("referrerpolicy")).toBe("no-referrer");
});

test("source toggling keeps the live iframe mounted and a later canvas does not replace the first one", async () => {
  await render(board, true);
  const original = iframe();
  const source = [...host.querySelectorAll("button")].find(button => button.textContent === "源码");
  if (!source) throw new Error("Missing source action");
  await act(async () => source.click());
  expect(iframe()).toBe(original);
  expect(original.parentElement?.hidden).toBe(true);
  expect(host.querySelector("[data-canvas-source]")?.textContent?.trim()).toBe(svg);
  await render(`${board}\n\nAnother board\n\n${board}`, false);
  expect(host.querySelectorAll("iframe")).toHaveLength(2);
  expect(iframe()).toBe(original);
  expect(original.parentElement?.hidden).toBe(true);
});

test("an incomplete new fence reserves a steady board instead of executing partial code", async () => {
  await render("```zeno-html\n<div>Working", true);
  const placeholder = host.querySelector("[data-conversation-canvas]");
  expect(placeholder).not.toBeNull();
  expect(host.querySelector("iframe")).toBeNull();
  expect(placeholder?.textContent).toContain("正在生成");
  const slot = placeholder?.querySelector<HTMLElement>("[data-canvas-viewport]");
  expect(slot?.style.height).toBe("360px");
  await render("```zeno-html\n<div>Working on more content", true);
  expect(host.querySelector("[data-conversation-canvas]")).toBe(placeholder);
  expect(slot?.style.height).toBe("360px");
  expect(host.querySelector("iframe")).toBeNull();
});

test("an incomplete replacement retains the last complete snapshot until its closing fence arrives", async () => {
  await render(board, true);
  const original = iframe(); const source = original.src;
  await render('```svg\n<svg xmlns="http://www.w3.org/2000/svg"><rect', true);
  expect(iframe()).toBe(original);
  expect(iframe().src).toBe(source);
  const next = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><rect width="60" height="60" /></svg>';
  await render(`\`\`\`svg\n${next}\n\`\`\``, true);
  expect(iframe()).toBe(original);
  expect(iframe().src).not.toBe(source);
});

test("a disabled installation or absent assistant opt-in retains normal fenced code", async () => {
  await render(board, false, "", false);
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.querySelector("code")?.textContent).toContain("<svg");
  setClientProfileBootstrap({ requireSignin: true });
  await render(board);
  expect(localClientFeatureEnabled("conversationCanvas")).toBe(false);
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.querySelector("code")?.textContent).toContain("<svg");
});

test("ordinary HTML examples stay code and invalid preview source has an explicit recovery", async () => {
  await render("```html\n<button>Example only</button>\n```", true);
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.querySelector("code")?.textContent).toContain("Example only");
  await act(async () => root.render(<ConversationCanvas fence={{ ordinal: 0, kind: "svg", source: "not svg", complete: true }} />));
  expect(host.querySelector('[data-canvas-state="failed"]')).not.toBeNull();
  expect(host.querySelector("[data-canvas-source]")?.textContent).toBe("not svg");
  expect(host.querySelector('button[aria-label="重试预览"]')).not.toBeNull();
});

test("only the owned opaque iframe can resize the board, while theme updates preserve its document", async () => {
  await render(board);
  const original = iframe(); const documentSource = original.src;
  const token = new URL(documentSource).searchParams.get("instance");
  if (!token || !original.contentWindow) throw new Error("Missing authenticated frame context");
  const viewport = host.querySelector<HTMLElement>("[data-canvas-viewport]");
  const data = { channel: "zeno-conversation-canvas", token, type: "height", height: 440 };
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data, source: window, origin: "null" })));
  expect(viewport?.style.height).toBe("360px");
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data, source: original.contentWindow, origin: "http://localhost" })));
  expect(viewport?.style.height).toBe("360px");
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { ...data, token: "wrong" }, source: original.contentWindow, origin: "null" })));
  expect(viewport?.style.height).toBe("360px");
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data, source: original.contentWindow, origin: "null" })));
  expect(viewport?.style.height).toBe("440px");
  await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { ...data, height: 99999 }, source: original.contentWindow, origin: "null" })));
  expect(viewport?.style.height).toBe("960px");
  const previous = document.documentElement.getAttribute("data-theme");
  try {
    await act(async () => { document.documentElement.dataset.theme = "dark"; await Promise.resolve(); });
    expect(iframe()).toBe(original);
    expect(iframe().src).toBe(documentSource);
  } finally {
    if (previous === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previous);
  }
});

test("the static shell receives generated source only after its authenticated opaque handshake", async () => {
  await render(board);
  const frame = iframe(); const contentWindow = frame.contentWindow;
  const token = new URL(frame.src).searchParams.get("instance");
  if (!contentWindow || !token) throw new Error("Missing authenticated shell");
  const messages: unknown[] = [];
  const previousPost = contentWindow.postMessage;
  contentWindow.postMessage = data => { messages.push(data); };
  const data = { channel: "zeno-conversation-canvas", token, type: "shell-ready" };
  try {
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data, source: window, origin: "null" })));
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data, source: contentWindow, origin: "http://localhost" })));
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data: { ...data, token: "wrong" }, source: contentWindow, origin: "null" })));
    expect(messages).toHaveLength(0);
    await act(async () => window.dispatchEvent(new MessageEvent("message", { data, source: contentWindow, origin: "null" })));
    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message).toMatchObject({ channel: data.channel, token, type: "document" });
    if (!message || typeof message !== "object" || !("srcDoc" in message) || typeof message.srcDoc !== "string") throw new Error("Missing generated document payload");
    expect(message.srcDoc).toContain("<!doctype html>");
    expect(message.srcDoc).toContain("allow-scripts");
    expect(message.srcDoc).toContain("circle");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
  } finally { contentWindow.postMessage = previousPost; }
});
