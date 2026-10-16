"use client";
import { useEffect, useState } from "react";
import { desktopExecutionPolicySchema, type DesktopExecutionPolicy } from "@openwork/types/den/desktop-policies";

export function validateExecutionPolicy(value: DesktopExecutionPolicy): DesktopExecutionPolicy {
  const parsed = desktopExecutionPolicySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (parsed.error.issues.some((issue) => issue.path[0] === "browserOrigins")) throw new Error("输入完整的网站地址，每行一个，不包含路径或登录信息。例如：https://portal.example.com");
  throw new Error("请检查阻止命令模式。最多添加 100 条模式，每条不超过 500 个字符。");
}

export function ExecutionPolicyFields({ value, onChange, disabled }: { value: DesktopExecutionPolicy; onChange: (value: DesktopExecutionPolicy) => void; disabled?: boolean }) {
  const [commandsText, setCommandsText] = useState(value.blockedCommands.join("\n"));
  const [originsText, setOriginsText] = useState(value.browserOrigins?.join("\n") ?? "");
  useEffect(() => {
    setCommandsText((text) => JSON.stringify(text.split("\n").filter((line) => line.trim())) === JSON.stringify(value.blockedCommands) ? text : value.blockedCommands.join("\n"));
    if (value.browserOrigins !== undefined) {
      const origins = value.browserOrigins;
      setOriginsText((text) => JSON.stringify(text.split("\n").filter((line) => line.trim())) === JSON.stringify(origins) ? text : origins.join("\n"));
    }
  }, [value.blockedCommands, value.browserOrigins]);
  return <fieldset disabled={disabled} aria-label="命令与浏览器访问权限" className="rounded-xl border border-gray-200 bg-white">
    <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-900">命令与浏览器</div>
    <div className="space-y-5 p-4">
      <label className="flex items-center justify-between gap-4 text-sm"><span>运行系统命令</span><input aria-label="运行系统命令" type="checkbox" checked={value.commands === "allow"} onChange={(event) => onChange({ ...value, commands: event.target.checked ? "allow" : "deny" })} /></label>
      <label className="block text-sm text-gray-800">已阻止的命令模式<textarea aria-label="已阻止的命令模式" disabled={value.commands === "deny"} className="mt-2 w-full rounded-lg border border-gray-200 p-3 text-sm" rows={2} value={commandsText} onChange={(event) => { setCommandsText(event.target.value); onChange({ ...value, blockedCommands: event.target.value.split("\n").filter((line) => line.trim()) }); }} /></label>
      <p className="text-xs text-gray-500">每行一条模式，使用 * 匹配任意文本。若需完全阻止命令，请在上方关闭系统命令。应用命令限制后，已保存的命令与交互式终端将不可用。</p>
      <label className="flex items-center justify-between gap-4 text-sm"><span>仅允许浏览获批网站</span><input aria-label="仅允许浏览获批网站" type="checkbox" checked={value.browserOrigins !== undefined} onChange={(event) => { if (event.target.checked) onChange({ ...value, browserOrigins: originsText.split("\n").map((line) => line.trim()).filter(Boolean) }); else { const { browserOrigins: _origins, ...rest } = value; onChange(rest); } }} /></label>
      {value.browserOrigins !== undefined ? <label className="block text-sm text-gray-800">已批准的网站<textarea aria-label="已批准的网站" className="mt-2 w-full rounded-lg border border-gray-200 p-3 text-sm" rows={3} placeholder="https://portal.example.com" value={originsText} onChange={(event) => { setOriginsText(event.target.value); onChange({ ...value, browserOrigins: event.target.value.split("\n").filter((line) => line.trim()) }); }} /><span className="mt-1 block text-xs text-gray-500">每行一个完整网站地址，子域名需单独添加。空列表将阻止浏览。请包含所需的登录与资源网站。</span></label> : null}
      <label className="flex items-center justify-between gap-4 text-sm"><span>阻止浏览器上传和提交表单</span><input aria-label="阻止浏览器上传和提交表单" type="checkbox" checked={value.blockBrowserUploads} onChange={(event) => onChange({ ...value, blockBrowserUploads: event.target.checked })} /></label>
      <p className="text-xs text-gray-500">网站规则适用于内置浏览器。设置获批网站后，内置网页抓取和搜索将被阻止。关闭系统命令可防止脚本绕过浏览器限制。这些设置不控制设备上的其他应用。</p>
    </div>
  </fieldset>;
}
