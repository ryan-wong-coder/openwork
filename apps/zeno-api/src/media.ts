import { constants } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { personalMediaMimeSchema, personalMediaLimit, validatePersonalMedia } from "@zeno/core/media";
import type { ZenoDatabase } from "./database";
import { digest } from "./crypto";
import { HttpError } from "./errors";
import { readBody } from "./http";

const mimeSchema = personalMediaMimeSchema;
const mediaRow = z.object({ id: z.string(), storage_key: z.string().regex(/^[a-f0-9-]{36}\.(?:jpg|png|webp|gif|mp4|webm)$/), mime_type: mimeSchema, bytes: z.number().int().positive(), sha256: z.string(), created_at: z.number() });
function webmHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || !Buffer.from(bytes.slice(0, 4)).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return false;
  const vint = (offset: number, id = false) => {
    const first = bytes[offset]; if (!first) return null;
    let length = 1, mask = 0x80;
    while (!(first & mask)) { mask >>= 1; length++; }
    if (length > (id ? 4 : 8) || offset + length > bytes.length) return null;
    let value = id ? first : first & (mask - 1);
    for (let index = 1; index < length; index++) value = value * 256 + bytes[offset + index];
    return Number.isSafeInteger(value) ? { value, next: offset + length } : null;
  };
  const header = vint(4); if (!header || header.value > 4096 || header.next + header.value > bytes.length) return false;
  const end = header.next + header.value; let offset = header.next;
  while (offset < end) {
    const id = vint(offset, true); if (!id) return false;
    const size = vint(id.next); if (!size || size.next + size.value > end) return false;
    if (id.value === 0x4282) return size.value === 4 && new TextDecoder().decode(bytes.slice(size.next, size.next + 4)) === "webm";
    offset = size.next + size.value;
  }
  return false;
}
function matches(bytes: Uint8Array, mime: z.infer<typeof mimeSchema>): boolean {
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png") return bytes.length >= 8 && Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp") return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(text(0, 6));
  if (mime === "video/webm") return webmHeader(bytes);
  return bytes.length >= 16 && text(4, 8) === "ftyp";
}
function metadata(row: z.infer<typeof mediaRow>, name: string) { return { id: row.id, name, mime: row.mime_type, size: row.bytes, createdAt: row.created_at }; }
export async function uploadMedia(database: ZenoDatabase, mediaRoot: string, userId: string, request: Request, now = Date.now()) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new HttpError(415, "multipart_required", "请上传文件。");
  const body = await readBody(request, 52 * 1024 * 1024);
  const form = await new Request(request.url, { method: "POST", headers: request.headers, body: Uint8Array.from(body).buffer }).formData();
  const file = form.get("file");
  if (!(file instanceof File) || [...form.keys()].some(key => key !== "file") || form.getAll("file").length !== 1) throw new HttpError(400, "file_required", "请选择一个文件。");
  const mime = mimeSchema.safeParse(file.type);
  if (!mime.success) throw new HttpError(415, "media_type_rejected", "支持 JPG、PNG、WebP、GIF、MP4 或 WebM。");
  const max = personalMediaLimit(mime.data);
  if (!file.size || file.size > max) throw new HttpError(413, "media_too_large", "文件过大或为空。");
  validatePersonalMedia(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matches(bytes, mime.data)) throw new HttpError(415, "media_content_rejected", "文件内容与格式不一致。");
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" }[mime.data];
  const id = crypto.randomUUID(); const storageKey = `${id}.${extension}`;
  const directory = join(mediaRoot, userId); await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, storageKey); const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const name = basename(file.name).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || `media.${extension}`;
  try {
    database.sqlite.query("INSERT INTO media(id,user_id,storage_key,mime_type,bytes,sha256,created_at,name) VALUES (?,?,?,?,?,?,?,?)").run(id, userId, storageKey, mime.data, bytes.length, digest(bytes), now, name);
  } catch (error) { await unlink(path).catch(() => undefined); throw error; }
  return { id, name, mime: mime.data, size: bytes.length, createdAt: now };
}
export async function readMedia(database: ZenoDatabase, mediaRoot: string, userId: string, id: string, request: Request): Promise<Response> {
  const raw = database.sqlite.query("SELECT * FROM media WHERE id=? AND user_id=?").get(id, userId);
  if (!raw) throw new HttpError(404, "media_not_found", "文件不存在。");
  const row = mediaRow.parse(raw);
  const handle = await open(join(mediaRoot, userId, row.storage_key), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => { throw new HttpError(404, "media_not_found", "文件不存在。"); });
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== row.bytes) throw new HttpError(404, "media_not_found", "文件不可读取。");
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  const headers = new Headers({ "Content-Type": row.mime_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "bytes", "Vary": "Cookie, Authorization", "Content-Length": String(bytes.length) });
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : -1; const end = match?.[2] ? Number(match[2]) : bytes.length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.length || end >= bytes.length) return new Response(null, { status: 416, headers: { ...Object.fromEntries(headers), "Content-Range": `bytes */${bytes.length}`, "Content-Length": "0" } });
    headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`); headers.set("Content-Length", String(end - start + 1));
    return new Response(request.method === "HEAD" ? null : Uint8Array.from(bytes.subarray(start, end + 1)).buffer, { status: 206, headers });
  }
  return new Response(request.method === "HEAD" ? null : Uint8Array.from(bytes).buffer, { headers });
}
export async function deleteMedia(database: ZenoDatabase, mediaRoot: string, userId: string, id: string) {
  const raw = database.sqlite.query("SELECT * FROM media WHERE id=? AND user_id=?").get(id, userId);
  if (!raw) throw new HttpError(404, "media_not_found", "文件不存在。");
  const row = mediaRow.parse(raw);
  database.sqlite.query("DELETE FROM media WHERE id=? AND user_id=?").run(id, userId);
  await unlink(join(mediaRoot, userId, row.storage_key)).catch(() => undefined);
  return { deleted: true };
}
