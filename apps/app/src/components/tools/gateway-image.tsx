import { useEffect, useState } from "react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { ImageIcon, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Image } from "@/components/ui/image";
import { Tool } from "@/components/ui/tool";
import { useOpenArtifactPath } from "@/lib/artifacts";
import type { McpAppOrigin } from "@/components/chat/mcp-app-origin";
import { gatewayImageMatchesWorkspace, gatewayImageResult } from "./gateway-image-result";

export function GatewayImageTool({ part, origin }: { part: DynamicToolUIPart | ToolUIPart; origin: McpAppOrigin }) {
  const result = gatewayImageResult(part);
  const path = result && gatewayImageMatchesWorkspace(result, origin.workspaceId) ? result.path : null;
  const mimeType = result?.mimeType;
  const [preview, setPreview] = useState<{ path: string; url: string; owner: McpAppOrigin } | null>(null);
  const [failed, setFailed] = useState(false);
  const openArtifact = useOpenArtifactPath();

  useEffect(() => {
    if (!path || !mimeType) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setPreview(null);
    setFailed(false);
    // Credentials and workspace authorization stay in the existing file API.
    // The tool's absolutePath and any supplied URL are deliberately ignored.
    void origin.client.downloadWorkspaceFile(origin.workspaceId, path, { sessionId: origin.sessionId ?? undefined }).then((file) => {
      if (cancelled) return;
      if (file.data.byteLength > 36 * 1024 * 1024) throw new Error("图片超过预览大小限制。");
      objectUrl = URL.createObjectURL(new Blob([file.data], { type: mimeType }));
      setPreview({ path, url: objectUrl, owner: origin });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, mimeType, origin.client, origin.workspaceId, origin.sessionId]);

  if (!result || !path) return null;
  const imageUrl = preview?.path === path && preview.owner.client === origin.client
    && preview.owner.workspaceId === origin.workspaceId && preview.owner.sessionId === origin.sessionId ? preview.url : null;
  return <div data-testid="gateway-image-result" data-image-path={path} className="flex w-full flex-col items-start gap-2">
    <Tool toolPart={part} title="图片已生成" className="w-full" />
    {imageUrl && !failed
      ? <Image src={imageUrl} alt="生成的图片" previewMaxHeight={280} previewMaxWidth={420} onError={() => setFailed(true)} className="max-w-full border border-dls-border" />
      : <div role="status" className="flex items-center gap-2 text-xs text-dls-secondary">
        {failed ? <ImageIcon className="size-4" /> : <LoaderCircle className="size-4 motion-safe:animate-spin" />}
        {failed ? "图片预览暂不可用，可打开图片查看。" : "正在加载图片预览…"}
      </div>}
    <div className="flex max-w-full flex-wrap items-center gap-2 text-xs text-dls-secondary">
      <Button variant="ghost" size="xs" onClick={() => openArtifact(path)}><ImageIcon className="size-3.5" />打开图片</Button>
      {result.width && result.height ? <span>{result.width} × {result.height}</span> : null}
      <span className="max-w-full truncate" title={path}>{path.split("/").at(-1)}</span>
    </div>
  </div>;
}
