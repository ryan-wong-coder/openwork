import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function stageZenoArtifacts({ platform, arch, version, source, output, environment = process.env }) {
  if (!["darwin", "win32", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) throw new Error("Expected platform and architecture.");
  const manifest = platform === "darwin" ? "latest-mac.yml" : platform === "win32" ? "latest.yml" : `latest-linux${arch === "arm64" ? "-arm64" : ""}.yml`;
  const required = platform === "darwin" ? [".dmg", ".zip"] : platform === "win32" ? [".exe"] : [".AppImage", ".deb"];
  const names = readdirSync(source).filter((name) => name.startsWith("zeno-") && name.includes(`-${arch}-${version}.`) && statSync(resolve(source, name)).isFile());
  for (const extension of required) if (!names.some((name) => name.endsWith(extension))) throw new Error(`Missing ${platform}/${arch} ${extension} artifact.`);
  const document = YAML.parse(readFileSync(resolve(source, manifest), "utf8"));
  if (document.version !== version || !Array.isArray(document.files) || !document.files.length) throw new Error("Update metadata version or files are invalid.");
  for (const entry of document.files) {
    if (typeof entry.url !== "string" || basename(entry.url) !== entry.url || !names.includes(entry.url)) throw new Error("Update metadata references an unexpected artifact.");
    const bytes = readFileSync(resolve(source, entry.url));
    const digest = createHash("sha512").update(bytes).digest("base64");
    if (entry.sha512 !== digest || (entry.size !== undefined && entry.size !== bytes.length)) throw new Error("Update metadata checksum or size mismatch.");
    entry.size = bytes.length;
  }
  mkdirSync(output, { recursive: true });
  for (const name of names) copyFileSync(resolve(source, name), resolve(output, name));
  writeFileSync(resolve(output, manifest), YAML.stringify(document));
  const feedUrl = `https://www.zeno.ryan-wong.cn/updates/${platform}/${arch}/`;
  const files = [...names, manifest].map((name) => {
    const bytes = readFileSync(resolve(output, name));
    return { name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), sha512: createHash("sha512").update(bytes).digest("base64"), url: new URL(encodeURIComponent(name), feedUrl).href };
  });
  const signing = platform === "darwin" ? environment.ZENO_MAC_SIGNING || "self-signed" : platform === "win32" ? environment.ZENO_WINDOWS_SIGNING || "unsigned" : "none";
  writeFileSync(resolve(output, "release-info.json"), JSON.stringify({ version, platform, arch, feedUrl, manifest, signing, updatesEnabled: platform !== "darwin" || signing !== "adhoc", files }, null, 2) + "\n");
  writeFileSync(resolve(output, "SHA256SUMS"), files.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n");
  return { version, platform, arch, manifest, output, artifacts: names };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, arch] = process.argv.slice(2);
  const version = JSON.parse(readFileSync(resolve(desktop, "package.json"), "utf8")).version;
  console.log(JSON.stringify(stageZenoArtifacts({ platform, arch, version,
    source: resolve(desktop, "dist-zeno", platform, arch), output: resolve(desktop, "dist-zeno-staged", platform, arch),
  })));
}
