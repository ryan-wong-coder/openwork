"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { getNewPluginSkillRoute, getOrgAccessFlags, getPluginSkillRoute, getPluginsRoute } from "../../_lib/den-org";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenTextarea } from "../../_components/ui/textarea";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  type DenPlugin,
  type PluginHook,
  type PluginMcp,
  type PluginWorkflow,
  type PluginAgent,
  type PluginCommand,
  formatPluginTimestamp,
  useArchivePlugin,
  useAttachWorkflowToPlugin,
  usePlugin,
  useUpdatePlugin,
} from "./plugin-data";
import { ItemHeader, SectionTitle } from "./item-header";
import { DetailRows, ItemMenu, ItemPanel, ItemRow, removeEntry } from "./item-list";
import { ConnectorLogo, KindTile, PluginLogo } from "./item-logo";
import { skillTitle } from "./plugin-page-screen";
import { usePluginAccess } from "./plugin-access-data";
import { PluginAccessSection } from "./plugin-access-section";
import { WorkflowDetailPanel } from "./workflow-detail-panel";
import { useLibrary, type LibraryWorkflowItem } from "./library-data";

export function PluginDetailScreen({
  pluginId,
  backHref,
}: {
  pluginId: string;
  backHref?: string;
}) {
  const router = useRouter();
  const { orgContext, orgSlug } = useOrgDashboard();
  const { data: plugin, isLoading, error, refetch } = usePlugin(pluginId);
  const pluginAccessQuery = usePluginAccess(pluginId);
  const archivePlugin = useArchivePlugin();
  const attachWorkflow = useAttachWorkflowToPlugin(pluginId);
  const libraryQuery = useLibrary();
  const [editPlugin, setEditPlugin] = useState<{ name: string; description: string } | null>(null);
  const [addWorkflowOpen, setAddWorkflowOpen] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.currentMember.permissions,
  );

  if (isLoading && !plugin) {
    return (
      <div className="mx-auto max-w-[860px] px-6 py-8 md:px-8">
        <div className="rounded-2xl border border-gray-100 bg-white px-5 py-8 text-[13px] text-gray-400">
          正在加载插件详情…
        </div>
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="mx-auto max-w-[860px] px-6 py-8 md:px-8">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3.5 text-[13px] text-red-600">
          {error instanceof Error ? error.message : "未找到此插件。"}
        </div>
      </div>
    );
  }

  if (selectedWorkflowId) {
    return (
      <div className="mx-auto max-w-[1180px] px-6 py-8 md:px-8">
        <WorkflowDetailPanel configObjectId={selectedWorkflowId} onClose={() => setSelectedWorkflowId(null)} />
      </div>
    );
  }

  const libraryItem = libraryQuery.data?.find((item) => item.type === "plugin" && item.id === plugin.id);
  // Creator, a manager on this plugin, or `sharing.manage_all` (manager on everything shared).
  const canManagePlugin = (plugin.createdByOrgMembershipId !== null && plugin.createdByOrgMembershipId === orgContext?.currentMember.id)
    || (libraryItem?.type === "plugin" && libraryItem.role === "manager")
    || access.canManageAllShared;
  const creator = orgContext?.members.find((member) => member.id === plugin.createdByOrgMembershipId) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[896px] flex-col gap-7 px-6 py-10 md:px-12">
      <ItemHeader compact back={{ href: backHref ?? getPluginsRoute(orgSlug), label: "插件" }} logo={<PluginLogo name={plugin.name} size="lg" />} title={plugin.name} actions={canManagePlugin ? <ItemMenu size="md" label={`${plugin.name} 的更多操作`} entries={[
        { label: "编辑", onSelect: () => setEditPlugin({ name: plugin.name, description: plugin.description }) },
        removeEntry(plugin.name, async () => { await archivePlugin.mutateAsync(pluginId); router.push(getPluginsRoute(orgSlug)); router.refresh(); }),
      ]} /> : undefined} />
      <DetailRows rows={[
        ...(plugin.description ? [{ label: "关于", value: plugin.description, wrap: true }] : []),
        { label: "创建者", value: creator?.user.name ?? "你的组织" },
        { label: "已更新", value: formatPluginTimestamp(plugin.updatedAt) },
        ...(plugin.version ? [{ label: "版本", value: plugin.version }] : []),
      ]} />

      <div className="flex flex-col gap-6">
        <PluginAccessSection
          pluginId={plugin.id}
          pluginCreatedByOrgMembershipId={plugin.createdByOrgMembershipId}
          grants={pluginAccessQuery.data ?? []}
          isLoading={pluginAccessQuery.isLoading}
          error={pluginAccessQuery.error}
        />
        <SkillsSection orgSlug={orgSlug} plugin={plugin} canEdit={canManagePlugin} />
        <WorkflowsSection
          plugin={plugin}
          canEdit={canManagePlugin}
          onAdd={() => {
            attachWorkflow.reset();
            setAddWorkflowOpen(true);
          }}
          onOpen={(workflowId) => setSelectedWorkflowId(workflowId)}
        />
        <PrimitiveSection label="智能体" items={plugin.agents} render={renderAgentRow} />
        <PrimitiveSection label="命令" items={plugin.commands} render={renderCommandRow} />
        <PrimitiveSection label="钩子" items={plugin.hooks} render={renderHookRow} />
        <PrimitiveSection label="MCP 服务器" items={plugin.mcps} render={renderMcpRow} />
      </div>

      {editPlugin ? (
        <EditPluginDialog
          pluginId={plugin.id}
          initialName={editPlugin.name}
          initialDescription={editPlugin.description}
          onClose={() => setEditPlugin(null)}
          onSaved={() => {
            setEditPlugin(null);
            void refetch();
          }}
        />
      ) : null}
      <AddWorkflowDialog
        open={addWorkflowOpen}
        plugin={plugin}
        workflows={(libraryQuery.data ?? []).filter((item): item is LibraryWorkflowItem => item.type === "workflow")}
        busy={attachWorkflow.isPending}
        error={attachWorkflow.error}
        onClose={() => {
          if (!attachWorkflow.isPending) setAddWorkflowOpen(false);
        }}
        onAttach={(workflowId) => {
          void attachWorkflow.mutateAsync(workflowId).then(() => setAddWorkflowOpen(false)).catch(() => undefined);
        }}
      />
    </div>
  );
}

function EditPluginDialog({
  pluginId,
  initialName,
  initialDescription,
  onClose,
  onSaved,
}: {
  pluginId: string;
  initialName: string;
  initialDescription: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updatePlugin = useUpdatePlugin();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const unchanged = trimmedName === initialName && trimmedDescription === initialDescription;

  async function handleSave() {
    try {
      await updatePlugin.mutateAsync({
        pluginId,
        name: trimmedName,
        description: trimmedDescription || null,
      });
      onSaved();
    } catch {
      // The mutation error is rendered in the dialog.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={updatePlugin.isPending ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-plugin-title"
        className="w-full max-w-[440px] rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="edit-plugin-title" className="text-[16px] font-semibold tracking-[-0.01em] text-gray-950">
          编辑插件
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-500">
          更新 Den 中显示的名称与描述。
        </p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[12px] font-medium text-gray-700">名称</span>
          <DenInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={updatePlugin.isPending}
            data-testid="plugin-edit-name"
            autoFocus
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-medium text-gray-700">描述（可选）</span>
          <DenTextarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={updatePlugin.isPending}
            rows={3}
            data-testid="plugin-edit-description"
          />
        </label>
        {updatePlugin.error ? (
          <p className="mt-3 text-[12.5px] text-red-600">
            {updatePlugin.error instanceof Error ? updatePlugin.error.message : "更新插件失败，请重试。"}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <DenButton variant="secondary" onClick={onClose} disabled={updatePlugin.isPending}>
            取消
          </DenButton>
          <DenButton
            loading={updatePlugin.isPending}
            disabled={!trimmedName || unchanged}
            onClick={() => void handleSave()}
            data-testid="plugin-edit-save"
          >
            保存更改
          </DenButton>
        </div>
      </div>
    </div>
  );
}

function PrimitiveSection<T>({
  label,
  items,
  render,
}: {
  label: string;
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  if (items.length === 0) {
    return null;
  }
  return <section className="flex flex-col gap-3"><SectionTitle title={label} /><ItemPanel>{items.map((item) => render(item))}</ItemPanel></section>;

}

function SkillsSection({ orgSlug, plugin, canEdit }: { orgSlug: string | null; plugin: DenPlugin; canEdit: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3"><SectionTitle title="技能" />{canEdit ? <DenButton size="sm" href={getNewPluginSkillRoute(orgSlug, plugin.id)} icon={Plus}>添加技能</DenButton> : null}</div>
      <ItemPanel>
        {plugin.skills.length === 0 ? <p className="px-3 py-4 text-[13px] text-[var(--dls-text-secondary)]">暂无技能。</p> : plugin.skills.map((skill) => <ItemRow compact key={skill.id} logo={<KindTile kind="skill" />} title={skillTitle(skill.name)} description={skill.description} href={canEdit ? getPluginSkillRoute(orgSlug, plugin.id, skill.id) : undefined} />)}
      </ItemPanel>
    </section>
  );
}

function renderHookRow(hook: PluginHook) {
  return <div key={hook.id}><ItemRow compact title={hook.event} description={hook.description} />{hook.matcher ? <details className="px-3 pb-3 text-[13px] text-[var(--dls-text-secondary)]"><summary>技术详情</summary><DetailRows rows={[{ label: "匹配条件", value: hook.matcher, wrap: true }]} /></details> : null}</div>;
}

function renderMcpRow(mcp: PluginMcp) {
  return <div key={mcp.id}><ItemRow compact logo={<ConnectorLogo name={mcp.name} url={mcp.url} />} title={mcp.name} description={mcp.description} /><details className="px-3 pb-3 text-[13px] text-[var(--dls-text-secondary)]"><summary>技术详情</summary><DetailRows rows={[{ label: "传输方式", value: mcp.transport }, { label: "工具", value: mcp.toolCount }]} /></details></div>;
}

function renderAgentRow(agent: PluginAgent) {
  return <ItemRow compact key={agent.id} logo={<PluginLogo name={agent.name} />} title={agent.name} description={agent.description} />;
}

function renderCommandRow(command: PluginCommand) {
  return <ItemRow compact key={command.id} logo={<KindTile kind="command" />} title={command.name} description={command.description} />;
}

function WorkflowsSection({
  plugin,
  canEdit,
  onAdd,
  onOpen,
}: {
  plugin: DenPlugin;
  canEdit: boolean;
  onAdd: () => void;
  onOpen: (workflowId: string) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle title="工作流" />
        {canEdit ? (
          <DenButton size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5" aria-hidden />添加工作流</DenButton>
        ) : null}
      </div>
      {plugin.workflows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-5 py-8 text-center">
          <p className="text-[14px] font-medium text-gray-900">此插件暂无工作流。</p>
          <p className="mt-1 text-[12.5px] text-gray-500">从成功的代码模式运行中创建工作流并选择此插件，或添加已有工作流。</p>
        </div>
      ) : (
        <div className="grid gap-2">{plugin.workflows.map((workflow) => renderWorkflowRow(workflow, () => onOpen(workflow.id)))}</div>
      )}
    </section>
  );
}

function AddWorkflowDialog({
  open,
  plugin,
  workflows,
  busy,
  error,
  onClose,
  onAttach,
}: {
  open: boolean;
  plugin: DenPlugin;
  workflows: LibraryWorkflowItem[];
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onAttach: (workflowId: string) => void;
}) {
  const existing = new Set(plugin.workflows.map((workflow) => workflow.id));
  const available = workflows.filter((workflow) => !existing.has(workflow.id) && workflow.role === "manager");
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-workflow-title" className="w-full max-w-[520px] rounded-2xl border border-gray-100 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.4)]" onClick={(event) => event.stopPropagation()}>
        <h2 id="add-workflow-title" className="text-[16px] font-semibold tracking-[-0.01em] text-gray-950">添加工作流到 {plugin.name}</h2>
        <p className="mt-1 text-[13px] leading-6 text-gray-500">此插件中的工作流与插件本身具有相同的人员和团队可见范围，包括集合受众。</p>
        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {available.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-[13px] text-gray-500">没有可添加的、由你管理的未关联工作流。请从成功的代码模式运行中创建，并在保存时选择此插件。</div>
          ) : available.map((workflow) => (
            <button key={workflow.id} type="button" disabled={busy} onClick={() => onAttach(workflow.id)} className="w-full rounded-xl border border-gray-100 px-4 py-3 text-left transition hover:border-gray-200 hover:bg-gray-50 disabled:opacity-60">
              <p className="text-[14px] font-semibold text-gray-900">{workflow.name}</p>
              <p className="mt-0.5 text-[12.5px] text-gray-500">{workflow.plugin ? `当前位于 ${workflow.plugin.name}` : "直接共享"}{workflow.description ? ` · ${workflow.description}` : ""}</p>
            </button>
          ))}
        </div>
        {error ? <p className="mt-3 text-[12.5px] text-red-600">{error instanceof Error ? error.message : "添加工作流失败，请重试。"}</p> : null}
        <div className="mt-5 flex justify-end"><DenButton variant="secondary" onClick={onClose} disabled={busy}>关闭</DenButton></div>
      </div>
    </div>
  );
}

function renderWorkflowRow(workflow: PluginWorkflow, onOpen: () => void) {
  return (
    <button
      key={workflow.id}
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-gray-100 bg-white px-4 py-3 text-left transition hover:border-gray-200 hover:bg-gray-50"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-gray-900">{workflow.name}</p>
        <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
          {workflow.requiredCapabilityCount} 项只读能力
        </span>
      </div>
      {workflow.description ? (
        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.55] text-gray-500">{workflow.description}</p>
      ) : null}
      <p className="mt-2 text-[11px] text-gray-400">
        {workflow.versionId ? `当前版本 ${workflow.versionId.slice(0, 8)}` : "尚无已发布版本"}
        {workflow.outputSchema ? " · 已验证输出" : ""}
      </p>
    </button>
  );
}

export type { DenPlugin };
