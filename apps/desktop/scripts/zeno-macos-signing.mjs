import { spawnSync } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep private material and child-process arguments out of logs and thrown errors.
function quiet(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) throw new Error(`Zeno signing setup failed while running ${command}.`);
  return result.stdout.trim();
}

export function prepareZenoSelfSigning(environment = process.env) {
  if (process.platform !== "darwin") throw new Error("The macOS signing keychain requires macOS.");
  const source = environment.ZENO_MAC_CODESIGN_P12;
  const encoded = environment.ZENO_MAC_CODESIGN_P12_BASE64;
  const password = environment.ZENO_MAC_CODESIGN_PASSWORD;
  if ((!source && !encoded) || !password) throw new Error("Self-signed mode requires the persistent ZENO_MAC_CODESIGN_P12 (path) or ZENO_MAC_CODESIGN_P12_BASE64, and ZENO_MAC_CODESIGN_PASSWORD.");
  const directory = mkdtempSync(join(tmpdir(), "zeno-signing-"));
  const bundle = join(directory, "identity.p12");
  const keychain = join(directory, "signing.keychain-db");
  const keychainPassword = randomBytes(32).toString("hex");
  const previous = quiet("security", ["list-keychains", "-d", "user"]).split("\n").map((line) => line.trim().replace(/^"|"$/g, "")).filter(Boolean);
  let created = false;
  let listed = false;
  const release = () => {
    try {
      if (listed) quiet("security", ["list-keychains", "-d", "user", "-s", ...previous]);
    } finally {
      if (created) { try { quiet("security", ["delete-keychain", keychain]); } catch { /* Best effort cleanup after interrupted signing. */ } }
      rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    writeFileSync(bundle, source ? readFileSync(source) : Buffer.from(encoded, "base64"), { mode: 0o600 });
    quiet("security", ["create-keychain", "-p", keychainPassword, keychain]);
    created = true;
    quiet("security", ["set-keychain-settings", keychain]);
    quiet("security", ["unlock-keychain", "-p", keychainPassword, keychain]);
    quiet("security", ["import", bundle, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign"]);
    quiet("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", keychainPassword, keychain]);
    quiet("security", ["list-keychains", "-d", "user", "-s", ...previous, keychain]);
    listed = true;
    const certificate = new X509Certificate(quiet("security", ["find-certificate", "-p", keychain]));
    if (Date.parse(certificate.validTo) <= Date.now() || !certificate.keyUsage?.includes("1.3.6.1.5.5.7.3.3")) throw new Error("The Zeno signing certificate must be unexpired and permit code signing.");
    const fingerprint = certificate.fingerprint.replaceAll(":", "");
    if (!/^[A-F0-9]{40}$/.test(fingerprint) || !existsSync(keychain)) throw new Error("Could not resolve the Zeno signing identity.");
    rmSync(bundle, { force: true });
    return { environment: { ZENO_MAC_CERT_SHA1: fingerprint, ZENO_MAC_KEYCHAIN: keychain }, release };
  } catch (error) {
    release();
    throw error;
  }
}
