let shellUrl: Promise<string> | undefined;

/** Never send generated code to a host which silently ignores its network policy. */
export function loadCanvasShellUrl(): Promise<string> {
  shellUrl ??= resolveShellUrl().catch(error => {
    shellUrl = undefined;
    throw error;
  });
  return shellUrl;
}

async function resolveShellUrl(): Promise<string> {
  const native = window.__OPENWORK_ELECTRON__?.conversationCanvas;
  if (native?.networkPolicy === "connection-allowlist") {
    const url = new URL(native.shellUrl);
    if (url.protocol === "zeno-canvas:" && url.host === "shell" && url.pathname === "/zeno-canvas-shell.html") return url.href;
    throw new Error("Unsupported native canvas shell");
  }
  // The policy shipped in Chromium 152. Other engines retain readable source
  // until they provide an equivalent native network boundary.
  const chromium = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent)?.[1];
  if (!chromium || Number(chromium) < 152 || !/^https?:$/.test(location.protocol)) throw new Error("Canvas network policy is unavailable");
  const url = new URL(`${import.meta.env.BASE_URL}zeno-canvas-shell.html`, location.href);
  const response = await fetch(url, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok || response.headers.get("Connection-Allowlist")?.trim() !== "()"
    || !response.headers.get("Content-Type")?.includes("text/html")) throw new Error("Canvas shell policy is missing");
  if (!(await response.text()).includes('<meta name="zeno-canvas-shell" content="1">')) throw new Error("Canvas shell is missing");
  return url.href;
}
