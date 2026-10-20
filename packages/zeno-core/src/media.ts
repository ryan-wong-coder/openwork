import { z } from 'zod';
export const personalMediaMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
export const PERSONAL_IMAGE_LIMIT = 10 * 1024 * 1024;
export const PERSONAL_VIDEO_LIMIT = 50 * 1024 * 1024;
export function personalMediaLimit(mime: string) { return mime.startsWith('video/') ? PERSONAL_VIDEO_LIMIT : PERSONAL_IMAGE_LIMIT; }
export function validatePersonalMedia(file: { type: string; size: number }): void {
  const mime = personalMediaMimeSchema.safeParse(file.type);
  if (!mime.success) throw new Error('请选择 JPG、PNG、WebP、GIF、MP4 或 WebM 文件。');
  if (file.size < 1 || file.size > personalMediaLimit(mime.data)) throw new Error(mime.data.startsWith('video/') ? '视频须小于 50 MB。' : '图片须小于 10 MB。');
}
