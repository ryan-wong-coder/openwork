import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperatorResolver, setOperatorFeature } from "../src/operator";

test("operator rollout persists, is strict, and fails closed without deleting data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zeno-profile-test-"));
  try {
    const path = join(directory, "operator.json"); const resolver = createOperatorResolver(path);
    expect(resolver("zenoAccounts")).toBe(false);
    setOperatorFeature(path, "zenoAccounts", "true"); expect(resolver("zenoAccounts")).toBe(true);
    setOperatorFeature(path, "zenoAccounts", "false"); expect(resolver("zenoAccounts")).toBe(false);
    expect(() => setOperatorFeature(path, "unknownFlag", "true")).toThrow();
    await writeFile(path, JSON.stringify({ features: { zenoAccounts: true }, unknown: "rejected" }));
    expect(resolver("zenoAccounts")).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
