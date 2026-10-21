import { z } from "zod";

export const workspaceAccessArgsSchema = z.object({
  workspaceId: z.string().trim().min(1).max(300),
}).strict();

const workspacesSchema = z.object({ items: z.array(z.object({
  id: z.string(), name: z.string().optional(), displayName: z.string().optional(), path: z.string().min(1),
})) });
const foldersSchema = z.object({
  workspaceRoot: z.string().min(1), folders: z.array(z.string()), hiddenCount: z.number().int().nonnegative(),
});

/** Use the same effective permission read as Settings, without changing access. */
export async function readWorkspaceAccess(raw: unknown, get: (path: string) => Promise<unknown>) {
  const args = workspaceAccessArgsSchema.parse(raw);
  const workspaces = workspacesSchema.parse(await get("/workspaces"));
  const workspace = workspaces.items.find(item => item.id === args.workspaceId);
  if (!workspace) return { ok: false, error: "工作区不存在或当前连接无权访问。" };
  const authorizedFolders = foldersSchema.parse(await get(`/workspace/${encodeURIComponent(workspace.id)}/authorized-folders`));
  return {
    ok: true,
    workspace: { id: workspace.id, name: workspace.displayName ?? workspace.name ?? workspace.id, path: workspace.path },
    authorizedFolders,
    instruction: "路径属于此工作区连接的执行主机。folders 是已显式允许的附加目录；hiddenCount 表示未展开的权限规则，不能据此推断任意文件均可访问。读取文件仍须遵守实际工具权限，修改授权目录需要用户操作。",
  };
}
