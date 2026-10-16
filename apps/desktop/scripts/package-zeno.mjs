import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareZenoSelfSigning } from "./zeno-macos-signing.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const triples = {
  darwin: { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" },
  win32: { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" },
  linux: { x64: "x86_64-unknown-linux-gnu", arm64: "aarch64-unknown-linux-gnu" },
};

export function zenoPackagingPlan(args, platform = process.platform, hostArch = process.arch, environment = process.env) {
  if (!Object.hasOwn(triples, platform)) throw new Error(`Unsupported packaging platform: ${platform}`);
  const allowed = new Set(["--prepared", "--dir", "--mac", "--win", "--linux", "--x64", "--arm64", "dmg", "zip", "nsis", "AppImage", "deb"]);
  if (args.some((argument) => !allowed.has(argument))) throw new Error("Only platform, architecture, target and --prepared options are accepted. Publishing is always disabled.");
  const architectures = ["x64", "arm64"].filter((arch) => args.includes(`--${arch}`));
  if (architectures.length > 1) throw new Error("Package one architecture per invocation so sidecars and update feeds cannot mix.");
  const arch = architectures[0] ?? hostArch;
  const target = triples[platform][arch];
  if (!target) throw new Error(`Unsupported packaging architecture: ${arch}`);
  const platformFlag = platform === "darwin" ? "--mac" : platform === "win32" ? "--win" : "--linux";
  if (args.some((argument) => ["--mac", "--win", "--linux"].includes(argument) && argument !== platformFlag)) throw new Error("Build each operating system on its native runner.");
  const signing = platform === "darwin" ? environment.ZENO_MAC_SIGNING || "self-signed"
    : platform === "win32" ? environment.ZENO_WINDOWS_SIGNING || "unsigned" : "none";
  if (platform === "darwin" && !["self-signed", "developer-id", "adhoc"].includes(signing)) throw new Error("Invalid ZENO_MAC_SIGNING mode.");
  if (platform === "win32" && !["unsigned", "certificate"].includes(signing)) throw new Error("Invalid ZENO_WINDOWS_SIGNING mode.");
  const builderArgs = args.filter((argument) => argument !== "--prepared");
  if (!builderArgs.includes(platformFlag)) builderArgs.unshift(platformFlag);
  // A CLI target list replaces inherited targets; configuration arrays merge.
  if (platform === "linux" && !args.includes("--dir") && !args.some((argument) => ["AppImage", "deb"].includes(argument))) builderArgs.splice(builderArgs.indexOf(platformFlag) + 1, 0, "AppImage", "deb");
  if (!architectures.length) builderArgs.push(`--${arch}`);
  builderArgs.push("--publish", "never", `-c.directories.output=dist-zeno/${platform}/${arch}`,
    // Linux targets otherwise rewrite ${arch} to x86_64 or amd64 in filenames.
    `-c.artifactName=zeno-\${os}-${arch}-\${version}.\${ext}`,
    `-c.extraMetadata.zenoReleaseSigning=${signing}`,
    `-c.extraMetadata.zenoReleaseUpdatesEnabled=${platform !== "darwin" || signing !== "adhoc"}`);
  if (platform === "darwin" && signing === "self-signed") builderArgs.push("-c.mac.identity=-", "-c.mac.sign=scripts/zeno-macos-sign.cjs");
  if (platform === "darwin" && signing === "adhoc") builderArgs.push("-c.mac.identity=-");
  if (platform === "win32") builderArgs.push(`-c.win.verifyUpdateCodeSignature=${signing === "certificate"}`);
  if (signing === "developer-id" || signing === "certificate") builderArgs.push("-c.forceCodeSigning=true");
  return { arch, target, signing, builderArgs, prepared: args.includes("--prepared") };
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: desktopRoot, stdio: "inherit", env, shell: process.platform === "win32" && command.endsWith(".cmd") });
  if (result.error) throw new Error(`Could not start ${command}.`);
  if (result.status !== 0) throw new Error(`Packaging command failed with exit code ${result.status ?? 1}.`);
}

async function main() {
  const plan = zenoPackagingPlan(process.argv.slice(2));
  let signing;
  const env = {
    ...process.env,
    TARGET: plan.target,
    VITE_OPENWORK_CLIENT_PROFILE: "local-gateway",
    VITE_OPENWORK_DEPLOYMENT: "desktop",
    VITE_DEN_REQUIRE_SIGNIN: "0",
    VITE_DEN_REQUIRE_ACTIVATION: "0",
    OPENWORK_DESKTOP_SENTRY_DSN: "",
    OPENWORK_DISABLE_FREE_INFERENCE: "1",
    OPENWORK_DISABLE_HOSTED_MODELS: "1",
    CSC_IDENTITY_AUTO_DISCOVERY: plan.signing === "developer-id" ? "true" : "false",
    MACOS_NOTARIZE: plan.signing === "developer-id" ? process.env.MACOS_NOTARIZE || "false" : "false",
  };
  // Never inherit a developer's unrelated signing identity or upstream credentials.
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.CSC_NAME;
  if (plan.signing !== "developer-id") { delete env.CSC_LINK; delete env.CSC_KEY_PASSWORD; }
  if (plan.signing !== "certificate") { delete env.WIN_CSC_LINK; delete env.WIN_CSC_KEY_PASSWORD; }
  try {
    if (process.platform === "darwin" && plan.signing === "self-signed") {
      signing = prepareZenoSelfSigning();
      Object.assign(env, signing.environment);
    }
    if (plan.signing === "developer-id" && !env.CSC_LINK) throw new Error("Developer ID mode requires CSC_LINK and CSC_KEY_PASSWORD.");
    if (plan.signing === "certificate" && !env.WIN_CSC_LINK) throw new Error("Windows certificate mode requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD.");
    if (!plan.prepared) run(process.execPath, [resolve(desktopRoot, "scripts/electron-build.mjs")], env);
    run(process.execPath, [resolve(desktopRoot, "scripts/prepare-zeno-runtime.mjs")], env);
    const suffix = process.platform === "win32" ? ".exe" : "";
    for (const name of [`opencode-${plan.target}${suffix}`, `opencode2-${plan.target}${suffix}`, `versions.json-${plan.target}${suffix}`]) {
      if (!existsSync(resolve(desktopRoot, "resources/sidecars", name))) throw new Error(`Missing prepared sidecar: ${name}`);
    }
    run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "electron-builder", "--config", "electron-builder.zeno.yml", ...plan.builderArgs], env);
  } finally {
    signing?.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
