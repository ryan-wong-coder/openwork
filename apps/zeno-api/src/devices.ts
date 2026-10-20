import { z } from "zod";
import type { ZenoDatabase } from "./database";
import type { Identity } from "./auth";
import { challenge, digest, equal, secret } from "./crypto";
import { HttpError } from "./errors";
import { deviceSchema, modelChoiceSchema, workspaceChoiceSchema } from "@zeno/core/schema";

const platformSchema = z.enum(["darwin", "win32", "linux"]);
export const inventorySchema = z.object({
  workspaces: z.array(workspaceChoiceSchema).max(100), models: z.array(modelChoiceSchema).max(200),
  appliedCursor: z.number().int().nonnegative(), windowOpen: z.boolean(),
}).strict();
const deviceRow = z.object({ id: z.string(), name: z.string(), platform: platformSchema, created_at: z.number(), expires_at: z.number(), last_seen_at: z.number().nullable(), revoked_at: z.number().nullable(), metadata_json: z.string() });

export function beginDeviceAuthorization(database: ZenoDatabase, raw: unknown, origin: string, now = Date.now()) {
  const input = z.object({ name: z.string().trim().min(1).max(100), platform: platformSchema, codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(raw);
  const deviceCode = secret(); const userCode = secret(6).toUpperCase(); const expiresAt = now + 10 * 60_000;
  database.sqlite.query("INSERT INTO device_authorization(code_hash,user_code_hash,code_challenge,device_name,platform,created_at,expires_at) VALUES (?,?,?,?,?,?,?)").run(digest(deviceCode), digest(userCode), input.codeChallenge, input.name, input.platform, now, expiresAt);
  const verificationUri = `${origin}/app/device`;
  return { deviceCode, userCode, verificationUri, verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`, expiresAt, interval: 5 };
}

export function approveDevice(database: ZenoDatabase, identity: Identity, raw: unknown, now = Date.now()) {
  if (identity.deviceId !== null) throw new HttpError(403, "browser_approval_required", "请在已登录的网页中确认设备。");
  const input = z.object({ userCode: z.string().trim().min(6).max(20) }).strict().parse(raw);
  const changed = database.sqlite.query("UPDATE device_authorization SET approved_by=?,approved_at=? WHERE user_code_hash=? AND expires_at>? AND consumed_at IS NULL AND approved_by IS NULL").run(identity.userId, now, digest(input.userCode.toUpperCase()), now);
  if (changed.changes !== 1) throw new HttpError(400, "authorization_invalid", "设备授权不可用或已过期。");
  return { approved: true };
}

const authorizationRow = z.object({ code_challenge: z.string(), device_name: z.string(), platform: platformSchema, expires_at: z.number(), approved_by: z.string().nullable(), consumed_at: z.number().nullable() });
export function exchangeDeviceAuthorization(database: ZenoDatabase, raw: unknown, now = Date.now()) {
  const input = z.object({ deviceCode: z.string().min(32).max(100), codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) }).strict().parse(raw);
  return database.sqlite.transaction(() => {
    const parsed = authorizationRow.safeParse(database.sqlite.query("SELECT code_challenge,device_name,platform,expires_at,approved_by,consumed_at FROM device_authorization WHERE code_hash=?").get(digest(input.deviceCode)));
    if (!parsed.success || parsed.data.expires_at <= now || parsed.data.consumed_at !== null || !equal(parsed.data.code_challenge, challenge(input.codeVerifier))) throw new HttpError(400, "authorization_invalid", "设备授权不可用。");
    const value = parsed.data;
    if (!value.approved_by) throw new HttpError(428, "authorization_pending", "等待浏览器确认。");
    if (!database.sqlite.query("SELECT id FROM user WHERE id=? AND disabled=0").get(value.approved_by)) throw new HttpError(400, "authorization_invalid", "设备授权不可用。");
    const deviceId = crypto.randomUUID(); const accessToken = `zdt_${secret()}`; const expiresAt = now + 90 * 24 * 3600_000;
    database.sqlite.query("INSERT INTO device(id,user_id,name,platform,credential_hash,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)").run(deviceId, value.approved_by, value.device_name, value.platform, digest(accessToken), now, expiresAt, now);
    database.sqlite.query("UPDATE device_authorization SET consumed_at=? WHERE code_hash=?").run(now, digest(input.deviceCode));
    return { deviceId, accessToken, tokenType: "Bearer", expiresAt };
  }).immediate();
}

export function listDevices(database: ZenoDatabase, userId: string) {
  return { devices: database.sqlite.query("SELECT id,name,platform,created_at,expires_at,last_seen_at,revoked_at,metadata_json FROM device WHERE user_id=? ORDER BY created_at,id").all(userId).map(raw => {
    const row = deviceRow.parse(raw);
    const inventory = inventorySchema.safeParse(JSON.parse(row.metadata_json));
    return deviceSchema.parse({ id: row.id, name: row.name, platform: row.platform, createdAt: row.created_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at,
      ...(inventory.success ? inventory.data : { workspaces: [], models: [], appliedCursor: 0, windowOpen: false }) });
  }) };
}

export function revokeDevice(database: ZenoDatabase, userId: string, deviceId: string, now = Date.now()) {
  const result = database.sqlite.query("UPDATE device SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?").run(now, deviceId, userId);
  if (result.changes !== 1) throw new HttpError(404, "device_not_found", "设备不存在。");
  return { revoked: true };
}

export function heartbeatDevice(database: ZenoDatabase, identity: Identity, raw: unknown, now = Date.now()) {
  if (!identity.deviceId) throw new HttpError(403, "device_required", "需要设备凭据。");
  const input = z.object({ inventory: inventorySchema }).strict().parse(raw);
  // No paths, auth material, arbitrary environment or scheduling authority.
  database.sqlite.query("UPDATE device SET last_seen_at=?,metadata_json=? WHERE id=? AND user_id=? AND revoked_at IS NULL").run(now, JSON.stringify(input.inventory), identity.deviceId, identity.userId);
  return { deviceId: identity.deviceId, lastSeenAt: now };
}
