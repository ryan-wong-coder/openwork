import type { EnvService } from "../env-file.js";
import { ApiError } from "../errors.js";
import {
  gatewayRequest, gatewayStatus, parseGatewayInput, parseGatewayModels, publicGatewayConfig,
  readGatewaySettings, saveGatewayConfig, syncGatewayModels, testGatewayConnection,
} from "../gateway-config.js";
import { generateGatewayImage } from "../gateway-images.js";
import { forwardGatewayChat, forwardGatewayMessages } from "../gateway-proxy.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

export function registerGatewayRoutes(options: {
  routes: Route[];
  config: ServerConfig;
  env: EnvService;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  jsonResponse: (data: unknown, status?: number) => Response;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, scope: "collaborator") => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  reload: () => Promise<"reloaded" | "deferred">;
}) {
  const { routes, config, env, readJsonBody, jsonResponse, ensureWritable } = options;
  const privateResponse = (value: unknown) => {
    const response = jsonResponse(value);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  addRoute(routes, "POST", "/gateway/openai/chat/completions", "none", async (ctx) => forwardGatewayChat(config, env, ctx.request));
  addRoute(routes, "POST", "/gateway/openai/messages", "none", async (ctx) => forwardGatewayMessages(config, env, ctx.request));
  addRoute(routes, "GET", "/gateway/status", "client", async () => privateResponse(await gatewayStatus(env, config)));
  addRoute(routes, "GET", "/gateway/config", "host-token", async () => privateResponse(await publicGatewayConfig(env, config)));
  addRoute(routes, "PUT", "/gateway/config", "host-token", async (ctx) => {
    ensureWritable(config);
    await saveGatewayConfig(config, env, await readJsonBody(ctx.request), ctx.request.signal);
    const refresh = await options.reload();
    return privateResponse({ ...await publicGatewayConfig(env, config), refresh });
  });
  for (const method of ["GET", "POST"]) {
    addRoute(routes, method, "/gateway/models", "host-token", async (ctx) => {
      if (method === "GET") {
        const result = await syncGatewayModels(config, env, ctx.request.signal);
        const refresh = result.changed ? await options.reload() : undefined;
        return privateResponse({ models: result.models, syncedAt: result.syncedAt, ...(refresh ? { refresh } : {}) });
      }
      const current = await readGatewaySettings(env);
      const input = method === "POST" ? await readJsonBody(ctx.request) : {};
      const parsed = parseGatewayInput(input, current.settings);
      const models = parseGatewayModels(await gatewayRequest(
        { ...current.settings, ...parsed }, parsed.apiKey ?? current.apiKey,
        "models", {}, ctx.request.signal,
      ));
      return privateResponse({ models, syncedAt: Date.now() });
    });
  }
  addRoute(routes, "POST", "/gateway/test", "host-token", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    if (body.model !== undefined && typeof body.model !== "string") throw new ApiError(400, "gateway_model_invalid", "请选择有效的对话模型。");
    return privateResponse(await testGatewayConnection(env, typeof body.model === "string" ? body.model : undefined, ctx.request.signal));
  });
  addRoute(routes, "POST", "/gateway/images", "client", async (ctx) => {
    options.requireClientScope(ctx, "collaborator");
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const context = body.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context : {};
    const workspaceId = Reflect.get(context, "workspaceId");
    const directory = Reflect.get(context, "directory") ?? Reflect.get(context, "worktree");
    const workspace = typeof workspaceId === "string" && workspaceId
      ? await options.resolveWorkspace(config, workspaceId)
      : config.workspaces.find((item) => item.path === directory);
    if (!workspace) throw new ApiError(404, "workspace_not_found", "找不到图片所属的本地工作区，请在工作区内重试。");
    return privateResponse(await generateGatewayImage(env, workspace, body, ctx.request.signal));
  });
}
