import { resolve, sep } from "node:path";
import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import { readGatewaySettings } from "../gateway-config.js";
import { generateGatewayImage } from "../gateway-images.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

// Keep the action identity so existing conversations use the configured gateway too.
export const OPENAI_IMAGE_GENERATION_EXTENSION_ID = "openai-image-generation";
export const OPENAI_IMAGE_GENERATION_EXTENSION_ACTIONS = [
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID, action: "status", title: "图片生成状态",
    description: "检查本地模型网关是否已配置并允许生成图片。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID, action: "image_generate", title: "生成或编辑图片",
    description: "通过已配置的 ModelHelm 网关调用 GPT Image，生成真实图片并保存到当前工作区。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "完整图片描述，或需要保留和修改的内容。" },
        filename: { type: "string", description: "可选文件名，图片保存在工作区 artifacts 文件夹。" },
        size: { type: "string", enum: ["auto", "1024x1024", "1536x1024", "1024x1536"] },
        quality: { type: "string", enum: ["auto", "low", "medium", "high"] },
        referenceImages: { type: "array", items: { type: "string" }, maxItems: 4, description: "当前注册工作区中的参考图片路径。" },
      },
      required: ["prompt"], additionalProperties: false,
    },
  },
];

export async function openAiImageGenerationStatus(env: EnvService) {
  const { settings, apiKey } = await readGatewaySettings(env);
  return {
    configured: Boolean(apiKey), connected: Boolean(apiKey) && settings.imageGenerationEnabled,
    model: settings.imageModel, provider: "modelhelm",
    error: !apiKey ? "请先在网关设置中保存 API 密钥。" : settings.imageGenerationEnabled ? null : "图片生成已在网关设置中关闭。",
  };
}

function workspaceForContext(config: ServerConfig, context: Record<string, unknown>): WorkspaceInfo {
  const id = typeof context.workspaceId === "string" ? context.workspaceId : context.workspaceID;
  const directory = typeof context.directory === "string" ? context.directory : context.worktree;
  const workspace = typeof id === "string" && id
    ? config.workspaces.find((entry) => entry.id === id)
    : typeof directory === "string" ? config.workspaces.find((entry) => {
      const root = resolve(entry.path); const candidate = resolve(directory);
      return candidate === root || candidate.startsWith(`${root}${sep}`);
    }) : undefined;
  if (!workspace) throw new ApiError(404, "workspace_not_found", "找不到图片所属的本地工作区，请在工作区内重试。");
  return workspace;
}

export async function callOpenAiImageGenerationExtensionAction(config: ServerConfig, env: EnvService, action: string, args: Record<string, unknown>, context: Record<string, unknown>, signal?: AbortSignal) {
  if (action === "status") return {
    ok: true, extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID, action,
    result: await openAiImageGenerationStatus(env), context,
  };
  if (action !== "image_generate") return null;
  if (config.readOnly) throw new ApiError(403, "read_only", "当前服务为只读模式，无法生成图片。");
  signal?.throwIfAborted();
  const result = await generateGatewayImage(env, workspaceForContext(config, context), args, signal);
  return { ok: true, extensionId: OPENAI_IMAGE_GENERATION_EXTENSION_ID, action, path: result.path, result, context };
}
