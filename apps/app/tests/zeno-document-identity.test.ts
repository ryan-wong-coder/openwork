import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { applyZenoDocumentIdentity } from "../src/app/lib/zeno-document-identity";

const ownedDom = typeof document === "undefined";
beforeAll(() => {
  if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
});
afterAll(async () => {
  if (ownedDom) await GlobalRegistrator.unregister();
});
let headBefore = "";
let attributeBefore: string | null = null;
let historyBefore: string | null = null;
beforeEach(() => {
  headBefore = document.head.innerHTML;
  attributeBefore = document.documentElement.getAttribute("data-zeno-interface");
  historyBefore = localStorage.getItem("openwork.history");
});
afterEach(() => {
  document.head.innerHTML = headBefore;
  if (attributeBefore === null) document.documentElement.removeAttribute("data-zeno-interface");
  else document.documentElement.setAttribute("data-zeno-interface", attributeBefore);
  if (historyBefore === null) localStorage.removeItem("openwork.history");
  else localStorage.setItem("openwork.history", historyBefore);
});

test("local identity restores title, icons, metadata and original root attribute", () => {
  document.documentElement.removeAttribute("data-zeno-interface");
  document.head.innerHTML = '<title>Connected organization</title><link rel="icon" type="image/svg+xml" href="/original.svg"><meta name="theme-color" content="#123456"><meta name="theme-color" content="#654321" media="(prefers-color-scheme: dark)"><meta name="apple-mobile-web-app-title" content="Original">';
  const originalHead = document.head.innerHTML;
  const cleanup = applyZenoDocumentIdentity(document, "/zeno.ico");
  expect(document.title).toBe("泽诺 Zeno");
  expect(document.documentElement.dataset.zenoInterface).toBe("true");
  expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/zeno.ico");
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe("#f3f1e8");
  cleanup();
  expect(document.documentElement.hasAttribute("data-zeno-interface")).toBe(false);
  expect(document.head.innerHTML).toBe(originalHead);
});

test("effect replay preserves a preexisting attribute and never touches storage", () => {
  document.head.innerHTML = "";
  window.document.documentElement.dataset.zenoInterface = "false";
  window.localStorage.setItem("openwork.history", "keep");
  const first = applyZenoDocumentIdentity(document, "/zeno.ico");
  first();
  const second = applyZenoDocumentIdentity(document, "/zeno.ico");
  second();
  expect(window.document.documentElement.dataset.zenoInterface).toBe("false");
  expect(window.localStorage.getItem("openwork.history")).toBe("keep");
  expect(window.document.querySelectorAll('link[rel="icon"]').length).toBe(0);
});
