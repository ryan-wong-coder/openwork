import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, constants, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createWriteStream } from "node:fs";
import asar from "@electron/asar";
import YAML from "yaml";
import { prepareZenoSelfSigning } from "./zeno-macos-signing.mjs";

// This is deliberately NOT a local desktop test. Zeno preserves OpenWork's
// bundle ID, hence Squirrel's native ShipIt domain. Only an ephemeral GitHub-
// hosted macOS runner with no existing installation/cache is safe. No native
// execution override exists. --self-test exercises pure validation/ASAR only.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ORIGIN = "https://www.zeno.ryan-wong.cn";
const TARGET = "1.0.0";
const BASELINE = "0.999.0";
const BUNDLE_ID = "com.differentai.openwork";
const PRODUCT = "泽诺 Zeno";
const ENTITLEMENTS = join(REPO, "apps/desktop/build/entitlements.mac.plist");
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);

export function assertHostedRunner(environment, platform, arch) {
  assert.equal(platform, "darwin", "Native update smoke requires macOS.");
  assert.ok(["arm64", "x64"].includes(arch), "Unsupported runner architecture.");
  assert.equal(environment.CI, "true", "CI-only: refusing a developer machine.");
  assert.equal(environment.GITHUB_ACTIONS, "true", "Only GitHub Actions is supported.");
  assert.equal(environment.RUNNER_ENVIRONMENT, "github-hosted", "Self-hosted runners are deliberately refused.");
  assert.equal(environment.RUNNER_OS, "macOS", "Expected an ephemeral macOS runner.");
  assert.ok(/^\d+$/.test(environment.GITHUB_RUN_ID || ""), "Missing GitHub run identity.");
  assert.equal(environment.GITHUB_REF, "refs/heads/personal", "Only the personal branch may run this smoke.");
  assert.ok(environment.RUNNER_TEMP && isAbsolute(environment.RUNNER_TEMP), "Missing runner-owned temporary directory.");
  assert.ok(environment.ZENO_MAC_CODESIGN_P12_BASE64 && environment.ZENO_MAC_CODESIGN_PASSWORD, "The persistent release signing secrets are required.");
}

function sha512Hex(value) {
  assert.equal(typeof value, "string", "Missing SHA-512.");
  assert.ok(/^(?:[a-f\d]{128}|[A-Za-z\d+/]{86}==)$/i.test(value), "Invalid SHA-512.");
  return /^[a-f\d]{128}$/i.test(value) ? value.toLowerCase() : Buffer.from(value, "base64").toString("hex");
}

export function validateRelease(release, manifest, arch) {
  const feed = `${ORIGIN}/updates/darwin/${arch}/`;
  assert.equal(release?.version, TARGET, "The public release must still be the pinned target.");
  assert.ok(Number.isFinite(Date.parse(release.publishedAt)), "Missing public release timestamp.");
  assert.ok(Array.isArray(release.artifacts) && release.artifacts.length, "No real public artifacts are published.");
  assert.equal(manifest?.version, TARGET, "The public feed and release API disagree.");
  assert.ok(Array.isArray(manifest.files) && manifest.files.length, "The real feed has no files.");
  assert.ok(!manifest.packages || Object.keys(manifest.packages).length === 0, "Unexpected update packages.");
  const names = new Set();
  const files = manifest.files.map(file => {
    assert.equal(typeof file.url, "string", "Invalid feed URL.");
    const url = new URL(file.url, feed);
    const name = decodeURIComponent(url.pathname.split("/").at(-1));
    assert.ok(url.href.startsWith(feed) && url.origin === ORIGIN && !url.search && !url.hash && !url.username && !url.password, "Feed artifact escaped the official Zeno directory.");
    assert.equal(url.pathname, new URL(encodeURIComponent(name), feed).pathname, "Unexpected feed path.");
    assert.ok(name.startsWith("zeno-") && name.includes(`-${arch}-${TARGET}.`) && !/[/\\\r\n]/.test(name), "Wrong architecture or filename.");
    assert.ok(!names.has(name), "Duplicate feed artifact."); names.add(name);
    assert.ok(Number.isSafeInteger(file.size) && file.size > 0, "Missing real feed size.");
    const records = release.artifacts.filter(item => item.platform === "darwin" && item.arch === arch && item.name === name);
    assert.equal(records.length, 1, "Feed artifact is not uniquely present in the public release.");
    const record = records[0];
    assert.equal(record.url, `/downloads/${TARGET}/${name}`, "Public download URL is inconsistent.");
    assert.equal(record.size, file.size, "Public release and feed sizes differ.");
    assert.equal(sha512Hex(record.sha512), sha512Hex(file.sha512), "Public release and feed SHA-512 differ.");
    assert.ok(/^[a-f\d]{64}$/i.test(record.sha256), "Missing public SHA-256.");
    assert.equal(record.signature, "self-signed", "This smoke requires the persistent self-signed release lane.");
    assert.equal(record.format, name.endsWith(".zip") ? "zip" : name.endsWith(".dmg") ? "dmg" : "unsupported", "Public format differs from filename.");
    return { url: url.href, name, size: file.size, sha256: record.sha256.toLowerCase(), sha512: sha512Hex(file.sha512) };
  });
  if (manifest.path) {
    const file = files.find(item => item.url === new URL(manifest.path, feed).href);
    assert.ok(file, "The feed path is absent from its files.");
    if (manifest.sha512) assert.equal(sha512Hex(manifest.sha512), file.sha512, "The top-level feed hash differs.");
  }
  const zip = files.filter(file => file.name.endsWith(".zip"));
  assert.equal(zip.length, 1, "Exactly one real update ZIP is required.");
  return { feed, zip: zip[0] };
}

function quiet(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
  // In particular, never include security import arguments or its output.
  if (result.error || result.status !== 0) throw new Error(`Native smoke command failed: ${basename(command)}.`);
  return result.stdout.trim();
}

async function until(read, accept, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await read(); if (accept(value)) return value; } catch { /* A restart temporarily removes CDP/runtime. */ }
    await pause(250);
  }
  throw new Error(`Timed out: ${label}.`);
}

async function publicFetch(url, timeout = 30_000) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, ORIGIN, "Only the public Zeno origin may provide releases.");
  const response = await fetch(parsed, { redirect: "error", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(timeout) });
  assert.equal(response.status, 200, `Published release unavailable (${parsed.pathname}).`);
  return response;
}

async function downloadVerified(file, destination) {
  // The public site may provide ~10 Mbps shared across both architecture jobs.
  const response = await publicFetch(file.url, 1_800_000);
  const length = response.headers.get("content-length");
  if (length) assert.equal(Number(length), file.size, "Download Content-Length mismatch.");
  await writeVerifiedZip(Readable.fromWeb(response.body), file, destination);
}

async function writeVerifiedZip(source, file, destination) {
  const sha256 = createHash("sha256"); const sha512 = createHash("sha512"); let size = 0;
  await pipeline(source, new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > file.size) { callback(new Error("Published ZIP exceeded its declared size.")); return; }
    sha256.update(chunk); sha512.update(chunk); callback(null, chunk);
  } }), createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  assert.equal(size, file.size, "Downloaded ZIP size mismatch.");
  assert.equal(sha256.digest("hex"), file.sha256, "Downloaded ZIP SHA-256 mismatch.");
  assert.equal(sha512.digest("hex"), file.sha512, "Downloaded ZIP SHA-512 mismatch.");
}

export async function copyVerifiedBaseline(directory, temporaryRoot, file, destination) {
  assert.ok(isAbsolute(directory) && isAbsolute(temporaryRoot), "Baseline paths must be absolute.");
  assert.equal(basename(file.name), file.name, "Baseline name must equal the published filename.");
  const root = resolve(temporaryRoot); const folder = resolve(directory); const path = join(folder, file.name);
  const inside = value => value === "" || (!value.startsWith("..") && !isAbsolute(value));
  const local = relative(root, folder);
  assert.ok(inside(local), "Baseline must be inside RUNNER_TEMP.");
  let ancestor = root;
  for (const part of ["", ...local.split("/").filter(Boolean)]) {
    ancestor = join(ancestor, part);
    const info = lstatSync(ancestor);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "Baseline directories must not contain symlinks.");
  }
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink(), "Baseline must be a regular file, never a symlink.");
  assert.ok(inside(relative(realpathSync(root), realpathSync(path))), "Baseline resolved outside RUNNER_TEMP.");
  assert.equal(info.size, file.size, "Build artifact size differs from the live public release.");
  // O_NOFOLLOW also refuses a final-component symlink swapped after lstat.
  // Hash the bytes actually copied; neither an artifact name nor its CI run
  // is trusted in place of the live API + feed's SHA-256/SHA-512 and size.
  await writeVerifiedZip(createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), file, destination);
}

// Reproduce every original packed/unpacked file, mode and symlink. A plain
// createPackage() would incorrectly pack native .node dependencies into ASAR.
export async function rewriteArchiveVersion(archive, scratch) {
  const extracted = join(scratch, "extracted");
  asar.extractAll(archive, extracted);
  const packagePath = join(extracted, "package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(metadata.version, TARGET);
  writeFileSync(packagePath, `${JSON.stringify({ ...metadata, version: BASELINE }, null, 2)}\n`);
  const entries = asar.listPackage(archive).map(name => name.replace(/^\//, ""));
  const streams = entries.map(name => {
    const entry = asar.statFile(archive, name, false); const path = join(extracted, name); const stat = lstatSync(path);
    return { path: name, stat, unpacked: entry.unpacked === true,
      type: stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "link" : "file",
      ...(stat.isSymbolicLink() ? { symlink: readlinkSync(path) } : {}), streamGenerator: () => createReadStream(path) };
  });
  const next = join(scratch, "app.asar");
  await asar.createPackageFromStreams(next, streams);
  for (const name of entries) {
    const before = asar.statFile(archive, name, false); const after = asar.statFile(next, name, false);
    assert.equal(after.unpacked === true, before.unpacked === true, "ASAR unpacked boundary changed.");
    assert.equal(after.executable === true, before.executable === true, "ASAR executable mode changed.");
    if ("link" in before) assert.equal(after.link, before.link, "ASAR symlink changed.");
    else if (!("files" in before) && name !== "package.json") assert.ok(asar.extractFile(archive, name).equals(asar.extractFile(next, name)), "Only package.json may change inside ASAR.");
  }
  const changed = JSON.parse(asar.extractFile(next, "package.json").toString());
  assert.deepEqual(changed, { ...metadata, version: BASELINE });
  asar.uncacheAll();
  rmSync(archive, { force: true }); rmSync(`${archive}.unpacked`, { recursive: true, force: true });
  renameSync(next, archive);
  if (existsSync(`${next}.unpacked`)) renameSync(`${next}.unpacked`, `${archive}.unpacked`);
  return metadata;
}

function plist(bundle) { return join(bundle, "Contents/Info.plist"); }
function bundleVersion(bundle) { return quiet("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist(bundle)]); }
function archivePath(bundle) { return join(bundle, "Contents/Resources/app.asar"); }

export function validateUpdaterCacheName(cacheName) {
  // electron-builder flattens the scoped package name to one cache leaf,
  // currently @openworkdesktop-updater. Keep that literal directory name.
  assert.ok(typeof cacheName === "string" && /^@?[\w][\w.-]{0,255}$/.test(cacheName), "Unsafe update cache name.");
  return cacheName;
}

function assertPristineMachine(cacheName) {
  validateUpdaterCacheName(cacheName);
  const nativePaths = [join(homedir(), "Library/Caches", `${BUNDLE_ID}.ShipIt`), join(homedir(), "Library/Caches", cacheName),
    join(homedir(), "Library/Preferences", `${BUNDLE_ID}.ShipIt.plist`), join(homedir(), "Library/Application Support", BUNDLE_ID),
    join(homedir(), "Applications/OpenWork.app"), join(homedir(), `Applications/${PRODUCT}.app`), "/Applications/OpenWork.app", `/Applications/${PRODUCT}.app`];
  assert.ok(nativePaths.every(path => !existsSync(path)), "Runner has pre-existing OpenWork/Zeno state; refusing to touch shared native caches.");
  const processes = quiet("/bin/ps", ["-axo", "pid=,command="]);
  assert.ok(!processes.split("\n").some(line => /(?:\/Contents\/MacOS\/(?:OpenWork(?: Enterprise)?|泽诺 Zeno)(?:\s|$)|com\.differentai\.openwork\.ShipIt)/.test(line)), "An existing desktop/ShipIt process is active.");
  return nativePaths;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePort); });
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function connect(webSocketUrl, onEvent = () => {}) {
  const socket = new WebSocket(webSocketUrl); const pending = new Map(); let identifier = 0;
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = () => reject(new Error("Owned CDP connection failed.")); });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const promise = pending.get(message.id); if (!promise) return;
      pending.delete(message.id); clearTimeout(promise.timer);
      message.error ? promise.reject(new Error("Owned CDP command failed.")) : promise.resolve(message.result);
    } else onEvent(message);
  };
  socket.onclose = () => { for (const promise of pending.values()) { clearTimeout(promise.timer); promise.reject(new Error("Owned CDP closed.")); } pending.clear(); };
  return { socket, send(method, params = {}, timeout = 30_000) { return new Promise((resolveCommand, reject) => {
    const id = ++identifier;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Owned CDP timed out: ${method}.`)); }, timeout);
    pending.set(id, { resolve: resolveCommand, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); } };
}

export function privateMainTarget(target, bundle) {
  if (target?.type !== "page" || typeof target.url !== "string") return false;
  try {
    const url = new URL(target.url);
    // Production renderer assets live beside app.asar, not inside it.
    // Query/hash routing is allowed only on this exact private HTML file.
    return url.protocol === "file:" && !url.host && !url.username && !url.password
      && resolve(fileURLToPath(url)) === join(bundle, "Contents/Resources/app-dist/index.html");
  } catch { return false; }
}

async function attach(port, bundle, exceptions, origins) {
  const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
    const targets = await response.json();
    return targets.find(item => privateMainTarget(item, bundle));
  }, Boolean, 120_000, "private packaged main window");
  const client = await connect(target.webSocketDebuggerUrl, event => {
    if (event.method === "Runtime.exceptionThrown") exceptions.push("renderer-exception");
    if (event.method === "Network.requestWillBeSent") {
      try { const url = new URL(event.params.request.url); if (["http:", "https:"].includes(url.protocol)) origins.add(url.origin); } catch { /* Non-network scheme. */ }
    }
  });
  await client.send("Runtime.enable"); await client.send("Network.enable");
  const evaluate = async (expression, timeout = 30_000) => {
    const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeout);
    if (result.exceptionDetails) throw new Error("Packaged renderer operation failed.");
    return result.result.value;
  };
  await until(() => evaluate("Boolean(window.__OPENWORK_ELECTRON__?.updater)"), Boolean, 30_000, "native preload bridge");
  return { ...client, evaluate, invoke: (command, ...args) => evaluate(`window.__OPENWORK_ELECTRON__.invokeDesktop(${JSON.stringify(command)},...${JSON.stringify(args)})`, 120_000) };
}

function loopbackBase(value) {
  const url = new URL(value);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password, "Runtime must be private loopback.");
  return url.href.replace(/\/$/, "");
}

async function runtime(client, workspace) {
  await client.invoke("engineStart", workspace, { workspacePaths: [workspace] });
  return until(async () => {
    const info = await client.invoke("openworkServerInfo");
    assert.equal(info.running, true); const base = loopbackBase(info.baseUrl); const token = info.clientToken || info.ownerToken;
    assert.ok(token, "Missing private runtime authorization.");
    const request = async (path, options = {}) => {
      const response = await fetch(`${base}${path}`, { ...options, redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } });
      assert.equal(response.status, 200, "Private runtime request failed."); return response.json();
    };
    const health = await request("/health"); assert.equal(health.ok, true);
    return { request };
  }, Boolean, 120_000, "packaged embedded server health");
}

async function shipItIdle(timeout) {
  await until(() => quiet("/bin/ps", ["-axo", "pid=,command="]), lines => !lines.split("\n").some(line => line.includes(`${BUNDLE_ID}.ShipIt`)), timeout, "native ShipIt exit");
}

export function privateMainPids(processes, executable) {
  return processes.split("\n").flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    const pid = Number(match?.[1]);
    return Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid && match[2] === executable ? [pid] : [];
  });
}

async function cleanupPrivateMain(bundle, verifiedUpdate, report) {
  const executable = join(bundle, "Contents/MacOS", PRODUCT);
  const remaining = () => privateMainPids(quiet("/bin/ps", ["-axo", "pid=,comm="]), executable);
  try { await until(remaining, pids => pids.length === 0, 30_000, "private app cleanup"); }
  catch (error) {
    // Never use cleanup signals to manufacture the restart being verified.
    // Only a completed real update + preservation check permits this fallback.
    if (!verifiedUpdate) throw error;
    for (const pid of remaining()) {
      const current = spawnSync("/bin/ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      if (current.status !== 0 || current.stdout.trim() !== executable) continue;
      try { process.kill(pid, "SIGTERM"); } catch (cause) { if (cause.code !== "ESRCH") throw cause; }
    }
    await until(remaining, pids => pids.length === 0, 30_000, "verified private app SIGTERM cleanup");
    report.cleanupTermination = "SIGTERM only after verified update/restart/preservation, to exact private main PIDs";
  }
}

function publishRelaunchEnvironment(environment) {
  // ShipIt launches the updated bundle through NSWorkspace, not our spawn().
  // Publish ONLY these non-secret per-run paths/flags to the fresh CI login
  // session so the real automatic relaunch keeps its profile and CDP port.
  // Never change HOME or put signing secrets into launchd's environment.
  const previous = [];
  const restore = () => {
    for (const [key, value] of previous.reverse()) quiet("/bin/launchctl", value === null ? ["unsetenv", key] : ["setenv", key, value]);
  };
  try {
    for (const [key, value] of Object.entries(environment)) {
      assert.ok(/^(?:OPENWORK_|OPENCODE_|XDG_|VITE_OPENWORK_CLIENT_PROFILE$|NODE_OPTIONS$|NODE_PATH$)/.test(key), "Unexpected relaunch environment variable.");
      const result = spawnSync("/bin/launchctl", ["getenv", key], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      if (result.error) throw new Error("Cannot inspect the isolated CI login environment.");
      previous.push([key, result.status === 0 ? result.stdout.replace(/\n$/, "") : null]);
      quiet("/bin/launchctl", ["setenv", key, value]);
    }
    return restore;
  } catch (error) { restore(); throw error; }
}

async function selfTest() {
  const env = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "macOS", GITHUB_RUN_ID: "1", GITHUB_REF: "refs/heads/personal", RUNNER_TEMP: "/tmp/runner", ZENO_MAC_CODESIGN_P12_BASE64: "fixture", ZENO_MAC_CODESIGN_PASSWORD: "fixture" };
  assertHostedRunner(env, "darwin", "arm64");
  for (const key of ["CI", "GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "GITHUB_REF", "ZENO_MAC_CODESIGN_PASSWORD"]) assert.throws(() => assertHostedRunner({ ...env, [key]: "" }, "darwin", "arm64"));
  assert.throws(() => assertHostedRunner(env, "linux", "arm64"));
  assert.equal(validateUpdaterCacheName("@openworkdesktop-updater"), "@openworkdesktop-updater");
  assert.equal(validateUpdaterCacheName("openwork-updater"), "openwork-updater");
  for (const cacheName of [undefined, "", ".", "..", "/tmp/cache", "../cache", "a/b", "a\\b", "@../cache", "cache\n", "a%2fb", "C:cache"]) assert.throws(() => validateUpdaterCacheName(cacheName));
  const name = `zeno-mac-arm64-${TARGET}.zip`; const sha256 = "1".repeat(64); const sha512 = "2".repeat(128);
  const release = { version: TARGET, publishedAt: "2026-10-16T00:00:00Z", artifacts: [{ platform: "darwin", arch: "arm64", name, url: `/downloads/${TARGET}/${name}`, size: 100, sha256, sha512, signature: "self-signed", format: "zip" }] };
  const manifest = { version: TARGET, files: [{ url: name, size: 100, sha512: Buffer.from(sha512, "hex").toString("base64") }] };
  assert.equal(validateRelease(release, manifest, "arm64").zip.sha512, sha512);
  for (const bad of [{ version: "1.0.1" }, { files: [] }, { files: [{ ...manifest.files[0], url: `https://outside.invalid/${name}` }] }, { files: [{ ...manifest.files[0], size: 101 }] }, { files: [{ ...manifest.files[0], sha512: "3".repeat(128) }] }]) assert.throws(() => validateRelease(release, { ...manifest, ...bad }, "arm64"));
  assert.throws(() => validateRelease({ ...release, artifacts: [{ ...release.artifacts[0], url: "/downloads/wrong.zip" }] }, manifest, "arm64"));
  const privateExecutable = "/tmp/private-bundle/泽诺 Zeno.app/Contents/MacOS/泽诺 Zeno";
  const ownedPid = process.pid + 10_000;
  assert.deepEqual(privateMainPids(`${ownedPid} ${privateExecutable}\n${ownedPid + 1} ${privateExecutable} --argument\n${ownedPid + 2} ${privateExecutable}-helper\n${ownedPid + 3} /Applications/泽诺 Zeno.app/Contents/MacOS/泽诺 Zeno\n1 ${privateExecutable}\n${process.pid} ${privateExecutable}`, privateExecutable), [ownedPid]);
  const privateBundle = "/tmp/private-bundle/泽诺 Zeno.app";
  const renderer = pathToFileURL(join(privateBundle, "Contents/Resources/app-dist/index.html")).href;
  for (const suffix of ["", "#/settings/about", "?smoke=true#/workspace/owned/session"]) assert.equal(privateMainTarget({ type: "page", url: renderer + suffix }, privateBundle), true);
  for (const target of [{ type: "iframe", url: renderer }, { type: "page", url: renderer.replace("app-dist", "app.asar") }, { type: "page", url: renderer.replace("private-bundle", "other-bundle") }, { type: "page", url: "https://www.zeno.ryan-wong.cn/index.html" }, { type: "page", url: "about:blank" }]) assert.equal(privateMainTarget(target, privateBundle), false);
  const root = mkdtempSync(join(tmpdir(), "zeno-smoke-self-test-"));
  try {
    const baseline = join(root, "baseline"); mkdirSync(baseline);
    const content = Buffer.from("release fixture bytes"); const file = { name, size: content.length, sha256: digest(content), sha512: digest(content, "sha512") };
    writeFileSync(join(baseline, name), content);
    await copyVerifiedBaseline(baseline, root, file, join(root, "verified.zip"));
    assert.ok(readFileSync(join(root, "verified.zip")).equals(content));
    await assert.rejects(copyVerifiedBaseline(baseline, root, { ...file, size: file.size + 1 }, join(root, "wrong-size.zip")));
    await assert.rejects(copyVerifiedBaseline(baseline, root, { ...file, sha256: "0".repeat(64) }, join(root, "wrong-sha256.zip")));
    await assert.rejects(copyVerifiedBaseline(baseline, root, { ...file, sha512: "0".repeat(128) }, join(root, "wrong-sha512.zip")));
    await assert.rejects(copyVerifiedBaseline(dirname(root), root, file, join(root, "outside.zip")));
    await assert.rejects(copyVerifiedBaseline(baseline, root, { ...file, name: `../${name}` }, join(root, "wrong-name.zip")));
    const linkDirectory = join(root, "linked-directory"); symlinkSync(baseline, linkDirectory);
    await assert.rejects(copyVerifiedBaseline(linkDirectory, root, file, join(root, "symlink-directory.zip")));
    const linkedFile = join(root, "linked-file"); mkdirSync(linkedFile); symlinkSync(join(baseline, name), join(linkedFile, name));
    await assert.rejects(copyVerifiedBaseline(linkedFile, root, file, join(root, "symlink-file.zip")));
    const source = join(root, "source"); mkdirSync(join(source, "native"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ version: TARGET, openworkBrand: "zeno" }));
    writeFileSync(join(source, "native/fixture.node"), "not an executable"); writeFileSync(join(source, "unchanged.js"), "fixture");
    chmodSync(join(source, "unchanged.js"), 0o755); symlinkSync("../unchanged.js", join(source, "native/fixture-link"));
    const archive = join(root, "app.asar"); await asar.createPackageWithOptions(source, archive, { unpack: "*.node" });
    await rewriteArchiveVersion(archive, join(root, "rewrite"));
    assert.equal(JSON.parse(asar.extractFile(archive, "package.json").toString()).version, BASELINE);
    assert.equal(asar.statFile(archive, "native/fixture.node").unpacked, true);
    assert.equal(asar.extractFile(archive, "native/fixture.node").toString(), "not an executable");
    assert.equal(asar.statFile(archive, "unchanged.js").executable, true);
    assert.equal(asar.statFile(archive, "native/fixture-link", false).link, "unchanged.js");
  } finally { asar.uncacheAll(); rmSync(root, { recursive: true, force: true }); }
  console.log("Zeno update smoke self-test passed (validation and ASAR only; no native update was run).");
}

async function main() {
  assertHostedRunner(process.env, process.platform, process.arch);
  assert.notEqual(process.getuid?.(), 0, "Do not run the desktop smoke as root.");
  assert.equal(JSON.parse(readFileSync(join(REPO, "apps/desktop/package.json"), "utf8")).version, TARGET, "Checkout and published target must agree.");
  const runnerTemp = resolve(process.env.RUNNER_TEMP);
  const root = mkdtempSync(join(runnerTemp, "zeno-update-smoke-"));
  assert.ok(!relative(runnerTemp, root).startsWith(".."));
  const evidence = join(runnerTemp, "zeno-update-smoke-evidence"); mkdirSync(evidence, { recursive: true });
  const report = { passed: false, target: TARGET, baseline: BASELINE, platform: "darwin", arch: process.arch, publicOrigin: ORIGIN, phases: [], isolation: "ephemeral github-hosted runner; no pre-existing native state; private bundle/profile/workspace", nativeUpdateExecuted: false };
  const phase = (name, values = {}) => { report.phases.push({ ...values, name }); console.log(`[zeno-update-smoke] ${name}`); };
  let identity; let child; let client; let browser; let port; let privateBundle; let restoreRelaunchEnvironment; let nativePaths = []; let ownsNativeCache = false;
  const exceptions = []; const origins = new Set();
  try {
    const releaseResponse = await publicFetch(`${ORIGIN}/api/releases/latest.json`);
    const release = await releaseResponse.json();
    const feed = `${ORIGIN}/updates/darwin/${process.arch}/`;
    const manifestText = await (await publicFetch(`${feed}latest-mac.yml`)).text();
    const selected = validateRelease(release, YAML.parse(manifestText), process.arch);
    const zip = join(root, selected.zip.name);
    const baselineDirectory = process.env.ZENO_UPDATE_BASELINE_DIR;
    if (baselineDirectory) await copyVerifiedBaseline(baselineDirectory, runnerTemp, selected.zip, zip);
    else await downloadVerified(selected.zip, zip);
    const source = baselineDirectory ? "verified-build-artifact" : "verified-public-download";
    report.baselineSource = source;
    // Only baseline acquisition is deduplicated. The native updater below
    // still checks and downloads the complete ZIP from the real public feed.
    phase("verified-public-feed-and-zip", { version: TARGET, feed, artifactName: selected.zip.name, bytes: selected.zip.size, sha256: selected.zip.sha256, source });
    const entries = quiet("/usr/bin/unzip", ["-Z1", zip]).split("\n");
    assert.ok(entries.every(entry => !isAbsolute(entry) && !entry.split("/").includes("..")), "Unsafe published ZIP path.");
    const install = join(root, "installation"); mkdirSync(install);
    quiet("/usr/bin/ditto", ["-x", "-k", zip, install]);
    privateBundle = join(install, `${PRODUCT}.app`);
    assert.ok(existsSync(privateBundle), "Published ZIP lacks the branded app.");
    assert.equal(readdirSync(install).filter(name => name.endsWith(".app")).length, 1);
    const archive = archivePath(privateBundle); const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString());
    assert.equal(metadata.version, TARGET); assert.equal(metadata.openworkBrand, "zeno"); assert.equal(metadata.openworkDistribution, "public");
    assert.equal(metadata.zenoReleaseUpdatesEnabled, true); assert.equal(metadata.zenoReleaseSigning, "self-signed");
    const config = YAML.parse(readFileSync(join(privateBundle, "Contents/Resources/app-update.yml"), "utf8"));
    assert.equal(config.provider, "generic"); assert.equal(config.url, selected.feed);
    nativePaths = assertPristineMachine(config.updaterCacheDirName);
    identity = prepareZenoSelfSigning();
    const requirement = `identifier "${BUNDLE_ID}" and certificate leaf = H"${identity.environment.ZENO_MAC_CERT_SHA1}"`;
    quiet("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--all-architectures", `-R=${requirement}`, privateBundle]);
    const publishedArchiveHash = digest(readFileSync(archive));
    assert.equal(bundleVersion(privateBundle), TARGET);
    await rewriteArchiveVersion(archive, join(root, "asar-baseline"));
    const info = JSON.parse(quiet("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist(privateBundle)]));
    assert.equal(info.CFBundleIdentifier, BUNDLE_ID);
    info.CFBundleShortVersionString = BASELINE; info.CFBundleVersion = BASELINE;
    if (info.ElectronAsarIntegrity) {
      assert.ok(info.ElectronAsarIntegrity["Resources/app.asar"], "Unexpected ASAR integrity location.");
      info.ElectronAsarIntegrity["Resources/app.asar"] = { algorithm: "SHA256", hash: digest(asar.getRawHeader(archive).headerString) };
    }
    const temporaryPlist = join(root, "baseline-info.json"); writeFileSync(temporaryPlist, JSON.stringify(info));
    quiet("/usr/bin/plutil", ["-convert", "xml1", "-o", plist(privateBundle), temporaryPlist]);
    const require = createRequire(import.meta.url); const builderRequire = createRequire(require.resolve("electron-builder"));
    const appBuilderRequire = createRequire(builderRequire.resolve("app-builder-lib")); const { signAsync } = appBuilderRequire("@electron/osx-sign");
    await signAsync({ app: privateBundle, platform: "darwin", identity: identity.environment.ZENO_MAC_CERT_SHA1, keychain: identity.environment.ZENO_MAC_KEYCHAIN,
      identityValidation: false, preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      optionsForFile: file => ({ entitlements: ENTITLEMENTS, hardenedRuntime: true, timestamp: "none", ...(file === privateBundle ? { requirements: `=designated => ${requirement}` } : {}) }) });
    quiet("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--all-architectures", `-R=${requirement}`, privateBundle]);
    identity.release(); identity = null;
    assert.equal(bundleVersion(privateBundle), BASELINE);
    phase("prepared-private-same-identity-baseline", { version: BASELINE, codeChanges: "package version and matching Info.plist/integrity only" });

    const profile = join(root, "profile"); const workspace = join(root, "workspace"); const state = join(root, "state");
    for (const folder of [profile, workspace, state, "config", "data", "cache", "logs"].map(folder => isAbsolute(folder) ? folder : join(root, folder))) mkdirSync(folder, { recursive: true });
    writeFileSync(join(profile, "openwork-workspaces.json"), JSON.stringify({ selectedId: "", activeId: null, watchedId: null, workspaces: [] }));
    const marker = `zeno-update-ci-${process.env.GITHUB_RUN_ID}-${randomBytes(8).toString("hex")}`;
    writeFileSync(join(workspace, "update-smoke-marker.txt"), marker);
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) if (/^(?:OPENWORK_|OPENCODE_|DEN_|VITE_|ZENO_|CSC_|APPLE_|GH_TOKEN$|GITHUB_TOKEN$|ELECTRON_|NODE_OPTIONS$|NODE_PATH$)/.test(key)) delete environment[key];
    port = await freePort();
    const isolatedEnvironment = { OPENWORK_DEV_MODE: "0", VITE_OPENWORK_CLIENT_PROFILE: "local-gateway", OPENWORK_CLIENT_PROFILE: "local-gateway", OPENWORK_AUTOMATION_RUNNER: "off",
      OPENWORK_ELECTRON_USERDATA: profile, OPENWORK_ELECTRON_REMOTE_DEBUG_PORT: String(port), OPENWORK_ELECTRON_DISABLE_PROTOCOL_REGISTRATION: "1", OPENWORK_ELECTRON_USE_MOCK_KEYCHAIN: "1",
      OPENWORK_DESKTOP_BOOTSTRAP_PATH: join(state, "desktop-bootstrap.json"), OPENWORK_DESKTOP_WORKSPACE_STATE_PATH: join(profile, "openwork-workspaces.json"), OPENWORK_SERVER_TOKEN_STORE_PATH: join(state, "server-tokens.json"),
      OPENWORK_SERVER_CONFIG: join(state, "server.json"), OPENWORK_RUNTIME_DB: join(state, "runtime.sqlite"), OPENWORK_ENV_STORE: join(state, "env.json"), OPENWORK_TOKEN_STORE: join(state, "tokens.json"), OPENWORK_DATA_DIR: join(root, "data"),
      OPENWORK_ENGINE_V2_PREVIEW: "0", OPENCODE_CONFIG_DIR: join(root, "config/opencode"), OPENCODE_DB: join(root, "data/opencode.db"),
      XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: state, NODE_OPTIONS: "", NODE_PATH: "" };
    Object.assign(environment, isolatedEnvironment);
    // The native cache namespace remains the release namespace. It is owned by
    // this one fresh hosted VM, checked absent twice, never redirected/faked.
    assertPristineMachine(config.updaterCacheDirName); ownsNativeCache = true;
    restoreRelaunchEnvironment = publishRelaunchEnvironment(isolatedEnvironment);
    const executable = join(privateBundle, "Contents/MacOS", PRODUCT);
    child = spawn(executable, [], { env: environment, cwd: workspace, detached: true, stdio: ["ignore", openSync(join(root, "logs/electron.log"), "a", 0o600), openSync(join(root, "logs/electron-error.log"), "a", 0o600)] });
    child.on("error", () => {});
    client = await attach(port, privateBundle, exceptions, origins);
    const build = await client.invoke("appBuildInfo"); assert.equal(build.version, BASELINE);
    const channel = await client.evaluate("window.__OPENWORK_ELECTRON__.updater.getChannel()");
    assert.equal(channel.product, "zeno"); assert.equal(channel.supported, true); assert.equal(channel.currentVersion, BASELINE); assert.equal(channel.feedUrl, feed);
    const workspaces = await client.invoke("workspaceCreate", { folderPath: workspace, name: "Zeno update CI" });
    const workspaceRecord = workspaces.workspaces.find(item => item.path === workspace); assert.ok(workspaceRecord?.id);
    const beforeRuntime = await runtime(client, workspace);
    const mount = `/workspace/${encodeURIComponent(workspaceRecord.id)}/opencode`;
    const session = await beforeRuntime.request(`${mount}/session`, { method: "POST", body: JSON.stringify({ title: marker }) });
    assert.ok(session.id); assert.equal(session.title, marker);
    await beforeRuntime.request(`${mount}/session/${encodeURIComponent(session.id)}/message`, { method: "POST", body: JSON.stringify({ noReply: true, parts: [{ type: "text", text: marker }] }) });
    const messagesBefore = await beforeRuntime.request(`${mount}/session/${encodeURIComponent(session.id)}/message`);
    assert.ok(messagesBefore.some(message => message.parts?.some(part => part.type === "text" && part.text === marker)), "Native history marker was not stored.");
    await client.evaluate(`localStorage.setItem("zeno.update.smoke",${JSON.stringify(marker)})`);
    phase("baseline-server-and-history-ready", { nativeVersion: build.version, storedSession: true, storedMessage: true });
    const checked = await client.evaluate("window.__OPENWORK_ELECTRON__.updater.check('stable')", 120_000);
    assert.equal(checked.product, "zeno"); assert.equal(checked.available, true); assert.equal(checked.latestVersion, TARGET); assert.equal(checked.feedUrl, feed); assert.equal(checked.totalBytes, selected.zip.size);
    phase("native-check-real-public-feed", { latestVersion: checked.latestVersion, bytes: checked.totalBytes });
    // Allow the same real public ZIP transfer budget inside electron-updater.
    const downloaded = await client.evaluate("window.__OPENWORK_ELECTRON__.updater.download()", 1_800_000);
    assert.deepEqual(downloaded, { ok: true, version: TARGET });
    report.nativeUpdateExecuted = true;
    phase("native-download-and-squirrel-staging-complete");
    const activity = await beforeRuntime.request("/experimental/engine-v2-preview/activity");
    assert.equal(activity.v1?.verdict, "idle"); assert.equal(activity.v1.busySessions, 0); assert.equal(activity.v1.waitingRequests, 0);
    if (activity.v2 !== null) { assert.equal(activity.v2?.verdict, "idle"); assert.equal(activity.v2.busySessions, 0); assert.equal(activity.v2.waitingRequests, 0); }
    const browserVersion = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    browser = await connect(browserVersion.webSocketDebuggerUrl);
    await client.evaluate("(()=>{window.__zenoInstallResult=null;window.__OPENWORK_ELECTRON__.updater.onInstallError(()=>{window.__zenoInstallResult={ok:false}});window.__OPENWORK_ELECTRON__.updater.installAndRestart().then(result=>{window.__zenoInstallResult=result});return true})()");
    // Completion is the real process exit + bundle replacement + native
    // relaunch, never an IPC ok or a relaunch manually manufactured by us.
    await until(() => child.exitCode, value => value !== null, 90_000, "old native process exit");
    client.socket.close(); client = null; browser.socket.close(); browser = null;
    await until(() => bundleVersion(privateBundle), value => value === TARGET, 120_000, "Squirrel replaces the private bundle");
    await shipItIdle(120_000);
    assert.equal(digest(readFileSync(archivePath(privateBundle))), publishedArchiveHash, "Installed code is not the published target archive.");
    quiet("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--all-architectures", `-R=${requirement}`, privateBundle]);
    client = await attach(port, privateBundle, exceptions, origins);
    const updatedBuild = await client.invoke("appBuildInfo"); assert.equal(updatedBuild.version, TARGET);
    assert.equal(await client.evaluate('localStorage.getItem("zeno.update.smoke")'), marker, "Chromium profile marker was lost.");
    assert.equal(readFileSync(join(workspace, "update-smoke-marker.txt"), "utf8"), marker, "Workspace file was lost.");
    const preserved = await client.invoke("workspaceBootstrap");
    assert.ok(preserved.workspaces.some(item => item.id === workspaceRecord.id && item.path === workspace), "Workspace registry identity was lost.");
    const afterRuntime = await runtime(client, workspace);
    const sessionAfter = await afterRuntime.request(`${mount}/session/${encodeURIComponent(session.id)}`); assert.equal(sessionAfter.title, marker);
    const messagesAfter = await afterRuntime.request(`${mount}/session/${encodeURIComponent(session.id)}/message`);
    assert.ok(messagesAfter.some(message => message.parts?.some(part => part.type === "text" && part.text === marker)), "Native history message was lost.");
    assert.equal(exceptions.length, 0, "A renderer exception occurred.");
    assert.ok([...origins].every(origin => !/openworklabs\.com|github\.com/.test(origin)), "An official upstream request occurred.");
    const screenshot = await client.send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(evidence, "updated-app.png"), Buffer.from(screenshot.data, "base64"));
    phase("real-restart-target-server-and-preservation-verified", { nativeVersion: updatedBuild.version, diskVersion: bundleVersion(privateBundle), publishedCode: true, profile: true, workspace: true, history: true, embeddedServer: true, rendererExceptions: exceptions.length });
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    identity?.release();
    try {
      if (port && child && privateBundle) {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) })).json();
        assert.ok(targets.some(target => privateMainTarget(target, privateBundle)), "Refusing to close an unowned browser.");
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) })).json();
        const ownedBrowser = await connect(version.webSocketDebuggerUrl);
        await ownedBrowser.send("Browser.close", {}, 5_000).catch(() => {}); ownedBrowser.socket.close();
      }
    } catch { /* A failed install may have already quit. */ }
    client?.socket.close(); browser?.socket.close();
    try {
      if (privateBundle) await cleanupPrivateMain(privateBundle, report.passed, report);
      await shipItIdle(60_000);
      restoreRelaunchEnvironment?.(); restoreRelaunchEnvironment = null;
      // These paths were absent before this fresh CI run. Never clear an
      // existing user's native state or remove a bundle while ShipIt uses it.
      if (ownsNativeCache) for (const path of nativePaths.filter(path => path.includes("/Library/Caches/") || path.endsWith(`${BUNDLE_ID}.ShipIt.plist`))) rmSync(path, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      report.cleanup = "owned app, profile, private keychain and fresh-run caches removed after native processes exited";
    } catch { report.cleanup = "native processes did not settle; preserved private files for runner disposal"; report.passed = false; process.exitCode = 1; }
    report.networkOrigins = [...origins];
    writeFileSync(join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`[zeno-update-smoke] ${report.passed ? "passed" : "failed"}; sanitized evidence: ${evidence}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--self-test") await selfTest();
  else {
    assert.equal(process.argv.length, 2, "No native execution overrides are accepted.");
    await main();
  }
}
