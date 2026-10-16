import type { DynamicToolUIPart, ToolUIPart } from "ai";

export type GatewayImageResult = {
  path: string;
  workspaceId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width?: number;
  height?: number;
};

/** Only the native image tool's local raster artifact is eligible for preview. */
export function gatewayImageResult(part: DynamicToolUIPart | ToolUIPart): GatewayImageResult | null {
  const name = part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
  if (name !== "openwork_image_generate" || part.state !== "output-available") return null;
  let value: unknown = part.output;
  if (typeof value === "string") {
    if (value.length > 64_000) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !("ok" in value) || value.ok !== true
    || !("path" in value) || typeof value.path !== "string" || value.path.length > 512
    || !/^artifacts\/[\p{L}\p{N}_-]+\.(?:png|jpg|jpeg|webp)$/u.test(value.path)
    || !("workspaceId" in value) || typeof value.workspaceId !== "string" || !value.workspaceId.trim()
    || !("mimeType" in value) || (value.mimeType !== "image/png" && value.mimeType !== "image/jpeg" && value.mimeType !== "image/webp")) return null;
  const dimension = (input: unknown) => typeof input === "number" && Number.isInteger(input) && input > 0 && input <= 50_000 ? input : undefined;
  return {
    path: value.path, workspaceId: value.workspaceId, mimeType: value.mimeType,
    width: dimension("width" in value ? value.width : undefined),
    height: dimension("height" in value ? value.height : undefined),
  };
}

export function gatewayImageMatchesWorkspace(result: GatewayImageResult, workspaceId: string) {
  return Boolean(workspaceId) && result.workspaceId === workspaceId;
}
