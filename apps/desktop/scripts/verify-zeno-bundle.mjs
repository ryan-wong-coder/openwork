import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import asar from "@electron/asar";
import YAML from "yaml";
import { verifyCanvasPackaging } from "./verify-canvas-packaging.mjs";
import { verifyPersonalPackaging, personalRuntimeSmokeSource } from "./verify-personal-packaging.mjs";
import { verifyFitnessVisualPackaging } from "./verify-fitness-packaging.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [platform, arch] = process.argv.slice(2);
if (!["darwin", "win32", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) throw new Error("Expected platform and architecture.");
const output = resolve(desktop, "dist-zeno", platform, arch);
const directory = platform === "darwin" ? arch === "x64" ? "mac" : "mac-arm64" : `${platform === "win32" ? "win" : "linux"}${arch === "x64" ? "" : "-arm64"}-unpacked`;
const app = platform === "darwin" ? join(output, directory, "泽诺 Zeno.app", "Contents") : join(output, directory);
const resources = join(app, platform === "darwin" ? "Resources" : "resources");
const archive = join(resources, "app.asar");
const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString());
const version = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version;
if (metadata.version !== version || metadata.openworkBrand !== "zeno" || metadata.openworkDistribution !== "public" || typeof metadata.zenoReleaseUpdatesEnabled !== "boolean") throw new Error("Packaged Zeno identity or update metadata is invalid.");
if (metadata.zenoReleaseSigning === "adhoc" && metadata.zenoReleaseUpdatesEnabled) throw new Error("Ad-hoc builds cannot enable release updates.");
const feed = YAML.parse(readFileSync(join(resources, "app-update.yml"), "utf8"));
if (feed.provider !== "generic" || feed.url !== `https://www.zeno.ryan-wong.cn/updates/${platform}/${arch}/`) throw new Error("Packaged updater does not use the correct independent architecture feed.");
// asar 3 traverses directory names using the host's path separator.
const feature = JSON.parse(asar.extractFile(archive, join("node_modules", "@openwork", "features", "package.json")).toString());
if (feature.exports["."] !== "./index.js") throw new Error("Packaged feature resolver must load compiled Node ESM.");
for (const name of ["local-client-profile", "session-activity", "gateway-image-tools", "openwork-chrome-devtools"]) {
  if (!asar.extractFile(archive, join("server", "dist", "opencode-plugins", `${name}.js`)).length) throw new Error(`Missing packaged host bridge dependency: ${name}`);
}
for (const name of ["opencode", "opencode2", "versions.json"]) readFileSync(join(resources, "sidecars", `${name}${platform === "win32" && name !== "versions.json" ? ".exe" : ""}`));
const canvas = verifyCanvasPackaging({ archive, resources });
const personal = verifyPersonalPackaging({ archive });
const fitnessVisuals = verifyFitnessVisualPackaging({ resources });
const nativeTarget = platform === process.platform && arch === process.arch;
if (nativeTarget) {
  const temporary = mkdtempSync(join(tmpdir(), "zeno-packaged-server-"));
  const script = join(temporary, "smoke.mjs");
  writeFileSync(script, `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const archive=process.env.ZENO_SMOKE_ARCHIVE;
const require=createRequire(pathToFileURL(archive+'/package.json'));
const Database=require('better-sqlite3');
const database=new Database(':memory:');
assert.equal(database.prepare('SELECT 1 AS ok').get().ok,1); database.close();
require('node-pty');
const {startEmbeddedServer}=await import(pathToFileURL(archive+'/server/dist/embedded.js'));
const server=await startEmbeddedServer({clientProfile:'local-gateway',host:'127.0.0.1',port:0,configPath:process.env.OPENWORK_SERVER_CONFIG,token:'zeno-fixture-client',hostToken:'zeno-fixture-host',approvalMode:'manual',workspaces:[],manageOpencode:false,logRequests:false});
try {
  const health=await fetch(server.url+'/health'); assert.equal(health.status,200);
  const status=await fetch(server.url+'/gateway/status',{headers:{Authorization:'Bearer zeno-fixture-client'}}); assert.equal(status.status,200);
  assert.deepEqual(Object.keys(await status.json()).sort(),['chatModel','configured','ready']);
  const denied=await fetch(server.url+'/gateway/config',{headers:{Authorization:'Bearer zeno-fixture-client'}}); assert.ok([401,403].includes(denied.status));
  const host=await fetch(server.url+'/gateway/config',{headers:{'X-OpenWork-Host-Token':'zeno-fixture-host'}}); assert.equal(host.status,200);
  console.log(JSON.stringify({packagedServer:true,nativeModules:true,clientStatus:true,hostBoundary:true}));
} finally {await server.stop();}
` + personalRuntimeSmokeSource);
  const executable = platform === "darwin" ? join(app, "MacOS", "泽诺 Zeno") : join(app, platform === "win32" ? "泽诺 Zeno.exe" : "openwork");
  const inherited = { ...process.env };
  for (const key of Object.keys(inherited)) if (/^(?:OPENWORK_|OPENCODE_|DEN_|VITE_DEN_)/.test(key)) delete inherited[key];
  try {
    const result = spawnSync(executable, [script], {
      timeout: 90_000,
      stdio: "inherit",
      env: { ...inherited, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "", NODE_PATH: "", ZENO_SMOKE_ARCHIVE: archive,
        ZENO_SMOKE_PERSONAL_ROOT: join(temporary, "synthetic-personal"),
        OPENWORK_CLIENT_PROFILE: "local-gateway", OPENWORK_SERVER_CONFIG: join(temporary, "openwork/server.json"),
        OPENWORK_RUNTIME_DB: join(temporary, "openwork/runtime.sqlite"), OPENWORK_ENV_STORE: join(temporary, "openwork/env.json"),
        OPENWORK_ENGINE_V2_PREVIEW: "0", OPENCODE_CONFIG_DIR: join(temporary, "opencode"), OPENCODE_DB: join(temporary, "opencode.sqlite"),
        XDG_CONFIG_HOME: join(temporary, "config"), XDG_DATA_HOME: join(temporary, "data"), XDG_STATE_HOME: join(temporary, "state"),
      },
    });
    if (result.error || result.status !== 0) throw new Error("Packaged Electron Node server smoke failed.");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ version, platform, arch, brand: metadata.openworkBrand, signing: metadata.zenoReleaseSigning, updatesEnabled: metadata.zenoReleaseUpdatesEnabled, feed: feed.url, runtimeSmoke: nativeTarget ? "passed" : "cross-architecture-static-only", canvas, personal, fitnessVisuals }));
