import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = `${root}dist`;
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(`${root}src`, dist, { recursive: true });
await cp(`${root}public`, dist, { recursive: true });
console.log(`Built ${dist}`);
