import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { resolveFeature } from "@openwork/features";
import { ApiError } from "./errors.js";
import type { EnvService } from "./env-file.js";
import { gatewayRequest, readGatewaySettings } from "./gateway-config.js";
import type { WorkspaceInfo } from "./types.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function inside(root: string, path: string) {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}
function sameDirectory(original: Stats, current: Stats) {
  return current.isDirectory() && !current.isSymbolicLink() && original.dev === current.dev && original.ino === current.ino;
}
function imageType(bytes: Buffer): { mime: string; extension: string } {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: "image/png", extension: "png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", extension: "webp" };
  throw new ApiError(502, "gateway_image_invalid", "图片数据格式无效，请重试。");
}
function option(input: Record<string, unknown>, name: string, fallback: string, allowed: string[]) {
  const value = input[name] ?? fallback;
  if (typeof value !== "string" || !allowed.includes(value)) throw new ApiError(400, "gateway_image_option_invalid", "请选择支持的图片尺寸或质量。");
  return value;
}

/** Keys stay in the host process; the model only receives local artifact paths. */
export async function generateGatewayImage(env: Pick<EnvService, "list">, workspace: WorkspaceInfo, input: Record<string, unknown>, signal?: AbortSignal) {
  const { settings, apiKey } = await readGatewaySettings(env);
  const enabled = resolveFeature("gatewayImageGeneration", {
    deployment: "self_hosted", locks: { gatewayImageGeneration: Boolean(apiKey) && settings.imageGenerationEnabled }, overrides: {}, rollouts: {},
  }).enabled;
  if (!enabled) throw new ApiError(403, "gateway_images_disabled", "图片生成尚未启用，请先在网关设置中保存密钥并开启图片生成。");
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 32_000) throw new ApiError(400, "gateway_image_prompt_invalid", "请填写不超过 32000 字的图片描述。");
  const size = option(input, "size", settings.imageSize, ["auto", "1024x1024", "1536x1024", "1024x1536"]);
  const quality = option(input, "quality", settings.imageQuality, ["auto", "low", "medium", "high"]);
  const refs = input.referenceImages ?? [];
  if (!Array.isArray(refs) || refs.length > 4 || refs.some((value) => typeof value !== "string" || !value.trim())) throw new ApiError(400, "gateway_image_references_invalid", "最多可使用 4 张本地参考图片。");
  const root = await realpath(workspace.path);
  const artifacts = resolve(root, "artifacts");
  await mkdir(artifacts, { recursive: true });
  const outputDirectory = await realpath(artifacts);
  if (!inside(root, outputDirectory)) throw new ApiError(400, "gateway_image_path_invalid", "图片输出目录必须位于当前工作区内。");
  const [rootIdentity, outputIdentity] = await Promise.all([lstat(root), lstat(outputDirectory)]);
  const ensureOutputDirectory = async () => {
    try {
      const [currentRoot, currentOutput] = await Promise.all([realpath(workspace.path), realpath(artifacts)]);
      if (currentRoot !== root || currentOutput !== outputDirectory || !inside(currentRoot, currentOutput)) throw new Error("changed");
      const [currentRootIdentity, currentOutputIdentity] = await Promise.all([lstat(currentRoot), lstat(currentOutput)]);
      if (!sameDirectory(rootIdentity, currentRootIdentity) || !sameDirectory(outputIdentity, currentOutputIdentity)) throw new Error("changed");
    } catch {
      throw new ApiError(400, "gateway_image_path_changed", "图片生成期间工作区或输出目录发生变化，请重试。");
    }
  };
  let init: RequestInit;
  if (refs.length) {
    const form = new FormData();
    form.set("model", settings.imageModel);
    form.set("prompt", prompt);
    form.set("size", size);
    form.set("quality", quality);
    form.set("n", "1");
    form.set("response_format", "b64_json");
    let total = 0;
    for (const ref of refs) {
      if (typeof ref !== "string") continue;
      const path = await realpath(resolve(root, ref));
      if (!inside(root, path)) throw new ApiError(400, "gateway_image_path_invalid", "参考图片必须位于当前工作区内。");
      const info = await stat(path);
      total += info.size;
      if (!info.isFile() || info.size > 20 * 1024 * 1024 || total > 30 * 1024 * 1024) throw new ApiError(400, "gateway_image_reference_too_large", "单张参考图片不能超过 20 MB，总计不能超过 30 MB。");
      const bytes = await readFile(path);
      form.append("image[]", new Blob([new Uint8Array(bytes)], { type: imageType(bytes).mime }), basename(path));
    }
    init = { method: "POST", body: form };
  } else {
    init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: settings.imageModel, prompt, size, quality, n: 1, response_format: "b64_json" }) };
  }
  const payload = await gatewayRequest(settings, apiKey, refs.length ? "images/edits" : "images/generations", init, signal);
  const data = record(payload) && Array.isArray(payload.data) ? payload.data : [];
  const first = data.find(record);
  const encoded = typeof first?.b64_json === "string" ? first.b64_json.trim() : "";
  if (!encoded || encoded.length > 48 * 1024 * 1024 || !/^[A-Za-z0-9+/\s]*={0,2}$/.test(encoded)) throw new ApiError(502, "gateway_image_missing", "网关未返回有效的图片数据。");
  const bytes = Buffer.from(encoded, "base64");
  const type = imageType(bytes);
  const dimensions = type.mime === "image/png" && bytes.length >= 24
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : {};
  const slug = (typeof input.filename === "string" ? input.filename : "generated-image").replace(/\.[a-z0-9]+$/i, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "generated-image";
  const filename = `${slug}-${randomUUID().slice(0, 8)}.${type.extension}`;
  const absolutePath = resolve(outputDirectory, filename);
  signal?.throwIfAborted();
  await ensureOutputDirectory();
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const output = await open(absolutePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o666);
  try {
    await ensureOutputDirectory();
    signal?.throwIfAborted();
    await output.writeFile(bytes, { signal });
  } finally { await output.close(); }
  const path = relative(root, absolutePath).split(sep).join("/");
  return { ok: true, path, pathBase: "workspace-root", workspaceRoot: root, absolutePath, bytes: bytes.byteLength, mimeType: type.mime, ...dimensions, requestedSize: size, model: settings.imageModel, workspaceId: workspace.id, revisedPrompt: typeof first?.revised_prompt === "string" ? first.revised_prompt : undefined };
}
