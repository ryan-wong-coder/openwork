import { z } from "zod";

const imageArgs = z.object({
  prompt: z.string().trim().min(1).max(32_000).describe("图片的完整描述；修改图片时说明需要保留和调整的内容。"),
  filename: z.string().optional().describe("文件名，不含目录；文件会安全保存在当前工作区 artifacts 中。"),
  size: z.enum(["auto", "1024x1024", "1536x1024", "1024x1536"]).optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  referenceImages: z.array(z.string()).max(4).optional().describe("用于编辑或参考的已注册工作区根目录中的图片路径，最多 4 张；路径相对 workspaceRoot，可能不同于当前 worktree 执行目录；省略则生成新图片。"),
});

export const GATEWAY_IMAGE_INSTRUCTION = `When the user needs generated artwork, website imagery, illustrations, or image edits, use openwork_image_generate with the configured gateway. Use referenceImages for revisions of existing workspace images. The tool saves real image files and returns pathBase="workspace-root", workspaceRoot, a root-relative path, and absolutePath. Both path and referenceImages are relative to the registered workspaceRoot, which may differ from the current execution or worktree directory. When writing code in a different directory, use absolutePath or calculate the correct relative path from the code file; never assume the returned path is relative to the current directory. Returned width and height describe the actual image dimensions; requestedSize is only a request preference and does not guarantee output dimensions. Use those files directly in code and render a Markdown image preview for the user. Continue implementing the requested app or document after generating its assets. Never invent an output path or claim image generation succeeded after an error. Do not ask for or inspect API keys; credentials are managed by the host settings. An unconfigured or disabled gateway must be explained using the tool's actual error.`;

export function createGatewayImageTools<Context>(call: (input: Record<string, unknown>, context: Context) => Promise<unknown>) {
  return {
    openwork_image_generate: {
      description: "通过已配置的 ModelHelm 网关生成或编辑图片，保存到当前工作区，返回可直接用于网页、代码和文档的真实图片路径。",
      args: imageArgs.shape,
      async execute(rawArgs: unknown, context: Context) {
        const input = imageArgs.parse(rawArgs);
        return JSON.stringify(await call(input, context), null, 2);
      },
    },
  };
}
