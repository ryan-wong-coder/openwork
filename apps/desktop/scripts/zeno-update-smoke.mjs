import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { closeSync, constants, createReadStream, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createWriteStream } from "node:fs";
import asar from "@electron/asar";
import YAML from "yaml";
import { compareStableVersions } from "../electron/recovery.mjs";
import { assertCanvasProbeTarget, canvasProbeDocument, verifyPackagedCanvas } from "./zeno-canvas-packaged-probe.mjs";

// This is deliberately NOT a local desktop test. Zeno preserves OpenWork's
// bundle ID, hence Squirrel's native ShipIt domain. Only an ephemeral GitHub-
// hosted macOS runner with no existing installation/cache is safe. No native
// execution override exists. --self-test never launches a native application.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ORIGIN = "https://www.zeno.ryan-wong.cn";
const TARGET = JSON.parse(readFileSync(join(REPO, "apps/desktop/package.json"), "utf8")).version;
const BASELINE = "1.0.0";
assert.ok(/^\d+\.\d+\.\d+$/.test(TARGET) && compareStableVersions(TARGET, BASELINE) === 1, "The checked-out target must be a stable version newer than the original baseline.");
const BUNDLE_ID = "com.differentai.openwork";
const PRODUCT = "泽诺 Zeno";
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);

export function numericDownloadProgress(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(["transferred", "total", "percent", "bytesPerSecond"].flatMap(key => {
    const number = value[key];
    return typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER
      && (key !== "percent" || number <= 100) && (!["transferred", "total"].includes(key) || Number.isSafeInteger(number))
      ? [[key, number]] : [];
  }));
}

export function safeUpdateFailureSignals(text) {
  if (typeof text !== "string") return [];
  const allowed = [
    ["ERR_CONNECTION_RESET", "connection-reset"], ["ECONNRESET", "connection-reset"],
    ["ERR_CONNECTION_CLOSED", "connection-closed"], ["ERR_CONNECTION_ABORTED", "connection-aborted"],
    ["ECONNABORTED", "connection-aborted"], ["ERR_TIMED_OUT", "network-timeout"], ["ETIMEDOUT", "network-timeout"],
    ["ERR_NETWORK_CHANGED", "network-changed"], ["ERR_INTERNET_DISCONNECTED", "network-disconnected"],
    ["ERR_NAME_NOT_RESOLVED", "dns-failure"], ["ENOTFOUND", "dns-failure"], ["EAI_AGAIN", "dns-failure"],
    ["ERR_CONTENT_LENGTH_MISMATCH", "incomplete-transfer"], ["ERR_INCOMPLETE_CHUNKED_ENCODING", "incomplete-transfer"],
    ["ERR_STREAM_PREMATURE_CLOSE", "incomplete-transfer"], ["EPIPE", "connection-closed"],
    ["ERR_CERT_AUTHORITY_INVALID", "tls-certificate-failure"], ["ERR_CERT_DATE_INVALID", "tls-certificate-failure"],
    ["ERR_UPDATER_INVALID_SIGNATURE", "signature-verification-failed"],
    ["ERR_UPDATER_CHECKSUM_MISMATCH", "integrity-check-failed"],
  ];
  const signals = allowed.flatMap(([code, classification]) => new RegExp(`\\b${code}\\b`).test(text) ? [{ code, classification }] : []);
  for (const [code, classification] of [[-999, "network-cancelled"], [-1001, "network-timeout"], [-1003, "dns-failure"],
    [-1004, "connection-failed"], [-1005, "connection-lost"], [-1009, "network-disconnected"], [-1200, "tls-failure"], [-1202, "tls-certificate-failure"]]) {
    if (new RegExp(`\\bNSURLErrorDomain\\b[^\\r\\n]{0,120}\\bCode\\s*[=:]\\s*${code}\\b`).test(text)) signals.push({ code: `NSURLErrorDomain:${code}`, classification });
  }
  for (const [pattern, code, classification] of [
    [/\bnative-stage-timeout\b/, "native-stage-timeout", "native-staging-timeout"],
    [/\bnative-stage-unavailable\b/, "native-stage-unavailable", "native-staging-unavailable"],
    [/\bsha512 checksum mismatch\b/i, "sha512-checksum-mismatch", "integrity-check-failed"],
  ]) if (pattern.test(text)) signals.push({ code, classification });
  return signals;
}

export function privateUpdateFailureDiagnostics(root) {
  const signals = new Map(); let filesScanned = 0; let bytesScanned = 0; let readFailures = 0;
  // Read only bounded tails of the two files created by this smoke's spawn.
  // Never retain raw log text, paths, URLs, messages or unknown error codes.
  for (const name of ["electron.log", "electron-error.log"]) {
    let descriptor;
    try {
      descriptor = openSync(join(root, "logs", name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = fstatSync(descriptor);
      if (!info.isFile()) continue;
      const bytes = Buffer.alloc(Math.min(info.size, 256 * 1024));
      const length = readSync(descriptor, bytes, 0, bytes.length, Math.max(0, info.size - bytes.length));
      filesScanned += 1; bytesScanned += length;
      for (const signal of safeUpdateFailureSignals(bytes.subarray(0, length).toString("utf8"))) signals.set(signal.code, signal);
    } catch { readFailures += 1; }
    finally { if (descriptor !== undefined) try { closeSync(descriptor); } catch { readFailures += 1; } }
  }
  return { collectedBeforeCleanup: true, filesScanned, bytesScanned, readFailures, signals: [...signals.values()] };
}

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
  assert.ok(environment.ZENO_UPDATE_BASELINE_DIR && environment.ZENO_UPDATE_TARGET_DIR && environment.ZENO_UPDATE_BASELINE_METADATA, "Both explicit release artifact sources and historical release metadata are required.");
}

export function validateHistoricalRelease(release, arch) {
  assert.ok(["arm64", "x64"].includes(arch), "Unsupported baseline architecture.");
  assert.equal(release?.version, BASELINE, "Historical release must be the original baseline.");
  assert.ok(Array.isArray(release.platforms) && release.platforms.length === 6, "Historical release must contain all six published targets.");
  const targets = new Set();
  for (const lane of release.platforms) {
    assert.ok(["darwin", "win32", "linux"].includes(lane.platform) && ["arm64", "x64"].includes(lane.arch), "Invalid historical target.");
    assert.equal(lane.version, BASELINE, "Mixed historical release versions.");
    const key = `${lane.platform}/${lane.arch}`;
    assert.ok(!targets.has(key), "Duplicate historical target."); targets.add(key);
  }
  const lanes = release.platforms.filter(lane => lane.platform === "darwin" && lane.arch === arch);
  assert.equal(lanes.length, 1, "Historical Mac target is missing or duplicated.");
  const lane = lanes[0];
  const feed = `${ORIGIN}/updates/darwin/${arch}/`;
  assert.equal(lane.version, BASELINE);
  assert.equal(lane.feedUrl, feed);
  assert.equal(lane.signing, "self-signed");
  assert.equal(lane.updatesEnabled, true);
  assert.ok(Array.isArray(lane.files), "Historical target files are missing.");
  const expectedName = `zeno-mac-${arch}-${BASELINE}.zip`;
  const files = lane.files.filter(file => file.name === expectedName);
  assert.equal(files.length, 1, "Exactly one original baseline ZIP is required.");
  const file = files[0];
  assert.equal(file.url, new URL(expectedName, feed).href, "Historical ZIP URL is inconsistent.");
  assert.ok(Number.isSafeInteger(file.size) && file.size > 0, "Historical ZIP size is missing.");
  assert.ok(/^[a-f\d]{64}$/i.test(file.sha256), "Historical ZIP SHA-256 is missing.");
  return { name: expectedName, size: file.size, sha256: file.sha256.toLowerCase(), sha512: sha512Hex(file.sha512) };
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

export async function copyVerifiedArtifact(directory, temporaryRoot, file, destination) {
  assert.ok(isAbsolute(directory) && isAbsolute(temporaryRoot), "Artifact paths must be absolute.");
  assert.equal(basename(file.name), file.name, "Artifact name must equal the published filename.");
  const root = resolve(temporaryRoot); const folder = resolve(directory); const path = join(folder, file.name);
  const inside = value => value === "" || (!value.startsWith("..") && !isAbsolute(value));
  const local = relative(root, folder);
  assert.ok(inside(local), "Artifact must be inside RUNNER_TEMP.");
  let ancestor = root;
  for (const part of ["", ...local.split("/").filter(Boolean)]) {
    ancestor = join(ancestor, part);
    const info = lstatSync(ancestor);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), "Artifact directories must not contain symlinks.");
  }
  const info = lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink(), "Artifact must be a regular file, never a symlink.");
  assert.ok(inside(relative(realpathSync(root), realpathSync(path))), "Artifact resolved outside RUNNER_TEMP.");
  assert.equal(info.size, file.size, "Build artifact size differs from the published release.");
  // O_NOFOLLOW also refuses a final-component symlink swapped after lstat.
  // Hash the bytes actually copied; neither an artifact name nor its CI run
  // is trusted in place of the published metadata's SHA-256/SHA-512 and size.
  await writeVerifiedZip(createReadStream(path, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }), file, destination);
}

function plist(bundle) { return join(bundle, "Contents/Info.plist"); }
function bundleVersion(bundle) { return quiet("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist(bundle)]); }
function archivePath(bundle) { return join(bundle, "Contents/Resources/app.asar"); }

function unpackOriginalApp(zip, destination) {
  const entries = quiet("/usr/bin/unzip", ["-Z1", zip]).split("\n");
  assert.ok(entries.every(entry => !isAbsolute(entry) && !entry.split("/").includes("..")), "Unsafe published ZIP path.");
  mkdirSync(destination);
  quiet("/usr/bin/ditto", ["-x", "-k", zip, destination]);
  const bundle = join(destination, `${PRODUCT}.app`);
  assert.ok(existsSync(bundle), "Published ZIP lacks the branded app.");
  assert.equal(readdirSync(destination).filter(name => name.endsWith(".app")).length, 1);
  return bundle;
}

function verifyOriginalApp(bundle, version, feed, requirement) {
  const metadata = JSON.parse(asar.extractFile(archivePath(bundle), "package.json").toString());
  assert.equal(metadata.version, version); assert.equal(metadata.openworkBrand, "zeno"); assert.equal(metadata.openworkDistribution, "public");
  assert.equal(metadata.zenoReleaseUpdatesEnabled, true); assert.equal(metadata.zenoReleaseSigning, "self-signed");
  const info = JSON.parse(quiet("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist(bundle)]));
  assert.equal(info.CFBundleIdentifier, BUNDLE_ID);
  assert.equal(info.CFBundleShortVersionString, version); assert.equal(info.CFBundleVersion, version);
  const config = YAML.parse(readFileSync(join(bundle, "Contents/Resources/app-update.yml"), "utf8"));
  assert.equal(config.provider, "generic"); assert.equal(config.url, feed);
  quiet("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--all-architectures", ...(requirement ? [`-R=${requirement}`] : []), bundle]);
  return config;
}

export function certificateRequirement(certificate) {
  const leaf = new X509Certificate(certificate);
  return `identifier "${BUNDLE_ID}" and certificate leaf = H"${digest(leaf.raw, "sha1")}"`;
}

export function assertInstalledArchive(archive, expectedHash) {
  assert.ok(/^[a-f\d]{64}$/.test(expectedHash), "Missing verified target archive hash.");
  assert.equal(digest(readFileSync(archive)), expectedHash, "Installed code is not the verified published target archive.");
}

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
  const socket = new WebSocket(webSocketUrl); const pending = new Map(); const observers = new Set([onEvent]); let identifier = 0;
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = () => reject(new Error("Owned CDP connection failed.")); });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const promise = pending.get(message.id); if (!promise) return;
      pending.delete(message.id); clearTimeout(promise.timer);
      message.error ? promise.reject(new Error("Owned CDP command failed.")) : promise.resolve(message.result);
    } else for (const observe of observers) observe(message);
  };
  socket.onclose = () => { for (const promise of pending.values()) { clearTimeout(promise.timer); promise.reject(new Error("Owned CDP closed.")); } pending.clear(); };
  return { socket, observe(listener) { observers.add(listener); return () => observers.delete(listener); }, send(method, params = {}, timeout = 30_000) { return new Promise((resolveCommand, reject) => {
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
  const env = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_OS: "macOS", GITHUB_RUN_ID: "1", GITHUB_REF: "refs/heads/personal", RUNNER_TEMP: "/tmp/runner", ZENO_UPDATE_BASELINE_DIR: "/tmp/runner/baseline", ZENO_UPDATE_TARGET_DIR: "/tmp/runner/target", ZENO_UPDATE_BASELINE_METADATA: "/tmp/runner/history/zeno-release.json" };
  assertHostedRunner(env, "darwin", "arm64");
  for (const key of ["CI", "GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "GITHUB_REF", "ZENO_UPDATE_TARGET_DIR", "ZENO_UPDATE_BASELINE_METADATA"]) assert.throws(() => assertHostedRunner({ ...env, [key]: "" }, "darwin", "arm64"));
  assert.throws(() => assertHostedRunner(env, "linux", "arm64"));
  assert.equal(validateUpdaterCacheName("@openworkdesktop-updater"), "@openworkdesktop-updater");
  assert.equal(validateUpdaterCacheName("openwork-updater"), "openwork-updater");
  for (const cacheName of [undefined, "", ".", "..", "/tmp/cache", "../cache", "a/b", "a\\b", "@../cache", "cache\n", "a%2fb", "C:cache"]) assert.throws(() => validateUpdaterCacheName(cacheName));
  const name = `zeno-mac-arm64-${TARGET}.zip`; const sha256 = "1".repeat(64); const sha512 = "2".repeat(128);
  const release = { version: TARGET, publishedAt: "2026-10-16T00:00:00Z", artifacts: [{ platform: "darwin", arch: "arm64", name, url: `/downloads/${TARGET}/${name}`, size: 100, sha256, sha512, signature: "self-signed", format: "zip" }] };
  const manifest = { version: TARGET, files: [{ url: name, size: 100, sha512: Buffer.from(sha512, "hex").toString("base64") }] };
  assert.equal(validateRelease(release, manifest, "arm64").zip.sha512, sha512);
  for (const bad of [{ version: BASELINE }, { files: [] }, { files: [{ ...manifest.files[0], url: `https://outside.invalid/${name}` }] }, { files: [{ ...manifest.files[0], size: 101 }] }, { files: [{ ...manifest.files[0], sha512: "3".repeat(128) }] }]) assert.throws(() => validateRelease(release, { ...manifest, ...bad }, "arm64"));
  assert.throws(() => validateRelease({ ...release, artifacts: [{ ...release.artifacts[0], url: "/downloads/wrong.zip" }] }, manifest, "arm64"));
  const historical = { version: BASELINE, platforms: ["darwin", "win32", "linux"].flatMap(platform => ["arm64", "x64"].map(arch => ({
    platform, arch, version: BASELINE, feedUrl: `${ORIGIN}/updates/${platform}/${arch}/`, signing: platform === "darwin" ? "self-signed" : "unsigned", updatesEnabled: true,
    files: [{ name: `zeno-mac-${arch}-${BASELINE}.zip`, url: `${ORIGIN}/updates/${platform}/${arch}/zeno-mac-${arch}-${BASELINE}.zip`, size: 100, sha256, sha512 }],
  }))) };
  assert.equal(validateHistoricalRelease(historical, "arm64").name, `zeno-mac-arm64-${BASELINE}.zip`);
  assert.equal(validateHistoricalRelease(historical, "x64").sha512, sha512);
  for (const changed of [{ ...historical, version: TARGET }, { ...historical, platforms: historical.platforms.slice(1) }, { ...historical, platforms: historical.platforms.map((lane, index) => index ? lane : { ...lane, signing: "adhoc" }) }, { ...historical, platforms: historical.platforms.map((lane, index) => index ? lane : { ...lane, files: [{ ...lane.files[0], sha256: "short" }] }) }]) assert.throws(() => validateHistoricalRelease(changed, "arm64"));
  assert.throws(() => certificateRequirement(Buffer.from("invalid certificate")));
  const privateExecutable = "/tmp/private-bundle/泽诺 Zeno.app/Contents/MacOS/泽诺 Zeno";
  const ownedPid = process.pid + 10_000;
  assert.deepEqual(privateMainPids(`${ownedPid} ${privateExecutable}\n${ownedPid + 1} ${privateExecutable} --argument\n${ownedPid + 2} ${privateExecutable}-helper\n${ownedPid + 3} /Applications/泽诺 Zeno.app/Contents/MacOS/泽诺 Zeno\n1 ${privateExecutable}\n${process.pid} ${privateExecutable}`, privateExecutable), [ownedPid]);
  const privateBundle = "/tmp/private-bundle/泽诺 Zeno.app";
  const renderer = pathToFileURL(join(privateBundle, "Contents/Resources/app-dist/index.html")).href;
  for (const suffix of ["", "#/settings/about", "?smoke=true#/workspace/owned/session"]) assert.equal(privateMainTarget({ type: "page", url: renderer + suffix }, privateBundle), true);
  for (const target of [{ type: "iframe", url: renderer }, { type: "page", url: renderer.replace("app-dist", "app.asar") }, { type: "page", url: renderer.replace("private-bundle", "other-bundle") }, { type: "page", url: "https://www.zeno.ryan-wong.cn/index.html" }, { type: "page", url: "about:blank" }]) assert.equal(privateMainTarget(target, privateBundle), false);
  assertCanvasProbeTarget(renderer + "#/settings/about", privateBundle);
  for (const location of [renderer.replace("private-bundle", "other-bundle"), "https://outside.invalid/index.html", "about:blank"]) assert.throws(() => assertCanvasProbeTarget(location, privateBundle));
  const syntheticCanvas = canvasProbeDocument("window.ZenoCharts={ready:Promise.resolve()}", "a".repeat(48));
  assert.equal(syntheticCanvas.ok, true); assert.ok(syntheticCanvas.srcDoc.includes("Content-Security-Policy"));
  assert.equal(canvasProbeDocument("fixture", "invalid token").ok, false);
  await assert.rejects(verifyPackagedCanvas({ client: {}, bundle: privateBundle }), /CI-only|ephemeral|native macOS|client.evaluate/);
  const root = mkdtempSync(join(tmpdir(), "zeno-smoke-self-test-"));
  try {
    const workflow = YAML.parse(readFileSync(join(REPO, ".github/workflows/zeno-update-smoke.yml"), "utf8"));
    assert.equal(workflow.on.workflow_dispatch.inputs.architecture.default, "both");
    assert.deepEqual(workflow.on.workflow_dispatch.inputs.architecture.options, ["both", "x64", "arm64"]);
    const selector = workflow.jobs["select-architectures"].steps.find(step => step.id === "select").run;
    const selectionSource = /^node --input-type=module <<'JS'\n([\s\S]+)\nJS\n?$/.exec(selector)?.[1];
    assert.ok(selectionSource, "The workflow architecture selector must be directly testable.");
    const lanes = [{ runner: "macos-15-intel", arch: "x64" }, { runner: "macos-15", arch: "arm64" }];
    for (const selected of [undefined, "both", "x64", "arm64", "", "linux", "x64,arm64", "__proto__"]) {
      const output = join(root, `architecture-${String(selected).replace(/[^a-z0-9]/gi, "_")}.txt`);
      const result = spawnSync(process.execPath, ["--input-type=module"], { input: selectionSource, encoding: "utf8",
        env: { GITHUB_OUTPUT: output, ...(selected === undefined ? {} : { SMOKE_ARCHITECTURE: selected }) } });
      if (selected === undefined || ["both", "x64", "arm64"].includes(selected)) {
        assert.equal(result.status, 0, "Valid workflow architecture selection failed.");
        assert.deepEqual(JSON.parse(readFileSync(output, "utf8").trim().replace(/^matrix=/, "")),
          { include: selected === undefined || selected === "both" ? lanes : lanes.filter(lane => lane.arch === selected) });
      } else { assert.notEqual(result.status, 0); assert.equal(existsSync(output), false); }
    }
    const privateMarker = "synthetic-secret-DO-NOT-RETAIN";
    const diagnosticText = `Error net::ERR_CONNECTION_CLOSED https://private.invalid/${privateMarker} /private/${privateMarker}\n`
      + `Error: ECONNRESET ${privateMarker}; NSURLErrorDomain Code=-1005 ${privateMarker}\nunknown ERR_PRIVATE_${privateMarker}`;
    assert.deepEqual(safeUpdateFailureSignals(diagnosticText), [
      { code: "ECONNRESET", classification: "connection-reset" }, { code: "ERR_CONNECTION_CLOSED", classification: "connection-closed" },
      { code: "NSURLErrorDomain:-1005", classification: "connection-lost" },
    ]);
    assert.deepEqual(safeUpdateFailureSignals(`https://private.invalid/${privateMarker} ERR_PRIVATE native-message`), []);
    assert.deepEqual(numericDownloadProgress({ transferred: 419291136, total: 431109099, percent: 97.25, bytesPerSecond: 1000.5,
      url: privateMarker, error: privateMarker }), { transferred: 419291136, total: 431109099, percent: 97.25, bytesPerSecond: 1000.5 });
    for (const invalid of [null, [], { transferred: -1, total: Infinity, percent: 101, bytesPerSecond: "123" },
      { transferred: 1.5, total: Number.MAX_SAFE_INTEGER + 1, percent: NaN, bytesPerSecond: -1 }]) assert.deepEqual(numericDownloadProgress(invalid), {});
    mkdirSync(join(root, "logs"));
    writeFileSync(join(root, "logs/electron.log"), diagnosticText);
    writeFileSync(join(root, "logs/electron-error.log"), `${privateMarker} `.repeat(30000) + "ERR_CONTENT_LENGTH_MISMATCH");
    const diagnostics = privateUpdateFailureDiagnostics(root);
    assert.equal(diagnostics.filesScanned, 2); assert.equal(diagnostics.readFailures, 0);
    assert.ok(diagnostics.bytesScanned <= 512 * 1024);
    assert.ok(diagnostics.signals.some(signal => signal.code === "ERR_CONTENT_LENGTH_MISMATCH"));
    assert.ok(!JSON.stringify(diagnostics).includes(privateMarker));
    assert.ok(!JSON.stringify(diagnostics).includes("private.invalid"));
    assert.ok(!JSON.stringify(diagnostics).includes(root));
    const baseline = join(root, "baseline"); mkdirSync(baseline);
    const content = Buffer.from("release fixture bytes"); const file = { name, size: content.length, sha256: digest(content), sha512: digest(content, "sha512") };
    writeFileSync(join(baseline, name), content);
    await copyVerifiedArtifact(baseline, root, file, join(root, "verified.zip"));
    assert.ok(readFileSync(join(root, "verified.zip")).equals(content));
    await assert.rejects(copyVerifiedArtifact(baseline, root, { ...file, size: file.size + 1 }, join(root, "wrong-size.zip")));
    await assert.rejects(copyVerifiedArtifact(baseline, root, { ...file, sha256: "0".repeat(64) }, join(root, "wrong-sha256.zip")));
    await assert.rejects(copyVerifiedArtifact(baseline, root, { ...file, sha512: "0".repeat(128) }, join(root, "wrong-sha512.zip")));
    await assert.rejects(copyVerifiedArtifact(dirname(root), root, file, join(root, "outside.zip")));
    await assert.rejects(copyVerifiedArtifact(baseline, root, { ...file, name: `../${name}` }, join(root, "wrong-name.zip")));
    const linkDirectory = join(root, "linked-directory"); symlinkSync(baseline, linkDirectory);
    await assert.rejects(copyVerifiedArtifact(linkDirectory, root, file, join(root, "symlink-directory.zip")));
    const linkedFile = join(root, "linked-file"); mkdirSync(linkedFile); symlinkSync(join(baseline, name), join(linkedFile, name));
    await assert.rejects(copyVerifiedArtifact(linkedFile, root, file, join(root, "symlink-file.zip")));
    const source = join(root, "source"); mkdirSync(join(source, "native"), { recursive: true });
    writeFileSync(join(source, "package.json"), JSON.stringify({ version: TARGET, openworkBrand: "zeno" }));
    writeFileSync(join(source, "native/fixture.node"), "not an executable"); writeFileSync(join(source, "unchanged.js"), "fixture");
    const archive = join(root, "app.asar"); await asar.createPackageWithOptions(source, archive, { unpack: "*.node" });
    const archiveHash = digest(readFileSync(archive));
    assertInstalledArchive(archive, archiveHash);
    assert.equal(JSON.parse(asar.extractFile(archive, "package.json").toString()).version, TARGET);
    assert.equal(asar.statFile(archive, "native/fixture.node").unpacked, true);
    assert.equal(asar.extractFile(archive, "native/fixture.node").toString(), "not an executable");
    writeFileSync(join(source, "unchanged.js"), "same version, different code");
    const wrongArchive = join(root, "wrong-app.asar"); await asar.createPackageWithOptions(source, wrongArchive, { unpack: "*.node" });
    assert.equal(JSON.parse(asar.extractFile(wrongArchive, "package.json").toString()).version, TARGET);
    assert.throws(() => assertInstalledArchive(wrongArchive, archiveHash), /target archive/);
    assert.throws(() => assertInstalledArchive(archive, ""), /archive hash/);
  } finally { asar.uncacheAll(); rmSync(root, { recursive: true, force: true }); }
  console.log("Zeno update smoke self-test passed (integrity, architecture selection and sanitized diagnostics; no native update was run).");
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
  let child; let client; let browser; let port; let privateBundle; let restoreRelaunchEnvironment; let nativePaths = []; let ownsNativeCache = false;
  const exceptions = []; const origins = new Set();
  try {
    const releaseResponse = await publicFetch(`${ORIGIN}/api/releases/latest.json`);
    const release = await releaseResponse.json();
    const feed = `${ORIGIN}/updates/darwin/${process.arch}/`;
    const manifestText = await (await publicFetch(`${feed}latest-mac.yml`)).text();
    const selected = validateRelease(release, YAML.parse(manifestText), process.arch);
    const historicalPath = process.env.ZENO_UPDATE_BASELINE_METADATA;
    assert.ok(isAbsolute(historicalPath), "Historical release metadata path must be absolute.");
    const historicalRelative = relative(runnerTemp, historicalPath);
    assert.ok(!historicalRelative.startsWith("..") && !isAbsolute(historicalRelative), "Historical metadata must be inside RUNNER_TEMP.");
    const historicalInfo = lstatSync(historicalPath);
    assert.ok(historicalInfo.isFile() && !historicalInfo.isSymbolicLink(), "Historical release metadata must be a regular file.");
    const historicalReal = relative(realpathSync(runnerTemp), realpathSync(historicalPath));
    assert.ok(!historicalReal.startsWith("..") && !isAbsolute(historicalReal), "Historical metadata resolved outside RUNNER_TEMP.");
    const historical = JSON.parse(readFileSync(historicalPath, { encoding: "utf8", flag: constants.O_RDONLY | constants.O_NOFOLLOW }));
    const baseline = validateHistoricalRelease(historical, process.arch);
    const baselineZip = join(root, baseline.name);
    const targetZip = join(root, selected.zip.name);
    await copyVerifiedArtifact(process.env.ZENO_UPDATE_BASELINE_DIR, runnerTemp, baseline, baselineZip);
    await copyVerifiedArtifact(process.env.ZENO_UPDATE_TARGET_DIR, runnerTemp, selected.zip, targetZip);
    report.baselineSource = "original-historical-release-build-artifact";
    report.targetSource = "build-artifact-verified-against-live-api-and-feed";
    phase("verified-original-baseline-zip", { version: BASELINE, artifactName: baseline.name, bytes: baseline.size, sha256: baseline.sha256 });
    phase("verified-public-target-artifact", { version: TARGET, feed, artifactName: selected.zip.name, bytes: selected.zip.size, sha256: selected.zip.sha256 });

    // Neither original bundle is changed or re-signed. The historical ZIP is
    // anchored to its public GitHub release index; the target ZIP is anchored
    // to the live website API and native feed with both cryptographic hashes.
    privateBundle = unpackOriginalApp(baselineZip, join(root, "installation"));
    const config = verifyOriginalApp(privateBundle, BASELINE, selected.feed);
    const originalBaselineArchiveHash = digest(readFileSync(archivePath(privateBundle)));
    const certificatePrefix = join(root, "baseline-public-certificate-");
    quiet("/usr/bin/codesign", ["--display", `--extract-certificates=${certificatePrefix}`, privateBundle]);
    const requirement = certificateRequirement(readFileSync(`${certificatePrefix}0`));
    quiet("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--all-architectures", `-R=${requirement}`, privateBundle]);
    const targetBundle = unpackOriginalApp(targetZip, join(root, "verified-target"));
    const targetConfig = verifyOriginalApp(targetBundle, TARGET, selected.feed, requirement);
    assert.equal(targetConfig.updaterCacheDirName, config.updaterCacheDirName, "The release update cache identity changed.");
    const publishedArchiveHash = digest(readFileSync(archivePath(targetBundle)));
    rmSync(join(root, "verified-target"), { recursive: true, force: true });
    assertInstalledArchive(archivePath(privateBundle), originalBaselineArchiveHash);
    nativePaths = assertPristineMachine(config.updaterCacheDirName);
    phase("verified-unmodified-original-baseline-and-signing-continuity", { version: BASELINE, originalSignature: true, codeChanges: "none", targetArchiveSha256: publishedArchiveHash });
    // Only the original baseline is launched. The actual target ZIP transfer
    // below is performed by its native updater against the public Zeno feed.

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
    try {
      const subscribed = await client.evaluate(`(()=>{window.__zenoSmokeDownloadProgress={};const updater=window.__OPENWORK_ELECTRON__.updater;if(typeof updater.onDownloadProgress!=="function")return false;const numeric=${numericDownloadProgress.toString()};updater.onDownloadProgress(value=>{window.__zenoSmokeDownloadProgress={...window.__zenoSmokeDownloadProgress,...numeric(value)}});return true})()`, 2_000);
      report.downloadProgress = { subscriptionSupported: subscribed === true };
    } catch { report.downloadProgress = { subscriptionSupported: false }; }
    // Allow the same real public ZIP transfer budget inside electron-updater.
    const downloaded = await client.evaluate("window.__OPENWORK_ELECTRON__.updater.download()", 1_800_000);
    try { report.downloadProgress = { ...report.downloadProgress, ...numericDownloadProgress(await client.evaluate("window.__zenoSmokeDownloadProgress", 2_000)) }; }
    catch { /* Diagnostics must not change a healthy native update verdict. */ }
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
    assertInstalledArchive(archivePath(privateBundle), publishedArchiveHash);
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
    if (compareStableVersions(TARGET, "1.0.5") >= 0) {
      const canvas = await verifyPackagedCanvas({ client, bundle: privateBundle });
      writeFileSync(join(evidence, "native-canvas.png"), canvas.screenshot);
      const retained = await afterRuntime.request(`${mount}/session/${encodeURIComponent(session.id)}/message`);
      assert.ok(retained.some(message => message.parts?.some(part => part.type === "text" && part.text === marker)), "Native history changed after the canvas probe.");
      assert.equal(exceptions.length, 0, "A host renderer exception occurred during the canvas probe.");
      report.canvas = { ...canvas.report, hostStatePreservedAfterCleanup: true, historyPreservedAfterCleanup: true, rendererExceptions: exceptions.length };
      phase("installed-target-native-canvas-verified", { nativePolicy: true, localInteraction: true, bundledAntCharts: true, hostStatePreserved: true });
    }
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    try {
      if (client) report.downloadProgress = { ...report.downloadProgress,
        ...numericDownloadProgress(await client.evaluate("window.__zenoSmokeDownloadProgress", 2_000)) };
    } catch { /* The owned renderer may already have exited. */ }
    report.failureDiagnostics = privateUpdateFailureDiagnostics(root);
    throw error;
  } finally {
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
      report.cleanup = "original app copy, profile and fresh-run caches removed after native processes exited";
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
