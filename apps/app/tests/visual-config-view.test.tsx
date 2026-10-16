import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createOpenworkServerClient } from "../src/app/lib/openwork-server";

GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => { await GlobalRegistrator.unregister(); });
const { createRoot } = await import("react-dom/client");
const { VisualConfigView } = await import("../src/react-app/domains/settings/pages/visual-config-view");

describe("visual configuration form", () => {
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let content: string;
  let exists: boolean;
  let conflict: boolean;
  let writes: unknown[];
  let restoreFetch: () => void;
  const client = createOpenworkServerClient({ baseUrl: "http://localhost:8787", token: "fixture-token" });

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    content = '// keep this comment\n{ "model": "gateway/first", "subagent_depth": 2, "provider": { "gateway": { "options": { "apiKey": "fixture-private-value" } } } }\n';
    exists = true; conflict = false; writes = [];
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        const payload: unknown = JSON.parse(typeof init.body === "string" ? init.body : "{}");
        writes.push(payload);
        if (conflict) return Response.json({ code: "config_conflict", message: "配置已被其他操作修改，请重新加载。" }, { status: 409 });
        return Response.json({ ok: true, status: 0, stdout: "", stderr: "" });
      }
      return Response.json({ exists, path: "/fixture/opencode.jsonc", content });
    });
    restoreFetch = () => fetchSpy.mockRestore();
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); restoreFetch(); });

  const render = async (connected = true) => {
    await act(async () => { root.render(createElement(VisualConfigView, { client: connected ? client : null, workspaceId: "workspace" })); });
  };
  const button = (label: string) => {
    const found = [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  const input = (label: string) => {
    const found = [...host.querySelectorAll("input")].find((element) => element.getAttribute("aria-label") === label);
    if (!found) throw new Error(`Missing input: ${label}`);
    return found;
  };
  const type = async (field: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  test("saves a form edit with its exact baseline and leaves comments and private fields intact", async () => {
    await render();
    expect(button("保存修改").disabled).toBe(true);
    expect(host.querySelector("textarea")).toBeNull();
    await type(input("默认模型"), "gateway/second");
    expect(button("保存修改").disabled).toBe(false);
    await act(async () => button("保存修改").click());
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ scope: "project", expectedContent: content });
    expect(JSON.stringify(writes[0])).toContain("keep this comment");
    expect(JSON.stringify(writes[0])).toContain("gateway/second");
    expect(host.textContent).toContain("修改已保存");
    expect(host.textContent).not.toContain("fixture-private-value");
    expect(button("保存修改").disabled).toBe(true);
  });

  test("a save conflict keeps edits visible and offers reload", async () => {
    await render(); await type(input("默认模型"), "gateway/second"); conflict = true;
    await act(async () => button("保存修改").click());
    expect(host.textContent).toContain("配置已被其他操作修改");
    expect(input("默认模型").value).toBe("gateway/second");
    expect(button("重新加载")).toBeTruthy();
    expect(button("保存修改").disabled).toBe(false);
  });

  test("invalid numbers block save and undo restores the field value", async () => {
    await render(); await type(input("子助手最大层数"), "");
    await type(input("默认模型"), "gateway/second");
    expect(button("保存修改").disabled).toBe(true);
    expect(host.textContent).toContain("有效数字");
    await act(async () => button("撤销修改").click());
    expect(input("子助手最大层数").value).toBe("2");
    expect(host.textContent).not.toContain("有效数字");
  });

  test("malformed files are shown as repairable errors without an editable replacement", async () => {
    content = '{ "model": ';
    await render();
    expect(host.textContent).toContain("无法读取");
    expect(button("保存修改").disabled).toBe(true);
    expect(host.querySelector('input[aria-label="默认模型"]')).toBeNull();
  });

  test("an offline local service preserves the destination layout and disables save", async () => {
    await render(false);
    expect(host.textContent).toContain("本地服务尚未连接");
    expect(button("保存修改").disabled).toBe(true);
    expect(writes).toEqual([]);
  });
});
