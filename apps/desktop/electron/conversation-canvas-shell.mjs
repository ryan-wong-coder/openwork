import { readFile } from "node:fs/promises";

export const CANVAS_SHELL_SCHEME = "zeno-canvas";
export const CANVAS_SHELL_URL = "zeno-canvas://shell/zeno-canvas-shell.html";
const REQUIRED_FEATURES = ["ConnectionAllowlists", "OverrideConnectionAllowlistOriginTrial"];

/** Must run before ready. These switches enable the native policy, not network access. */
export function prepareCanvasShellProtocol(app, protocol) {
  if (app.isReady()) return false;
  const disabled = app.commandLine.getSwitchValue("disable-features").split(",").map(value => value.trim());
  if (REQUIRED_FEATURES.some(feature => disabled.some(value => value.split(/[<:]/)[0] === feature))) return false;
  const enabled = new Set(app.commandLine.getSwitchValue("enable-features").split(",").map(value => value.trim()).filter(Boolean));
  for (const feature of REQUIRED_FEATURES) enabled.add(feature);
  app.commandLine.appendSwitch("enable-features", [...enabled].join(","));
  protocol.registerSchemesAsPrivileged([{ scheme: CANVAS_SHELL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
  return true;
}

export function canvasShellResponse(request, source) {
  const url = new URL(request.url);
  const instance = url.searchParams.get("instance");
  if (url.protocol !== `${CANVAS_SHELL_SCHEME}:` || url.hostname !== "shell" || url.port || url.username || url.password
    || url.pathname !== "/zeno-canvas-shell.html" || [...url.searchParams.keys()].some(key => key !== "instance")
    || url.searchParams.getAll("instance").length > 1 || (instance !== null && !/^[a-f0-9]{48}$/.test(instance))) {
    return new Response(null, { status: 404 });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
  return new Response(request.method === "HEAD" ? null : source, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Connection-Allowlist": "()", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
  } });
}

/** Publish the immutable bridge capability only after a trusted response is installed. */
export async function installCanvasShellProtocol({ protocol, shellPath, prepared, chromiumVersion }) {
  const chromiumMajor = Number.parseInt(chromiumVersion, 10);
  if (!prepared || !Number.isFinite(chromiumMajor) || chromiumMajor < 150) return null;
  try {
    const source = await readFile(shellPath, "utf8");
    if (!source.includes('<meta name="zeno-canvas-shell" content="1">') || source.length > 262144) return null;
    protocol.handle(CANVAS_SHELL_SCHEME, request => canvasShellResponse(request, source));
    return Object.freeze({ shellUrl: CANVAS_SHELL_URL, networkPolicy: "connection-allowlist" });
  } catch { return null; }
}
