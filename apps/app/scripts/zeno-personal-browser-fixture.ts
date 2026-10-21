/** Test-only loopback host: actual API + production PWA files, isolated synthetic database. */
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { createApp } from "../../zeno-api/src/app";
import { bootstrapAdmin, issueInvite, redeemInvite } from "../../zeno-api/src/auth";
import { syncRecords } from "../../zeno-api/src/records";
import { challenge, secret } from "../../zeno-api/src/crypto";
import { createMutation, dateTimeInZone, eventDataSchema, localDateKey, mutationResultSchema, routineDataSchema, workoutDataSchema, syncResultSchema, taskDataSchema } from "../../../packages/zeno-core/src/index";

const env = z.object({ ZENO_QA_ROOT: z.string().min(1), ZENO_QA_DIST: z.string().min(1), ZENO_QA_PASSWORD: z.string().min(16), ZENO_QA_CONTROL: z.string().min(32), ZENO_QA_ACCOUNT_SCROLL: z.literal("1").optional() }).parse(process.env);
const root = await realpath(env.ZENO_QA_ROOT); const dist = await realpath(env.ZENO_QA_DIST);
const nginx = await readFile(new URL("../../../infra/zeno-release/zeno-api/nginx-locations.conf", import.meta.url), "utf8");
function nginxCsp(location: string): string {
  const block = nginx.split(`location = ${location} {`)[1]?.split("\n}")[0];
  const policy = block?.match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1];
  if (!policy) throw new Error("production CSP unavailable"); return policy;
}
const htmlCsp = nginxCsp("/app/index.html"); const shellCsp = nginxCsp("/app/zeno-canvas-shell.html");
const prefix = "/api/zeno/v1"; let app: ReturnType<typeof createApp> | undefined;
const accounts = new Map<string, { userId: string; cookie: string }>();
const featureOverrides = new Map<string, boolean>();
const counts = { apiRequests: 0, realModelCalls: 0 };
let failDeviceList = false;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 52 * 1024 * 1024, async fetch(request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith(prefix + "/")) { counts.apiRequests++; if (failDeviceList && request.method === "GET" && url.pathname === prefix + "/devices") return Response.json({ code: "synthetic_device_failure", message: "合成连接故障，请重试。" }, { status: 503 }); return app ? app.fetch(request, "127.0.0.1") : new Response(null, { status: 503 }); }
  if (url.pathname.startsWith("/__qa/")) {
    if (request.headers.get("x-zeno-qa") !== env.ZENO_QA_CONTROL) return new Response(null, { status: 403 });
    try {
      const account = accounts.get(url.searchParams.get("account") ?? "a"); if (!account) throw new Error("account unavailable");
      if (env.ZENO_QA_ACCOUNT_SCROLL && url.pathname === "/__qa/scroll-error" && request.method === "POST") {
        failDeviceList = z.object({ enabled: z.boolean() }).strict().parse(await request.json()).enabled;
        return Response.json({ failDeviceList });
      }
      if (env.ZENO_QA_ACCOUNT_SCROLL && url.pathname === "/__qa/scroll-fixture" && request.method === "GET") return Response.json({ users: app?.database.sqlite.query("SELECT COUNT(*) AS count FROM user").get(), invites: app?.database.sqlite.query("SELECT COUNT(*) AS count FROM invite").get(), ...counts });
      if (url.pathname === "/__qa/state") {
        if (!app) throw new Error("fixture unavailable");
        const result = syncResultSchema.parse(syncRecords(app.database, account.userId, 0, 500));
        const latest = new Map(result.records.map(record => [record.kind + ":" + record.id, record]));
        return Response.json({ records: [...latest.values()].filter(record => !record.deletedAt), ...counts });
      }
      if (url.pathname === "/__qa/seed-stats" && request.method === "POST") {
        await save(account, createMutation("workout", workoutDataSchema.parse({ title: "合成统计训练", unit: "kg", startedAt: Date.now() - 60000, finishedAt: Date.now(), restEndsAt: null, notes: "", exercises: [{ id: "seed-bench", exerciseId: "0025", name: "杠铃卧推", restSeconds: 60, sets: [{ id: "seed-set", reps: 8, weight: 40, completed: true, completedAt: Date.now() }] }] })));
        return Response.json({ seeded: true });
      }
      if (url.pathname === "/__qa/media") return Response.json({ files: app?.database.sqlite.query("SELECT id,mime_type AS mime,bytes,sha256 FROM media WHERE user_id=? ORDER BY created_at,id").all(account.userId) ?? [] });
      if (url.pathname === "/__qa/admin") {
        const admin = accounts.get("admin"); if (!admin) throw new Error("admin unavailable");
        const invites: unknown = await (await call("/admin/invites", "GET", undefined, admin)).json();
        const parsed = z.object({ invites: z.array(z.object({ consumedAt: z.number().nullable(), revokedAt: z.number().nullable() })) }).parse(invites);
        return Response.json({ inviteCount: parsed.invites.length, revokedInvites: parsed.invites.filter(value => value.revokedAt !== null).length, features: Object.fromEntries(featureOverrides) });
      }
      if (url.pathname === "/__qa/remote-edit" && request.method === "POST") {
        const input = z.object({ id: z.string(), description: z.string(), workspaceId: z.string().nullable().optional() }).parse(await request.json());
        const result = syncResultSchema.parse(await (await call("/sync?cursor=0&limit=500", "GET", undefined, account)).json());
        const current = result.records.filter(record => record.kind === "event" && record.id === input.id).at(-1);
        if (!current || current.kind !== "event") throw new Error("remote event missing");
        const data = eventDataSchema.parse({ ...current.data, description: input.description, ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId ?? undefined }) });
        const response = await call("/records/event/" + encodeURIComponent(current.id), "PUT", createMutation("event", data, { id: current.id, baseVersion: current.version }), account);
        if (!response.ok) throw new Error("remote edit failed"); return Response.json({ version: mutationResultSchema.parse(await response.json()).record.version });
      }
      if (url.pathname === "/__qa/conflict" && request.method === "POST") {
        const result = syncResultSchema.parse(await (await call("/sync?cursor=0&limit=500", "GET", undefined, account)).json());
        const current = result.records.filter(record => record.kind === "event" && record.id === "qa-conflict").at(-1);
        if (!current || current.kind !== "event") throw new Error("conflict fixture missing");
        let changed = current;
        for (let index = 0; index < 2; index++) {
          const mutation = createMutation("event", { ...changed.data, title: index ? "远端第三版日程" : "远端第二版日程" }, { id: changed.id, baseVersion: changed.version });
          const saved = mutationResultSchema.parse(await (await call("/records/event/qa-conflict", "PUT", mutation, account)).json()).record;
          if (saved.kind !== "event") throw new Error("fixture kind mismatch"); changed = saved;
        }
        return Response.json({ changed: true, version: changed.version });
      }
      return new Response(null, { status: 404 });
    } catch { return Response.json({ error: "fixture control failed" }, { status: 500 }); }
  }
  if (!url.pathname.startsWith("/app/")) return new Response(null, { status: 404 });
  const requested = resolve(dist, decodeURIComponent(url.pathname.slice(5)));
  if (requested !== dist && !requested.startsWith(dist + sep)) return new Response(null, { status: 404 });
  const file = Bun.file(requested); const asset = await file.exists() && (await file.stat()).isFile() ? file : Bun.file(resolve(dist, "index.html"));
  if (!await asset.exists()) return new Response(null, { status: 404 });
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  if (url.pathname === "/app/zeno-canvas-shell.html") { headers.set("Content-Security-Policy", shellCsp); headers.set("Connection-Allowlist", "()"); }
  else if (asset.type.startsWith("text/html")) headers.set("Content-Security-Policy", htmlCsp);
  return new Response(asset, { headers });
} });
const origin = `http://127.0.0.1:${server.port}`;
app = createApp({ origin, databasePath: resolve(root, "accounts.sqlite"), mediaRoot: resolve(root, "media"), authSecret: secret() + secret(), featureEnabled: key => featureOverrides.get(key) ?? true, setFeature: (key, enabled) => { featureOverrides.set(key, enabled); } });
async function call(path: string, method = "GET", body?: unknown, account?: { cookie: string; userId: string }, bearer?: string): Promise<Response> {
  if (!app) throw new Error("fixture unavailable");
  return app.fetch(new Request(origin + prefix + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(bearer ? { Authorization: "Bearer " + bearer } : account ? { Cookie: account.cookie, "X-Zeno-Account": account.userId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), "127.0.0.2");
}
const adminEmail = env.ZENO_QA_ACCOUNT_SCROLL ? "qa@example.test" : "qa-admin@example.test";
const admin = await bootstrapAdmin(app.database, { email: adminEmail, name: "测试管理员", password: env.ZENO_QA_PASSWORD });
const adminLogin = await call("/auth/sign-in/email", "POST", { email: adminEmail, password: env.ZENO_QA_PASSWORD });
if (!adminLogin.ok) throw new Error("synthetic admin login failed");
accounts.set("admin", { userId: admin, cookie: adminLogin.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") });
for (const key of ["a", "b"]) {
  const email = `qa-${key}@example.test`; const invite = issueInvite(app.database, admin, email);
  const user = await redeemInvite(app.database, { token: invite.token, email, name: key === "a" ? "测试账号甲" : "测试账号乙", password: env.ZENO_QA_PASSWORD });
  const login = await call("/auth/sign-in/email", "POST", { email, password: env.ZENO_QA_PASSWORD });
  if (!login.ok) throw new Error("synthetic seed login failed");
  accounts.set(key, { userId: user.userId, cookie: login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") });
}
const a = accounts.get("a"); const b = accounts.get("b"); if (!a || !b) throw new Error("fixture account missing");
const now = Date.now(); const zone = "Asia/Shanghai"; const today = localDateKey(now, zone); const start = dateTimeInZone(today, "10:00", zone);
async function save(account: { userId: string; cookie: string }, mutation: ReturnType<typeof createMutation>, bearer?: string) {
  const response = await call("/records/" + mutation.kind + "/" + mutation.id, "PUT", mutation, account, bearer);
  if (!response.ok) throw new Error("synthetic record seeding failed: " + mutation.kind + ":" + response.status);
  return mutationResultSchema.parse(await response.json()).record;
}
await save(a, createMutation("event", eventDataSchema.parse({ title: "项目讨论", startAt: start, endAt: start + 3600000, timeZone: zone }), { id: "qa-discussion" }));
await save(a, createMutation("event", eventDataSchema.parse({ title: "冲突测试日程", startAt: start + 7200000, endAt: start + 10800000, timeZone: zone }), { id: "qa-conflict" }));
await save(a, createMutation("event", eventDataSchema.parse({ title: "页签甲编辑日程", startAt: start + 14400000, endAt: start + 16200000, timeZone: zone }), { id: "qa-tab-a" }));
await save(a, createMutation("event", eventDataSchema.parse({ title: "页签乙编辑日程", startAt: start + 18000000, endAt: start + 19800000, timeZone: zone }), { id: "qa-tab-b" }));
await save(b, createMutation("event", eventDataSchema.parse({ title: "乙账号专属日程", startAt: start, endAt: start + 3600000, timeZone: zone }), { id: "qa-b-only" }));
await save(a, createMutation("routine", routineDataSchema.parse({ title: "基础力量", description: "", exercises: [{ id: "bench", exerciseId: "0025", name: "杠铃卧推", restSeconds: 60, sets: [{ id: "bench-1", weight: 40, reps: 8 }, { id: "bench-2", weight: 40, reps: 8 }] }], progression: { mode: "double", repMin: 8, repMax: 10, increment: 2.5 } }), { id: "qa-routine" }));
// Provision a real test device through the same PKCE endpoints, with no local executor.
const verifier = secret();
const grant = z.object({ userCode: z.string(), deviceCode: z.string() }).parse(await (await call("/devices/authorization", "POST", { name: "测试电脑", platform: "linux", codeChallenge: challenge(verifier) })).json());
if (!(await call("/devices/approve", "POST", { userCode: grant.userCode }, a)).ok) throw new Error("fixture device approval failed");
const device = z.object({ deviceId: z.string(), accessToken: z.string() }).parse(await (await call("/devices/token", "POST", { deviceCode: grant.deviceCode, codeVerifier: verifier })).json());
if (!(await call("/devices/heartbeat", "POST", { inventory: { workspaces: [{ id: "qa-workspace", name: "测试工作区" }], models: [{ providerId: "synthetic", modelId: "no-live-model", label: "测试模型" }], appliedCursor: 0, windowOpen: false } }, a, device.accessToken)).ok) throw new Error("fixture heartbeat failed");
await save(a, createMutation("task", taskDataSchema.parse({ title: "每周回顾", instructions: "整理本周日程", deviceId: device.deviceId, workspaceId: "qa-workspace", model: { providerId: "synthetic", modelId: "no-live-model" }, schedule: { frequency: "weekly", startAt: start, timeZone: zone, weekdays: [1] } }), { id: "qa-task" }));
if (env.ZENO_QA_ACCOUNT_SCROLL) {
  for (let index = 1; index <= 18; index++) {
    const email = `scroll-member-${String(index).padStart(2, "0")}@example.test`;
    const invite = issueInvite(app.database, admin, email);
    await redeemInvite(app.database, { token: invite.token, email, name: `合成成员 ${String(index).padStart(2, "0")}`, password: env.ZENO_QA_PASSWORD });
  }
  for (let index = 1; index <= 24; index++) issueInvite(app.database, admin, `scroll-invite-${String(index).padStart(2, "0")}@example.test`);
}
console.info(JSON.stringify({ ready: true, origin, synthetic: true }));
let stopped = false;
const stop = async () => { if (stopped) return; stopped = true; await server.stop(true); app?.close(); };
process.on("SIGTERM", () => void stop()); process.on("SIGINT", () => void stop());
