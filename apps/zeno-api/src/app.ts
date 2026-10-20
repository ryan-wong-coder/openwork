import { z } from "zod";
import { type FeatureKey } from "@openwork/features";
import { accountUserSchema, idSchema, recordKindSchema, timestampSchema } from "@zeno/core/schema";
import { authenticate, createAuth, issueInvite, issuePasswordReset, redeemInvite, redeemPasswordReset, emailSchema } from "./auth";
import { openDatabase } from "./database";
import { approveDevice, beginDeviceAuthorization, exchangeDeviceAuthorization, heartbeatDevice, listDevices, revokeDevice } from "./devices";
import { HttpError } from "./errors";
import { assertMutationOrigin, createRateLimiter, errorResponse, json, PREFIX, readJson } from "./http";
import { deleteMedia, readMedia, uploadMedia } from "./media";
import { ConflictError, getRecord, mutateBatch, mutateRecord, syncRecords } from "./records";
import { operatorFeatureEnabled, operatorUpdateSchema, type OperatorKey } from "./operator";
import { routePaths, authOperations, routePattern } from "./routes";

export type AppOptions = {
  databasePath: string; mediaRoot: string; origin: string; authSecret: string;
  featureEnabled?: (key: FeatureKey) => boolean; now?: () => number;
  setFeature?: (key: OperatorKey, enabled: boolean) => void;
};
const adminUserRowsSchema = z.array(accountUserSchema.extend({ disabled: z.number().int().min(0).max(1), createdAt: timestampSchema }));
function browserAuthResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(browserAuthResult);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "token").map(([key, item]) => [key, browserAuthResult(item)]));
  return value;
}
export function createApp(options: AppOptions) {
  const origin = new URL(options.origin).origin;
  if (origin !== options.origin || !["https:", "http:"].includes(new URL(origin).protocol) || new URL(origin).protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Origin must be an exact HTTPS origin (loopback HTTP is supported for tests)");
  const database = openDatabase(options.databasePath); const auth = createAuth(database, origin, options.authSecret);
  const now = options.now ?? Date.now; const enabled = options.featureEnabled ?? (key => operatorFeatureEnabled(key, {}));
  const limit = createRateLimiter(now);
  const gate = (key: FeatureKey) => { if (!enabled(key)) throw new HttpError(404, "feature_disabled", "此功能暂未启用。"); };
  const features = () => ({ zenoAccounts: enabled("zenoAccounts"), personalCalendar: enabled("personalCalendar"), fitnessTracking: enabled("fitnessTracking"), localScheduledTasks: enabled("localScheduledTasks") });
  const authPaths = new Set<string>(Object.values(authOperations).map(value => value.path));
  return {
    database, auth, close: () => database.close(),
    async fetch(request: Request, peer = "local"): Promise<Response> {
      try {
        const url = new URL(request.url); const path = url.pathname;
        if (path === routePaths.health && request.method === "GET") return json({ ok: true, service: "zeno-data", aiExecution: "local-only" });
        if (!path.startsWith(`${PREFIX}/`)) throw new HttpError(404, "not_found", "接口不存在。");
        assertMutationOrigin(request, origin);
        if (path === routePaths.features && request.method === "GET") return json(features());
        if (path.startsWith(`${PREFIX}/auth/`)) {
          if (!authPaths.has(path)) throw new HttpError(404, "not_found", "接口不存在。");
          if (!enabled("zenoAccounts") && path.endsWith("/sign-in/email")) gate("zenoAccounts");
          limit(`auth:${peer}`, 30);
          const requestHeaders = new Headers(request.headers);
          // Never let an Internet client choose the auth limiter's IP identity.
          requestHeaders.set("x-forwarded-for", peer); requestHeaders.set("x-real-ip", peer);
          const response = await auth.handler(new Request(request, { headers: requestHeaders })); const headers = new Headers(response.headers);
          headers.set("Cache-Control", "no-store"); headers.set("X-Content-Type-Options", "nosniff");
          if (response.ok && response.headers.get("Content-Type")?.includes("application/json")) {
            // This surface uses HttpOnly cookies. Do not mirror the same
            // bearer credential into a JavaScript-readable session response.
            const body = browserAuthResult(await response.json());
            headers.delete("Content-Length");
            return new Response(JSON.stringify(body), { status: response.status, headers });
          }
          return new Response(response.body, { status: response.status, headers });
        }
        if (path === routePaths.inviteRedeem && request.method === "POST") {
          gate("zenoAccounts"); limit(`invite:${peer}`, 5);
          return json(await redeemInvite(database, await readJson(request), now()), 201);
        }
        if (path === routePaths.passwordReset && request.method === "POST") {
          gate("zenoAccounts"); limit(`reset:${peer}`, 5);
          return json(await redeemPasswordReset(database, await readJson(request), now()));
        }
        if (path === routePaths.deviceAuthorization && request.method === "POST") {
          gate("zenoAccounts"); limit(`device-start:${peer}`, 10);
          return json(beginDeviceAuthorization(database, await readJson(request), origin, now()), 201);
        }
        if (path === routePaths.deviceToken && request.method === "POST") {
          gate("zenoAccounts"); limit(`device-token:${peer}`, 30);
          return json(exchangeDeviceAuthorization(database, await readJson(request), now()));
        }
        const actor = await authenticate(database, auth, request, now());
        if (!actor) throw new HttpError(401, "unauthorized", "请先登录。");
        const expectedAccount = request.headers.get("x-zeno-account");
        if (expectedAccount !== null && expectedAccount !== actor.userId) throw new HttpError(409, "account_changed", "账号已改变，请重新登录。");
        limit(`user:${actor.userId}`, 300);
        if (path === routePaths.me && request.method === "GET") return json({ user: { id: actor.userId, email: actor.email, name: actor.name, role: actor.role }, deviceId: actor.deviceId });
        if (path.startsWith(`${PREFIX}/admin/`)) {
          if (actor.role !== "admin" || actor.deviceId) throw new HttpError(403, "admin_browser_required", "请使用管理员网页会话。");
          if (path === routePaths.adminFeatures && request.method === "GET") return json(features());
          if (path === routePaths.adminFeatures && request.method === "PUT") {
            const input = operatorUpdateSchema.parse(await readJson(request));
            if (!options.setFeature) throw new HttpError(503, "operator_unavailable", "功能配置暂不可用。");
            options.setFeature(input.key, input.enabled);
            return json(features());
          }
          if (path === routePaths.adminUsers && request.method === "GET") return json({ users: adminUserRowsSchema.parse(database.sqlite.query("SELECT id,email,name,role,disabled,created_at AS createdAt FROM user ORDER BY created_at,id").all()).map(user => ({ ...user, disabled: user.disabled === 1 })) });
          if (path === routePaths.adminDevices && request.method === "GET") return json({ devices: database.sqlite.query("SELECT d.id,d.name,d.platform,d.created_at AS createdAt,d.last_seen_at AS lastSeenAt,d.revoked_at AS revokedAt,u.id AS userId,u.email FROM device d JOIN user u ON u.id=d.user_id ORDER BY d.created_at,d.id").all() });
          if (path === routePaths.adminInvites && request.method === "GET") return json({ invites: database.sqlite.query("SELECT id,email,created_at AS createdAt,expires_at AS expiresAt,consumed_at AS consumedAt,revoked_at AS revokedAt FROM invite ORDER BY created_at DESC,id").all() });
          const adminInvite = routePattern(routePaths.adminInvite).exec(path);
          if (adminInvite && request.method === "DELETE") {
            const changed = database.sqlite.query("UPDATE invite SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND consumed_at IS NULL").run(now(), idSchema.parse(adminInvite[1]));
            if (!changed.changes) throw new HttpError(404, "invite_not_found", "邀请不存在或已使用。");
            return json({ revoked: true });
          }
          if ((path === routePaths.adminInvites || path === routePaths.adminPasswordResets) && request.method === "POST") {
            const input = z.object({ email: emailSchema }).strict().parse(await readJson(request));
            const invite = path.endsWith("/invites") ? issueInvite(database, actor.userId, input.email, now()) : issuePasswordReset(database, actor.userId, input.email, now());
            return json({ email: invite.email, expiresAt: invite.expiresAt, url: `${origin}/app/${path.endsWith("/invites") ? "invite" : "reset"}?token=${encodeURIComponent(invite.token)}` }, 201);
          }
          const adminDevice = routePattern(routePaths.adminDevice).exec(path);
          if (adminDevice && request.method === "DELETE") {
            const changed = database.sqlite.query("UPDATE device SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(now(), idSchema.parse(adminDevice[1]));
            if (!changed.changes) throw new HttpError(404, "device_not_found", "设备不存在。");
            return json({ revoked: true });
          }
          throw new HttpError(404, "not_found", "接口不存在。");
        }
        if (path === routePaths.devices && request.method === "GET") return json(listDevices(database, actor.userId));
        if (path === routePaths.deviceApprove && request.method === "POST") {
          gate("zenoAccounts"); limit(`approval:${actor.userId}`, 10);
          return json(approveDevice(database, actor, await readJson(request), now()));
        }
        if (path === routePaths.deviceHeartbeat && request.method === "POST") return json(heartbeatDevice(database, actor, await readJson(request), now()));
        const deviceMatch = routePattern(routePaths.device).exec(path);
        if (deviceMatch && request.method === "DELETE") return json(revokeDevice(database, actor.userId, idSchema.parse(deviceMatch[1]), now()));
        if (path === routePaths.sync && request.method === "GET") {
          const cursor = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get("cursor") ?? 0);
          const count = z.coerce.number().int().min(1).max(500).parse(url.searchParams.get("limit") ?? 200);
          return json(syncRecords(database, actor.userId, cursor, count));
        }
        if (path === routePaths.batch && request.method === "POST") return json(mutateBatch(database, actor, await readJson(request), enabled, now()));
        const match = routePattern(routePaths.record).exec(path);
        if (match) {
          const kind = recordKindSchema.parse(match[1]); const id = idSchema.parse(match[2]);
          if (request.method === "GET") {
            const record = getRecord(database, actor.userId, kind, id);
            if (!record) throw new HttpError(404, "record_not_found", "记录不存在。");
            return json({ record });
          }
          if (["PUT", "PATCH"].includes(request.method)) {
            const body = z.object({ kind: recordKindSchema, id: idSchema }).passthrough().parse(await readJson(request));
            if (body.kind !== kind || body.id !== id) throw new HttpError(400, "record_path_mismatch", "记录路径不匹配。");
            return json(mutateRecord(database, actor, body, enabled, now()));
          }
        }
        if (path === routePaths.media && request.method === "POST") { gate("fitnessTracking"); limit(`media:${actor.userId}`, 10); return json(await uploadMedia(database, options.mediaRoot, actor.userId, request, now()), 201); }
        const mediaMatch = routePattern(routePaths.mediaItem).exec(path);
        if (mediaMatch) {
          const id = z.uuid().parse(mediaMatch[1]);
          if (["GET", "HEAD"].includes(request.method)) return await readMedia(database, options.mediaRoot, actor.userId, id, request);
          if (request.method === "DELETE") return json(await deleteMedia(database, options.mediaRoot, actor.userId, id));
        }
        throw new HttpError(404, "not_found", "接口不存在。");
      } catch (error) {
        if (error instanceof ConflictError) return json({ code: "conflict", current: error.current, submitted: error.submitted }, 409);
        return errorResponse(error);
      }
    },
  };
}
