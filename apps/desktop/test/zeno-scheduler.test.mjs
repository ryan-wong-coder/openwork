import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { personalRecordSchema, recordMutationSchema } from '@zeno/core/schema';
import { createZenoScheduler } from '../electron/zeno-scheduler.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zeno-scheduler-test-'));
  let at = 1_800_000_000_000, open = true, identity = { userId: 'synthetic-user', deviceId: 'synthetic-device', generation: 0 }, failSync = false, failAll = false;
  let cursor = 0, progress = { status: 'running', messageCount: 1 }, lostReply = false, tasksEnabled = true, calendarEnabled = true;
  const records = [], receipts = new Map(), creates = [], sends = [], stops = [], notices = [], calls = [];
  const setRecord = (kind, id, data, createdAt = at - 1000) => {
    const old = [...records].reverse().find(value => value.kind === kind && value.id === id);
    const record = personalRecordSchema.parse({ id, kind, data, userId: identity.userId, version: (old?.version ?? 0) + 1, cursor: ++cursor, createdAt: old?.createdAt ?? createdAt, updatedAt: at, deletedAt: null });
    records.push(record); return record;
  };
  const service = {
    identity: async () => identity,
    accountDirectory: async userId => path.join(root, userId),
    async sync(after) { if (failSync || failAll) throw new Error('Synthetic offline'); const values = records.filter(value => value.cursor > after); return { records: values, cursor: values.at(-1)?.cursor ?? after, hasMore: false }; },
    async internalRequest(method, requestPath, body, expected) {
      calls.push({ method, requestPath, body, expected });
      if (expected && (!identity || expected.userId !== identity.userId || expected.deviceId !== identity.deviceId || expected.generation !== identity.generation)) return { status: 409, body: { code: 'identity_changed' } };
      if (failAll) throw new Error('Synthetic offline');
      if (requestPath === '/features') return { status: 200, body: { zenoAccounts: true, personalCalendar: calendarEnabled, fitnessTracking: true, localScheduledTasks: tasksEnabled } };
      if (requestPath === '/devices/heartbeat') return { status: 200, body: {} };
      if (method === 'PUT') {
        const input = recordMutationSchema.parse(body);
        if (receipts.has(input.operationId)) return { status: 200, body: { ...receipts.get(input.operationId), replayed: true } };
        const previous = [...records].reverse().find(value => value.kind === input.kind && value.id === input.id) ?? null;
        if ((previous?.version ?? 0) !== input.baseVersion) return { status: 409, body: { code: 'conflict', current: previous, submitted: input } };
        const record = setRecord(input.kind, input.id, input.data); const result = { record, previous, replayed: false }; receipts.set(input.operationId, result);
        if (lostReply) { lostReply = false; throw new Error('Synthetic response lost after commit'); }
        return { status: 200, body: result };
      }
      throw new Error('Unexpected synthetic route');
    },
  };
  const adapter = {
    async create(command) { creates.push(command); return { sessionId: 'session-' + creates.length, workspaceId: command.workspaceId }; },
    async send(receipt, input) { sends.push({ receipt, input }); return { messageId: input.messageId, alreadyPresent: false }; },
    async observe() { return { ...progress, observedAt: at }; },
    async stop(receipt, input) { stops.push({ receipt, input }); progress = { status: 'idle', messageCount: 1 }; return { stopped: true, reason: null }; },
  };
  const options = { service, isWindowOpen: () => open, now: () => at, adapter,
    getInventory: async () => ({ workspaces: [{ id: 'workspace-test', name: 'Test workspace' }], models: [{ providerId: 'modelhelm', modelId: 'fixture-model' }] }),
    getLocalRuntime: async () => { throw new Error('Fake adapter must not access a live runtime'); }, notify: async (...args) => notices.push(args) };
  let scheduler = createZenoScheduler(options);
  t.after(async () => { await scheduler.dispose(); await rm(root, { recursive: true, force: true }); });
  const task = (id = 'task-one', start = at) => setRecord('task', id, { title: 'Synthetic task', instructions: 'Synthetic instructions', deviceId: identity.deviceId, workspaceId: 'workspace-test', model: { providerId: 'modelhelm', modelId: 'fixture-model' }, schedule: { startAt: start, timeZone: 'Asia/Shanghai' } });
  return { root, service, options, adapter, creates, sends, stops, records, notices, receipts, calls, setRecord, task,
    get scheduler() { return scheduler; }, get at() { return at; }, advance: value => { at += value; }, setOpen: value => { open = value; }, setIdentity: value => { identity = value; }, setProgress: value => { progress = value; }, setOffline: value => { failAll = value; }, setSyncFailure: value => { failSync = value; }, setTasksEnabled: value => { tasksEnabled = value; }, setCalendarEnabled: value => { calendarEnabled = value; }, loseReply: () => { lostReply = true; },
    async restart() { await scheduler.dispose(); scheduler = createZenoScheduler(options); return scheduler; },
    async journalPath() { return path.join(root, 'synthetic-user', (await readdir(path.join(root, 'synthetic-user')))[0]); },
  };
}

test('local scheduled execution uses a durable receipt before one prompt, preserves mode, and does not replay on restart', async t => {
  const f = await fixture(t); f.task();
  f.adapter.send = async (receipt, input) => {
    const journal = JSON.parse(await readFile(await f.journalPath(), 'utf8'));
    assert.equal(journal.entries[0].phase, 'sending'); assert.equal(journal.entries[0].receipt.sessionId, receipt.sessionId);
    f.sends.push({ receipt, input }); return { messageId: input.messageId, alreadyPresent: false };
  };
  await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.sends.length, 1);
  assert.equal(f.creates[0].prompt, null); assert.equal(f.scheduler.executionModeForSession('session-1'), 'scheduled');
  await f.restart(); await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.sends.length, 1); assert.equal(f.scheduler.executionModeForSession('session-1'), 'scheduled');
  f.setProgress({ status: 'idle', finalText: 'Synthetic finished result', messageCount: 2 });
  await f.scheduler.tick(); await f.scheduler.tick();
  const run = [...f.records].reverse().find(value => value.kind === 'run'); assert.equal(run.data.status, 'succeeded'); assert.equal(run.data.summary, 'Synthetic finished result');
});

test('closed and suspended periods never start AI; overdue schedules become missed and require a manual request', async t => {
  const f = await fixture(t); f.task('missed-task', f.at + 1000); f.setOpen(false);
  await f.scheduler.tick(); f.advance(5000); f.setOpen(true); await f.scheduler.wake();
  assert.equal(f.creates.length, 0); assert.equal(f.records.find(value => value.kind === 'run')?.data.status, 'missed');
  f.task('suspended-task', f.at + 1000); await f.scheduler.suspend(); f.advance(2000); await f.scheduler.tick(); assert.equal(f.creates.length, 0);
  await f.scheduler.wake(); assert.equal(f.creates.length, 0);
  f.setRecord('request', 'manual-request', { type: 'run_task', taskId: 'missed-task', deviceId: 'synthetic-device', createdAt: f.at, expiresAt: f.at + 60000 });
  await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.scheduler.executionModeForSession('session-1'), 'interactive');
});

test('closed-window polling does not erase the occurrence watermark for recurring missed work', async t => {
  const f = await fixture(t);
  f.setRecord('task', 'recurring', { title: 'Daily synthetic task', instructions: 'Synthetic', deviceId: 'synthetic-device', workspaceId: 'workspace-test', model: { providerId: 'modelhelm', modelId: 'fixture-model' }, schedule: { frequency: 'daily', startAt: f.at + 1000, timeZone: 'UTC' } });
  await f.scheduler.tick(); f.setOpen(false); f.advance(86400000); await f.scheduler.tick(); f.advance(86400000); await f.scheduler.tick();
  f.setOpen(true); await f.scheduler.wake();
  assert.equal(f.creates.length, 0); assert.equal(f.records.filter(value => value.kind === 'run' && value.data.status === 'missed').length, 2);
});

test('sync loss prevents new execution but does not kill an already admitted local session or lose its outbox', async t => {
  const f = await fixture(t); f.task(); f.loseReply(); await f.scheduler.tick(); assert.equal(f.sends.length, 1);
  f.setOffline(true); f.setProgress({ status: 'idle', finalText: 'Finished while sync offline', messageCount: 2 });
  await f.scheduler.tick(); assert.equal(f.stops.length, 0); assert.equal(f.creates.length, 1);
  f.setOffline(false); await f.scheduler.tick(); await f.scheduler.tick();
  const run = [...f.records].reverse().find(value => value.kind === 'run'); assert.equal(run.data.status, 'succeeded');
  const g = await fixture(t); g.task(); g.setSyncFailure(true); await g.scheduler.tick(); assert.equal(g.creates.length, 0);
});

test('definitions are synchronized again after outbox work and a last-moment pause prevents native admission', async t => {
  const f = await fixture(t); const task = f.task(); const original = f.service.sync; let reads = 0;
  f.service.sync = async cursor => {
    if (++reads === 2) f.setRecord('task', task.id, { ...task.data, enabled: false });
    return original(cursor);
  };
  await f.scheduler.tick(); assert.equal(reads, 2); assert.equal(f.creates.length, 0);
  assert.equal([...f.records].reverse().find(value => value.kind === 'run').data.status, 'cancelled');
});

test('manual run_task requests reject changed task instructions, device, workspace, or model before creating a session', async t => {
  for (const change of [{ instructions: 'Updated instructions' }, { deviceId: 'other-device' }, { workspaceId: 'workspace-other' }, { model: { providerId: 'modelhelm', modelId: 'updated-model' } }]) {
    const f = await fixture(t); const task = f.task('manual-task', f.at + 60000); const original = f.service.sync; let reads = 0;
    f.setRecord('request', 'manual-request', { type: 'run_task', taskId: task.id, deviceId: 'synthetic-device', createdAt: f.at, expiresAt: f.at + 60000 });
    f.service.sync = async cursor => { if (++reads === 2) f.setRecord('task', task.id, { ...task.data, ...change }); return original(cursor); };
    await f.scheduler.tick(); assert.equal(f.creates.length, 0); assert.equal(f.sends.length, 0);
    assert.equal([...f.records].reverse().find(value => value.kind === 'run').data.status, 'cancelled');
  }
});

test('the send gate catches task edits and phone cancellation during slow empty-session creation', async t => {
  const f = await fixture(t); const task = f.task(); const create = f.adapter.create;
  f.adapter.create = async command => { const receipt = await create(command); f.setRecord('task', task.id, { ...task.data, instructions: 'Changed while creating' }); return receipt; };
  await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.sends.length, 0);
  assert.equal([...f.records].reverse().find(value => value.kind === 'run').data.status, 'cancelled');
  const g = await fixture(t); const request = g.setRecord('request', 'phone-request', { type: 'chat', prompt: 'Original prompt', deviceId: 'synthetic-device', createdAt: g.at, expiresAt: g.at + 60000 }); const createPhone = g.adapter.create;
  g.adapter.create = async command => { const receipt = await createPhone(command); g.setRecord('request', request.id, { ...request.data, cancelRequested: true }); return receipt; };
  await g.scheduler.tick(); assert.equal(g.creates.length, 1); assert.equal(g.sends.length, 0);
  assert.equal([...g.records].reverse().find(value => value.kind === 'request').data.status, 'cancelled');
});

test('the send gate rechecks the feature and local inventory while retaining the empty receipt for safe recovery', async t => {
  const f = await fixture(t); f.task(); const create = f.adapter.create;
  f.adapter.create = async command => { const receipt = await create(command); f.setTasksEnabled(false); return receipt; };
  await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.sends.length, 0);
  f.setTasksEnabled(true); await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.sends.length, 1);
  const g = await fixture(t); g.task(); const createInventory = g.adapter.create;
  g.adapter.create = async command => { const receipt = await createInventory(command); g.options.getInventory = async () => ({ workspaces: [], models: [] }); return receipt; };
  await g.scheduler.tick(); assert.equal(g.creates.length, 1); assert.equal(g.sends.length, 0);
  assert.equal([...g.records].reverse().find(value => value.kind === 'run').data.status, 'failed');
});

test('all authenticated scheduler dispatches carry an identity fence and an account switch in delivery cannot leak an old receipt', async t => {
  const f = await fixture(t); f.task(); const dispatch = f.service.internalRequest;
  f.service.internalRequest = async (method, requestPath, body, expected) => {
    if (method === 'PUT') f.setIdentity({ userId: 'synthetic-other-user', deviceId: 'other-device', generation: 1 });
    return dispatch(method, requestPath, body, expected);
  };
  await f.scheduler.tick(); assert.equal(f.creates.length, 0); assert.equal(f.receipts.size, 0);
  assert.equal(f.calls.some(value => value.method === 'PUT'), true);
  for (const call of f.calls) assert.deepEqual(call.expected, { userId: 'synthetic-user', deviceId: 'synthetic-device', generation: 0 });
  const g = await fixture(t); g.task(); await g.scheduler.tick();
  for (const call of g.calls) assert.deepEqual(call.expected, { userId: 'synthetic-user', deviceId: 'synthetic-device', generation: 0 });
  assert.equal(g.calls.some(value => value.requestPath === '/features'), true); assert.equal(g.calls.some(value => value.requestPath === '/devices/heartbeat'), true);
});

test('closed and suspended availability is published immediately even with task admission disabled', async t => {
  const f = await fixture(t); f.setTasksEnabled(false); f.task(); await f.scheduler.tick();
  const heartbeats = () => f.calls.filter(value => value.requestPath === '/devices/heartbeat');
  assert.equal(heartbeats().length, 1); assert.equal(heartbeats()[0].body.inventory.windowOpen, true);
  f.setOpen(false); await f.scheduler.tick(); assert.equal(heartbeats().length, 2); assert.equal(heartbeats().at(-1).body.inventory.windowOpen, false);
  await f.scheduler.tick(); assert.equal(heartbeats().length, 2); assert.equal(f.creates.length, 0);
  f.setOpen(true); await f.scheduler.wake(); assert.equal(heartbeats().at(-1).body.inventory.windowOpen, true);
  const readsBeforeSuspend = f.calls.filter(value => value.requestPath === '/features').length;
  await f.scheduler.suspend(); assert.equal(heartbeats().at(-1).body.inventory.windowOpen, false);
  assert.equal(f.calls.filter(value => value.requestPath === '/features').length, readsBeforeSuspend);
  assert.deepEqual(heartbeats().at(-1).body.inventory.workspaces, [{ id: 'workspace-test', name: 'Test workspace' }]);
  await f.scheduler.tick(); assert.equal(f.creates.length, 0);
});

test('calendar reminders work independently of task rollout and local model inventory and remain deduplicated', async t => {
  const f = await fixture(t); f.setTasksEnabled(false); f.options.getInventory = async () => { throw new Error('Synthetic runtime unavailable'); };
  f.setRecord('event', 'calendar-reminder', { title: 'Synthetic calendar reminder', startAt: f.at + 61000, endAt: f.at + 3600000, timeZone: 'UTC', reminders: [1] });
  await f.scheduler.tick(); assert.equal(f.notices.length, 0); f.advance(1500); await f.scheduler.tick();
  assert.deepEqual(f.notices, [['日程提醒', 'Synthetic calendar reminder']]); assert.equal(f.creates.length, 0);
  await f.scheduler.tick(); await f.restart(); await f.scheduler.tick(); assert.equal(f.notices.length, 1);
});

test('cached calendar reminders still fire offline while new AI remains blocked', async t => {
  const f = await fixture(t); f.task('offline-task', f.at + 1000);
  f.setRecord('event', 'offline-reminder', { title: 'Offline calendar reminder', startAt: f.at + 61000, endAt: f.at + 3600000, timeZone: 'UTC', reminders: [1] });
  await f.scheduler.tick(); f.setOffline(true); f.advance(2000); await f.scheduler.tick(); await f.scheduler.tick();
  assert.deepEqual(f.notices, [['日程提醒', 'Offline calendar reminder']]); assert.equal(f.creates.length, 0);
});

test('a completed recurring occurrence has no reminder while a later planned one remains scheduled', async t => {
  const f = await fixture(t); f.setTasksEnabled(false);
  const date = new Date(f.at + 61000).toISOString().slice(0, 10);
  f.setRecord('event', 'completed-occurrence', { title: 'Recurring todo', category: 'todo', startAt: f.at + 61000, endAt: f.at + 3600000, timeZone: 'UTC', recurrence: { frequency: 'daily', count: 2 }, exceptions: { [date]: { status: 'completed' } }, reminders: [1] });
  await f.scheduler.tick(); f.advance(2000); await f.scheduler.tick(); assert.equal(f.notices.length, 0);
  f.advance(86400000 - 2000); await f.scheduler.tick();
  f.advance(2000); await f.scheduler.tick(); assert.deepEqual(f.notices, [['日程提醒', 'Recurring todo']]);
});

test('calendar rollout and per-account notifications settings suppress reminders and completion notifications', async t => {
  const f = await fixture(t); f.setCalendarEnabled(false);
  f.setRecord('event', 'disabled-calendar', { title: 'Disabled calendar', startAt: f.at + 61000, endAt: f.at + 3600000, timeZone: 'UTC', reminders: [1] });
  await f.scheduler.tick(); f.advance(2000); await f.scheduler.tick(); assert.equal(f.notices.length, 0);
  const g = await fixture(t); g.task(); g.setRecord('settings', 'personal-settings', { timeZone: 'UTC', notifications: false });
  g.setRecord('event', 'muted-calendar', { title: 'Muted calendar', startAt: g.at + 61000, endAt: g.at + 3600000, timeZone: 'UTC', reminders: [1] });
  await g.scheduler.tick(); g.setProgress({ status: 'idle', finalText: 'Synthetic completion', messageCount: 2 }); g.advance(2000); await g.scheduler.tick();
  assert.equal([...g.records].reverse().find(value => value.kind === 'run').data.status, 'succeeded'); assert.equal(g.notices.length, 0);
  g.setRecord('settings', 'personal-settings', { timeZone: 'UTC', notifications: true });
  g.setRecord('event', 'enabled-calendar', { title: 'Enabled calendar', startAt: g.at + 61000, endAt: g.at + 3600000, timeZone: 'UTC', reminders: [1] });
  await g.scheduler.tick(); g.advance(2000); await g.scheduler.tick(); assert.deepEqual(g.notices, [['日程提醒', 'Enabled calendar']]);
});

test('pending phone requests expire/cancel without AI, target devices are checked, and coach sessions have proposal-only mode', async t => {
  const f = await fixture(t);
  f.setRecord('request', 'expired', { type: 'chat', prompt: 'Expired', deviceId: 'synthetic-device', createdAt: f.at - 10000, expiresAt: f.at - 1 });
  f.setRecord('request', 'cancelled', { type: 'chat', prompt: 'Cancelled', deviceId: 'synthetic-device', cancelRequested: true, createdAt: f.at, expiresAt: f.at + 60000 });
  f.setRecord('request', 'other-device', { type: 'chat', prompt: 'Other device', deviceId: 'other-device', createdAt: f.at, expiresAt: f.at + 60000 });
  await f.scheduler.tick(); assert.equal(f.creates.length, 0);
  assert.equal([...f.records].reverse().find(value => value.id === 'expired').data.status, 'expired');
  assert.equal([...f.records].reverse().find(value => value.id === 'cancelled').data.status, 'cancelled');
  f.setRecord('request', 'coach', { type: 'coach', prompt: 'Synthetic coaching proposal', deviceId: 'synthetic-device', createdAt: f.at, expiresAt: f.at + 60000 });
  await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.scheduler.executionModeForSession('session-1'), 'scheduled');
});

test('uncertain creation and sending never create or submit another paid turn after recovery', async t => {
  const f = await fixture(t); f.task();
  f.adapter.create = async command => { f.creates.push(command); throw new Error('Synthetic uncertain create'); };
  await f.scheduler.tick(); await f.restart(); await f.scheduler.tick(); assert.equal(f.creates.length, 1); assert.equal(f.sends.length, 0);
  const g = await fixture(t); g.task(); g.adapter.send = async () => { g.sends.push('uncertain'); throw new Error('Synthetic uncertain send'); };
  await g.scheduler.tick(); g.setProgress({ status: 'idle', messageCount: 0 }); await g.restart(); await g.scheduler.tick(); await g.scheduler.tick();
  assert.equal(g.creates.length, 1); assert.equal(g.sends.length, 1);
  assert.equal([...g.records].reverse().find(value => value.kind === 'run').data.status, 'uncertain');
});

test('window closure and account revocation stop the pinned turn; no new account receives an old receipt', async t => {
  const f = await fixture(t); f.task(); await f.scheduler.tick(); f.setOpen(false); await f.scheduler.tick();
  assert.equal(f.stops.length, 1); assert.equal(f.stops[0].input.messageId, f.sends[0].input.messageId);
  assert.equal([...f.records].reverse().find(value => value.kind === 'run').data.status, 'cancelled');
  const g = await fixture(t); g.task(); await g.scheduler.tick(); g.setIdentity(null); await g.scheduler.tick(); assert.equal(g.stops.length, 1); assert.equal(g.creates.length, 1);
});

test('corrupt journal fails closed and is not replaced with an empty execution history', async t => {
  const f = await fixture(t); await f.scheduler.tick(); const file = await f.journalPath(); await f.scheduler.dispose(); await writeFile(file, '{invalid');
  await f.restart(); await assert.rejects(() => f.scheduler.tick(), /避免重复/); assert.equal(f.creates.length, 0); assert.equal(await readFile(file, 'utf8'), '{invalid');
});
