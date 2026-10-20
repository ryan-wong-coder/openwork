import { z } from 'zod';

z.config({ jitless: true });
export const personalMediaMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
export const PERSONAL_IMAGE_LIMIT = 10 * 1024 * 1024;
export const PERSONAL_VIDEO_LIMIT = 50 * 1024 * 1024;
const mediaExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
/** Multipart parsers may discard a supplied MIME for extensionless filenames. */
export function personalMediaFilename(name: string, mime: string): string {
  const type = personalMediaMimeSchema.parse(mime), extension = mediaExtensions[type];
  const leaf = name.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'media';
  if (leaf.length <= 200 && (leaf.toLowerCase().endsWith('.' + extension) || type === 'image/jpeg' && /\.jpeg$/i.test(leaf))) return leaf;
  const stem = leaf.replace(/\.(?:jpe?g|png|webp|gif|mp4|webm)$/i, '').replace(/\.+$/, '').slice(0, 190) || 'media';
  return stem + '.' + extension;
}
export function personalMediaLimit(mime: string) { return mime.startsWith('video/') ? PERSONAL_VIDEO_LIMIT : PERSONAL_IMAGE_LIMIT; }
export function validatePersonalMedia(file: { type: string; size: number }): void {
  const mime = personalMediaMimeSchema.safeParse(file.type);
  if (!mime.success) throw new Error('请选择 JPG、PNG、WebP、GIF、MP4 或 WebM 文件。');
  if (file.size < 1 || file.size > personalMediaLimit(mime.data)) throw new Error(mime.data.startsWith('video/') ? '视频须小于 50 MB。' : '图片须小于 10 MB。');
}
