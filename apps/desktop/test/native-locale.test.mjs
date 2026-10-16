import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeMenuTemplate, nativeTemplate, nativeText, setNativeLanguage } from "../electron/native-locale.mjs";
import { contentMenuTemplate } from "../electron/context-menu.mjs";

test("native menus default to Chinese and preserve roles and callbacks", () => {
  setNativeLanguage("zh-CN");
  const click = () => {};
  const [menu] = localizeMenuTemplate([{ label: "File", submenu: [{ role: "copy" }, { label: "Close", click }] }]);
  assert.equal(menu.label, "文件");
  assert.equal(menu.submenu[0].label, "复制");
  assert.equal(menu.submenu[0].role, "copy");
  assert.equal(menu.submenu[1].click, click);
  assert.equal(nativeText("OpenWork"), "OpenWork");
});

test("changing language restores custom English and Electron's OS role labels", () => {
  assert.equal(setNativeLanguage("en"), true);
  assert.equal(setNativeLanguage("en"), false);
  const [menu] = localizeMenuTemplate([{ label: "File", submenu: [{ role: "copy" }] }]);
  assert.equal(menu.label, "File");
  assert.equal(menu.submenu[0].label, undefined);
  setNativeLanguage("zh");
});

test("image and link context actions are Chinese and keep the original URL", () => {
  setNativeLanguage("zh");
  const copied = [];
  const menu = contentMenuTemplate({}, { linkURL: "https://example.test/path" }, { writeText: (value) => copied.push(value) });
  const action = menu.find((item) => item.label === "复制链接地址");
  assert.ok(action);
  action.click();
  assert.deepEqual(copied, ["https://example.test/path"]);
});

test("browser consent interpolation keeps literal user data and English fallback", () => {
  setNativeLanguage("zh");
  const params = { action: "click", origin: "https://example.test/$&/{action}" };
  const chinese = nativeTemplate("Allow {action} on {origin}?", params);
  assert.ok(chinese.includes(params.origin));
  assert.ok(chinese.includes("click"));
  assert.notEqual(chinese, "Allow click on https://example.test/$&/{action}?");
  setNativeLanguage("en");
  assert.equal(nativeTemplate("Allow {action} on {origin}?", params), "Allow click on https://example.test/$&/{action}?");
  setNativeLanguage("zh");
});
