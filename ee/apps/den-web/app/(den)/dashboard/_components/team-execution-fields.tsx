"use client";

import { useId, useState } from "react";
import { Globe, Info, Terminal, TriangleAlert, X } from "lucide-react";
import type { DesktopExecutionPolicy } from "@openwork/types/den/desktop-policies";
import { DenButton } from "../../_components/ui/button";
import { validateExecutionPolicy } from "./execution-policy-fields";
import { TeamPermissionGroup, TeamPermissionSelect } from "./team-permission-fields";
import { teamWebsiteSummary } from "./team-permission-state";

export function TeamExecutionFields({ value, onChange, onPendingSiteChange }: {
  value: DesktopExecutionPolicy;
  onChange: (value: DesktopExecutionPolicy) => void;
  onPendingSiteChange: (pending: boolean) => void;
}) {
  const id = useId();
  const [site, setSite] = useState("");
  const [siteError, setSiteError] = useState<string | null>(null);
  const [editingSites, setEditingSites] = useState(false);
  const [commandsText, setCommandsText] = useState(value.blockedCommands.join("\n"));
  const browserMode = value.browserOrigins === undefined ? "all" : value.browserOrigins.length || editingSites ? "approved" : "blocked";
  const commandsAllowed = value.commands === "allow";
  const restrictedBrowser = value.browserOrigins !== undefined || value.blockBrowserUploads;

  function changeSite(text: string) {
    setSite(text);
    setSiteError(null);
    onPendingSiteChange(Boolean(text.trim()));
  }

  function addSite() {
    try {
      const candidate = validateExecutionPolicy({ ...value, browserOrigins: [...(value.browserOrigins ?? []), site.trim()] });
      const origin = candidate.browserOrigins?.at(-1);
      if (origin && value.browserOrigins?.includes(origin)) {
        setSiteError("此网站已获批准。");
        return;
      }
      onChange(candidate);
      changeSite("");
    } catch (error) {
      setSiteError(error instanceof Error ? error.message : "请输入完整网站地址。");
    }
  }

  return <>
    <TeamPermissionGroup title="浏览网站" icon={Globe} defaultOpen status={browserMode === "all" ? "允许" : browserMode === "blocked" || value.browserOrigins?.length === 0 ? "已阻止" : "仅获批网站"} description={value.browserOrigins?.length === 0 ? "未批准任何网站，因此浏览已被阻止" : `${teamWebsiteSummary(value)} · 上传和表单：${value.blockBrowserUploads ? "已阻止" : "已允许"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 py-3">
        <label htmlFor={`${id}-browser`} className="text-sm text-gray-800">网站访问权限</label>
        <select id={`${id}-browser`} value={browserMode} onChange={(event) => {
          changeSite("");
          setEditingSites(event.target.value === "approved");
          if (event.target.value === "all") {
            const { browserOrigins: _origins, ...rest } = value;
            onChange(rest);
          } else onChange({ ...value, browserOrigins: event.target.value === "blocked" ? [] : value.browserOrigins ?? [] });
        }} className="max-w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800">
          <option value="all">所有网站</option><option value="approved">仅获批网站</option><option value="blocked">已阻止</option>
        </select>
      </div>
      {browserMode === "approved" ? <div className="pb-3">
        <ul aria-label="已批准的网站" className="space-y-2">
          {value.browserOrigins?.map((origin) => <li key={origin} className="flex items-center gap-2 rounded-lg border border-gray-200 py-1 pl-3 pr-1">
            <span className="min-w-0 flex-1 break-all text-sm text-gray-700">{origin}</span>
            <DenButton variant="ghost" size="xs" aria-label={`移除 ${origin}`} onClick={() => { setEditingSites(true); setSiteError(null); onChange({ ...value, browserOrigins: value.browserOrigins?.filter((site) => site !== origin) }); }}><X aria-hidden="true" className="h-4 w-4" /></DenButton>
          </li>)}
        </ul>
        <div className="mt-2 flex gap-2">
          <input aria-label="待批准的网站地址" aria-invalid={Boolean(siteError)} aria-describedby={`${id}-site-help${siteError ? ` ${id}-site-error` : ""}`} type="url" placeholder="https://portal.example.com" value={site} onChange={(event) => changeSite(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSite(); } }} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <DenButton variant="secondary" size="sm" disabled={!site.trim()} onClick={addSite}>添加网站</DenButton>
        </div>
        {siteError ? <p id={`${id}-site-error`} role="alert" className="mt-2 text-xs text-red-700">{siteError}</p> : null}
        <p id={`${id}-site-help`} className="mt-2 text-xs leading-5 text-gray-500">仅支持完整网站，登录网站与子域名需单独添加，最多 100 个。 {value.browserOrigins?.length === 0 ? "未批准任何网站，因此浏览已被阻止。" : null}</p>
      </div> : null}
      <TeamPermissionSelect label="上传文件与提交表单" allowed={!value.blockBrowserUploads} onChange={(allowed) => onChange({ ...value, blockBrowserUploads: !allowed })} />
      <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600"><Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ow-warning)]" /><p>适用于内置浏览器。 {value.browserOrigins !== undefined ? "启用网站限制时，独立网页搜索与抓取工具将被阻止。" : ""}这些规则不控制其他应用或第三方连接。</p></div>
      {commandsAllowed && restrictedBrowser ? <div role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--dls-border)] bg-[var(--dls-hover)] p-3 text-xs leading-5 text-[var(--dls-text-primary)]"><TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ow-warning)]" /><div><p>计算机命令仍可访问其他网站并发送数据。</p><DenButton variant="ghost" size="sm" className="mt-1 !px-0 !text-[var(--dls-text-primary)] underline underline-offset-4" onClick={() => onChange({ ...value, commands: "deny" })}>同时阻止计算机命令</DenButton></div></div> : null}
    </TeamPermissionGroup>
    <TeamPermissionGroup title="运行计算机命令" icon={Terminal} status={!commandsAllowed ? "已阻止" : value.blockedCommands.length ? "部分已阻止" : "允许"} description={!commandsAllowed ? "Shell 命令与交互式终端不可用" : value.blockedCommands.length ? "命令模式已生效 · 已保存命令与终端被阻止" : "Shell 命令、已保存命令与交互式终端"}>
      <TeamPermissionSelect label="计算机命令" allowed={commandsAllowed} onChange={(allowed) => onChange({ ...value, commands: allowed ? "allow" : "deny" })} />
      {commandsAllowed ? <details className="mt-2"><summary className="cursor-pointer text-xs text-gray-600">高级：阻止指定命令</summary><label htmlFor={`${id}-patterns`} className="mt-3 block text-sm text-gray-800">已阻止的命令模式</label><textarea id={`${id}-patterns`} rows={3} value={commandsText} onChange={(event) => { setCommandsText(event.target.value); onChange({ ...value, blockedCommands: event.target.value.split("\n").filter((line) => line.trim()) }); }} className="mt-2 w-full rounded-lg border border-gray-200 p-3 text-sm" /><p className="mt-2 text-xs leading-5 text-gray-500">每行一条模式，使用 * 匹配任意文本。模式无法覆盖同一操作的所有执行方式。启用后，已保存命令与交互式终端不可用。</p></details> : null}
    </TeamPermissionGroup>
  </>;
}
