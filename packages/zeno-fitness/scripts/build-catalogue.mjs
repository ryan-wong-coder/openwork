import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Electron loads plain JavaScript from node_modules. Bundle the catalogue's
// reviewed text and media mapping so runtime imports never reach app sources.
const result = await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['src/catalogue.ts', 'src/agent-catalogue.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'node',
  conditions: ['development'],
  target: 'es2022',
  metafile: true,
  logLevel: 'info',
});

for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(dependency => dependency.external && !dependency.path.startsWith('node:'))) {
    throw new Error('Fitness catalogue runtime must bundle every non-Node dependency.');
  }
}
