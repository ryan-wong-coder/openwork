"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, FileText, Plus, Server, Terminal, Trash2 } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenSelect } from "../../_components/ui/select";
import { DenTextarea } from "../../_components/ui/textarea";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import { getImportPluginRoute, getMcpConnectionsRoute, getPluginRoute, getPluginsRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { IntegrationIcon } from "./integration-icon";
import { useMarketplaces } from "./marketplace-data";
import { type ExternalMcpConnection, useMcpConnections } from "./mcp-connections-data";
import { pluginQueryKeys } from "./plugin-data";
import {
  clearPluginImportDraft,
  loadPluginImportDraft,
  pluginImportSourceLabel,
  pluginImportSuggestedName,
  type PluginImportDraft,
} from "./plugin-import-draft";

type ComponentKind = "skill" | "command" | "mcp";

type DraftComponent = {
  key: number;
  kind: ComponentKind;
  name: string;
  description: string;
  /** Markdown body for skills/commands. */
  content: string;
  /** Existing organization connector selected for MCP; unused for skills and commands. */
  connectionId: string;
};

const COMPONENT_META: Record<ComponentKind, { label: string; icon: typeof FileText; hint: string }> = {
  skill: {
    label: "技能",
    icon: FileText,
    hint: "任务匹配时，代理将加载这些逐步说明。请按操作手册的方式编写。",
  },
  command: {
    label: "命令",
    icon: Terminal,
    hint: "可重复使用的斜杠命令，请明确描述代理运行时应执行的操作。",
  },
  mcp: {
    label: "连接器",
    icon: Server,
    hint: "选择组织连接器，成员安装插件后将获得其工具，登录与访问权限仍在“连接器”中管理。",
  },
};
const COMPONENT_KINDS: ComponentKind[] = ["skill", "command", "mcp"];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "component";
}

function buildSkillMarkdown(component: DraftComponent): string {
  const name = slugify(component.name);
  const description = component.description.trim() || component.name.trim();
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    component.content.trim(),
    "",
  ].join("\n");
}

function buildComponentBody(component: DraftComponent): Record<string, unknown> {
  if (component.kind === "mcp") {
    return {
      type: "mcp",
      connectionId: component.connectionId,
    };
  }

  return {
    type: component.kind,
    input: {
      rawSourceText:
        component.kind === "skill" ? buildSkillMarkdown(component) : `${component.content.trim()}\n`,
      metadata: {
        name: component.name.trim(),
        description: component.description.trim() || undefined,
      },
    },
  };
}

async function postJson(path: string, body: unknown, failureLabel: string): Promise<unknown> {
  const { response, payload } = await requestJson(
    path,
    { method: "POST", body: JSON.stringify(body) },
    20000,
  );
  if (!response.ok) {
    throw getRequestError(payload, response, `${failureLabel} (${response.status}).`);
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createdItemId(payload: unknown): string | null {
  const item = isRecord(payload) && isRecord(payload.item) ? payload.item : null;
  return typeof item?.id === "string" ? item.id : null;
}

function connectorAuthDescription(connection: ExternalMcpConnection): string {
  let description: string;
  if (connection.authType === "oauth") {
    description = connection.credentialMode === "per_member"
      ? "每名成员使用自己的账户登录"
      : "一个组织共享账户";
  } else if (connection.authType === "apikey") {
    description = "组织 API 密钥";
  } else {
    description = "无需登录";
  }
  return !connection.connected && connection.credentialMode === "shared"
    ? `${description} · 尚未连接`
    : description;
}

function ConnectorPicker({
  connections,
  loading,
  value,
  takenIds,
  disabled,
  orgSlug,
  onChange,
}: {
  connections: ExternalMcpConnection[];
  loading: boolean;
  value: string;
  takenIds: Set<string>;
  disabled: boolean;
  orgSlug: string | null;
  onChange: (connectionId: string) => void;
}) {
  if (loading) {
    return <p className="text-[13px] text-gray-500">正在加载连接器…</p>;
  }

  if (connections.length === 0) {
    return (
      <p className="text-[13px] text-gray-500">
        暂无连接器。{" "}
        <Link href={getMcpConnectionsRoute(orgSlug)} className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">
          添加连接器
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {connections.map((connection) => {
          const selected = value === connection.id;
          const taken = takenIds.has(connection.id);
          return (
            <button
              key={connection.id}
              type="button"
              data-testid={`plugin-connector-option-${connection.id}`}
              aria-pressed={selected}
              disabled={disabled || taken}
              onClick={() => onChange(connection.id)}
              className={selected
                ? "flex w-full items-center gap-3 rounded-2xl border border-[var(--dls-border)] bg-[var(--dls-active)] px-4 py-3 text-left"
                : "flex w-full items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3 text-left transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"}
            >
              <IntegrationIcon
                name={connection.name}
                serviceUrl={connection.url}
                className="size-9 rounded-xl"
                imageClassName="size-4"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-gray-900">{connection.name}</span>
                <span className="block text-[12px] text-gray-500">
                  {taken ? "已在此插件中" : connectorAuthDescription(connection)}
                </span>
              </span>
              {selected ? <Check size={16} className="shrink-0 text-gray-900" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-gray-500">
        需要其他服务？{" "}
        <Link href={getMcpConnectionsRoute(orgSlug)} className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">
          添加连接器
        </Link>
      </p>
    </div>
  );
}

export function PluginEditorScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { orgContext, orgSlug, runReauthableAction } = useOrgDashboard();
  const { data: marketplaces = [] } = useMarketplaces();
  const { data: allConnections = [], isLoading: connectionsLoading } = useMcpConnections("manageable");
  const connections = allConnections.filter((connection) => !connection.nativeProviderKey);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [components, setComponents] = useState<DraftComponent[]>(() => searchParams.get("component") === "skill"
    ? [{ key: 0, kind: "skill", name: "", description: "", content: "", connectionId: "" }]
    : []);
  const [nextKey, setNextKey] = useState(1);
  const [marketplaceId, setMarketplaceId] = useState<string>("");
  const [marketplaceTouched, setMarketplaceTouched] = useState(false);
  const [shareOrgWide, setShareOrgWide] = useState(true);
  const [importDraft, setImportDraft] = useState<PluginImportDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Publishing is the happy path for non-technical creators: pre-select the
  // requested marketplace, or the first marketplace when opened elsewhere.
  useEffect(() => {
    if (marketplaceTouched || marketplaceId || marketplaces.length === 0) return;
    const requestedMarketplaceId = searchParams.get("marketplaceId");
    const requestedMarketplace = marketplaces.find((marketplace) => marketplace.id === requestedMarketplaceId);
    setMarketplaceId(requestedMarketplace?.id ?? marketplaces[0].id);
  }, [marketplaceId, marketplaceTouched, marketplaces, searchParams]);

  useEffect(() => {
    const draft = loadPluginImportDraft();
    if (!draft) return;
    setImportDraft(draft);
    setName((current) => current || pluginImportSuggestedName(draft.preview));
  }, []);

  const addComponent = (kind: ComponentKind) => {
    setComponents((current) => [
      ...current,
      { key: nextKey, kind, name: "", description: "", content: "", connectionId: "" },
    ]);
    setNextKey((value) => value + 1);
  };

  const updateComponent = (key: number, patch: Partial<DraftComponent>) => {
    setComponents((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    );
  };

  const removeComponent = (key: number) => {
    setComponents((current) => current.filter((entry) => entry.key !== key));
  };

  async function createImportedPlugin(draft: PluginImportDraft) {
    if (!shareOrgWide && !orgContext) {
      setSaveError("组织成员信息仍在加载，请稍后重试。");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let pluginId: string | null = null;
      await runReauthableAction("create-imported-plugin", async () => {
        const result = await requestJson(
          "/v1/plugins/import-mcps-from-github-url",
          {
            method: "POST",
            body: JSON.stringify({
              access: {
                orgWide: shareOrgWide,
                memberIds: shareOrgWide || !orgContext ? [] : [orgContext.currentMember.id],
                teamIds: [],
              },
              authType: draft.authType,
              credentialMode: draft.credentialMode,
              description: description.trim() || null,
              githubUrl: draft.githubUrl,
              marketplaceId: marketplaceId || undefined,
              name: name.trim(),
              selectedSkillKeys: draft.selectedSkillKeys,
              selectedServerKeys: draft.selectedServerKeys,
            }),
          },
          30000,
        );
        if (!result.response.ok) {
          throw getRequestError(result.payload, result.response, "无法创建导入的插件，请重试。");
        }
        const item = isRecord(result.payload) && isRecord(result.payload.item) ? result.payload.item : null;
        const plugin = item && isRecord(item.plugin) ? item.plugin : null;
        pluginId = plugin && typeof plugin.id === "string" ? plugin.id : null;
      });
      if (!pluginId) throw new Error("插件已创建，但未返回 ID，请刷新后重试。");

      clearPluginImportDraft();
      await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.all });
      router.push(getPluginRoute(orgSlug, pluginId));
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "无法创建导入的插件，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function createPlugin() {
    if (!name.trim()) {
      setSaveError("请为插件命名。");
      return;
    }
    if (importDraft) {
      await createImportedPlugin(importDraft);
      return;
    }
    if (components.length === 0) {
      setSaveError("请至少添加一个技能、命令或连接器。");
      return;
    }
    for (const component of components) {
      if (component.kind === "mcp") {
        if (!component.connectionId) {
          setSaveError("请为插件选择连接器。");
          return;
        }
        continue;
      }
      if (!component.name.trim()) {
        setSaveError(`每个${COMPONENT_META[component.kind].label.toLowerCase()}都需要名称。`);
        return;
      }
      if (!component.content.trim()) {
        setSaveError(`为“${component.name || "你的组件"}”编写说明。`);
        return;
      }
    }

    setSaving(true);
    setSaveError(null);
    try {
      let pluginPayload: unknown = null;
      await runReauthableAction("create-plugin", async () => {
        pluginPayload = await postJson(
          "/v1/plugins",
          {
            name: name.trim(),
            description: description.trim() || null,
            components: components.map(buildComponentBody),
            orgWide: shareOrgWide,
            marketplaceId: marketplaceId || undefined,
          },
          "创建插件失败",
        );
      });
      const pluginId = createdItemId(pluginPayload);
      if (!pluginId) throw new Error("插件已创建，但未返回 ID，请刷新后重试。");

      await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.all });
      router.push(getPluginRoute(orgSlug, pluginId));
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "创建插件失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  const importedSkills = importDraft
    ? importDraft.preview.skills.filter((skill) => importDraft.selectedSkillKeys.includes(skill.skillKey))
    : [];
  const importedServers = importDraft
    ? importDraft.preview.servers.filter((server) => importDraft.selectedServerKeys.includes(server.serverKey))
    : [];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href={getPluginsRoute(orgSlug)}
        className="mb-6 inline-flex items-center gap-2 text-[14px] text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft size={15} />
        返回插件
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold text-gray-900">创建插件</h1>
          <p className="mt-1 text-[15px] text-gray-500">
            将技能、命令与连接器打包，供团队在 OpenWork 中一键安装。
          </p>
        </div>
        <Link
          href={getImportPluginRoute(orgSlug)}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <Download size={14} />
          {importDraft ? "更改导入" : "从 GitHub 导入"}
        </Link>
      </div>

      <div className="mt-8 flex flex-col gap-5 rounded-[24px] border border-gray-200 bg-white p-6">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-gray-700">插件名称</label>
          <DenInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：销售通话准备"
            disabled={saving}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-gray-700">说明</label>
          <DenTextarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="此插件可以帮助用户做什么？"
            rows={2}
            disabled={saving}
          />
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-gray-900">包含内容</h2>
          {!importDraft ? <div className="flex gap-2">
            {COMPONENT_KINDS.map((kind) => {
              const meta = COMPONENT_META[kind];
              return (
                <DenButton
                  key={kind}
                  variant="secondary"
                  size="sm"
                  onClick={() => addComponent(kind)}
                  disabled={saving}
                >
                  <Plus size={14} />
                  {meta.label}
                </DenButton>
              );
            })}
          </div> : null}
        </div>

        {importDraft ? (
          <div className="mt-4 overflow-hidden rounded-[24px] border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">从 GitHub 导入</p>
                <p className="mt-1 truncate text-[14px] font-medium text-gray-900">{pluginImportSourceLabel(importDraft.preview)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[13px] font-medium">
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-900"
                  onClick={() => {
                    clearPluginImportDraft();
                    setImportDraft(null);
                  }}
                >
                  放弃
                </button>
                <Link href={getImportPluginRoute(orgSlug)} className="text-gray-600 hover:text-gray-900">
                  更改导入
                </Link>
              </div>
            </div>
            {[...importedSkills.map((skill) => ({ key: `skill:${skill.skillKey}`, label: "技能", name: skill.name, Icon: FileText })),
              ...importedServers.map((server) => ({ key: `mcp:${server.serverKey}`, label: "MCP 服务器", name: server.name, Icon: Server }))]
              .map((item) => (
                <div key={item.key} className="flex items-center gap-3 border-b border-gray-100 px-5 py-3 last:border-b-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-500">
                    <item.Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-gray-900">{item.name}</span>
                    <span className="block text-[12px] text-gray-500">{item.label}</span>
                  </span>
                </div>
              ))}
          </div>
        ) : components.length === 0 ? (
          <div className="mt-4 rounded-[24px] border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center text-[14px] text-gray-500">
            添加技能、命令或连接器以开始，插件至少需要一个组件。
          </div>
        ) : null}

        {!importDraft ? <div className="mt-4 flex flex-col gap-4">
          {components.map((component) => {
            const meta = COMPONENT_META[component.kind];
            const Icon = meta.icon;
            const takenIds = new Set(
              components.flatMap((entry) =>
                entry.kind === "mcp" && entry.key !== component.key && entry.connectionId
                  ? [entry.connectionId]
                  : [],
              ),
            );
            return (
              <div key={component.key} className="rounded-[24px] border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[14px] font-medium text-gray-900">
                    <Icon size={16} className="text-gray-500" />
                    {meta.label}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComponent(component.key)}
                    disabled={saving}
                    className="text-gray-400 hover:text-red-600"
                    aria-label={`移除 ${meta.label.toLowerCase()}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <p className="mb-4 text-[13px] text-gray-500">{meta.hint}</p>
                <div className="flex flex-col gap-3">
                  {component.kind === "mcp" ? (
                    <ConnectorPicker
                      connections={connections}
                      loading={connectionsLoading}
                      value={component.connectionId}
                      takenIds={takenIds}
                      disabled={saving}
                      orgSlug={orgSlug}
                      onChange={(connectionId) => updateComponent(component.key, { connectionId })}
                    />
                  ) : (
                    <>
                      <DenInput
                        value={component.name}
                        onChange={(event) => updateComponent(component.key, { name: event.target.value })}
                        placeholder="名称，例如“销售通话准备”"
                        disabled={saving}
                      />
                      <DenInput
                        value={component.description}
                        onChange={(event) => updateComponent(component.key, { description: event.target.value })}
                        placeholder="一句话描述：智能体应在何时使用此组件？"
                        disabled={saving}
                      />
                      <DenTextarea
                        value={component.content}
                        onChange={(event) => updateComponent(component.key, { content: event.target.value })}
                        placeholder={
                          component.kind === "skill"
                            ? "使用 Markdown 编写代理应遵循的说明…"
                            : "编写用户运行此命令时需要执行的操作…"
                        }
                        rows={8}
                        disabled={saving}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div> : null}
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-[24px] border border-gray-200 bg-white p-6">
        <h2 className="text-[18px] font-semibold text-gray-900">分享</h2>
        <label className="flex items-start gap-3 text-[14px] text-gray-700">
          <input
            type="checkbox"
            checked={shareOrgWide}
            onChange={(event) => setShareOrgWide(event.target.checked)}
            disabled={saving}
            className="mt-0.5"
          />
          <span>
            分享给组织中的所有人
            <span className="block text-[13px] text-gray-500">
              成员可查看并安装此插件，取消勾选可在完善期间仅自己使用。
            </span>
          </span>
        </label>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-gray-700">合集</label>
          <DenSelect
            value={marketplaceId}
            onChange={(event) => {
              setMarketplaceTouched(true);
              setMarketplaceId(event.target.value);
            }}
            disabled={saving}
          >
            <option value="">暂不发布</option>
            {marketplaces.map((marketplace) => (
              <option key={marketplace.id} value={marketplace.id}>
                {marketplace.name}
              </option>
            ))}
          </DenSelect>
          <p className="mt-1.5 text-[13px] text-gray-500">
            发布后插件会显示在合集中，成员可在 OpenWork 应用中找到它。
          </p>
        </div>
      </div>

      {saveError ? (
        <div className="mt-4 rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {saveError}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <DenButton onClick={() => void createPlugin()} disabled={saving}>
          {saving ? "正在创建…" : "创建插件"}
        </DenButton>
        <Link
          href={getPluginsRoute(orgSlug)}
          onClick={() => clearPluginImportDraft()}
          className="text-[14px] text-gray-500 hover:text-gray-900"
        >
          取消
        </Link>
      </div>
    </div>
  );
}
