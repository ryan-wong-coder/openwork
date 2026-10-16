import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, type ReactNode } from "react";
import type { ModelOption, ProviderListItem } from "../src/app/types";
import { FAST_DEFAULT_VARIANT } from "@openwork/types/cloud-model-fast";
import { getModelBehaviorOptions, getModelEffortState } from "../src/app/lib/model-behavior";
import { runtimeModelOptions } from "../src/react-app/domains/models/catalog";
import { setLocale } from "../src/i18n";

const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
let option: ModelOption;
let available: ModelOption[];
const changes: Array<string | null> = [];
mock.module("../src/hooks/use-mobile", () => ({ useIsMobile: () => false }));
mock.module("../src/react-app/shell/workspace-provider", () => ({ useWorkspace: () => ({ client: null, opencodeBaseUrl: null, selectedWorkspaceRoot: null }) }));
mock.module("../src/react-app/kernel/use-workspace-model-default", () => ({ useSetWorkspaceDefaultModel: () => () => {} }));
mock.module("../src/react-app/domains/cloud/desktop-config-provider", () => ({ useCheckDesktopRestriction: () => () => false }));
mock.module("../src/react-app/domains/cloud/den-auth-provider", () => ({ useDenAuth: () => ({ isSignedIn: false }) }));
mock.module("../src/react-app/kernel/platform", () => ({ usePlatform: () => ({ openLink: () => {} }) }));
mock.module("../src/react-app/domains/cloud/auto-access-ui", () => ({ AutoAccessFooter: () => null, openAutoProviderSettings: () => {} }));
mock.module("../src/react-app/domains/models/model-picker-list", () => ({ ModelPickerList: ({ footer }: { footer?: ReactNode }) => <>{footer}</> }));
mock.module("../src/react-app/domains/models/use-model-catalog", () => ({
  useModelChoice: () => ({ choose: (_option: ModelOption, commit: () => void) => commit(), loginOpen: false }),
  useModelCatalog: () => ({ options: available, actionOptions: available, currentOption: option,
    catalogState: { state: "ready" }, restrictToCloud: false, autoVisible: false }),
}));
const { createRoot } = await import("react-dom/client");
const { ModelSelect } = await import("../src/components/model-select");
const { ModelPickerModal } = await import("../src/react-app/domains/session/modals/model-picker-modal");
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

type ProviderModel = ProviderListItem["models"][string];
function model(reasoning: boolean, variants: ProviderModel["variants"] = {}): ProviderModel {
  return { id: "fixture-model", providerID: "fixture", name: "MiniMax M2.1",
    api: { id: "fixture-model", url: "https://provider.example.invalid", npm: "@ai-sdk/openai-compatible" },
    capabilities: { reasoning, temperature: true, attachment: false, toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false }, interleaved: false },
    cost: { input: 1, output: 1, cache: { read: 0, write: 0 } }, limit: { context: 10000, output: 1000 },
    status: "active", options: {}, headers: {}, release_date: "2026-01-01", variants };
}
function engineOptions(reasoning: boolean, variants: ProviderModel["variants"] = {}) {
  const provider: ProviderListItem = { id: "fixture", name: "Fixture provider", source: "config", env: [], options: {}, models: { "fixture-model": model(reasoning, variants) } };
  return runtimeModelOptions({ all: [provider], connected: [provider.id], default: {} });
}
beforeEach(() => {
  setLocale("zh"); changes.length = 0;
  available = engineOptions(true); option = available[0];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
  if (ownsDom) await GlobalRegistrator.unregister();
});
async function render(behaviorValue: string | null = null) {
  await act(async () => root.render(<ModelSelect open value={option} onOpenChange={() => {}} onChange={() => {}}
    behaviorValue={behaviorValue} onBehaviorChange={value => changes.push(value)} />));
}
function effortButton() {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="model-effort"]');
  if (!button) throw new Error("Missing effort control");
  return button;
}

test("runtime catalog preserves provider reasoning metadata and real variants", () => {
  expect(option.reasoning).toBe(true);
  expect(getModelEffortState(option.behaviorOptions ?? [], option.reasoning)).toMatchObject({ adjustable: false, label: "模型自动控制" });
  const manual = engineOptions(true, { low: { reasoningEffort: "low" }, high: { reasoningEffort: "high" }, disabled: { disabled: true } })[0];
  expect(manual.behaviorOptions?.map(entry => entry.value)).toEqual([null, "low", "high"]);
  expect(getModelEffortState(manual.behaviorOptions ?? [], manual.reasoning).adjustable).toBe(true);
});

test("automatic reasoning is visible but cannot open a depth menu or mutate a value", async () => {
  await render();
  expect(effortButton().textContent).toContain("模型自动控制");
  expect(effortButton().disabled).toBe(true);
  await act(async () => effortButton().click());
  expect(document.querySelector('[data-slot="model-thinking-submenu"]')).toBeNull();
  expect(changes).toEqual([]);
});

test("unknown or false reasoning is not inferred from a familiar model name", async () => {
  for (const reasoning of [undefined, false]) {
    option = { ...option, title: "MiniMax M2.1", reasoning }; available = [option];
    await render();
    expect(effortButton().textContent).toContain("未提供可调深度");
    expect(effortButton().disabled).toBe(true);
    await act(async () => effortButton().click());
  }
  expect(changes).toEqual([]);
});

test("a saved unlisted variant stays visible and offers only Default recovery", async () => {
  await render("saved-unverified-depth");
  expect(effortButton().textContent).toContain('未列出："saved-unverified-depth"');
  expect(effortButton().disabled).toBe(false);
  expect(getModelEffortState(option.behaviorOptions ?? [], true, "saved-unverified-depth")).toMatchObject({ adjustable: false, resetAvailable: true });
  await act(async () => effortButton().click());
  const options = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="model-thinking-submenu"] button[aria-pressed]')];
  expect(options.map(button => button.textContent?.trim())).toEqual(["默认"]);
  expect(changes).toEqual([]);
  await act(async () => options[0].click());
  expect(changes).toEqual([null]);
});

test("advertised manual levels remain selectable and pass their exact native IDs", async () => {
  available = engineOptions(true, { low: { reasoningEffort: "low" }, high: { reasoningEffort: "high" } }); option = available[0];
  await render(); expect(effortButton().disabled).toBe(false);
  await act(async () => effortButton().click());
  const high = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="model-thinking-submenu"] button')].find(button => button.textContent?.trim() === "深入");
  if (!high) throw new Error("Missing advertised localized High choice");
  await act(async () => high.click());
  expect(changes).toEqual(["high"]);
});

test("known depth labels localize while every native variant ID stays unchanged", () => {
  const ids = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "vendor/X_Option-v1"];
  const options = getModelBehaviorOptions("fixture", model(true, Object.fromEntries(ids.map(id => [id, {}]))));
  expect(options.slice(1).map(entry => entry.value)).toEqual(ids);
  expect(options.slice(1).map(entry => entry.label)).toEqual(["无额外思考", "极轻量", "轻量", "均衡", "深入", "极高", "最高", "vendor/X_Option-v1"]);
  setLocale("en");
  expect(getModelBehaviorOptions("fixture", model(true, { max: {} }))[1]).toMatchObject({ value: "max", label: "Maximum" });
});

test("Fast-only availability does not invent a reasoning depth", () => {
  const choices = getModelBehaviorOptions("fixture", model(true, { [FAST_DEFAULT_VARIANT]: { serviceTier: "priority" } }));
  expect(getModelEffortState(choices, true)).toMatchObject({ adjustable: false, label: "模型自动控制" });
  setLocale("en");
  expect(getModelEffortState(choices, true).label).toBe("Model controlled");
  expect(getModelEffortState([], undefined).label).toBe("No adjustable levels");
});

test("All models also reports automatic reasoning without a fake Default action", async () => {
  await act(async () => root.render(<ModelPickerModal open options={available} query="" setQuery={() => {}} target="session"
    current={option} onSelect={() => {}} onBehaviorChange={(_model, value) => changes.push(value)}
    onOpenSettings={() => {}} onClose={() => {}} />));
  const summary = document.querySelector<HTMLElement>('[data-testid="current-model-settings"] summary');
  if (!summary) throw new Error("Missing model advanced disclosure");
  await act(async () => summary.click());
  const details = document.querySelector('[data-testid="current-model-settings"]');
  expect(details?.textContent).toContain("模型自动控制");
  expect(details?.querySelector('[role="group"]')).toBeNull();
  expect(changes).toEqual([]);
});

test("All models keeps the same explicit recovery for an unlisted saved variant", async () => {
  await act(async () => root.render(<ModelPickerModal open options={available} query="" setQuery={() => {}} target="session"
    current={option} currentBehaviorValue="saved-unverified-depth" onSelect={() => {}}
    onBehaviorChange={(_model, value) => changes.push(value)} onOpenSettings={() => {}} onClose={() => {}} />));
  const summary = document.querySelector<HTMLElement>('[data-testid="current-model-settings"] summary');
  if (!summary) throw new Error("Missing model advanced disclosure");
  await act(async () => summary.click());
  const details = document.querySelector('[data-testid="current-model-settings"]');
  expect(details?.textContent).toContain('未列出："saved-unverified-depth"');
  const choices = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="current-model-settings"] [role="group"] button')];
  expect(choices.map(button => button.textContent?.trim())).toEqual(["默认"]);
  expect(changes).toEqual([]);
  await act(async () => choices[0].click());
  expect(changes).toEqual([null]);
});
