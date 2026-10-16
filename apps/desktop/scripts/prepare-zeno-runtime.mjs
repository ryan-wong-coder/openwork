import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../..");
const output = resolve(desktop, ".electron-runtime/node_modules/@openwork/features");
mkdirSync(output, { recursive: true });
// The new gateway server uses the shared feature resolver at runtime. Its
// workspace exports are TS, which Electron cannot strip inside node_modules.
// Compile this one package into the already staged Node ESM runtime.
for (const entry of ["index", "registry", "resolve"]) {
  const result = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", ["build", `packages/features/src/${entry}.ts`, "--target", "node", "--format", "esm", "--external", "zod", "--outfile", resolve(output, `${entry}.js`)], { cwd: repo, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Could not prepare the shared Zeno feature runtime.");
}
writeFileSync(resolve(output, "package.json"), JSON.stringify({ name: "@openwork/features", version: "0.0.0", private: true, type: "module", exports: { ".": "./index.js", "./registry": "./registry.js", "./resolve": "./resolve.js" }, dependencies: { zod: "^4.3.6" } }, null, 2) + "\n");
