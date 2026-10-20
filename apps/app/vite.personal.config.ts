import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  base: '/app/', plugins: [tailwindcss(), react(), { name: 'zeno-personal-index', async closeBundle() {
    const output = resolve(root, 'dist-personal');
    await rename(resolve(output, 'personal.html'), resolve(output, 'index.html'));
    const assets = (await readdir(resolve(output, 'assets'))).filter(name => !name.endsWith('.map')).sort().map(name => '/app/assets/' + name);
    const cacheId = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 16);
    const workerPath = resolve(output, 'personal-sw.js');
    const worker = (await readFile(workerPath, 'utf8')).replace("const CACHE = 'zeno-personal-shell-v1';", "const CACHE = 'zeno-personal-shell-" + cacheId + "';").replace("const PRECACHE = ['/app/', '/app/personal.webmanifest', '/app/zeno-personal.svg'];", 'const PRECACHE = ' + JSON.stringify(['/app/', '/app/personal.webmanifest', '/app/zeno-personal.svg', ...assets]) + ';');
    await writeFile(workerPath, worker);
  } }], resolve: { alias: { '@': resolve(root, 'src') } },
  server: { host: '127.0.0.1', port: 5189, strictPort: true, proxy: { '/api/zeno/v1': { target: process.env.ZENO_DEV_API_ORIGIN ?? 'http://127.0.0.1:8790', changeOrigin: false } } },
  build: { target: 'es2022', outDir: 'dist-personal', rollupOptions: { input: resolve(root, 'personal.html') } },
});
