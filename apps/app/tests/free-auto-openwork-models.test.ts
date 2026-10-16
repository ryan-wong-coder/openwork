import { beforeEach, expect, test } from "bun:test";
import { setLocale } from "../src/i18n";
import { autoPickerCopy, autoResetPhrase, autoUpdateTarget, autoWallCopy } from "../src/app/lib/inference-access";
import { buildModelCatalog, resolveRetainedSelection } from "../src/react-app/domains/models/catalog";
import { AUTO_MODEL_ID, AUTO_PROVIDER_ID, isAutoModel, modelTitle, openWorkModelsLunaReplacement, shouldSelectInitialAuto, starterModel } from "../src/react-app/domains/models/model-catalog";
import type { ModelOption } from "../src/app/types";

beforeEach(() => setLocale("en"));

const auto: ModelOption = { providerID: AUTO_PROVIDER_ID, modelID: AUTO_MODEL_ID, title: "Auto", isFree: true };
const openWorkModel: ModelOption = { providerID: "openwork", modelID: "anthropic/claude-sonnet", title: "Claude Sonnet" };
const other: ModelOption = { providerID: "anthropic", modelID: "claude-sonnet", title: "Claude Sonnet" };

function catalog(runtime: ModelOption[]) {
  return buildModelCatalog({ runtime, signedIn: true, restrictToCloud: false, checkRestriction: () => false,
    autoStatus: { providerID: AUTO_PROVIDER_ID, modelID: AUTO_MODEL_ID, code: null } });
}

test("free Auto is not listed when the organization has OpenWork Models", () => {
  expect(catalog([auto, other]).options.map((option) => option.providerID)).toContain(AUTO_PROVIDER_ID);
  const covered = catalog([auto, openWorkModel, other]);
  expect(covered.options.map((option) => option.providerID)).toEqual(["openwork", "anthropic"]);
  expect(covered.known.map((option) => option.providerID)).toContain(AUTO_PROVIDER_ID);
});

test("a conversation already on free Auto keeps working when it is hidden behind OpenWork Models", () => {
  expect(resolveRetainedSelection({ current: auto, catalog: catalog([auto, openWorkModel]), signedIn: true,
    restrictToCloud: false, checkRestriction: () => false, catalogState: "ready", sessionScoped: true })).toBeUndefined();
});

test("new members with OpenWork Models do not start on free Auto", () => {
  const input = { current: null, empty: true, explicit: false };
  expect(shouldSelectInitialAuto({ ...input, available: [auto, other] })).toBe(true);
  expect(shouldSelectInitialAuto({ ...input, available: [auto, openWorkModel] })).toBe(false);
});

const luna: ModelOption = { providerID: "openwork", modelID: AUTO_MODEL_ID, title: "GPT-6 Luna" };

test("Luna from OpenWork Models is listed under its own name, not as Auto", () => {
  expect(isAutoModel(luna)).toBe(false);
  expect(modelTitle(luna)).toBe("GPT-6 Luna");
  expect(catalog([auto, luna]).options).toEqual([expect.objectContaining({ providerID: "openwork", title: "GPT-6 Luna" })]);
});

test("members start on Luna from their OpenWork Models once it is listed", () => {
  const input = { current: null, empty: true, explicit: false };
  expect(shouldSelectInitialAuto({ ...input, available: [auto, openWorkModel, luna] })).toBe(true);
  expect(starterModel([auto, openWorkModel, luna])).toBe(luna);
  expect(starterModel([auto, other])).toBe(auto);
});

test("a saved free Auto choice moves to Luna from OpenWork Models", () => {
  expect(openWorkModelsLunaReplacement(auto, [auto, openWorkModel, luna])).toBe(luna);
  expect(openWorkModelsLunaReplacement(auto, [auto, openWorkModel])).toBeUndefined();
  expect(openWorkModelsLunaReplacement(other, [auto, luna])).toBeUndefined();
});


test("Auto copy preserves English reset intervals and evaluates the active language at call time", () => {
  const now = new Date(2026, 0, 3, 12).getTime();
  expect(autoResetPhrase(new Date(now + 60_000).toISOString(), now)).toBe("in 1 minute");
  expect(autoResetPhrase(new Date(now + 20 * 60_000).toISOString(), now)).toBe("in 20 minutes");
  expect(autoResetPhrase(new Date(now + 60 * 60_000).toISOString(), now)).toBe("in 1 hour");
  expect(autoResetPhrase(new Date(now + 3 * 60 * 60_000).toISOString(), now)).toBe("in 3 hours");
  expect(autoResetPhrase(new Date(2026, 0, 5, 12).toISOString(), now)).toBe("on Monday");
  expect(autoPickerCopy("ready", false).subtitle).toBe("OpenWork picks the model");
  expect(autoWallCopy({ state: "limit" }, true, now).detail).toBe("Pick another model to keep going.");
});

test("Auto copy displays Chinese intervals, weekdays, updates, and next steps", () => {
  const now = new Date(2026, 0, 3, 12).getTime();
  setLocale("zh");
  try {
    expect(autoResetPhrase(new Date(now + 20 * 60_000).toISOString(), now)).toBe("20 分钟后");
    expect(autoResetPhrase(new Date(now + 3 * 60 * 60_000).toISOString(), now)).toBe("3 小时后");
    expect(autoResetPhrase(new Date(2026, 0, 5, 12).toISOString(), now)).toBe("星期一");
    expect(autoUpdateTarget("v0.18.51")).toBe("OpenWork v0.18.51 或更新版本");
    expect(autoWallCopy({ state: "limit" }, true, now).detail).toBe("请选择其他模型继续。");
    expect(autoResetPhrase(new Date(now - 60_000).toISOString(), now)).toBeNull();
  } finally {
    setLocale("en");
  }
});
