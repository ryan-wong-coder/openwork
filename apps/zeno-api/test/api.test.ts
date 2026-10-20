import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createMutation, eventDataSchema, runDataSchema, requestDataSchema, taskDataSchema, mutationResultSchema, syncResultSchema } from "@zeno/core";
import { createApp, type AppOptions } from "../src/app";
import { bootstrapAdmin, issueInvite, issuePasswordReset, redeemInvite } from "../src/auth";
import { challenge, secret } from "../src/crypto";
import { PREFIX } from "../src/http";
import { createOperatorResolver, setOperatorFeature, operatorKeySchema } from "../src/operator";
import { ZenoClient } from "../../../packages/zeno-core/src/gen/sdk.gen";
import { createClient } from "../../../packages/zeno-core/src/gen/client";

const origin = "http://127.0.0.1:8790";
const password = "synthetic-test-password-123";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const finish of cleanup.splice(0)) await finish(); });
async function fixture(featureEnabled: NonNullable<AppOptions["featureEnabled"]> = () => true, operator = false) {
  const root = await mkdtemp(join(tmpdir(), "zeno-api-test-"));
  const profile = join(root, "operator-profile.json"); let setFeature: AppOptions["setFeature"];
  if (operator) for (const key of operatorKeySchema.options) setOperatorFeature(profile, key, "true");
  if (operator) setFeature = (key, enabled) => { setOperatorFeature(profile, key, String(enabled)); };
  const app = createApp({ origin, databasePath: join(root, "account.sqlite"), mediaRoot: join(root, "media"), authSecret: "synthetic-only-auth-secret-for-zeno-api-tests", featureEnabled: operator ? createOperatorResolver(profile) : featureEnabled, setFeature });
  cleanup.push(async () => { app.close(); await rm(root, { recursive: true, force: true }); });
  const adminId = await bootstrapAdmin(app.database, { email: "admin@example.test", name: "Test admin", password });
  const call = (path: string, method = "GET", body?: unknown, credential?: string, expectedAccount?: string) => app.fetch(new Request(origin + PREFIX + path, {
    method, headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(credential?.startsWith("zdt_") ? { Authorization: `Bearer ${credential}` } : credential ? { Cookie: credential } : {}), ...(expectedAccount ? { "X-Zeno-Account": expectedAccount } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const login = async (email: string, inputPassword = password) => {
    const response = await call("/auth/sign-in/email", "POST", { email, password: inputPassword });
    expect(response.status).toBe(200);
    return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  };
  const account = async (email = "member@example.test") => {
    const invite = issueInvite(app.database, adminId, email);
    const user = await redeemInvite(app.database, { token: invite.token, email, name: "Test member", password });
    return { ...user, cookie: await login(email) };
  };
  const connect = async (cookie: string, name = "Test computer") => {
    const verifier = secret();
    const started = await call("/devices/authorization", "POST", { name, platform: "linux", codeChallenge: challenge(verifier) });
    expect(started.status).toBe(201);
    const grant = z.object({ deviceCode: z.string(), userCode: z.string() }).parse(await started.json());
    expect((await call("/devices/approve", "POST", { userCode: grant.userCode }, cookie)).status).toBe(200);
    const response = await call("/devices/token", "POST", { deviceCode: grant.deviceCode, codeVerifier: verifier });
    expect(response.status).toBe(200);
    return z.object({ deviceId: z.string(), accessToken: z.string() }).parse(await response.json());
  };
  return { app, root, profile, adminId, call, login, account, connect };
}
function event(title = "Synthetic plan") { return eventDataSchema.parse({ title, startAt: 1_800_000_000_000, endAt: 1_800_003_600_000, timeZone: "Asia/Shanghai" }); }

describe("independent invitation accounts", () => {
  test("browser auth uses HttpOnly cookies without copying bearer credentials into JSON responses", async () => {
    const f = await fixture();
    const login = await f.call("/auth/sign-in/email", "POST", { email: "admin@example.test", password }); expect(login.status).toBe(200);
    expect(login.headers.getSetCookie().some(value => /HttpOnly/i.test(value))).toBe(true);
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const token = z.object({ token: z.string() }).parse(f.app.database.sqlite.query("SELECT token FROM session LIMIT 1").get()).token;
    expect(JSON.stringify(await login.json())).not.toContain(token);
    for (const path of ["/auth/get-session", "/auth/list-sessions"]) {
      const response = await f.call(path, "GET", undefined, cookie); expect(response.status).toBe(200);
      expect(JSON.stringify(await response.json())).not.toContain(token);
    }
    expect((await f.call("/me", "GET", undefined, cookie)).status).toBe(200);
    const changed = await f.call("/auth/change-password", "POST", { currentPassword: password, newPassword: password + "-changed", revokeOtherSessions: true }, cookie);
    expect(changed.status).toBe(200); expect(z.object({ user: z.object({ id: z.string() }) }).parse(await changed.json()).user.id).toBe(f.adminId);
  });
  test("public signup is refused; invitation is email-bound and consumed atomically under concurrency", async () => {
    const f = await fixture();
    expect((await f.call("/auth/sign-up/email", "POST", { email: "public@example.test", name: "Public", password })).status).toBe(404);
    const invite = issueInvite(f.app.database, f.adminId, "member@example.test");
    expect((await f.call("/invites/redeem", "POST", { token: invite.token, email: "other@example.test", name: "Test", password })).status).toBe(400);
    const results = await Promise.all([f.call("/invites/redeem", "POST", { token: invite.token, email: invite.email, name: "Test", password }), f.call("/invites/redeem", "POST", { token: invite.token, email: invite.email, name: "Test", password })]);
    expect(results.map(value => value.status).sort()).toEqual([201, 400]);
    expect(f.app.database.sqlite.query("SELECT id FROM user WHERE email=?").all(invite.email)).toHaveLength(1);
    const cookie = await f.login(invite.email);
    expect((await f.call("/me", "GET", undefined, cookie)).status).toBe(200);
    expect((await f.call("/auth/sign-out", "POST", {}, cookie)).status).toBe(200);
    expect((await f.call("/me", "GET", undefined, cookie)).status).toBe(401);
  });
  test("expired invitations and cross-origin cookie mutations are rejected", async () => {
    const f = await fixture(); const invite = issueInvite(f.app.database, f.adminId, "expired@example.test", Date.now() - 100_000, 10);
    expect((await f.call("/invites/redeem", "POST", { token: invite.token, email: invite.email, name: "Test", password })).status).toBe(400);
    const member = await f.account();
    const denied = await f.app.fetch(new Request(origin + PREFIX + "/devices/approve", { method: "POST", headers: { Cookie: member.cookie, Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ userCode: "not-a-code" }) }));
    expect(denied.status).toBe(403);
  });
  test("password reset tokens are one-time and revoke sessions, devices and pending device approvals", async () => {
    const f = await fixture(); const member = await f.account(); const device = await f.connect(member.cookie);
    const reset = issuePasswordReset(f.app.database, f.adminId, member.email);
    const updated = "different-synthetic-password-456";
    const results = await Promise.all([f.call("/password/reset", "POST", { token: reset.token, password: updated }), f.call("/password/reset", "POST", { token: reset.token, password: updated })]);
    expect(results.map(value => value.status).sort()).toEqual([200, 400]);
    expect((await f.call("/me", "GET", undefined, member.cookie)).status).toBe(401);
    expect((await f.call("/me", "GET", undefined, device.accessToken)).status).toBe(401);
    expect((await f.call("/auth/sign-in/email", "POST", { email: member.email, password })).status).toBe(401);
    expect((await f.call("/me", "GET", undefined, await f.login(member.email, updated))).status).toBe(200);
  });
});

describe("device binding", () => {
  test("PKCE, browser approval and one-time redemption protect credentials; revoke takes effect immediately", async () => {
    const f = await fixture(); const member = await f.account(); const verifier = secret();
    const started = await f.call("/devices/authorization", "POST", { name: "Test device", platform: "darwin", codeChallenge: challenge(verifier) });
    const grant = z.object({ deviceCode: z.string(), userCode: z.string() }).parse(await started.json());
    expect((await f.call("/devices/token", "POST", { deviceCode: grant.deviceCode, codeVerifier: verifier })).status).toBe(428);
    expect((await f.call("/devices/approve", "POST", { userCode: grant.userCode }, member.cookie)).status).toBe(200);
    expect((await f.call("/devices/token", "POST", { deviceCode: grant.deviceCode, codeVerifier: secret() })).status).toBe(400);
    const exchanged = await f.call("/devices/token", "POST", { deviceCode: grant.deviceCode, codeVerifier: verifier });
    const device = z.object({ deviceId: z.string(), accessToken: z.string() }).parse(await exchanged.json());
    expect((await f.call("/devices/token", "POST", { deviceCode: grant.deviceCode, codeVerifier: verifier })).status).toBe(400);
    expect(JSON.stringify(f.app.database.sqlite.query("SELECT * FROM device").all())).not.toContain(device.accessToken);
    const heartbeat = { inventory: { workspaces: [{ id: "workspace-test", name: "Test workspace" }], models: [{ providerId: "modelhelm", modelId: "fixture-model" }], appliedCursor: 2, windowOpen: false } };
    expect((await f.call("/devices/heartbeat", "POST", heartbeat, device.accessToken)).status).toBe(200);
    const listed = await f.call("/devices"); expect(listed.status).toBe(401);
    const devices = z.object({ devices: z.array(z.object({ id: z.string(), workspaces: z.array(z.unknown()), appliedCursor: z.number() })) }).parse(await (await f.call("/devices", "GET", undefined, member.cookie)).json());
    expect(devices.devices[0]?.workspaces).toHaveLength(1); expect(devices.devices[0]?.appliedCursor).toBe(2);
    expect((await f.call("/devices/heartbeat", "POST", { inventory: { ...heartbeat.inventory, apiKey: "not-a-real-key" } }, device.accessToken)).status).toBe(400);
    expect((await f.call(`/devices/${device.deviceId}`, "DELETE", undefined, member.cookie)).status).toBe(200);
    expect((await f.call("/me", "GET", undefined, device.accessToken)).status).toBe(401);
  });
});

describe("record sync and authority", () => {
  test("retired device tasks can be removed and pending requests cancelled, while expired/revoked targets reject new work", async () => {
    for (const retired of ["expired", "revoked"]) {
      const f = await fixture(); const member = await f.account(); const device = await f.connect(member.cookie);
      const task = createMutation("task", taskDataSchema.parse({ title: "Retired device task", instructions: "Synthetic", deviceId: device.deviceId, workspaceId: "fixture-workspace", model: { providerId: "fixture", modelId: "fixture" }, schedule: { startAt: Date.now() + 60000, timeZone: "UTC" } }), { id: "retired-task" });
      const request = createMutation("request", requestDataSchema.parse({ type: "run_task", taskId: task.id, deviceId: device.deviceId, createdAt: Date.now(), expiresAt: Date.now() + 60000 }), { id: "retired-request" });
      expect((await f.call(`/records/task/${task.id}`, "PUT", task, member.cookie)).status).toBe(200);
      expect((await f.call(`/records/request/${request.id}`, "PUT", request, member.cookie)).status).toBe(200);
      if (retired === "expired") f.app.database.sqlite.query("UPDATE device SET expires_at=? WHERE id=?").run(Date.now() - 1, device.deviceId);
      else expect((await f.call(`/devices/${device.deviceId}`, "DELETE", undefined, member.cookie)).status).toBe(200);
      expect((await f.call("/records/task/new-retired-task", "PUT", { ...task, id: "new-retired-task", operationId: "new-retired-operation" }, member.cookie)).status).toBe(400);
      expect((await f.call(`/records/task/${task.id}`, "PUT", { ...task, deleted: true, baseVersion: 1, operationId: "retired-delete" }, member.cookie)).status).toBe(200);
      if (request.kind !== "request") throw new Error("Fixture request kind");
      expect((await f.call(`/records/request/${request.id}`, "PUT", { ...request, baseVersion: 1, operationId: "retired-cancel", data: { ...request.data, cancelRequested: true } }, member.cookie)).status).toBe(200);
    }
  });
  test("batch validation uses the shared 101-item boundary and rejects overflow before any mutation", async () => {
    const f = await fixture(); const member = await f.account();
    const mutations = Array.from({ length: 102 }, (_, index) => createMutation("event", event(), { id: `bounded-${index}`, operationId: `bounded-operation-${index}` }));
    expect((await f.call("/records/batch", "POST", { operationId: "oversized-batch", mutations }, member.cookie)).status).toBe(400);
    expect(syncResultSchema.parse(await (await f.call("/sync", "GET", undefined, member.cookie)).json()).records).toHaveLength(0);
    expect((await f.call("/records/batch", "POST", { operationId: "valid-boundary-batch", mutations: mutations.slice(0, 101) }, member.cookie)).status).toBe(200);
  });
  test("generated ZenoClient uses the actual local dispatcher for me, batch conflicts and private multipart media", async () => {
    const f = await fixture(); const member = await f.account();
    const localFetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => f.app.fetch(input instanceof Request ? input : new Request(input, init)), { preconnect: () => {} });
    const sdk = new ZenoClient({ client: createClient({ baseUrl: origin, headers: { Cookie: member.cookie, Origin: origin }, fetch: localFetch }) });
    const me = await sdk.getMe({ "X-Zeno-Account": member.userId }); expect(me.response?.status).toBe(200); expect(me.data?.user.id).toBe(member.userId);
    const mutation = createMutation("event", event(), { id: "sdk-event", operationId: "sdk-operation" });
    const batch = await sdk.mutateRecordsBatch({ "X-Zeno-Account": member.userId, batchMutation: { operationId: "sdk-batch", mutations: [mutation] } }); expect(batch.response?.status).toBe(200); expect(batch.data?.results[0]?.record.id).toBe(mutation.id);
    const stale = await sdk.putRecord({ "X-Zeno-Account": member.userId, kind: "event", id: mutation.id, recordMutation: { ...mutation, operationId: "sdk-stale" } }); expect(stale.response?.status).toBe(409); expect(stale.error?.code).toBe("conflict");
    const switched = await sdk.getMe({ "X-Zeno-Account": "wrong-synthetic-account" }); expect(switched.response?.status).toBe(409); expect(switched.error?.code).toBe("account_changed");
    const upload = await sdk.uploadMedia({ "X-Zeno-Account": member.userId, file: new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer], "sdk.png", { type: "image/png" }) }); expect(upload.response?.status).toBe(201); expect(upload.data?.mime).toBe("image/png");
    const anonymous = new ZenoClient({ client: createClient({ baseUrl: origin, fetch: localFetch }) }); expect((await anonymous.getMe()).response?.status).toBe(401);
  });
  test("account-bound writes reject cross-tab cookies and device credentials before touching another account", async () => {
    const f = await fixture(); const a = await f.account("bound-one@example.test"); const b = await f.account("bound-two@example.test"); const device = await f.connect(b.cookie);
    const mutation = createMutation("event", event(), { id: "bound-event", operationId: "bound-operation" });
    for (const credential of [b.cookie, device.accessToken]) {
      const response = await f.call("/records/event/bound-event", "PUT", mutation, credential, a.userId);
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: "account_changed", message: "账号已改变，请重新登录。" });
      expect((await f.call("/me", "GET", undefined, credential, a.userId)).status).toBe(409);
    }
    expect(syncResultSchema.parse(await (await f.call("/sync", "GET", undefined, b.cookie)).json()).records).toHaveLength(0);
    expect(f.app.database.sqlite.query("SELECT op_id FROM operation WHERE op_id='bound-operation'").get()).toBeNull();
    expect((await f.call("/records/event/bound-event", "PUT", mutation, b.cookie, b.userId)).status).toBe(200);
  });
  test("per-user writes, tombstones, pagination and operation replay never leak across accounts, including admin", async () => {
    const f = await fixture(); const a = await f.account("one@example.test"); const b = await f.account("two@example.test");
    const mutation = createMutation("event", event(), { id: "same-id", operationId: "same-operation" });
    const saved = mutationResultSchema.parse(await (await f.call("/records/event/same-id", "PUT", mutation, a.cookie)).json());
    expect(saved.record.userId).toBe(a.userId);
    expect((await f.call("/records/event/same-id", "GET", undefined, b.cookie)).status).toBe(404);
    expect((await f.call("/records/event/same-id", "GET", undefined, await f.login("admin@example.test"))).status).toBe(404);
    const replay = mutationResultSchema.parse(await (await f.call("/records/event/same-id", "PUT", mutation, a.cookie)).json()); expect(replay.replayed).toBe(true);
    const changed = { ...mutation, data: { ...mutation.data, title: "Other title" } };
    expect((await f.call("/records/event/same-id", "PUT", changed, a.cookie)).status).toBe(409);
    const independent = mutationResultSchema.parse(await (await f.call("/records/event/same-id", "PUT", mutation, b.cookie)).json()); expect(independent.record.userId).toBe(b.userId);
    const deletion = { ...mutation, operationId: "delete-operation", baseVersion: 1, deleted: true };
    expect((await f.call("/records/event/same-id", "PUT", deletion, a.cookie)).status).toBe(200);
    const first = syncResultSchema.parse(await (await f.call("/sync?cursor=0&limit=1", "GET", undefined, a.cookie)).json()); expect(first.hasMore).toBe(true);
    const last = syncResultSchema.parse(await (await f.call(`/sync?cursor=${first.cursor}`, "GET", undefined, a.cookie)).json()); expect(last.records).toHaveLength(1); expect(last.records[0]?.deletedAt).not.toBeNull(); expect(last.records.every(value => value.userId === a.userId)).toBe(true);
  });
  test("stale mutations return current+submitted; a conflicting batch rolls back all records and replay receipts", async () => {
    const f = await fixture(); const member = await f.account(); const existing = createMutation("event", event(), { id: "existing", operationId: "existing-op" });
    expect((await f.call("/records/event/existing", "PUT", existing, member.cookie)).status).toBe(200);
    const stale = { ...existing, operationId: "stale-op" };
    const conflict = await f.call("/records/event/existing", "PUT", stale, member.cookie); expect(conflict.status).toBe(409);
    const detail = z.object({ code: z.literal("conflict"), current: z.object({ version: z.literal(1) }), submitted: z.object({ operationId: z.literal("stale-op") }) }).parse(await conflict.json()); expect(detail.code).toBe("conflict");
    const fresh = createMutation("event", event("Fresh"), { id: "fresh", operationId: "fresh-op" });
    expect((await f.call("/records/batch", "POST", { operationId: "batch-one", mutations: [fresh, stale] }, member.cookie)).status).toBe(409);
    expect((await f.call("/records/event/fresh", "GET", undefined, member.cookie)).status).toBe(404);
    expect(f.app.database.sqlite.query("SELECT op_id FROM operation WHERE op_id='fresh-op'").get()).toBeNull();
    const valid = { ...stale, baseVersion: 1 };
    const batch = { operationId: "batch-two", mutations: [fresh, valid] };
    const result = await f.call("/records/batch", "POST", batch, member.cookie); expect(result.status).toBe(200);
    const replay = z.object({ replayed: z.literal(true), results: z.array(z.unknown()).length(2) }).parse(await (await f.call("/records/batch", "POST", batch, member.cookie)).json()); expect(replay.replayed).toBe(true);
  });
  test("browser cannot forge AI receipts or progress and another device cannot write bound requests", async () => {
    const f = await fixture(); const member = await f.account(); const one = await f.connect(member.cookie); const two = await f.connect(member.cookie);
    const run = createMutation("run", runDataSchema.parse({ deviceId: one.deviceId, scheduledAt: Date.now(), status: "succeeded" }));
    expect((await f.call(`/records/run/${run.id}`, "PUT", run, member.cookie)).status).toBe(403);
    expect((await f.call(`/records/run/${run.id}`, "PUT", run, two.accessToken)).status).toBe(403);
    expect((await f.call(`/records/run/${run.id}`, "PUT", run, one.accessToken)).status).toBe(200);
    const request = createMutation("request", requestDataSchema.parse({ type: "chat", deviceId: one.deviceId, prompt: "Synthetic request", createdAt: Date.now(), expiresAt: Date.now() + 60000 }));
    expect((await f.call(`/records/request/${request.id}`, "PUT", request, member.cookie)).status).toBe(200);
    if (request.kind !== "request") throw new Error("Fixture kind");
    const progress = { ...request, baseVersion: 1, operationId: "progress-op", data: { ...request.data, status: "running" } };
    expect((await f.call(`/records/request/${request.id}`, "PUT", progress, member.cookie)).status).toBe(403);
    expect((await f.call(`/records/request/${request.id}`, "PUT", progress, two.accessToken)).status).toBe(403);
    expect((await f.call(`/records/request/${request.id}`, "PUT", progress, one.accessToken)).status).toBe(200);
    const cancel = { ...request, baseVersion: 2, operationId: "cancel-op", data: { ...progress.data, cancelRequested: true } };
    expect((await f.call(`/records/request/${request.id}`, "PUT", cancel, member.cookie)).status).toBe(200);
  });
  test("unknown owner/key fields are rejected in both envelopes and nested proposal changes", async () => {
    const f = await fixture(); const member = await f.account(); const device = await f.connect(member.cookie);
    expect((await f.call("/records/settings/settings-one", "PUT", { operationId: "unknown-key-op", id: "settings-one", kind: "settings", baseVersion: 0, data: { timeZone: "UTC", modelKey: "synthetic-rejected" } }, member.cookie)).status).toBe(400);
    expect((await f.call("/records/event/unknown-owner", "PUT", { ...createMutation("event", event(), { id: "unknown-owner" }), userId: "different-owner" }, member.cookie)).status).toBe(400);
    expect((await f.call("/records/proposal/proposal-one", "PUT", { operationId: "nested-key-op", id: "proposal-one", kind: "proposal", baseVersion: 0, data: { title: "Synthetic proposal", source: "scheduled", createdAt: Date.now(), changes: [{ kind: "event", id: "event-one", baseVersion: 0, data: { ...event(), apiKey: "synthetic-rejected" } }] } }, device.accessToken)).status).toBe(400);
  });
});

describe("private media and management", () => {
  test("media applies shared image/video limits and accepts only a WebM EBML DocType", async () => {
    const f = await fixture(); const member = await f.account();
    const upload = async (type: string, bytes: Uint8Array) => {
      const form = new FormData(); form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type }), type === "video/webm" ? "test.webm" : "test.png");
      return f.app.fetch(new Request(origin + PREFIX + "/media", { method: "POST", headers: { Origin: origin, Cookie: member.cookie }, body: form }));
    };
    const image = new Uint8Array(12 * 1024 * 1024); image.set([137, 80, 78, 71, 13, 10, 26, 10]); expect((await upload("image/png", image)).status).toBe(413);
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
    const saved = await upload("video/webm", webm); expect(saved.status).toBe(201);
    const metadata = z.object({ id: z.string(), mime: z.literal("video/webm") }).parse(await saved.json());
    const downloaded = await f.call(`/media/${metadata.id}`, "GET", undefined, member.cookie); expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(webm);
    const wrongDocType = webm.slice(); wrongDocType.set([0x6e, 0x6f, 0x70, 0x65], 8); expect((await upload("video/webm", wrongDocType)).status).toBe(415);
    expect((await upload("video/webm", new TextEncoder().encode("fake webm content"))).status).toBe(415);
  });
  test("admin Cookie rollout shares atomic CLI storage; ordinary and native accounts cannot modify it and history stays exportable", async () => {
    const f = await fixture(() => true, true); const member = await f.account(); const admin = await f.login("admin@example.test"); const native = await f.connect(admin);
    const mutation = createMutation("event", event()); expect((await f.call(`/records/event/${mutation.id}`, "PUT", mutation, member.cookie)).status).toBe(200);
    for (const credential of [member.cookie, native.accessToken]) {
      expect((await f.call("/admin/features", "GET", undefined, credential)).status).toBe(403);
      expect((await f.call("/admin/features", "PUT", { key: "personalCalendar", enabled: false }, credential)).status).toBe(403);
    }
    expect((await f.call("/admin/features", "PUT", { key: "unrelatedFlag", enabled: true }, admin)).status).toBe(400);
    expect((await f.call("/admin/features", "PUT", { key: "personalCalendar", enabled: false, unknown: true }, admin)).status).toBe(400);
    const toggled = await f.call("/admin/features", "PUT", { key: "personalCalendar", enabled: false }, admin); expect(toggled.status).toBe(200);
    expect(await toggled.json()).toEqual({ zenoAccounts: true, personalCalendar: false, fitnessTracking: true, localScheduledTasks: true });
    expect(createOperatorResolver(f.profile)("personalCalendar")).toBe(false);
    expect((await f.call(`/records/event/${mutation.id}`, "PUT", { ...mutation, operationId: "rollout-edit", baseVersion: 1 }, member.cookie)).status).toBe(404);
    expect(syncResultSchema.parse(await (await f.call("/sync", "GET", undefined, member.cookie)).json()).records).toHaveLength(1);
    setOperatorFeature(f.profile, "personalCalendar", "true");
    expect(z.object({ personalCalendar: z.literal(true) }).parse(await (await f.call("/admin/features", "GET", undefined, admin)).json()).personalCalendar).toBe(true);
    expect((await f.call("/admin/features", "PUT", { key: "zenoAccounts", enabled: false }, admin)).status).toBe(200);
    expect((await f.call("/admin/features", "PUT", { key: "zenoAccounts", enabled: true }, admin)).status).toBe(200);
  });
  test("uploads require authentication, reject active/mislabeled content, enforce ownership and support ranges", async () => {
    const f = await fixture(); const a = await f.account("photo-one@example.test"); const b = await f.account("photo-two@example.test");
    const upload = async (cookie: string, type: string, bytes: Uint8Array) => {
      const form = new FormData(); form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type }), "test.png");
      return f.app.fetch(new Request(origin + PREFIX + "/media", { method: "POST", headers: { Origin: origin, Cookie: cookie }, body: form }));
    };
    expect((await upload(a.cookie, "image/svg+xml", new TextEncoder().encode("<svg/>"))).status).toBe(415);
    expect((await upload(a.cookie, "image/png", new TextEncoder().encode("<html>bad</html>"))).status).toBe(415);
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const response = await upload(a.cookie, "image/png", png); expect(response.status).toBe(201);
    const media = z.object({ id: z.string(), size: z.number() }).parse(await response.json()); expect(media.size).toBe(png.length);
    expect((await f.call(`/media/${media.id}`)).status).toBe(401);
    expect((await f.call(`/media/${media.id}`, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await f.call(`/media/${media.id}`, "DELETE", undefined, b.cookie)).status).toBe(404);
    const range = await f.app.fetch(new Request(origin + PREFIX + `/media/${media.id}`, { headers: { Cookie: a.cookie, Range: "bytes=0-7" } }));
    expect(range.status).toBe(206); expect(range.headers.get("cache-control")).toBe("private, no-store"); expect(new Uint8Array(await range.arrayBuffer())).toEqual(png.slice(0, 8));
    const measurement = { kind: "measurement", id: "removed-photo-measurement", operationId: "photo-measurement-create", baseVersion: 0, data: { at: Date.now(), photoMediaIds: [media.id] } };
    expect((await f.call(`/records/measurement/${measurement.id}`, "PUT", measurement, a.cookie)).status).toBe(200);
    const workout = { kind: "workout", id: "private-workout-media", operationId: "workout-media-create", baseVersion: 0, data: { title: "训练照片", startedAt: Date.now(), exercises: [], mediaIds: [media.id] } };
    expect((await f.call(`/records/workout/${workout.id}`, "PUT", workout, b.cookie)).status).toBe(400);
    expect((await f.call(`/records/workout/${workout.id}`, "PUT", workout, a.cookie)).status).toBe(200);
    expect((await f.call(`/media/${media.id}`, "DELETE", undefined, a.cookie)).status).toBe(200);
    expect((await f.call(`/media/${media.id}`, "GET", undefined, a.cookie)).status).toBe(404);
    expect((await f.call(`/records/measurement/${measurement.id}`, "PUT", { ...measurement, baseVersion: 1, operationId: "photo-measurement-delete", deleted: true }, a.cookie)).status).toBe(200);
    expect((await f.call(`/records/workout/${workout.id}`, "PUT", { ...workout, baseVersion: 1, operationId: "workout-media-delete", deleted: true }, a.cookie)).status).toBe(200);
  });
  test("admin has account/device management only; no admin business-data path exists", async () => {
    const f = await fixture(); const member = await f.account();
    expect((await f.call("/admin/users", "GET", undefined, member.cookie)).status).toBe(403);
    const admin = await f.login("admin@example.test");
    const users = await f.call("/admin/users", "GET", undefined, admin); expect(users.status).toBe(200);
    const parsed = z.object({ users: z.array(z.object({ id: z.string(), disabled: z.boolean() })) }).parse(await users.json());
    expect(parsed.users.find(user => user.id === member.userId)?.disabled).toBe(false);
    expect((await f.call(`/admin/users/${member.userId}/records`, "GET", undefined, admin)).status).toBe(404);
  });
  test("admin can list safe invitation metadata and revoke an unused invitation", async () => {
    const f = await fixture(); const admin = await f.login("admin@example.test"); const member = await f.account();
    const invite = issueInvite(f.app.database, f.adminId, "revoke-invite@example.test");
    expect((await f.call("/admin/invites", "GET", undefined, member.cookie)).status).toBe(403);
    expect((await f.call(`/admin/invites/${invite.id}`, "DELETE", undefined, member.cookie)).status).toBe(403);
    const listed = await (await f.call("/admin/invites", "GET", undefined, admin)).json();
    const parsed = z.object({ invites: z.array(z.object({ id: z.string(), email: z.string(), createdAt: z.number(), expiresAt: z.number(), consumedAt: z.number().nullable(), revokedAt: z.number().nullable() }).strict()) }).parse(listed);
    expect(parsed.invites.some(value => value.id === invite.id)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(invite.token); expect(JSON.stringify(listed)).not.toContain("secret_hash");
    expect((await f.call(`/admin/invites/${invite.id}`, "DELETE", undefined, admin)).status).toBe(200);
    expect((await f.call("/invites/redeem", "POST", { token: invite.token, email: invite.email, name: "Synthetic member", password })).status).toBe(400);
    const revoked = z.object({ invites: z.array(z.object({ id: z.string(), revokedAt: z.number().nullable() })) }).parse(await (await f.call("/admin/invites", "GET", undefined, admin)).json());
    expect(revoked.invites.find(value => value.id === invite.id)?.revokedAt).not.toBeNull();
  });
  test("feature shutdown preserves readable history and blocks new domain writes", async () => {
    let enabled = true; const f = await fixture(() => enabled); const member = await f.account();
    const mutation = createMutation("event", event());
    expect((await f.call(`/records/event/${mutation.id}`, "PUT", mutation, member.cookie)).status).toBe(200);
    enabled = false;
    expect((await f.call(`/records/event/${mutation.id}`, "PUT", { ...mutation, operationId: "closed-feature-edit", baseVersion: 1 }, member.cookie)).status).toBe(404);
    expect(syncResultSchema.parse(await (await f.call("/sync", "GET", undefined, member.cookie)).json()).records).toHaveLength(1);
  });
  test("fitness shutdown protects embedded equipment and day notes while account preferences remain editable", async () => {
    let fitnessEnabled = true; const f = await fixture(key => key !== "fitnessTracking" || fitnessEnabled); const member = await f.account();
    const settings = { kind: "settings", id: "personal-settings", baseVersion: 0, operationId: "settings-create", data: { timeZone: "UTC", fitnessEquipment: { available: ["barbell"] } } };
    expect((await f.call(`/records/settings/${settings.id}`, "PUT", settings, member.cookie)).status).toBe(200);
    fitnessEnabled = false;
    const preferences = { ...settings, baseVersion: 1, operationId: "settings-unit", data: { ...settings.data, unit: "lb" } };
    expect((await f.call(`/records/settings/${settings.id}`, "PUT", preferences, member.cookie)).status).toBe(200);
    expect((await f.call(`/records/settings/${settings.id}`, "PUT", { ...preferences, baseVersion: 2, operationId: "blocked-equipment", data: { ...preferences.data, fitnessEquipment: { available: [] } } }, member.cookie)).status).toBe(404);
    expect((await f.call(`/records/settings/${settings.id}`, "PUT", { ...preferences, baseVersion: 2, operationId: "blocked-settings-delete", deleted: true }, member.cookie)).status).toBe(404);
    const history = syncResultSchema.parse(await (await f.call("/sync", "GET", undefined, member.cookie)).json()); expect(history.records.at(-1)?.version).toBe(2);
  });
  test("service paths never start AI or make outbound fetches, including local-task sync", async () => {
    let outbound = 0;
    const denyFetch = Object.assign(() => { outbound++; throw new Error("Outbound fetch denied by synthetic fixture"); }, { preconnect: () => { outbound++; throw new Error("Outbound preconnect denied"); } });
    const network = spyOn(globalThis, "fetch").mockImplementation(denyFetch);
    try {
      const f = await fixture(); const member = await f.account(); const device = await f.connect(member.cookie);
      const task = createMutation("task", taskDataSchema.parse({ title: "Synthetic local task", instructions: "Synthetic instructions", deviceId: device.deviceId, workspaceId: "workspace-test", model: { providerId: "modelhelm", modelId: "fixture-model" }, schedule: { startAt: Date.now(), timeZone: "Asia/Shanghai" } }));
      expect((await f.call(`/records/task/${task.id}`, "PUT", task, member.cookie)).status).toBe(200);
      expect((await f.call("/sync", "GET", undefined, device.accessToken)).status).toBe(200);
      expect((await f.call("/ai/run", "POST", {}, member.cookie)).status).toBe(404);
      expect((await f.call("/gateway/config", "PUT", { apiKey: "synthetic-denied-field" }, member.cookie)).status).toBe(404);
      expect(outbound).toBe(0);
      const source = join(import.meta.dir, "../src");
      for (const file of await readdir(source)) {
        if (!file.endsWith(".ts")) continue;
        const text = await readFile(join(source, file), "utf8");
        const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);
        expect(imports.some(name => /opencode|headless|den-api|remote-sessions|modelhelm/i.test(name ?? ""))).toBe(false);
      }
    } finally { network.mockRestore(); }
  });
});
