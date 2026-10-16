import { createHash } from "node:crypto";
import { copyFileSync, linkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Expected downloaded artifacts and release output directories.");
const output = resolve(outputPath);
mkdirSync(output, { recursive: true });
const platforms = [];
let version;
for (const platform of ["darwin", "win32", "linux"]) for (const arch of ["x64", "arm64"]) {
  const directory = resolve(inputPath, `zeno-${platform}-${arch}`);
  const info = JSON.parse(readFileSync(resolve(directory, "release-info.json"), "utf8"));
  version ??= info.version;
  if (info.version !== version || info.platform !== platform || info.arch !== arch) throw new Error("Release lanes do not agree on version and target.");
  const manifestAsset = `zeno-${platform}-${arch}-${info.manifest}`;
  for (const file of info.files) {
    const source = resolve(directory, file.name);
    const bytes = readFileSync(source);
    if (file.name.includes("/") || file.name.includes("\\") || createHash("sha256").update(bytes).digest("hex") !== file.sha256 || bytes.length !== file.size) throw new Error("Release artifact integrity mismatch.");
    const destination = resolve(output, file.name === info.manifest ? manifestAsset : file.name);
    try { linkSync(source, destination); } catch { copyFileSync(source, destination); }
  }
  platforms.push({ ...info, manifestAsset });
}
writeFileSync(resolve(output, "zeno-release.json"), JSON.stringify({ version, platforms }, null, 2) + "\n");
writeFileSync(resolve(output, "RELEASE-NOTES.md"), `# 泽诺 Zeno ${version}\n\nWindows、Linux、macOS，分别提供 x64 与 arm64 安装包。\n\nmacOS 的 self-signed 包使用持久自签证书，未取得 Apple 公证；首次打开可能需要系统确认。后续更新必须保持同一签名身份。Windows 未签安装包可能显示未知发布者。\n\n各架构更新目录与 SHA-256/SHA-512 校验见 zeno-release.json。\n`);
console.log(JSON.stringify({ version, platforms: platforms.length, output }));
