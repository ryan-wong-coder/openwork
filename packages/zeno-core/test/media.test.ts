import { expect, test } from 'bun:test';
import { personalMediaFilename } from '../src/media.ts';

test('extensionless backup media retains MIME and original bytes through Bun multipart parsing', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']) {
    const body = new FormData(); body.append('file', new Blob([bytes], { type: mime }), personalMediaFilename('opaque-backup-id', mime));
    const parsed = (await new Request('http://fixture.invalid', { method: 'POST', body }).formData()).get('file');
    if (!(parsed instanceof File)) throw new Error('Multipart file missing');
    expect(parsed.type).toBe(mime);
    expect(new Uint8Array(await parsed.arrayBuffer())).toEqual(bytes);
  }
  expect(personalMediaFilename('../folder/photo.png', 'image/jpeg')).toBe('photo.jpg');
  expect(personalMediaFilename('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
  expect(() => personalMediaFilename('untrusted', 'image/svg+xml')).toThrow();
});
