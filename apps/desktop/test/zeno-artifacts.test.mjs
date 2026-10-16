import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { stageZenoArtifacts } from "../scripts/collect-zeno-artifacts.mjs";

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "zeno-artifact-test-"));
  const source = join(directory, "input");
  const output = join(directory, "output");
  mkdirSync(source);
  const version = "1.0.0";
  const name = "zeno-linux-arm64-1.0.0.AppImage";
  const bytes = Buffer.from("synthetic installer fixture");
  const document = { version, files: [{ url: name, sha512: createHash("sha512").update(bytes).digest("base64") }] };
  writeFileSync(join(source, name), bytes);
  writeFileSync(join(source, "zeno-linux-arm64-1.0.0.deb"), bytes);
  const writeManifest = () => writeFileSync(join(source, "latest-linux-arm64.yml"), YAML.stringify(document));
  writeManifest();
  try { run({ source, output, version, document, writeManifest, bytes, name }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("staging preserves native ARM64 manifest name and fills verified file sizes", () => fixture((input) => {
  const report = stageZenoArtifacts({ ...input, platform: "linux", arch: "arm64" });
  assert.equal(report.manifest, "latest-linux-arm64.yml");
  const staged = YAML.parse(readFileSync(join(input.output, report.manifest), "utf8"));
  assert.equal(staged.files[0].size, input.bytes.length);
  const info = JSON.parse(readFileSync(join(input.output, "release-info.json"), "utf8"));
  assert.equal(info.feedUrl, "https://www.zeno.ryan-wong.cn/updates/linux/arm64/");
  assert.equal(info.updatesEnabled, true);
  assert.ok(info.files.every((file) => file.size > 0 && file.url.startsWith(info.feedUrl) && /^[a-f0-9]{64}$/.test(file.sha256)));
}));

test("staging rejects altered installers and wrong release versions", () => fixture((input) => {
  writeFileSync(join(input.source, input.name), "altered payload");
  assert.throws(() => stageZenoArtifacts({ ...input, platform: "linux", arch: "arm64" }), /checksum/);
  assert.throws(() => stageZenoArtifacts({ ...input, version: "1.0.1", platform: "linux", arch: "arm64" }), /Missing/);
}));

test("metadata cannot redirect clients to a different server or architecture", () => fixture((input) => {
  for (const url of ["https://example.invalid/installer.AppImage", "../installer.AppImage", "zeno-linux-x64-1.0.0.AppImage"]) {
    input.document.files[0].url = url;
    input.writeManifest();
    assert.throws(() => stageZenoArtifacts({ ...input, platform: "linux", arch: "arm64" }), /unexpected artifact/);
  }
}));
