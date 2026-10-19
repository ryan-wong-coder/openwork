import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/** The deny-all network policy belongs only to the trusted canvas document. */
export function canvasShellHeadersPlugin(): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if ((request.method === "GET" || request.method === "HEAD")
      && new URL(request.url ?? "/", "http://localhost").pathname === "/zeno-canvas-shell.html") {
      response.setHeader("Connection-Allowlist", "()");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
    }
    next();
  };
  return {
    name: "zeno-canvas-shell-headers",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
