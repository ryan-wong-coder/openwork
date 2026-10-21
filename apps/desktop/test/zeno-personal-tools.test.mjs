import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { personalRecordSchema, recordMutationSchema } from '@zeno/core';
import { createZenoPersonalToolsService } from '../electron/zeno-personal-tools.mjs';

const NOW = 1800000000000;
const membership = code => ({ name: 'Fixture membership', code, format: 'qr', expiresAt: null, notes: '' });
function sameIdentity(a, b) { return a && b && a.userId === b.userId && a.deviceId === b.deviceId && a.generation === b.generation; }
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'zeno-personal-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = { identity: { userId: 'user-a', deviceId: 'device-a', generation: 1 }, windowOpen: true, records: new Map(), operations: new Map(), calls: [], history: [] };
  const directory = user => path.join(root, 'accounts', createHash('sha256').update(user).digest('hex'));
  const service = {
    identity: async () => state.identity ? { ...state.identity } : null,
    getSession: async () => state.identity ? { user: { id: state.identity.userId, email: 'fixture@example.invalid', name: 'Fixture', role: 'user' } } : null,
    accountDirectory: directory,
    sync: async (cursor = 0, expected = null) => {
      if (expected && !sameIdentity(expected, state.identity)) throw new Error('account_changed');
      return { records: [...state.records.values()].filter(record => record.userId === state.identity?.userId && record.cursor > cursor), cursor: Math.max(0, ...[...state.records.values()].map(record => record.cursor)), hasMore: false };
    },
    internalRequest: async (method, route, raw, expected = null) => {
      state.calls.push({ method, route, raw: structuredClone(raw), expected: expected ? { ...expected } : null });
      if (expected && !sameIdentity(expected, state.identity)) return { status: 409, body: { code: 'account_changed' } };
      if (method === 'GET' && route === '/devices') return { status: 200, body: { devices: [] } };
      if (method === 'GET' && route === '/features') return { status: 200, body: { zenoAccounts: true, personalCalendar: true, fitnessTracking: true, localScheduledTasks: true } };
      const mutation = recordMutationSchema.parse(raw);
      assert.equal(method, 'PUT'); assert.equal(route, `/records/${mutation.kind}/${mutation.id}`);
      const account = state.identity.userId; const key = `${account}:${mutation.kind}:${mutation.id}`; const operation = `${account}:${mutation.operationId}`;
      const encoded = JSON.stringify(mutation); const replay = state.operations.get(operation);
      if (replay) return replay.encoded === encoded ? { status: 200, body: structuredClone(replay.body) } : { status: 409, body: { code: 'operation_conflict' } };
      const previous = state.records.get(key) ?? null;
      if ((previous?.version ?? 0) !== mutation.baseVersion) return { status: 409, body: { code: 'version_conflict', current: previous } };
      const version = (previous?.version ?? 0) + 1; const cursor = state.history.length + 1;
      const record = personalRecordSchema.parse({ kind: mutation.kind, id: mutation.id, data: mutation.data, userId: account, version, cursor, createdAt: previous?.createdAt ?? NOW, updatedAt: NOW + cursor, deletedAt: mutation.deleted ? NOW + cursor : null });
      state.records.set(key, record); state.history.push(structuredClone(record));
      const body = { record, previous: structuredClone(previous), replayed: false }; state.operations.set(operation, { encoded, body: structuredClone(body) });
      return { status: 200, body };
    },
  };
  Object.assign(service, options.service ?? {});
  const tools = createZenoPersonalToolsService({ service, isWindowOpen: () => state.windowOpen, executionModeForSession: id => id === 'scheduled-session' ? 'scheduled' : id === 'unknown-session' ? null : 'interactive' });
  const execute = (input, sessionId = 'interactive-session') => tools.execute({ sessionId, input });
  const write = (code, baseVersion = 0, operationId = `fixture-${code}`, id = 'membership-a') => execute({ action: 'write', kind: 'membership', id, baseVersion, operationId, data: membership(code) });
  const undoFile = user => path.join(directory(user), 'undo.json');
  return { root, state, service, tools, execute, write, undoFile };
}

test('tools require an open window and matching signed-in account before reading or writing', async t => {
  const value = await fixture(t); value.state.windowOpen = false;
  assert.equal((await value.write('1')).code, 'window_closed'); assert.equal(value.state.calls.length, 0);
  value.state.windowOpen = true; value.state.identity = null;
  assert.equal((await value.execute({ action: 'read' })).code, 'account_required');
  value.state.identity = { userId: 'user-a', deviceId: 'device-a', generation: 1 };
  value.service.getSession = async () => ({ user: { id: 'user-b' } });
  assert.equal((await value.write('2')).code, 'account_changed'); assert.equal(value.state.calls.length, 0);
});

test('interactive writes use optimistic versions and stable operation ids; conflicts create no undo', async t => {
  const value = await fixture(t); const created = await value.write('1'); assert.equal(created.ok, true); assert.equal(created.record.version, 1);
  await assert.rejects(value.execute({ action: 'write', kind: 'membership', id: 'membership-a', operationId: 'no-base', data: membership('2') }), /baseVersion/);
  await assert.rejects(value.execute({ action: 'write', kind: 'membership', id: 'membership-a', baseVersion: 1, data: membership('2') }), /operationId/);
  const conflict = await value.write('2', 0, 'stale-write'); assert.equal(conflict.ok, false); assert.equal(conflict.status, 409); assert.equal(value.state.history.length, 1);
  const journal = JSON.parse(await readFile(value.undoFile('user-a'), 'utf8')); assert.equal(journal.length, 1);
  const replayed = await value.write('1'); assert.equal(replayed.record.version, 1); assert.equal(value.state.history.length, 1);
  const collision = await value.write('different', 1, 'fixture-1'); assert.equal(collision.status, 409); assert.equal(value.state.history.length, 1);
});

test('scheduled and unknown executions can only propose allowed calendar and plan changes', async t => {
  const value = await fixture(t);
  for (const sessionId of ['scheduled-session', 'unknown-session']) {
    assert.equal((await value.execute({ action: 'write', kind: 'membership', operationId: 'scheduled-write', data: membership('1') }, sessionId)).code, 'proposal_required');
    assert.equal((await value.execute({ action: 'undo', undoId: 'never' }, sessionId)).code, 'proposal_required');
  }
  assert.equal(value.state.calls.length, 0);
  const data = { title: 'Fixture review', description: 'Synthetic plan adjustment', source: 'proactive', status: 'applied', createdAt: NOW,
    changes: [{ kind: 'routine', id: 'routine-a', baseVersion: 0, data: { title: 'Fixture routine', unit: 'kg', exercises: [] }, deleted: false }] };
  const result = await value.execute({ action: 'propose', id: 'proposal-a', operationId: 'proposal-create', data }, 'scheduled-session');
  assert.equal(result.ok, true); assert.equal(result.reviewRequired, true); assert.equal(result.record.kind, 'proposal');
  assert.equal(result.record.data.source, 'scheduled'); assert.equal(result.record.data.status, 'pending'); assert.equal(result.record.data.createdAt, NOW);
  assert.equal([...value.state.records.values()].some(record => record.kind === 'routine'), false);
  await assert.rejects(value.execute({ action: 'propose', data: { ...data, changes: [{ ...data.changes[0], kind: 'workout' }] } }, 'scheduled-session'));
  await assert.rejects(value.execute({ action: 'propose', data }, 'scheduled-session'), /operationId/);
});

test('create retries without an id derive a stable record id from the account and operation', async t => {
  const value = await fixture(t); const input = { action: 'write', kind: 'membership', operationId: 'stable-create-without-id', data: membership('1') };
  const first = await value.execute(input); const second = await value.execute(input);
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(first.record.id, second.record.id); assert.equal(second.record.version, 1); assert.equal(value.state.history.length, 1);
  value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 };
  const other = await value.execute(input); assert.equal(other.ok, true); assert.notEqual(other.record.id, first.record.id); assert.equal(other.record.userId, 'user-b');
});

test('AI cannot manufacture execution receipts or review states through direct writes', async t => {
  const value = await fixture(t);
  for (const kind of ['run', 'request', 'proposal']) assert.equal((await value.execute({ action: 'write', kind, operationId: 'fixture-read-only', data: {} })).code, 'read_only_kind');
  assert.equal(value.state.calls.length, 0);
});

test('undo appends a new version and a second use is consumed rather than rewriting history', async t => {
  const value = await fixture(t); await value.write('old'); const changed = await value.write('new', 1, 'edit-card');
  assert.equal(changed.record.version, 2);
  const result = await value.execute({ action: 'undo', undoId: changed.undo.id });
  assert.equal(result.ok, true); assert.equal(result.record.version, 3); assert.equal(result.record.data.code, 'old');
  assert.deepEqual(value.state.history.map(record => record.data.code), ['old', 'new', 'old']);
  assert.equal((await value.execute({ action: 'undo', undoId: changed.undo.id })).code, 'undo_expired');
  assert.equal((await stat(value.undoFile('user-a'))).mode & 0o777, 0o600);
});

test('undo of a creation retains a tombstone version and later edits conflict safely', async t => {
  const value = await fixture(t); const created = await value.write('new');
  const removed = await value.execute({ action: 'undo', undoId: created.undo.id });
  assert.equal(removed.record.version, 2); assert.ok(removed.record.deletedAt); assert.equal(value.state.history.length, 2);
  const recreated = await value.write('restored', 2, 'restore-card'); await value.write('later', 3, 'later-edit');
  const conflict = await value.execute({ action: 'undo', undoId: recreated.undo.id });
  assert.equal(conflict.status, 409); assert.equal(value.state.history.length, 4);
  assert.ok(JSON.parse(await readFile(value.undoFile('user-a'), 'utf8')).some(entry => entry.id === recreated.undo.id));
});

test('expired and other-account undo handles cannot restore records', async t => {
  const value = await fixture(t); const created = await value.write('1');
  const entries = JSON.parse(await readFile(value.undoFile('user-a'), 'utf8')); entries[0].expiresAt = Date.now() - 1;
  await writeFile(value.undoFile('user-a'), JSON.stringify(entries));
  assert.equal((await value.execute({ action: 'undo', undoId: created.undo.id })).code, 'undo_expired');
  value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 };
  assert.equal((await value.execute({ action: 'undo', undoId: created.undo.id })).code, 'undo_expired'); assert.equal(value.state.history.length, 1);
});

test('read returns only current live records, supports filters and explicitly truncates at 200', async t => {
  const value = await fixture(t);
  for (let index = 0; index < 205; index++) {
    const record = personalRecordSchema.parse({ kind: 'membership', id: `card-${index}`, userId: 'user-a', data: membership(String(index)), version: 1, cursor: index + 1, createdAt: NOW, updatedAt: NOW, deletedAt: index === 0 ? NOW : null });
    value.state.records.set(`user-a:membership:${record.id}`, record);
  }
  const result = await value.execute({ action: 'read', kind: 'membership' }); assert.equal(result.ok, true); assert.equal(result.records.length, 200); assert.equal(result.truncated, true); assert.ok(result.records.every(record => record.deletedAt === null));
  assert.ok(result.schemas.membership); assert.equal((await value.execute({ action: 'read', kind: 'membership', id: 'card-2' })).records.length, 1);
});

test('paginated change history collapses versions before filtering tombstones for AI reads', async t => {
  const value = await fixture(t);
  await value.write('old', 0, 'deleted-v1');
  await value.write('edited', 1, 'deleted-v2');
  await value.execute({ action: 'write', kind: 'membership', id: 'membership-a', baseVersion: 2, operationId: 'deleted-v3', data: membership('edited'), deleted: true });
  await value.write('keep-old', 0, 'kept-v1', 'membership-b');
  await value.write('keep-new', 1, 'kept-v2', 'membership-b');
  value.service.sync = async cursor => {
    const rest = value.state.history.filter(record => record.cursor > cursor), records = rest.slice(0, 2);
    return { records, cursor: records.at(-1)?.cursor ?? cursor, hasMore: rest.length > records.length };
  };
  const result = await value.execute({ action: 'read', kind: 'membership' });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, 'membership-b');
  assert.equal(result.records[0].version, 2);
  assert.equal(result.records[0].data.code, 'keep-new');
  assert.equal((await value.execute({ action: 'read', id: 'membership-a' })).records.length, 0);
});

test('a changed generation before dispatch is passed to native authorization and rejected', async t => {
  const value = await fixture(t); const original = value.service.getSession;
  value.service.getSession = async () => { const session = await original(); value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 }; return session; };
  const result = await value.write('old-account-data'); assert.equal(result.ok, false); assert.equal(result.status, 409); assert.equal(value.state.history.length, 0);
});

test('account switch after a successful write suppresses records and does not save an undo journal', async t => {
  const value = await fixture(t); const original = value.service.internalRequest;
  value.service.internalRequest = async (...args) => { const response = await original(...args); value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 }; return response; };
  const result = await value.write('old-account-data'); assert.equal(result.code, 'account_changed'); assert.equal(result.record, undefined); assert.equal(result.retrySafe, false);
  await assert.rejects(stat(value.undoFile('user-a')), { code: 'ENOENT' }); await assert.rejects(stat(value.undoFile('user-b')), { code: 'ENOENT' });
});

test('account switch during pagination cannot return a mixed-account read', async t => {
  const value = await fixture(t); const made = await value.write('old-account-data'); let pages = 0;
  value.service.sync = async () => {
    pages++; if (pages === 1) { value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 }; return { records: [made.record], cursor: 1, hasMore: true }; }
    return { records: [{ ...made.record, userId: 'user-b', id: 'other-account-card', cursor: 2 }], cursor: 2, hasMore: false };
  };
  const result = await value.execute({ action: 'read' }); assert.equal(result.ok, false); assert.equal(result.code, 'account_changed'); assert.equal(result.records, undefined);
});

test('account switch during undo cannot expose the old-account result', async t => {
  const value = await fixture(t); const made = await value.write('old-account-data'); const original = value.service.internalRequest;
  value.service.internalRequest = async (...args) => { const response = await original(...args); value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 }; return response; };
  const result = await value.execute({ action: 'undo', undoId: made.undo.id }); assert.equal(result.ok, false); assert.equal(result.code, 'account_changed'); assert.equal(result.record, undefined); assert.equal(result.mayHaveChangedState, true); assert.equal(result.retrySafe, false);
});

test('read rejects a non-advancing pagination cursor and drops foreign-account records', async t => {
  const value = await fixture(t); const made = await value.write('1');
  value.service.sync = async () => ({ records: [], cursor: 0, hasMore: true });
  await assert.rejects(value.execute({ action: 'read' }), /同步游标无效/);
  value.service.sync = async () => ({ records: [made.record, { ...made.record, userId: 'user-b', id: 'foreign-card' }], cursor: 2, hasMore: false });
  const result = await value.execute({ action: 'read' }); assert.equal(result.ok, true); assert.equal(result.records.length, 1); assert.equal(result.records[0].userId, 'user-a');
});

test('queued calls retain their submitting account and cannot migrate into a newly connected account', async t => {
  const value = await fixture(t); const original = value.service.internalRequest;
  let entered, release; const blocked = new Promise(resolve => { entered = resolve; }); const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  value.service.internalRequest = async (...args) => { const response = await original(...args); if (++calls === 1) { entered(); await gate; } return response; };
  const first = value.write('old-account-data', 0, 'queued-first', 'card-first'); await blocked;
  const queued = value.write('queued-old-account-data', 0, 'queued-second', 'card-second');
  await new Promise(resolve => setImmediate(resolve)); value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 }; release();
  const [a, b] = await Promise.all([first, queued]); assert.equal(a.code, 'account_changed'); assert.equal(b.ok, false); assert.equal(b.code, 'account_changed');
  assert.equal(value.state.history.length, 1); assert.equal(value.state.history[0].userId, 'user-a');
});

test('device context failures and account switches do not become successful empty reads', async t => {
  const value = await fixture(t);
  value.service.internalRequest = async () => ({ status: 403, body: { code: 'forbidden' } });
  const forbidden = await value.execute({ action: 'read', kind: 'task' }); assert.equal(forbidden.ok, false); assert.equal(forbidden.code, 'forbidden'); assert.equal(forbidden.records, undefined);
  value.service.internalRequest = async () => ({ status: 200, body: { devices: [{ id: 'device-a', accessToken: 'synthetic-unexpected-field' }] } });
  await assert.rejects(value.execute({ action: 'read', kind: 'task' }));
  value.service.internalRequest = async () => { value.state.identity = { userId: 'user-b', deviceId: 'device-b', generation: 2 }; return { status: 200, body: { devices: [] } }; };
  const switched = await value.execute({ action: 'read' }); assert.equal(switched.code, 'account_changed'); assert.equal(switched.context, undefined); assert.equal(switched.records, undefined);
});
