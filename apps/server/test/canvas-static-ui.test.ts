import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { serveStaticUi } from "../src/static-ui";

const originalRoot = process.env.OPENWORK_WEB_ROOT;
let root: string;
const shell = '<!doctype html><meta name="zeno-canvas-shell" content="1"><p>Trusted shell fixture</p>';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "zeno-canvas-static-"));
  process.env.OPENWORK_WEB_ROOT = root;
  await writeFile(join(root, "index.html"), "<!doctype html><head></head><p>App fixture</p>");
  await writeFile(join(root, "zeno-canvas-shell.html"), shell);
});
afterAll(async () => {
  if (originalRoot === undefined) delete process.env.OPENWORK_WEB_ROOT;
  else process.env.OPENWORK_WEB_ROOT = originalRoot;
  await rm(root, { recursive: true, force: true });
});

test("only the real canvas shell carries the native deny-all network response policy", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await serveStaticUi(new Request("http://fixture/zeno-canvas-shell.html?instance=fixture", { method }), { token: "synthetic-owner-token" });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Connection-Allowlist")).toBe("()");
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(response?.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await response?.text()).toBe(method === "HEAD" ? "" : shell);
  }
  const app = await serveStaticUi(new Request("http://fixture/"), { token: "synthetic-owner-token" });
  expect(app?.headers.has("Connection-Allowlist")).toBe(false);
  const appText = await app?.text();
  expect(appText).toContain("App fixture");
  expect(appText).toContain("__OPENWORK_BOOTSTRAP__");
});

test("a missing shell cannot fall back to an authenticated application document", async () => {
  await rm(join(root, "zeno-canvas-shell.html"));
  const response = await serveStaticUi(new Request("http://fixture/zeno-canvas-shell.html"), { token: "synthetic-owner-token" });
  expect(response?.status).toBe(404);
  expect(response?.headers.has("Connection-Allowlist")).toBe(false);
  expect(await response?.text()).toBe("");
});
