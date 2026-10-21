import { afterEach, expect, test } from 'bun:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createApp } from '../../zeno-api/src/app';
import { bootstrapAdmin, issueInvite } from '../../zeno-api/src/auth';
import { createZenoPersonalService } from '../electron/zeno-personal.mjs';
import { createZenoPersonalToolsService, personalToolCallSchema } from '../electron/zeno-personal-tools.mjs';
import { createZenoPersonalTools, personalToolArgs } from '../../server/src/opencode-plugins/zeno-personal-tools';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function privateStorage() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'synthetic-encrypted-test-storage',
    encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decryptString(bytes: Buffer) { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); },
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zeno-tool-api-'));
  let app: ReturnType<typeof createApp> | undefined;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => app ? app.fetch(request, '127.0.0.1') : new Response(null, { status: 503 }) });
  const origin = `http://127.0.0.1:${server.port}`;
  let fitnessEnabled = true, windowOpen = true;
  app = createApp({ origin, databasePath: join(root, 'api.sqlite'), mediaRoot: join(root, 'media'), authSecret: randomBytes(32).toString('hex'), featureEnabled: key => key !== 'fitnessTracking' || fitnessEnabled });
  const application = app;
  const services: Array<ReturnType<typeof createZenoPersonalService>> = [];
  cleanups.push(async () => { for (const service of services) service.dispose(); await server.stop(true); application.close(); await rm(root, { recursive: true, force: true }); });
  const password = randomBytes(24).toString('base64url');
  const adminId = await bootstrapAdmin(application.database, { email: 'admin@example.test', name: 'Synthetic admin', password });
  const call = async (path: string, method = 'GET', body?: unknown, cookie?: string, accountId?: string) => fetch(origin + '/api/zeno/v1' + path, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(accountId ? { 'X-Zeno-Account': accountId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function account(key: string) {
    const email = `tool-${key}@example.test`, invite = issueInvite(application.database, adminId, email);
    const created = await call('/invites/redeem', 'POST', { token: invite.token, email, name: `Synthetic ${key}`, password }); expect(created.status).toBe(201);
    const login = await call('/auth/sign-in/email', 'POST', { email, password }); expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const me = z.object({ user: z.object({ id: z.string() }) }).parse(await (await call('/me', 'GET', undefined, cookie)).json());
    const service = createZenoPersonalService({ root: join(root, 'native-' + key), origin, safeStorage: privateStorage(), isWindowOpen: () => windowOpen, name: 'Synthetic device', platform: 'linux', openExternal: async (url: string) => {
      const response = await call('/devices/approve', 'POST', { userCode: new URL(url).searchParams.get('code') }, cookie); expect(response.status).toBe(200);
    } });
    services.push(service); await service.connect();
    const deadline = Date.now() + 6000;
    while (!await service.identity() && Date.now() < deadline) await Bun.sleep(30);
    expect((await service.identity())?.userId).toBe(me.user.id);
    const tools = createZenoPersonalToolsService({ service, isWindowOpen: () => windowOpen, executionModeForSession: (sessionId: string) => sessionId === 'scheduled' ? 'scheduled' : 'interactive' });
    const execute = (input: unknown, sessionId = 'interactive') => tools.execute({ sessionId, input });
    return { userId: me.user.id, service, execute, call: (path: string, method = 'GET', body?: unknown) => call(path, method, body, cookie, me.user.id) };
  }
  return { account, setFitnessEnabled: (value: boolean) => { fitnessEnabled = value; }, setWindowOpen: (value: boolean) => { windowOpen = value; } };
}
const routine = (exerciseId: string, name: string, title = 'Synthetic plan') => ({ title, exercises: [{ id: 'entry-bench', exerciseId, name, sets: [{ id: 'set-1', reps: 8, weight: 20 }], restSeconds: 90 }] });

test('real API and native service: search canonical exercises, write/read a routine, then undo', async () => {
  const f = await fixture(), a = await f.account('a');
  const search = await a.execute({ action: 'catalogue', query: '杠铃卧推', equipment: ['杠铃'], muscles: ['胸肌'], limit: 20 });
  expect(search.ok).toBe(true); expect(search.total).toBeGreaterThan(0);
  const bench = search.exercises.find(item => item.exerciseId === '0025'); expect(bench).toBeDefined();
  expect(bench.name).toBe('杠铃卧推'); expect(bench.equipmentId).toBe('barbell'); expect(bench.primaryMuscles).toContain('胸肌');
  expect(bench.demo).toEqual({ kind: 'mascot', video: '/app/zeno/fitness/bench-press.mp4', poster: '/app/zeno/fitness/bench-press-poster.webp' });
  expect(JSON.stringify(bench)).not.toMatch(/exercisedb|https?:\/\/|catalogue\/media/);
  const detail = await a.execute({ action: 'catalogue', id: bench.exerciseId }); expect(detail.exercises[0]).toEqual(bench);
  const made = await a.execute({ action: 'write', kind: 'routine', id: 'tool-plan', baseVersion: 0, operationId: 'tool-plan-create', data: routine(bench.exerciseId, bench.name) });
  expect(made.ok).toBe(true); expect(made.record.data.exercises[0].exerciseId).toBe(bench.exerciseId);
  const read = await a.execute({ action: 'read', kind: 'routine', query: 'Synthetic plan' });
  expect(read.records).toHaveLength(1); expect(read.records[0].id).toBe('tool-plan'); expect(read.records[0].version).toBe(1); expect(read.schemas.routine).toBeDefined();
  expect((await a.execute({ action: 'read', kind: 'routine', id: read.records[0].id })).records[0]).toEqual(read.records[0]);
  const undone = await a.execute({ action: 'undo', undoId: made.undo.id }); expect(undone.ok).toBe(true); expect(undone.record.deletedAt).not.toBeNull();
  expect((await a.execute({ action: 'read', kind: 'routine' })).records).toHaveLength(0);
}, 20000);

test('catalogue unifies only own live custom exercises and rejects foreign, unknown or deleted references', async () => {
  const f = await fixture(), a = await f.account('a'), b = await f.account('b');
  const data = { name: '合成双器械动作', primaryMuscles: ['胸肌'], equipment: ['哑铃', '弹力带'], instructions: ['合成步骤'], category: 'strength' };
  const own = await a.execute({ action: 'write', kind: 'exercise', id: 'own-custom', baseVersion: 0, operationId: 'own-custom-create', data }); expect(own.ok).toBe(true);
  expect((await b.execute({ action: 'write', kind: 'exercise', id: 'foreign-custom', baseVersion: 0, operationId: 'foreign-custom-create', data: { ...data, name: '外账号合成动作' } })).ok).toBe(true);
  const custom = await a.execute({ action: 'catalogue', query: data.name, equipment: ['哑铃'], muscles: ['胸肌'] });
  expect(custom.exercises).toHaveLength(1); expect(custom.exercises[0].exerciseId).toBe('own-custom'); expect(custom.exercises[0].source).toBe('custom'); expect(custom.exercises[0].demo).toBeNull();
  const details = await a.execute({ action: 'catalogue', id: 'own-custom' }); expect(details.exercises[0]).toEqual(custom.exercises[0]);
  expect((await a.execute({ action: 'catalogue', id: 'foreign-custom' })).exercises).toHaveLength(0);
  expect((await a.execute({ action: 'read', kind: 'exercise', id: 'foreign-custom' })).records).toHaveLength(0);
  expect((await a.execute({ action: 'write', kind: 'routine', operationId: 'own-reference', data: routine('own-custom', data.name) })).ok).toBe(true);
  for (const exerciseId of ['foreign-custom', 'never-existed']) {
    const rejected = await a.execute({ action: 'write', kind: 'routine', operationId: 'invalid-' + exerciseId, data: routine(exerciseId, 'Synthetic') });
    expect(rejected.code).toBe('exercise_unavailable'); expect(rejected.record).toBeUndefined();
  }
  expect((await a.execute({ action: 'write', kind: 'exercise', id: 'own-custom', baseVersion: 1, operationId: 'own-custom-delete', data, deleted: true })).ok).toBe(true);
  expect((await a.execute({ action: 'catalogue', id: 'own-custom' })).exercises).toHaveLength(0);
  expect((await a.execute({ action: 'write', kind: 'routine', operationId: 'deleted-reference', data: routine('own-custom', data.name) })).code).toBe('exercise_unavailable');
  expect((await a.execute({ action: 'read', kind: 'routine' })).records).toHaveLength(1);
}, 20000);

test('record/catalogue pagination is explicit and native account, feature and proposal boundaries remain enforced', async () => {
  const f = await fixture(), a = await f.account('a');
  const args = { action: 'catalogue', query: 'bench', limit: 2 };
  const first = await a.execute(args); expect(first.exercises).toHaveLength(2); expect(first.nextOffset).toBe(2); expect(first.truncated).toBe(true);
  const second = await a.execute({ ...args, offset: first.nextOffset }); expect(second.exercises).toHaveLength(2); expect(second.exercises[0].exerciseId).not.toBe(first.exercises[0].exerciseId);
  for (let index = 0; index < 3; index++) expect((await a.execute({ action: 'write', kind: 'routine', id: 'page-' + index, baseVersion: 0, operationId: 'page-create-' + index, data: routine('0025', '杠铃卧推', '分页计划 ' + index) })).ok).toBe(true);
  const page = await a.execute({ action: 'read', kind: 'routine', query: '分页计划', limit: 2 }); expect(page.records).toHaveLength(2); expect(page.total).toBe(3); expect(page.nextOffset).toBe(2);
  const tail = await a.execute({ action: 'read', kind: 'routine', query: '分页计划', offset: page.nextOffset, limit: 2 }); expect(tail.records).toHaveLength(1); expect(tail.nextOffset).toBeNull(); expect(page.records.map(item => item.id)).not.toContain(tail.records[0].id);
  expect((await a.execute({ action: 'write', kind: 'routine', operationId: 'scheduled-write', data: routine('0025', '杠铃卧推') }, 'scheduled')).code).toBe('proposal_required');
  const proposal = await a.execute({ action: 'propose', operationId: 'scheduled-proposal', data: { title: '合成建议', description: '', createdAt: Date.now(), changes: [{ kind: 'routine', id: 'proposed-plan', baseVersion: 0, deleted: false, data: routine('0025', '杠铃卧推') }] } }, 'scheduled');
  expect(proposal.ok).toBe(true); expect(proposal.reviewRequired).toBe(true); expect(proposal.record.data.status).toBe('pending'); expect((await a.execute({ action: 'read', kind: 'routine', id: 'proposed-plan' })).records).toHaveLength(0);
  f.setFitnessEnabled(false); expect((await a.execute({ action: 'catalogue', id: '0025' })).code).toBe('feature_disabled');
  expect((await a.execute({ action: 'read', kind: 'routine' })).records).toHaveLength(3);
  const disabled = await a.execute({ action: 'write', kind: 'routine', operationId: 'disabled-write', data: routine('0025', '杠铃卧推') }); expect(disabled.ok).toBe(false); expect(disabled.body.code).toBe('feature_disabled');
  f.setWindowOpen(false); expect((await a.execute({ action: 'catalogue', id: '0025' })).code).toBe('window_closed'); f.setWindowOpen(true);
  await a.service.disconnect(); expect((await a.execute({ action: 'catalogue', id: '0025' })).code).toBe('account_required'); expect((await a.execute({ action: 'read', kind: 'routine' })).code).toBe('account_required');
}, 20000);

test('V1/V2 argument facade matches the desktop canonical service schema and exposes the query contract', async () => {
  const facade = z.object(personalToolArgs).strict();
  const inputs = [{ action: 'catalogue', id: '0025' }, { action: 'catalogue', query: '卧推', equipment: ['哑铃'], muscles: ['胸肌'], category: '力量', bodyPart: '胸部', limit: 20, offset: 2 }, { action: 'read', kind: 'routine', query: '计划', offset: 4, limit: 2 }, { action: 'catalogue', limit: 0 }, { action: 'catalogue', offset: -1 }, { action: 'catalogue', accountId: 'foreign' }, { action: 'catalogue', limit: 201 }];
  for (const input of inputs) expect(facade.safeParse(input).success).toBe(personalToolCallSchema.safeParse(input).success);
  const calls: unknown[] = [];
  const tools = createZenoPersonalTools(async input => { calls.push(input); return { ok: true, exercises: [{ exerciseId: '0025' }] }; });
  expect(JSON.parse(await tools.zeno_personal.execute(inputs[0], { sessionID: 'synthetic-session' })).exercises[0].exerciseId).toBe('0025'); expect(calls).toEqual([inputs[0]]);
});

test('task reads expose only own device inventory and supply real IDs for task writes', async () => {
  const f = await fixture(), a = await f.account('a'), b = await f.account('b');
  const identityA = await a.service.identity(), identityB = await b.service.identity();
  const inventory = (key: string) => ({ workspaces: [{ id: 'workspace-' + key, name: 'Synthetic workspace ' + key }], models: [{ providerId: 'synthetic', modelId: 'local-model-' + key, label: 'Synthetic local model' }], appliedCursor: 0, windowOpen: true });
  expect((await a.service.internalRequest('POST', '/devices/heartbeat', { inventory: inventory('a') }, identityA)).status).toBe(200);
  expect((await b.service.internalRequest('POST', '/devices/heartbeat', { inventory: inventory('b') }, identityB)).status).toBe(200);
  const read = await a.execute({ action: 'read', kind: 'task' });
  expect(read.ok).toBe(true); expect(read.context.currentDeviceId).toBe(identityA.deviceId); expect(read.context.heartbeatMayBeStale).toBe(true); expect(read.context.executionRequiresLocalConfirmation).toBe(true);
  expect(read.context.devices).toHaveLength(1);
  const device = read.context.devices[0]; expect(device.id).toBe(identityA.deviceId); expect(device.workspaces).toEqual(inventory('a').workspaces); expect(device.models).toEqual(inventory('a').models);
  expect(JSON.stringify(read.context)).not.toContain(identityB.deviceId); expect(JSON.stringify(read.context)).not.toContain('workspace-b'); expect(JSON.stringify(read.context)).not.toMatch(/accessToken|credential|codeVerifier|password|authSecret/);
  const model = device.models[0], data = { title: 'Synthetic local task', instructions: 'Synthetic instruction; no executor is started in this test.', deviceId: device.id, workspaceId: device.workspaces[0].id, model, schedule: { frequency: 'once', startAt: Date.now() + 3600000, timeZone: 'UTC' } };
  const made = await a.execute({ action: 'write', kind: 'task', id: 'context-task', baseVersion: 0, operationId: 'context-task-create', data });
  expect(made.ok).toBe(true); expect(made.record.data.deviceId).toBe(identityA.deviceId); expect(made.record.data.workspaceId).toBe('workspace-a'); expect(made.record.data.model.modelId).toBe('local-model-a');
  const found = await a.execute({ action: 'read', kind: 'task', query: 'Synthetic local task' }); expect(found.records).toHaveLength(1); expect(found.context.currentDeviceId).toBe(identityA.deviceId);
  expect((await a.execute({ action: 'read' })).context.devices[0].id).toBe(identityA.deviceId);
  const forbidden = await a.execute({ action: 'write', kind: 'task', operationId: 'foreign-device-task', data: { ...data, deviceId: identityB.deviceId } }); expect(forbidden.ok).toBe(false); expect(forbidden.body.code).toBe('device_unavailable');
  expect((await a.execute({ action: 'undo', undoId: made.undo.id })).ok).toBe(true);
}, 20000);
