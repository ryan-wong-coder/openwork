import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { eventDataSchema, routineDataSchema } from "@zeno/core";
import type { PersonalStore, SaveRecord } from "../src/react-app/domains/zeno/use-zeno-sync";
const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/app/fitness" });
const { createRoot } = await import("react-dom/client");
const { CustomExerciseEditor } = await import("../src/react-app/domains/zeno/custom-exercise-editor");
const { RoutineEditor } = await import("../src/react-app/domains/zeno/routine-editor");
const { EventEditor } = await import("../src/react-app/domains/zeno/event-editor");
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT"); Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(async () => { Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct); if (ownsDom) await GlobalRegistrator.unregister(); });
function storeWithSave(save: SaveRecord): PersonalStore { const noop = async () => {}; return { records: [], ready: true, writable: true, offline: false, syncing: false, error: null, accountChanged: false, pending: 0, conflicts: [], failedChanges: [], failedMedia: [], retryFailedChange: noop, retryFailedMedia: noop, discardFailedChange: noop, discardFailedMedia: noop, registerDraftFlusher: () => () => {}, flushDrafts: noop, save, remove: noop, saveMutations: noop, addMedia: async () => "media", readMedia: async () => new Blob(), synchronize: noop, resolveConflict: noop, undo: noop, undoKinds: [], canUndo: false }; }
function input(host: HTMLElement, label: string) { const element = [...host.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label)?.querySelector("input"); if (!(element instanceof HTMLInputElement)) throw new Error("Missing " + label); return element; }
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) { const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set; if (!setter) throw new Error("Missing native value setter"); setter.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); }

test("batched real input events retain each custom-exercise field after React clears currentTarget", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); let saved: unknown;
  const store = storeWithSave(async (_kind, data) => { saved = data; });
  try {
    await act(async () => root.render(<CustomExerciseEditor store={store} onClose={() => {}} onSaved={() => {}} />));
    // One React batch intentionally delays later functional updaters past event cleanup.
    await act(async () => { fill(input(host, "动作名称"), "测试自定义动作"); fill(input(host, "主要肌群"), "胸、肱三头肌"); fill(input(host, "次要肌群"), "肩"); fill(input(host, "器械"), "哑铃"); const steps = host.querySelector("textarea"); if (!steps) throw new Error("Missing instructions"); fill(steps, "第一步\n第二步"); });
    await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(saved).toMatchObject({ name: "测试自定义动作", primaryMuscles: ["胸", "肱三头肌"], secondaryMuscles: ["肩"], equipment: ["哑铃"], instructions: ["第一步", "第二步"] });
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("calendar workspace selection links and unlinks records while single-occurrence edits remain locked", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); let saved: unknown;
  const initial = eventDataSchema.parse({ title: "日程", startAt: 2_000_000_000_000, endAt: 2_000_003_600_000, timeZone: "Asia/Shanghai" });
  const choose = async (text: string) => { await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关联工作区"]')?.click()); const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === text); if (!option) throw new Error("Missing workspace " + text); await act(async () => { option.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true })); option.click(); }); };
  try {
    await act(async () => root.render(<EventEditor initial={initial} workspaces={[{ id: "workspace-a", name: "个人项目" }]} onSave={async data => { saved = data; }} onCancel={() => {}} />));
    const disclosure = [...host.querySelectorAll("details")].find(details => details.querySelector("summary")?.textContent === "工作区"); if (disclosure) disclosure.open = true;
    await choose("个人项目");
    await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(saved).toMatchObject({ workspaceId: "workspace-a" });
    await choose("个人全局");
    await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(saved).toMatchObject({ workspaceId: undefined });
    await act(async () => root.render(<EventEditor key="missing" initial={{ ...initial, workspaceId: "missing-workspace" }} recurring workspaces={[]} onSave={async () => {}} onCancel={() => {}} />));
    const control = host.querySelector<HTMLButtonElement>('[aria-label="关联工作区"]');
    expect(control?.disabled).toBe(true); expect(control?.textContent).toContain("已关联工作区"); expect(host.textContent).not.toContain("missing-workspace");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("plan title and exercise edits in one input batch survive into the actual saved routine", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); let saved: unknown;
  const initial = routineDataSchema.parse({ title: "原计划", exercises: [{ id: "entry", exerciseId: "exercise", name: "测试动作", sets: [{ id: "set", weight: 20, reps: 8 }] }] });
  try {
    await act(async () => root.render(<RoutineEditor initial={initial} store={storeWithSave(async () => {})} onCancel={() => {}} onSave={async data => { saved = data; }} />));
    await act(async () => { fill(input(host, "计划名称"), "已修改计划"); const weight = host.querySelector<HTMLInputElement>('[aria-label="第1组重量"]'); const reps = host.querySelector<HTMLInputElement>('[aria-label="第1组次数"]'); if (!weight || !reps) throw new Error("Missing set inputs"); fill(weight, "24"); fill(reps, "10"); });
    await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(saved).toMatchObject({ title: "已修改计划", exercises: [{ sets: [{ weight: 24, reps: 10 }] }] });
  } finally { await act(async () => root.unmount()); host.remove(); }
});
