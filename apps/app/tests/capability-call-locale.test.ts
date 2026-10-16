import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import { DEFAULT_LANGUAGE, setLocale } from "../src/i18n";
import { getCapabilityCallSentence } from "../src/lib/capability-call";
import { codeModeSummary } from "../src/lib/code-mode-summary";

const part = (toolName: string, input: unknown = {}, output: unknown = {}): DynamicToolUIPart => ({
  type: "dynamic-tool", toolName, toolCallId: "localized-activity", state: "output-available", input, output,
});

beforeEach(() => setLocale("zh"));
afterEach(() => setLocale(DEFAULT_LANGUAGE));

describe("capability activity follows the active language", () => {
  test("image generation has Chinese running, completed and failed labels", () => {
    expect(getCapabilityCallSentence(part("openwork_image_generate"))).toEqual({
      service: "OpenWork", present: "正在生成图片 · OpenWork", past: "已生成图片 · OpenWork", failure: "生成图片失败 · OpenWork",
    });
    const call = part("openwork_execute_capability", { name: "openwork.image_generate" });
    expect(getCapabilityCallSentence(call).past).toBe("已生成图片 · OpenWork");
    setLocale("en");
    expect(getCapabilityCallSentence(call).past).toBe("Generated image · OpenWork");
    expect(getCapabilityCallSentence(call).failure).toBe("Couldn't generate image · OpenWork");
  });

  test("connector and user names survive translated search and skill activity", () => {
    const search = part("openwork_execute_capability", { name: "mcp:connection-fixture:search_messages", query: "预算 $&" });
    const result = getCapabilityCallSentence(search, { connectionName: "Slack" });
    expect(result.present).toBe("正在搜索Slack：“预算 $&”");
    expect(result.past).toBe("已搜索Slack：“预算 $&”");
    expect(result.failure).toBe("搜索Slack失败");
    expect(getCapabilityCallSentence(search, { connectionName: "Slack", includeQuery: false }).past).toBe("已搜索Slack");
    expect(getCapabilityCallSentence(part("openwork_get_skill", { name: "Plan My Day" })).past).toBe("已使用技能“Plan My Day”");
    expect(getCapabilityCallSentence(part("openwork_execute_capability", { name: "plugin:fixture:capability" }, { kind: "skill", plugin: "Plan My Day" })).past).toBe("已使用技能“Plan My Day”");
  });

  test("native calendar and connection checks localize nouns while keeping platform names", () => {
    const calendar = part("openwork_execute_capability", { name: "native:fixture:getCapabilitiesGoogleWorkspaceCalendarEvents" });
    expect(getCapabilityCallSentence(calendar).past).toBe("已获取日历事件 · Google Workspace");
    const probe = part("openwork_execute_capability", { name: "mcp:fixture:*" });
    expect(getCapabilityCallSentence(probe, { connectionName: "GitHub" }).present).toBe("正在检查GitHub 连接…");
    expect(getCapabilityCallSentence(probe, { connectionName: "GitHub" }).failure).toBe("检查GitHub 连接失败");
    expect(getCapabilityCallSentence(part("vendor_unrecognized_action")).past).toBe("已使用unrecognized action · Vendor");
  });

  test("catalog, scripts and unknown calls have localized fallback activity", () => {
    expect(getCapabilityCallSentence(part("search")).past).toBe("已检查可用工具");
    expect(getCapabilityCallSentence(part("openwork_search_capabilities", { query: "新连接" })).past).toBe("已搜索可用连接：“新连接”");
    expect(getCapabilityCallSentence(part("openwork_execute_capability_script")).past).toBe("已在 OpenWork Cloud 运行脚本");
    expect(getCapabilityCallSentence(part("openwork_execute_capability", {})).failure).toBe("工具执行失败");
    expect(getCapabilityCallSentence(part("openwork_list_skills")).past).toBe("已查看技能");
  });

  test("plugin kind labels use known static keys and preserve the unknown-kind fallback", () => {
    const call = (kind: string) => part("openwork_execute_capability", { name: "plugin:fixture:capability" }, { kind, plugin: "Example" });
    expect(getCapabilityCallSentence(call("command")).past).toBe("已使用命令“Example”");
    expect(getCapabilityCallSentence(call("mcp")).past).toBe("已使用连接“Example”");
    expect(getCapabilityCallSentence(call("constructor")).past).toBe("已使用插件“Example”");
    setLocale("en");
    expect(getCapabilityCallSentence(call("command")).past).toBe("Used command “Example”");
    expect(getCapabilityCallSentence(call("constructor")).past).toBe("Used plugin “Example”");
  });
});

describe("script summaries do not depend on English labels", () => {
  const options = { running: false, failed: false, serviceName: (call: DynamicToolUIPart) => call.toolName.split("_")[0] ?? null };

  test("recognizes grouped searches before and after switching languages", () => {
    const searches = [part("Slack_search_messages"), part("GitHub_search_issues")];
    expect(codeModeSummary(searches, options)).toBe("已搜索Slack、GitHub");
    setLocale("en");
    expect(codeModeSummary(searches, options)).toBe("Searched Slack and GitHub");
    setLocale("zh");
    expect(codeModeSummary(searches, { ...options, running: true })).toBe("正在搜索Slack、GitHub");
  });

  test("localizes writes, mixed reads, empty and failed scripts", () => {
    expect(codeModeSummary([part("Linear_save_issue", { body: { id: "fixture" } })], options)).toBe("已更新问题 · Linear");
    expect(codeModeSummary([part("Notion_create_note")], options)).toBe("已创建笔记 · Notion");
    expect(codeModeSummary([part("Slack_read_messages"), part("GitHub_list_issues")], options)).toBe("已查询Slack、GitHub");
    expect(codeModeSummary([part("Slack_create_message"), part("GitHub_create_issue")], options)).toBe("已修改Slack、GitHub");
    expect(codeModeSummary([], options)).toBe("已运行脚本");
    expect(codeModeSummary([], { ...options, running: true })).toBe("正在运行脚本");
    expect(codeModeSummary([], { ...options, failed: true })).toBe("脚本运行失败");
  });

  test("running create and update summaries select their existing static translations", () => {
    const running = (toolName: string, input: unknown = {}): DynamicToolUIPart => ({ ...part(toolName, input), state: "input-available" });
    expect(codeModeSummary([running("Linear_save_issue")], { ...options, running: true })).toBe("正在创建问题 · Linear");
    expect(codeModeSummary([running("Linear_save_issue", { body: { id: "fixture" } })], { ...options, running: true })).toBe("正在更新问题 · Linear");
    expect(codeModeSummary([running("Notion_create_document")], { ...options, running: true })).toBe("正在创建文档 · Notion");
    setLocale("en");
    expect(codeModeSummary([running("Linear_save_issue")], { ...options, running: true })).toBe("Creating an issue in Linear");
    expect(codeModeSummary([running("Linear_save_issue", { body: { id: "fixture" } })], { ...options, running: true })).toBe("Updating an issue in Linear");
    expect(codeModeSummary([running("Notion_create_document")], { ...options, running: true })).toBe("Creating a document in Notion");
  });
});
