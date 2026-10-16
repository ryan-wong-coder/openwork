import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  currentLocale,
  DEFAULT_LANGUAGE,
  initLocale,
  LANGUAGE_PREF_KEY,
  setLocale,
  subscribeLocale,
  t,
} from "../src/i18n";
import en from "../src/i18n/locales/en";
import zh from "../src/i18n/locales/zh";

describe("Chinese localization", () => {
  beforeEach(() => {
    GlobalRegistrator.register({ url: "http://localhost:5173/" });
    window.localStorage.clear();
    initLocale();
  });

  afterEach(async () => {
    await GlobalRegistrator.unregister();
  });

  test("a fresh profile defaults to Simplified Chinese", () => {
    expect(DEFAULT_LANGUAGE).toBe("zh");
    expect(initLocale()).toBe("zh");
    expect(currentLocale()).toBe("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(t("settings.language")).toBe("语言");
  });

  test("keeps an explicit language preference across initialization", () => {
    setLocale("en");
    expect(window.localStorage.getItem(LANGUAGE_PREF_KEY)).toBe("en");
    expect(initLocale()).toBe("en");
    expect(t("settings.language")).toBe("Language");
    expect(document.documentElement.lang).toBe("en");
  });

  test("an invalid or removed preference resets the in-memory language too", () => {
    setLocale("en");
    window.localStorage.setItem(LANGUAGE_PREF_KEY, "unknown");
    expect(initLocale()).toBe("zh");
    setLocale("en");
    window.localStorage.removeItem(LANGUAGE_PREF_KEY);
    expect(initLocale()).toBe("zh");
    expect(currentLocale()).toBe("zh");
  });

  test("storage failure still leaves the Chinese interface usable", () => {
    setLocale("en");
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("Storage unavailable"); } });
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(initLocale()).toBe("zh");
      expect(document.documentElement.lang).toBe("zh-CN");
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
      else Reflect.deleteProperty(window, "localStorage");
      warning.mockRestore();
    }
  });

  test("notifies interface subscribers only when the language changes", () => {
    const observed: string[] = [];
    const unsubscribe = subscribeLocale(() => observed.push(currentLocale()));
    setLocale("en");
    setLocale("en");
    setLocale("zh");
    unsubscribe();
    setLocale("ja");
    expect(observed).toEqual(["en", "zh"]);
  });

  test("Chinese count messages never fall back to English plural forms", () => {
    expect(t("account.providers_connected", { count: 2 })).toBe("2 个模型提供商");
    expect(t("time.seconds_ago", { count: 3 })).toBe("3秒前");
    expect(t("account.providers_connected", { count: 1, lng: "en" })).toBe("1 model provider");
    expect(t("account.providers_connected", { count: 2, lng: "en" })).toBe("2 model providers");
  });

  test("interpolation preserves literal dollar replacement sequences", () => {
    expect(t("den.status_loaded_workers", { count: 2, name: "$&" })).toContain("$&");
    expect(t("missing.translation")).toBe("missing.translation");
    const text = t("extensions.connector_note_codes", { name: "$&" });
    expect(text.split("$&")).toHaveLength(3);
    expect(text).not.toContain("{name}");
  });

  test("every English key has Chinese text and matching placeholders", () => {
    const chinese: Record<string, string> = zh;
    for (const [key, value] of Object.entries(en)) {
      const translated = chinese[key];
      expect(translated, key).toBeTruthy();
      const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z_][\w]*)\}/g)].map((match) => match[1]).filter((name) => !(/_(zero|one)$/.test(key) && name === "count")).sort();
      expect(placeholders(translated), key).toEqual(placeholders(value));
    }
  });
});

test("server-side initialization also defaults to Chinese", () => {
  expect(initLocale()).toBe("zh");
  expect(currentLocale()).toBe("zh");
});
