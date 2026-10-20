import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { ZenoDatabase } from "./database";
import { digest, secret } from "./crypto";
import { HttpError } from "./errors";
import * as schema from "./schema";

export const emailSchema = z.email().max(254).transform(value => value.trim().toLowerCase());
export const passwordSchema = z.string().min(12).max(128);
const identityRow = z.object({ id: z.string(), email: z.string(), name: z.string(), role: z.enum(["user", "admin"]), disabled: z.number() });
export type Identity = { userId: string; email: string; name: string; role: "user" | "admin"; deviceId: string | null };

export function createAuth(database: ZenoDatabase, origin: string, authSecret: string) {
  if (authSecret.length < 32) throw new Error("Zeno auth secret must contain at least 32 characters");
  return betterAuth({
    appName: "Zeno", baseURL: origin, basePath: "/api/zeno/v1/auth", secret: authSecret,
    database: drizzleAdapter(database.db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true },
    disabledPaths: ["/sign-up/email", "/request-password-reset", "/reset-password"],
    trustedOrigins: [origin], telemetry: { enabled: false },
    advanced: { cookiePrefix: "zeno", useSecureCookies: new URL(origin).protocol === "https:", defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
    user: { additionalFields: { role: { type: "string", defaultValue: "user", input: false }, disabled: { type: "boolean", defaultValue: false, input: false } } },
    session: { expiresIn: 30 * 24 * 3600, updateAge: 24 * 3600, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    databaseHooks: { session: { create: { before: async value => {
      const row = identityRow.safeParse(database.sqlite.query("SELECT id,email,name,role,disabled FROM user WHERE id=?").get(value.userId));
      if (!row.success || row.data.disabled !== 0) throw new APIError("UNAUTHORIZED", { message: "无法登录此账号。" });
      return { data: value };
    } } } },
  });
}
export type ZenoAuth = ReturnType<typeof createAuth>;

function insertCredential(database: ZenoDatabase, input: { email: string; name: string; passwordHash: string; role: "user" | "admin"; now: number }): string {
  const id = crypto.randomUUID();
  database.sqlite.query("INSERT INTO user(id,email,name,role,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, input.email, input.name, input.role, input.now, input.now);
  database.sqlite.query("INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES (?,?,'credential',?,?,?,?)").run(crypto.randomUUID(), id, id, input.passwordHash, input.now, input.now);
  return id;
}

export async function bootstrapAdmin(database: ZenoDatabase, input: { email: string; name: string; password: string }, now = Date.now()): Promise<string> {
  const email = emailSchema.parse(input.email); const password = passwordSchema.parse(input.password);
  const hash = await hashPassword(password);
  return database.sqlite.transaction(() => {
    if (database.sqlite.query("SELECT id FROM user WHERE role='admin' LIMIT 1").get()) throw new HttpError(409, "admin_exists", "管理员已初始化。");
    return insertCredential(database, { email, name: z.string().trim().min(1).max(100).parse(input.name), passwordHash: hash, role: "admin", now });
  }).immediate();
}

export function issueInvite(database: ZenoDatabase, adminId: string, emailInput: string, now = Date.now(), ttlMs = 7 * 24 * 3600_000) {
  const email = emailSchema.parse(emailInput); const token = secret(); const id = crypto.randomUUID();
  return database.sqlite.transaction(() => {
    const admin = identityRow.parse(database.sqlite.query("SELECT id,email,name,role,disabled FROM user WHERE id=?").get(adminId));
    if (admin.role !== "admin" || admin.disabled) throw new HttpError(403, "forbidden", "需要管理员权限。");
    database.sqlite.query("INSERT INTO invite(id,secret_hash,email,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?)").run(id, digest(token), email, adminId, now, now + ttlMs);
    return { id, token, email, expiresAt: now + ttlMs };
  }).immediate();
}

const redeemSchema = z.object({ token: z.string().min(32).max(100), email: emailSchema, name: z.string().trim().min(1).max(100), password: passwordSchema }).strict();
const inviteRow = z.object({ id: z.string(), email: z.string(), expires_at: z.number(), consumed_at: z.number().nullable(), revoked_at: z.number().nullable() });
export async function redeemInvite(database: ZenoDatabase, raw: unknown, now = Date.now()) {
  const input = redeemSchema.parse(raw); const hash = await hashPassword(input.password);
  return database.sqlite.transaction(() => {
    const parsed = inviteRow.safeParse(database.sqlite.query("SELECT id,email,expires_at,consumed_at,revoked_at FROM invite WHERE secret_hash=?").get(digest(input.token)));
    if (!parsed.success || parsed.data.consumed_at !== null || parsed.data.revoked_at !== null || parsed.data.expires_at <= now || parsed.data.email !== input.email) throw new HttpError(400, "invite_invalid", "邀请不可用或已过期。");
    if (database.sqlite.query("SELECT id FROM user WHERE email=?").get(input.email)) throw new HttpError(409, "account_exists", "此账号已存在，请登录。");
    const userId = insertCredential(database, { email: input.email, name: input.name, passwordHash: hash, role: "user", now });
    database.sqlite.query("UPDATE invite SET consumed_at=?,consumed_by=? WHERE id=? AND consumed_at IS NULL").run(now, userId, parsed.data.id);
    return { userId, email: input.email, name: input.name };
  }).immediate();
}

export async function resetPassword(database: ZenoDatabase, emailInput: string, passwordInput: string, now = Date.now()) {
  const email = emailSchema.parse(emailInput); const password = passwordSchema.parse(passwordInput); const hash = await hashPassword(password);
  return database.sqlite.transaction(() => {
    const row = identityRow.safeParse(database.sqlite.query("SELECT id,email,name,role,disabled FROM user WHERE email=?").get(email));
    if (!row.success) throw new HttpError(404, "account_not_found", "账号不存在。");
    database.sqlite.query("UPDATE account SET password=?,updated_at=? WHERE user_id=? AND provider_id='credential'").run(hash, now, row.data.id);
    database.sqlite.query("DELETE FROM session WHERE user_id=?").run(row.data.id);
    database.sqlite.query("UPDATE device SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now, row.data.id);
    database.sqlite.query("UPDATE device_authorization SET consumed_at=? WHERE approved_by=? AND consumed_at IS NULL").run(now, row.data.id);
    return { userId: row.data.id, revokedSessions: true, revokedDevices: true };
  }).immediate();
}

export function issuePasswordReset(database: ZenoDatabase, adminId: string, emailInput: string, now = Date.now()) {
  const email = emailSchema.parse(emailInput); const token = secret(); const expiresAt = now + 3600_000;
  return database.sqlite.transaction(() => {
    const admin = identityRow.parse(database.sqlite.query("SELECT id,email,name,role,disabled FROM user WHERE id=?").get(adminId));
    if (admin.role !== "admin" || admin.disabled) throw new HttpError(403, "forbidden", "需要管理员权限。");
    const target = identityRow.safeParse(database.sqlite.query("SELECT id,email,name,role,disabled FROM user WHERE email=? AND disabled=0").get(email));
    if (!target.success) throw new HttpError(404, "account_not_found", "账号不存在。");
    database.sqlite.query("UPDATE password_reset SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").run(now, target.data.id);
    database.sqlite.query("INSERT INTO password_reset(secret_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)").run(digest(token), target.data.id, now, expiresAt);
    return { token, email, expiresAt };
  }).immediate();
}
export async function redeemPasswordReset(database: ZenoDatabase, raw: unknown, now = Date.now()) {
  const input = z.object({ token: z.string().min(32).max(100), password: passwordSchema }).strict().parse(raw);
  const hash = await hashPassword(input.password);
  return database.sqlite.transaction(() => {
    const reset = z.object({ user_id: z.string() }).safeParse(database.sqlite.query("SELECT r.user_id FROM password_reset r JOIN user u ON u.id=r.user_id WHERE r.secret_hash=? AND r.expires_at>? AND r.consumed_at IS NULL AND u.disabled=0").get(digest(input.token), now));
    if (!reset.success) throw new HttpError(400, "reset_invalid", "重置链接不可用或已过期。");
    const userId = reset.data.user_id;
    database.sqlite.query("UPDATE account SET password=?,updated_at=? WHERE user_id=? AND provider_id='credential'").run(hash, now, userId);
    database.sqlite.query("DELETE FROM session WHERE user_id=?").run(userId);
    database.sqlite.query("UPDATE device SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(now, userId);
    database.sqlite.query("UPDATE device_authorization SET consumed_at=? WHERE approved_by=? AND consumed_at IS NULL").run(now, userId);
    database.sqlite.query("UPDATE password_reset SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL").run(now, userId);
    return { reset: true, revokedSessions: true, revokedDevices: true };
  }).immediate();
}

export async function authenticate(database: ZenoDatabase, auth: ZenoAuth, request: Request, now = Date.now()): Promise<Identity | null> {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    if (!/^Bearer zdt_[A-Za-z0-9_-]{43}$/.test(authorization)) return null;
    const row = z.object({ id: z.string(), user_id: z.string() }).safeParse(database.sqlite.query("SELECT id,user_id FROM device WHERE credential_hash=? AND revoked_at IS NULL AND expires_at>?").get(digest(authorization.slice(7)), now));
    if (!row.success) return null;
    const user = identityRow.safeParse(database.sqlite.query("SELECT id,email,name,role,disabled FROM user WHERE id=?").get(row.data.user_id));
    if (!user.success || user.data.disabled) return null;
    return { userId: user.data.id, email: user.data.email, name: user.data.name, role: user.data.role, deviceId: row.data.id };
  }
  const current = await auth.api.getSession({ headers: request.headers });
  if (!current) return null;
  const user = identityRow.safeParse(database.sqlite.query("SELECT id,email,name,role,disabled FROM user WHERE id=?").get(current.user.id));
  if (!user.success || user.data.disabled) return null;
  return { userId: user.data.id, email: user.data.email, name: user.data.name, role: user.data.role, deviceId: null };
}
