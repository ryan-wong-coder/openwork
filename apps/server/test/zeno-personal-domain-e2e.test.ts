import { afterEach, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createMutation, personalRecordSchema, syncResultSchema } from "../../../packages/zeno-core/src/index";
import { createApp } from "../../zeno-api/src/app";
import { bootstrapAdmin, issueInvite } from "../../zeno-api/src/auth";
import { createUiControlServer } from "../../desktop/electron/ui-control-server.mjs";
import { createZenoPersonalService } from "../../desktop/electron/zeno-personal.mjs";
import { createZenoPersonalToolsService } from "../../desktop/electron/zeno-personal-tools.mjs";
import { OpenWorkExtensionsPreview } from "../src/opencode-plugins/openwork-extensions-preview";

// Domain integration: registered V1 tool -> discovery -> real /personal HTTP
// bridge -> native service -> real PKCE device grant -> API -> private SQLite.
// No desktop window, model, production account, or production network is used.
const INTERACTIVE = "ses_synthetic_domain_interactive";
const SCHEDULED = "ses_synthetic_domain_scheduled";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const readSchema = z.object({
  ok: z.literal(true), records: z.array(personalRecordSchema), total: z.number(),
  offset: z.number(), limit: z.number(), nextOffset: z.number().nullable(), truncated: z.boolean(),
  schemas: z.record(z.string(), z.unknown()),
});
const catalogueSchema = z.object({
  ok: z.literal(true), total: z.number(), nextOffset: z.number().nullable(),
  exercises: z.array(z.object({
    exerciseId: z.string(), name: z.string(), source: z.enum(["builtin", "custom"]),
    instructions: z.array(z.string()), demo: z.object({ kind: z.string(), video: z.string(), poster: z.string() }).nullable(),
  }).passthrough()),
});
const writtenSchema = z.object({ ok: z.literal(true), record: personalRecordSchema, undo: z.object({ id: z.string() }), reviewRequired: z.boolean() });
const recordSchema = z.object({ record: personalRecordSchema });
const failureSchema = z.object({ ok: z.literal(false), code: z.string().optional(), status: z.number().optional(), body: z.object({ code: z.string() }).optional() });

// Explicit fixture encryption adapter. This exercises native credential
// encryption/file handling; it does not test Electron safeStorage or OS Keychain.
function fixtureEncryptedStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "fixture-aes-256-gcm",
    encryptString(value: string) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(value: Buffer) {
      const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zeno-personal-domain-e2e-"));
  await chmod(root, 0o700);
  const previousDiscovery = process.env.OPENWORK_UI_CONTROL_DISCOVERY;
  const services: Array<ReturnType<typeof createZenoPersonalService>> = [];
  let application: ReturnType<typeof createApp> | undefined;
  let plugin: Awaited<ReturnType<typeof OpenWorkExtensionsPreview>> | undefined;
  let active: ReturnType<typeof createZenoPersonalToolsService> | undefined;
  let fitnessEnabled = true, windowOpen = true;
  const syncCursors: number[] = [];
  const sessions: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const url = new URL(request.url);
    if (url.pathname === "/api/zeno/v1/sync") syncCursors.push(Number(url.searchParams.get("cursor")));
    return application ? application.fetch(request, "127.0.0.1") : new Response(null, { status: 503 });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  const ui = createUiControlServer({
    app: { getPath: () => root }, appName: "Synthetic domain fixture", appIdentifier: "synthetic.zeno.domain",
    getWindow: () => { throw new Error("This headless fixture has no desktop window"); },
    personalTask: (call: { input: unknown; sessionId: string }) => {
      sessions.push(call.sessionId);
      if (!active) throw new Error("Select a synthetic native profile first");
      return active.execute(call);
    },
  });
  cleanups.push(async () => {
    await plugin?.dispose();
    await ui.stop();
    for (const service of services) service.dispose();
    await server.stop(true);
    application?.close();
    if (previousDiscovery === undefined) delete process.env.OPENWORK_UI_CONTROL_DISCOVERY;
    else process.env.OPENWORK_UI_CONTROL_DISCOVERY = previousDiscovery;
    await rm(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });
  application = createApp({
    origin, databasePath: join(root, "private.sqlite"), mediaRoot: join(root, "media"),
    authSecret: randomBytes(32).toString("hex"), featureEnabled: key => key !== "fitnessTracking" || fitnessEnabled,
  });
  await chmod(join(root, "private.sqlite"), 0o600);
  const app = application;
  const password = randomBytes(32).toString("base64url");
  const adminId = await bootstrapAdmin(app.database, { email: `admin-${randomBytes(8).toString("hex")}@example.test`, name: "Synthetic fixture administrator", password });
  const api = (path: string, method = "GET", body?: unknown, cookie?: string, accountId?: string) => fetch(origin + "/api/zeno/v1" + path, {
    method, redirect: "error", headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}), ...(accountId ? { "X-Zeno-Account": accountId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await ui.start();
  await chmod(join(root, "openwork-ui-control.json"), 0o600);
  plugin = await OpenWorkExtensionsPreview(undefined, { clientProfile: "local-gateway" });
  const registered = plugin;
  const execute = async (input: unknown, sessionId = INTERACTIVE): Promise<unknown> => JSON.parse(await registered.tool.zeno_personal.execute(input, { sessionID: sessionId }));

  async function account(label: string) {
    const email = `member-${randomBytes(8).toString("hex")}@example.test`;
    const invite = issueInvite(app.database, adminId, email);
    expect((await api("/invites/redeem", "POST", { token: invite.token, email, name: "Synthetic fixture member", password })).status).toBe(201);
    const login = await api("/auth/sign-in/email", "POST", { email, password });
    expect(login.status).toBe(200);
    expect(login.headers.getSetCookie().some(value => /HttpOnly/i.test(value))).toBe(true);
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const me = z.object({ user: z.object({ id: z.string() }) }).parse(await (await api("/me", "GET", undefined, cookie)).json());
    const nativeRoot = join(root, "profile-" + label);
    let approvals = 0;
    const service = createZenoPersonalService({
      root: nativeRoot, origin, safeStorage: fixtureEncryptedStorage(), isWindowOpen: () => windowOpen,
      name: "Synthetic headless fixture device", platform: "linux",
      fetchImpl: (input: string, init: RequestInit) => {
        if (new URL(input).origin !== origin) throw new Error("Domain fixture permits loopback API requests only");
        return fetch(input, init);
      },
      openExternal: async (url: string) => {
        const verification = new URL(url);
        expect(verification.origin).toBe(origin);
        expect(verification.pathname).toBe("/app/device");
        const approved = await api("/devices/approve", "POST", { userCode: verification.searchParams.get("code") }, cookie);
        expect(approved.status).toBe(200);
        approvals++;
      },
    });
    services.push(service);
    const tools = createZenoPersonalToolsService({
      service, isWindowOpen: () => windowOpen,
      executionModeForSession: (id: string) => id === INTERACTIVE ? "interactive" : id === SCHEDULED ? "scheduled" : null,
    });
    return {
      userId: me.user.id, service,
      activate: () => { active = tools; },
      api: (path: string, method = "GET", body?: unknown) => api(path, method, body, cookie, me.user.id),
      async connect() {
        await service.connect();
        const deadline = Date.now() + 8_000;
        while (!await service.identity() && Date.now() < deadline) await Bun.sleep(20);
        expect((await service.identity())?.userId).toBe(me.user.id);
        expect(approvals).toBe(1);
        expect((await stat(join(nativeRoot, "device.bin"))).mode & 0o777).toBe(0o600);
        expect((await service.getDevice())?.revokedAt).toBeNull();
      },
    };
  }
  return { account, execute, syncCursors, sessions, setFitness: (enabled: boolean) => { fitnessEnabled = enabled; }, setWindow: (open: boolean) => { windowOpen = open; } };
}

const routine = (exerciseId: string, name: string, title = "合成训练计划") => ({
  title, exercises: [{ id: "synthetic-exercise-entry", exerciseId, name, sets: [{ id: "synthetic-set", reps: 8, weight: 20 }], restSeconds: 90 }],
});

test("registered V1 tool completes real PKCE, Chinese exercise search, routine/calendar persistence and tombstone undo", async () => {
  const f = await fixture(), a = await f.account("primary");
  a.activate();
  expect(failureSchema.parse(await f.execute({ action: "read", kind: "routine" })).code).toBe("account_required");
  expect(syncResultSchema.parse(await (await a.api("/sync?cursor=0&limit=500")).json()).records).toHaveLength(0);
  await a.connect();
  const found = catalogueSchema.parse(await f.execute({ action: "catalogue", query: "杠铃卧推", equipment: ["杠铃"], muscles: ["胸肌"], limit: 20 }));
  const bench = found.exercises.find(item => item.exerciseId === "0025");
  if (!bench) throw new Error("Chinese catalogue search did not return the canonical bench press");
  expect(bench.name).toBe("杠铃卧推");
  expect(bench.source).toBe("builtin");
  expect(bench.instructions.length).toBeGreaterThan(0);
  expect(catalogueSchema.parse(await f.execute({ action: "catalogue", id: bench.exerciseId })).exercises[0]).toEqual(bench);
  const created = writtenSchema.parse(await f.execute({ action: "write", kind: "routine", id: "synthetic-main-plan", baseVersion: 0, operationId: "synthetic-main-plan-create", data: routine(bench.exerciseId, bench.name) }));
  expect(created.record.kind).toBe("routine");
  if (created.record.kind !== "routine") throw new Error("Unexpected domain kind");
  expect(created.record.data.exercises[0]?.exerciseId).toBe(bench.exerciseId);
  expect(recordSchema.parse(await (await a.api("/records/routine/synthetic-main-plan")).json()).record).toEqual(created.record);
  const read = readSchema.parse(await f.execute({ action: "read", kind: "routine", query: "合成训练计划" }));
  expect(read.records).toEqual([created.record]);
  expect(read.schemas.routine).toBeDefined();
  expect(readSchema.parse(await f.execute({ action: "read", kind: "routine", id: created.record.id })).records).toEqual([created.record]);
  const undone = z.object({ ok: z.literal(true), record: personalRecordSchema }).parse(await f.execute({ action: "undo", undoId: created.undo.id }));
  expect(undone.record.version).toBe(2);
  expect(undone.record.deletedAt).not.toBeNull();
  expect(recordSchema.parse(await (await a.api("/records/routine/synthetic-main-plan")).json()).record).toEqual(undone.record);
  expect(readSchema.parse(await f.execute({ action: "read", kind: "routine" })).records).toHaveLength(0);
  expect(failureSchema.parse(await f.execute({ action: "undo", undoId: created.undo.id })).code).toBe("undo_expired");

  const calendar = writtenSchema.parse(await f.execute({ action: "write", kind: "event", id: "synthetic-calendar-entry", baseVersion: 0, operationId: "synthetic-calendar-create", data: { title: "合成日历训练时段", startAt: 1_800_000_000_000, endAt: 1_800_003_600_000, timeZone: "Asia/Shanghai", category: "training" } }));
  expect(readSchema.parse(await f.execute({ action: "read", kind: "event", query: "合成日历" })).records).toEqual([calendar.record]);
  expect(recordSchema.parse(await (await a.api("/records/event/synthetic-calendar-entry")).json()).record).toEqual(calendar.record);
  expect(z.object({ ok: z.literal(true), record: personalRecordSchema }).parse(await f.execute({ action: "undo", undoId: calendar.undo.id })).record.deletedAt).not.toBeNull();
  expect(readSchema.parse(await f.execute({ action: "read", kind: "event" })).records).toHaveLength(0);
  expect(new Set(f.sessions)).toEqual(new Set([INTERACTIVE]));
}, 30_000);

test("real change-feed and read pagination preserve all records while catalogue isolates custom exercises and rejects false IDs", async () => {
  const f = await fixture(), a = await f.account("primary"), b = await f.account("other");
  await a.connect(); await b.connect();
  const customData = { name: "合成私人动作", primaryMuscles: ["胸肌"], equipment: ["哑铃"], instructions: ["合成测试动作说明"] };
  a.activate();
  writtenSchema.parse(await f.execute({ action: "write", kind: "exercise", id: "synthetic-own-exercise", baseVersion: 0, operationId: "synthetic-own-exercise-create", data: customData }));
  b.activate();
  writtenSchema.parse(await f.execute({ action: "write", kind: "exercise", id: "synthetic-foreign-exercise", baseVersion: 0, operationId: "synthetic-foreign-exercise-create", data: { ...customData, name: "合成外账号动作" } }));
  a.activate();
  const own = catalogueSchema.parse(await f.execute({ action: "catalogue", query: "合成私人动作" }));
  expect(own.exercises.map(item => item.exerciseId)).toEqual(["synthetic-own-exercise"]);
  expect(own.exercises[0]?.source).toBe("custom");
  expect(own.exercises[0]?.demo).toBeNull();
  expect(catalogueSchema.parse(await f.execute({ action: "catalogue", id: "synthetic-foreign-exercise" })).exercises).toHaveLength(0);
  expect(readSchema.parse(await f.execute({ action: "read", kind: "exercise" })).records.map(item => item.id)).toEqual(["synthetic-own-exercise"]);
  expect((await a.api("/records/exercise/synthetic-foreign-exercise")).status).toBe(404);
  for (const id of ["synthetic-foreign-exercise", "synthetic-does-not-exist", "25"]) {
    expect(failureSchema.parse(await f.execute({ action: "write", kind: "routine", operationId: "synthetic-invalid-" + id, data: routine(id, "合成不可用动作") })).code).toBe("exercise_unavailable");
  }
  expect(readSchema.parse(await f.execute({ action: "read", kind: "routine" })).records).toHaveLength(0);
  writtenSchema.parse(await f.execute({ action: "write", kind: "routine", id: "synthetic-custom-plan", baseVersion: 0, operationId: "synthetic-custom-plan-create", data: routine("synthetic-own-exercise", customData.name) }));

  const mutations = Array.from({ length: 501 }, (_, index) => createMutation("membership", { name: "合成分页凭证", code: `SYNTHETIC-${index}`, format: "qr", expiresAt: null, notes: "Synthetic pagination fixture" }, { id: `synthetic-page-${index}`, operationId: `synthetic-page-create-${index}` }));
  for (let offset = 0; offset < mutations.length; offset += 101) {
    expect((await a.api("/records/batch", "POST", { operationId: "synthetic-page-batch-" + offset, mutations: mutations.slice(offset, offset + 101) })).status).toBe(200);
  }
  f.syncCursors.splice(0);
  const ids: string[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = readSchema.parse(await f.execute({ action: "read", kind: "membership", query: "合成分页凭证", offset, limit: 200 }));
    expect(page.total).toBe(501);
    expect(page.offset).toBe(offset);
    expect(page.truncated).toBe(page.nextOffset !== null);
    ids.push(...page.records.map(item => item.id));
    offset = page.nextOffset;
  }
  expect(ids).toHaveLength(501);
  expect(new Set(ids).size).toBe(501);
  expect(f.syncCursors.filter(cursor => cursor === 0)).toHaveLength(3);
  expect(f.syncCursors.filter(cursor => cursor > 0)).toHaveLength(3);
  expect(readSchema.parse(await f.execute({ action: "read", kind: "membership", query: "合成无匹配词" })).records).toHaveLength(0);
  b.activate();
  expect(readSchema.parse(await f.execute({ action: "read", kind: "membership" })).records).toHaveLength(0);
}, 30_000);

test("registered bridge enforces fitness flag, synthetic session authority, pending proposals, closed window and disconnected account", async () => {
  const f = await fixture(), a = await f.account("primary");
  a.activate(); await a.connect();
  const data = routine("0025", "杠铃卧推");
  for (const session of [SCHEDULED, "ses_synthetic_unknown"]) {
    expect(failureSchema.parse(await f.execute({ action: "write", kind: "routine", id: "synthetic-blocked-plan", baseVersion: 0, operationId: "synthetic-blocked-" + session, data }, session)).code).toBe("proposal_required");
  }
  const proposal = writtenSchema.parse(await f.execute({ action: "propose", id: "synthetic-scheduled-proposal", operationId: "synthetic-scheduled-proposal-create", data: { title: "合成定时建议", description: "Synthetic review only", source: "proactive", status: "applied", createdAt: Date.now(), changes: [{ kind: "routine", id: "synthetic-proposed-plan", baseVersion: 0, deleted: false, data }] } }, SCHEDULED));
  expect(proposal.reviewRequired).toBe(true);
  if (proposal.record.kind !== "proposal") throw new Error("Expected a proposal record");
  expect(proposal.record.data.source).toBe("scheduled");
  expect(proposal.record.data.status).toBe("pending");
  expect(readSchema.parse(await f.execute({ action: "read", kind: "routine" })).records).toHaveLength(0);
  expect((await a.api("/records/routine/synthetic-proposed-plan")).status).toBe(404);
  expect(recordSchema.parse(await (await a.api("/records/proposal/synthetic-scheduled-proposal")).json()).record).toEqual(proposal.record);
  f.setFitness(false);
  expect(failureSchema.parse(await f.execute({ action: "catalogue", id: "0025" })).code).toBe("feature_disabled");
  const disabled = failureSchema.parse(await f.execute({ action: "write", kind: "routine", id: "synthetic-disabled-plan", baseVersion: 0, operationId: "synthetic-disabled-plan-create", data }));
  expect(disabled.status).toBe(404);
  expect(disabled.body?.code).toBe("feature_disabled");
  expect((await a.api("/records/routine/synthetic-disabled-plan")).status).toBe(404);
  expect(readSchema.parse(await f.execute({ action: "read", kind: "proposal" })).records).toHaveLength(1);
  f.setWindow(false);
  expect(failureSchema.parse(await f.execute({ action: "read", kind: "routine" })).code).toBe("window_closed");
  f.setWindow(true);
  await a.service.disconnect();
  for (const input of [{ action: "read", kind: "routine" }, { action: "catalogue", id: "0025" }, { action: "write", kind: "routine", operationId: "synthetic-disconnected-write", data }]) {
    expect(failureSchema.parse(await f.execute(input)).code).toBe("account_required");
  }
  const finalSync = syncResultSchema.parse(await (await a.api("/sync?cursor=0&limit=500")).json());
  expect(finalSync.records).toHaveLength(1);
  expect(finalSync.records[0]?.kind).toBe("proposal");
}, 30_000);
