import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { NewTaskComposerProps } from "../src/react-app/domains/session/chat/new-task-composer";

let zenoEnabled = true;
let savedDraft = "";
let focusRequests = 0;
const saved: string[] = [];
mock.module("../src/app/lib/zeno-identity", () => ({ isZenoInterfaceEnabled: () => zenoEnabled }));
mock.module("../src/components/brand/zeno-brand", () => ({ ZenoMascot: ({ pose }: { pose?: string }) => <img alt="" data-mascot data-pose={pose} /> }));
mock.module("../src/hooks/use-mobile", () => ({ useIsMobile: () => false }));
mock.module("../src/react-app/domains/cloud/desktop-config-provider", () => ({
  useOrgRestrictions: () => ({}), useCheckDesktopRestriction: () => () => false,
}));
mock.module("../src/react-app/domains/cloud/den-auth-provider", () => ({ useDenAuth: () => ({ isSignedIn: false }) }));
mock.module("../src/react-app/kernel/platform", () => ({ usePlatform: () => ({ openLink: () => {} }) }));
mock.module("../src/react-app/domains/cloud/openwork-models-promo", () => ({
  useOpenWorkModelsPromoEligibility: () => false, isOpenWorkModelsPromoHidden: () => true,
  hideOpenWorkModelsPromo: () => {}, getOpenWorkModelsActionUrl: () => "", openWorkModelsPromoChangedEvent: "promo-changed",
}));
mock.module("../src/components/chat/task-suggestions", () => ({ resolveOrganizationPromptCardContent: () => ({ title: "", description: "", selectionPrompt: "" }) }));
mock.module("../src/react-app/domains/session/sync/draft-store", () => ({
  useNewTaskDraftState: () => ({ snapshot: { text: savedDraft }, save: ({ text }: { text: string }) => saved.push(text), clear: () => {} }),
}));
mock.module("../src/react-app/domains/session/surface/composer-state-store", () => ({
  getComposerDraft: () => "",
  persistableComposerDraftText: (draft: string) => draft,
  useComposerStateStore: { getState: () => ({ sessions: {} }) },
}));
mock.module("../src/react-app/domains/session/chat/new-task-composer", () => ({ NewTaskComposer: (props: NewTaskComposerProps) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const focus = () => { focusRequests += 1; ref.current?.focus(); };
    window.addEventListener("openwork:focusPrompt", focus);
    return () => window.removeEventListener("openwork:focusPrompt", focus);
  }, []);
  return <textarea ref={ref} value={props.draft} onInput={(event) => props.onDraftChange(event.currentTarget.value)} readOnly />;
} }));

GlobalRegistrator.register({ url: "http://localhost/" });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { SessionEmptyHero } = await import("../src/react-app/domains/session/chat/session-empty-hero");
const { t } = await import("../src/i18n");
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { zenoEnabled = true; savedDraft = ""; focusRequests = 0; saved.splice(0); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
afterAll(async () => { Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); await GlobalRegistrator.unregister(); });

async function mount(options: { providerCount?: number } = {}) {
  const sent: string[] = [];
  let configured = 0;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SessionEmptyHero providerCount={options.providerCount ?? 1}
    onRunTask={async (prompt) => { sent.push(prompt); }} onOpenProviderAuth={() => { configured += 1; }} />));
  cleanups.push(async () => { await act(async () => root.unmount()); host.remove(); });
  return { host, sent, configured: () => configured };
}

test("each quick intention fills and focuses the real draft without sending", async () => {
  const fixture = await mount();
  const buttons = fixture.host.querySelectorAll<HTMLButtonElement>("[data-zeno-intent]");
  expect(buttons.length).toBe(3);
  await act(async () => buttons[0]!.click());
  const editor = fixture.host.querySelector("textarea")!;
  expect(editor.value).toBe(t("zeno.prompt_files"));
  expect(document.activeElement).toBe(editor);
  expect(focusRequests).toBe(1);
  expect(saved.at(-1)).toBe(editor.value);
  expect(fixture.sent).toEqual([]);
  expect(fixture.host.querySelector("[data-mascot]")?.getAttribute("data-pose")).toBe("thinking");
});

test("typing a draft changes the decorative pose and clearing it restores welcome", async () => {
  const fixture = await mount();
  const editor = fixture.host.querySelector("textarea")!;
  expect(fixture.host.querySelector("[data-mascot]")?.getAttribute("data-pose")).toBe("welcome");
  await act(async () => {
    editor.value = "我的想法";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(fixture.host.querySelector("[data-mascot]")?.getAttribute("data-pose")).toBe("thinking");
  expect(fixture.sent).toEqual([]);
  await act(async () => {
    editor.value = "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(fixture.host.querySelector("[data-mascot]")?.getAttribute("data-pose")).toBe("welcome");
  expect(fixture.host.querySelector("[data-mascot]")?.getAttribute("alt")).toBe("");
});

test("an intention preserves an existing draft and its attachment tokens", async () => {
  savedDraft = "我的草稿 [attachment sample]";
  const fixture = await mount();
  await act(async () => fixture.host.querySelector<HTMLButtonElement>('[data-zeno-intent="image"]')!.click());
  expect(fixture.host.querySelector("textarea")!.value).toBe(`${savedDraft}\n${t("zeno.prompt_image")}`);
  expect(fixture.sent).toEqual([]);
});

test("missing gateway has one setup action, which opens the existing configuration flow", async () => {
  const fixture = await mount({ providerCount: 0 });
  const actions = fixture.host.querySelectorAll<HTMLButtonElement>("[data-zeno-gateway-setup]");
  expect(actions.length).toBe(1);
  expect(actions[0]!.textContent).toBe(t("zeno.gateway_setup"));
  await act(async () => actions[0]!.click());
  expect(fixture.configured()).toBe(1);
  expect(fixture.sent).toEqual([]);
});

test("turning the interface off restores the existing home", async () => {
  zenoEnabled = false;
  const fixture = await mount();
  expect(fixture.host.querySelector("[data-mascot]")).toBeNull();
  expect(fixture.host.querySelector("[data-zeno-intent]")).toBeNull();
  expect(fixture.host.textContent).toContain(t("interface.what_do_you_need_done"));
});
