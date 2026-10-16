import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const build = spawnSync(process.execPath, [resolve(desktopRoot, "scripts/electron-build.mjs")], {
  cwd: desktopRoot,
  stdio: "inherit",
  env: { ...process.env, VITE_OPENWORK_CLIENT_PROFILE: "local-gateway", VITE_OPENWORK_DEPLOYMENT: "desktop", VITE_DEN_REQUIRE_SIGNIN: "0" },
});
if (build.status !== 0) process.exit(build.status ?? 1);
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const packaging = spawnSync(command, ["exec", "electron-builder", "--config", "electron-builder.zeno.yml", ...process.argv.slice(2)], {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(packaging.status ?? 1);
