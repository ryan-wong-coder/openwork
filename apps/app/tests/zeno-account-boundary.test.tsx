import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { ZenoApiClient } from "@zeno/core";
import type { PersonalStore } from "../src/react-app/domains/zeno/use-zeno-sync";
const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/app/account" });
const { createRoot } = await import("react-dom/client");
const { PersonalAccountPage } = await import("../src/react-app/domains/zeno/account-page");
const { ZenoPersonalPage } = await import("../src/react-app/domains/zeno/personal-page");
const { markAccountSignedOut, clearAccountSignedOut, clearAccountHint, isAccountSignedOut } = await import("../src/react-app/domains/zeno/account-hint");
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT"); Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(async () => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct); if (ownsDom) await GlobalRegistrator.unregister(); });

test("account rollout off blocks preferences and new pairing while retaining privacy and recovery actions", async () => {
  let requests = 0;
  const client = new ZenoApiClient({ transport: async () => { requests++; return { status: 500, body: {} }; } });
  const noop = async () => {};
  const store: PersonalStore = { records: [], ready: true, writable: true, offline: false, syncing: false, error: null, accountChanged: false, pending: 0, conflicts: [], failedChanges: [], failedMedia: [], retryFailedChange: noop, retryFailedMedia: noop, discardFailedChange: noop, discardFailedMedia: noop, registerDraftFlusher: () => () => {}, flushDrafts: noop, save: noop, remove: noop, saveMutations: noop, addMedia: async () => "media", readMedia: async () => new Blob(), synchronize: noop, resolveConflict: noop, undo: noop, undoKinds: [], canUndo: false };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<PersonalAccountPage client={client} user={{ id: "test-user", email: "member@example.test", name: "测试用户", role: "user" }} devices={[]} refreshDevices={noop} onLogout={noop} store={store} readOnly />));
    const button = (label: string) => { const element = [...host.querySelectorAll("button")].find(item => item.textContent === label); if (!element) throw new Error("Missing " + label); return element; };
    expect(button("同意连接").disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="日历时区"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="默认重量单位"]')?.disabled).toBe(true);
    expect(button("退出账号").disabled).toBe(false); expect(button("修改密码").disabled).toBe(false);
    await act(async () => button("同意连接").click());
    expect(requests).toBe(0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("failed sign-in after explicit offline sign-out cannot revive the old cookie through online refresh", async () => {
  const service = "http://localhost", previousFetch = globalThis.fetch;
  let signIns = 0, sessions = 0;
  markAccountSignedOut(service); clearAccountHint(service);
  Reflect.set(globalThis, "fetch", async (request: RequestInfo | URL) => {
    const path = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url).pathname;
    if (path.endsWith("/auth/sign-in/email")) { signIns++; return new Response(JSON.stringify({ message: "邮箱或密码不正确。" }), { status: 401, headers: { "Content-Type": "application/json" } }); }
    if (path.endsWith("/me")) { sessions++; return Response.json({ user: { id: "old-account", email: "old@example.test", name: "旧账号", role: "user" } }); }
    return Response.json({});
  });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ZenoPersonalPage apiBaseUrl={service} />));
    const fill = (selector: string, value: string) => { const element = host.querySelector<HTMLInputElement>(selector); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; if (!element || !setter) throw new Error("Missing sign-in input"); setter.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); };
    await act(async () => { fill('input[name="email"]', "new@example.test"); fill('input[name="password"]', "wrong-password"); });
    await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(signIns).toBe(1); expect(host.textContent).toContain("邮箱或密码不正确");
    await act(async () => { window.dispatchEvent(new Event("online")); await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(sessions).toBe(0); expect(isAccountSignedOut(service)).toBe(true); expect(host.querySelector("[data-zeno-auth]")).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); Reflect.set(globalThis, "fetch", previousFetch); clearAccountSignedOut(service); clearAccountHint(service); }
});
