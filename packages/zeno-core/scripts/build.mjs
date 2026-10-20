import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
await build({ entryPoints: ['src/index.ts', 'src/schema.ts', 'src/calendar.ts', 'src/client.ts', 'src/media.ts'], outdir: 'dist', bundle: true, format: 'esm', platform: 'neutral', mainFields: ['main', 'module'], conditions: ['development'], target: 'es2022', sourcemap: true });
execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit', shell: process.platform === 'win32' });
