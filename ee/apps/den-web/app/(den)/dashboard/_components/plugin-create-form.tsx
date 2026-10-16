"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, FileText, Plus, SquareTerminal, Trash2, Plug } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenTextarea } from "../../_components/ui/textarea";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { LinkButton } from "./item-list";
import { ConnectorLogo } from "./item-logo";
import { libraryQueryKeys } from "./library-data";
import type { ExternalMcpConnection } from "./mcp-connections-data";
import { pluginQueryKeys } from "./plugin-data";

export type PluginComponentKind = "skill" | "command" | "mcp";

export type PluginDraftComponent = {
  key: number;
  kind: PluginComponentKind;
  name: string;
  description: string;
  content: string;
  connectionId: string;
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "component";
}

export function pluginComponentBody(component: PluginDraftComponent): Record<string, unknown> {
  if (component.kind === "mcp") return { type: "mcp", connectionId: component.connectionId };
  const name = component.kind === "command" ? slugify(component.name.replace(/^\//, "")) : component.name.trim();
  const description = component.description.trim() || component.name.trim();
  const rawSourceText = component.kind === "skill"
    ? ["---", `name: ${slugify(component.name)}`, `description: ${description}`, "---", "", component.content.trim(), ""].join("\n")
    : `${component.content.trim()}\n`;
  return {
    type: component.kind,
    input: { rawSourceText, metadata: { name, description: component.description.trim() || undefined } },
  };
}

/** The first problem with a draft, in words a person can act on. */
export function pluginDraftProblem(name: string, components: readonly PluginDraftComponent[]): string | null {
  if (!name.trim()) return "请为插件命名。";
  if (components.length === 0) return "添加技能、命令或连接器。";
  for (const component of components) {
    if (component.kind === "mcp") {
      if (!component.connectionId) return "请选择连接器。";
      continue;
    }
    const noun = component.kind === "skill" ? "技能" : "命令";
    if (!component.name.trim()) return `为${noun}命名。`;
    if (!component.content.trim()) return `描述${noun}应完成的工作。`;
  }
  return null;
}

function ComponentShell({ icon, header, children, onRemove, removeLabel }: {
  icon: ReactNode;
  header: ReactNode;
  children: ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-gray-100 bg-white p-4" data-testid="plugin-component">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-gray-500">{icon}</span>
        <div className="min-w-0 flex-1">{header}</div>
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700">
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}

function ConnectorChoice({ connections, value, takenIds, onChange, addConnectorHref }: {
  connections: readonly ExternalMcpConnection[];
  value: string;
  takenIds: ReadonlySet<string>;
  onChange: (connectionId: string) => void;
  addConnectorHref: string;
}) {
  if (connections.length === 0) {
    return (
      <p className="text-[13px] text-gray-500">
        暂无连接器。 <Link href={addConnectorHref} className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">请先添加</Link>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="连接器">
      {connections.map((connection) => {
        const selected = connection.id === value;
        const taken = takenIds.has(connection.id);
        return (
          <button
            key={connection.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={taken}
            onClick={() => onChange(connection.id)}
            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${selected ? "bg-gray-50" : "hover:bg-gray-50"}`}
          >
            <ConnectorLogo name={connection.name} url={connection.url} />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-gray-900">{connection.name}</span>
            {selected ? <Check className="h-4 w-4 shrink-0 text-gray-900" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * B1 and D2: one form for a member's plugin and an admin's. New plugins start
 * just for their maker; sharing happens on the plugin's page.
 */
export function PluginCreateForm({ connections, startWith, cancelHref, addConnectorHref, onCreated, footnote = "分享前仅供你使用。" }: {
  connections: readonly ExternalMcpConnection[];
  startWith?: PluginComponentKind;
  footnote?: string;
  cancelHref: string;
  addConnectorHref: string;
  onCreated: (pluginId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { runReauthableAction } = useOrgDashboard();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [components, setComponents] = useState<PluginDraftComponent[]>(() => startWith
    ? [{ key: 0, kind: startWith, name: "", description: "", content: "", connectionId: "" }]
    : []);
  const [nextKey, setNextKey] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (kind: PluginComponentKind) => {
    setComponents((current) => [...current, { key: nextKey, kind, name: "", description: "", content: "", connectionId: "" }]);
    setNextKey((value) => value + 1);
  };
  const update = (key: number, patch: Partial<PluginDraftComponent>) => {
    setComponents((current) => current.map((entry) => entry.key === key ? { ...entry, ...patch } : entry));
  };
  const remove = (key: number) => setComponents((current) => current.filter((entry) => entry.key !== key));

  async function create() {
    const problem = pluginDraftProblem(name, components);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let pluginId: string | null = null;
      await runReauthableAction("create-plugin", async () => {
        const { response, payload } = await requestJson("/v1/plugins", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || null,
            components: components.map(pluginComponentBody),
            orgWide: false,
          }),
        }, 20000);
        if (!response.ok) throw getRequestError(payload, response, "插件未创建");
        const item = typeof payload === "object" && payload !== null && "item" in payload ? payload.item : null;
        pluginId = typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" ? item.id : null;
      });
      if (!pluginId) throw new Error("插件已创建，但 OpenWork 无法打开，请刷新后重试。");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: pluginQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: libraryQueryKeys.items }),
      ]);
      onCreated(pluginId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "插件未创建，请重试。");
      setSaving(false);
    }
  }

  const kinds: { kind: PluginComponentKind; label: string }[] = [
    { kind: "skill", label: "技能" },
    { kind: "command", label: "命令" },
    { kind: "mcp", label: "连接器" },
  ];

  return (
    <form
      className="flex flex-col gap-7"
      data-testid="plugin-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-gray-900">插件名称</span>
          <DenInput value={name} onChange={(event) => setName(event.target.value)} placeholder="销售通话准备" disabled={saving} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-gray-900">说明</span>
          <DenInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="帮助成员完成什么工作" disabled={saving} />
        </label>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold leading-5 text-gray-900">包含内容</h2>
          <div className="flex items-center gap-1.5">
            {kinds.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                disabled={saving}
                onClick={() => add(entry.kind)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-100 bg-white px-3 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        {components.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 px-5 py-8 text-center text-[13px] text-gray-500">
            添加技能、命令或连接器。
          </p>
        ) : null}

        {components.map((component) => {
          if (component.kind === "mcp") {
            const takenIds = new Set(components.flatMap((entry) => entry.kind === "mcp" && entry.key !== component.key && entry.connectionId ? [entry.connectionId] : []));
            return (
              <ComponentShell
                key={component.key}
                icon={<Plug className="h-4 w-4" aria-hidden />}
                header={<p className="text-[13px] font-medium text-gray-900">连接器</p>}
                onRemove={() => remove(component.key)}
                removeLabel="移除连接器"
              >
                <div>
                  <ConnectorChoice
                    connections={connections}
                    value={component.connectionId}
                    takenIds={takenIds}
                    onChange={(connectionId) => update(component.key, { connectionId })}
                    addConnectorHref={addConnectorHref}
                  />
                </div>
              </ComponentShell>
            );
          }
          const isSkill = component.kind === "skill";
          return (
            <ComponentShell
              key={component.key}
              icon={isSkill ? <FileText className="h-4 w-4" aria-hidden /> : <SquareTerminal className="h-4 w-4" aria-hidden />}
              onRemove={() => remove(component.key)}
              removeLabel={isSkill ? "移除技能" : "移除命令"}
              header={(
                <input
                  value={component.name}
                  onChange={(event) => update(component.key, { name: event.target.value })}
                  placeholder={isSkill ? "为技能命名，例如“销售通话准备”" : "为命令命名，例如 /follow-up"}
                  aria-label={isSkill ? "技能名称" : "命令名称"}
                  disabled={saving}
                  className="-mx-1 w-full rounded-md bg-transparent px-1 text-[13px] font-medium text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-gray-200"
                />
              )}
            >
              <div className="flex flex-col gap-2">
                <DenInput
                  value={component.description}
                  onChange={(event) => update(component.key, { description: event.target.value })}
                  placeholder={isSkill ? "AI 应在什么情况下使用？" : "用几句话描述用途"}
                  aria-label={isSkill ? "使用时机" : "用途"}
                  disabled={saving}
                />
                <DenTextarea
                  value={component.content}
                  onChange={(event) => update(component.key, { content: event.target.value })}
                  placeholder={isSkill ? "用自然语言编写步骤。" : "描述运行时应执行的操作。"}
                  aria-label={isSkill ? "技能步骤" : "命令步骤"}
                  rows={3}
                  disabled={saving}
                />
              </div>
            </ComponentShell>
          );
        })}
      </section>

      {error ? <p className="text-[13px] text-red-600" role="alert">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-5">
        <p className="text-[12px] leading-4 text-gray-500">{footnote}</p>
        <div className="flex items-center gap-2">
          <LinkButton href={cancelHref}>取消</LinkButton>
          <DenButton type="submit" loading={saving}>创建插件</DenButton>
        </div>
      </div>
    </form>
  );
}
