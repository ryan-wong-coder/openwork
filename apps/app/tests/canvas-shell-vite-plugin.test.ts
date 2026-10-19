import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, preview } from "vite";
import { canvasShellHeadersPlugin } from "../scripts/canvas-shell-vite-plugin";

test("Vite dev and preview constrain only the trusted shell response", async () => {
  const root = await mkdtemp(join(tmpdir(), "zeno-canvas-vite-"));
  await mkdir(join(root, "public")); await mkdir(join(root, "dist"));
  const shell = '<meta name="zeno-canvas-shell" content="1">';
  await Promise.all([writeFile(join(root, "index.html"), "<p>App fixture</p>"), writeFile(join(root, "dist", "index.html"), "<p>App fixture</p>"),
    writeFile(join(root, "public", "zeno-canvas-shell.html"), shell), writeFile(join(root, "dist", "zeno-canvas-shell.html"), shell)]);
  const development = await createServer({ configFile: false, root, logLevel: "silent", plugins: [canvasShellHeadersPlugin()], server: { host: "127.0.0.1", port: 0 } });
  let production: Awaited<ReturnType<typeof preview>> | undefined;
  try {
    await development.listen();
    production = await preview({ configFile: false, root, logLevel: "silent", plugins: [canvasShellHeadersPlugin()], preview: { host: "127.0.0.1", port: 0 } });
    for (const urls of [development.resolvedUrls, production.resolvedUrls]) {
      const base = urls?.local[0]; if (!base) throw new Error("Missing fixture server URL");
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(new URL("zeno-canvas-shell.html?instance=fixture", base), { method });
        expect(response.status).toBe(200);
        expect(response.headers.get("Connection-Allowlist")).toBe("()");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.text()).toBe(method === "HEAD" ? "" : shell);
      }
      const app = await fetch(base);
      expect(app.headers.has("Connection-Allowlist")).toBe(false);
    }
  } finally {
    await development.close();
    if (production) await new Promise<void>(resolve => production.httpServer.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
