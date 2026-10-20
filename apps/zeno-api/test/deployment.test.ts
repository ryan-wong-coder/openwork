import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";

test("private deployment smoke exercises a real loopback HTTP listener without initializing accounts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zeno-deploy-test-"));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => app.fetch(request) });
  const app = createApp({ databasePath: join(directory, "db.sqlite"), mediaRoot: join(directory, "media"), origin: `http://127.0.0.1:${server.port}`, authSecret: "synthetic-private-deployment-smoke-secret" });
  try {
    const result = await Bun.$`node ${join(import.meta.dir, "../../../infra/zeno-release/zeno-api/smoke.mjs")} ${`http://127.0.0.1:${server.port}/`}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.text()).passed).toBe(true);
    expect(app.database.sqlite.query("SELECT id FROM user").all()).toHaveLength(0);
  } finally { await server.stop(true); app.close(); await rm(directory, { recursive: true, force: true }); }
});
