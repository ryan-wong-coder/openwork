import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function secret(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
export function digest(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function challenge(verifier: string): string { return createHash("sha256").update(verifier).digest("base64url"); }
export function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
