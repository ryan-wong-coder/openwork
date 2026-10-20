import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../..");

export const zenoLicenseInputs = Object.freeze([
  { name: "openGym-AGPL-3.0.txt", source: "packages/zeno-fitness/LICENSE" },
  { name: "openGym-NOTICE.md", source: "packages/zeno-fitness/UPSTREAM-NOTICE.md" },
  { name: "openGym-source-manifest.json", source: "packages/zeno-fitness/upstream-manifest.json" },
  { name: "OpenWork-MIT.txt", source: "LICENSE" },
  { name: "Zeno-NOTICE.md", source: "apps/app/THIRD_PARTY_NOTICES.md" },
].map(Object.freeze));

/** Preserve original bytes and refuse incomplete legal inputs before packaging. */
export function stageZenoLicenses({ repositoryRoot = repo, outputDirectory = resolve(desktop, ".electron-runtime/licenses") } = {}) {
  const sources = zenoLicenseInputs.map(input => {
    const source = resolve(repositoryRoot, input.source);
    const info = lstatSync(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Zeno license input must be a regular file: ${input.name}`);
    const bytes = readFileSync(source);
    if (bytes.length === 0) throw new Error(`Zeno license input is empty: ${input.name}`);
    return { ...input, bytes };
  });
  // All five inputs are validated first. A thrown error prevents the caller
  // from invoking electron-builder; stale staged names never mask omissions.
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  for (const input of sources) writeFileSync(resolve(outputDirectory, input.name), input.bytes);
  return sources.map(input => input.name);
}

function main() {
  stageZenoLicenses();
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
