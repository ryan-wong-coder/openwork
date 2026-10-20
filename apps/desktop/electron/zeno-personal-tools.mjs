import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createMutation, personalRecordSchema, proposalDataSchema, recordKindSchema, recordMutationSchema, recordSchemas } from '@zeno/core';
import { atomicPrivateJson } from './zeno-personal.mjs';

const callSchema = z.object({ action: z.enum(['read', 'write', 'propose', 'undo']), kind: recordKindSchema.optional(), id: z.string().max(128).optional(), baseVersion: z.number().int().nonnegative().optional(), operationId: z.string().max(128).optional(), data: z.record(z.string(), z.unknown()).optional(), deleted: z.boolean().optional(), undoId: z.string().max(128).optional() }).strict();
const undoSchema = z.object({ id: z.string(), expiresAt: z.number(), mutation: recordMutationSchema });
const writable = new Set(['event', 'routine', 'trainingSchedule', 'workout', 'measurement', 'exercise', 'membership', 'task', 'settings']);
export function createZenoPersonalToolsService({ service, isWindowOpen, executionModeForSession = sessionId => 'interactive' }) {
  let serial = Promise.resolve();
  async function execute(raw, submitted) {
    if (!isWindowOpen()) return { ok: false, code: 'window_closed', error: '请打开电脑上的泽诺后操作。' };
    const input = z.object({ input: callSchema, sessionId: z.string().min(1).max(300) }).strict().parse(raw);
    if (!submitted) return { ok: false, code: 'account_required', error: '请先在泽诺连接自己的账号。' };
    const identity = await service.identity();
    if (!identity || identity.userId !== submitted.userId || identity.deviceId !== submitted.deviceId || identity.generation !== submitted.generation) return { ok: false, code: 'account_changed' };
    const stillSame = async () => { const current = await service.identity(); return current && current.userId === identity.userId && current.deviceId === identity.deviceId && current.generation === identity.generation; };
    const currentSession = await service.getSession(); if (!currentSession || currentSession.user.id !== identity.userId) return { ok: false, code: 'account_changed' };
    const args = input.input; const directory = service.accountDirectory(identity.userId);
    const undoFile = path.join(directory, 'undo.json');
    if (args.action === 'read') {
      const records = new Map(); let cursor = 0, hasMore = true, changes = 0;
      while (hasMore) {
        const page = await service.sync(cursor);
        if (!await stillSame()) return { ok: false, code: 'account_changed' };
        changes += page.records.length;
        if (changes > 50000) throw new Error('数据较多，请在界面导出后分析。');
        for (const rawRecord of page.records) {
          const record = personalRecordSchema.parse(rawRecord);
          if (record.userId !== identity.userId) continue;
          const key = record.kind + ':' + record.id, previous = records.get(key);
          // The change feed includes every historical version and tombstone.
          if (!previous || record.version > previous.version || record.version === previous.version && record.cursor > previous.cursor) records.set(key, record);
        }
        if (page.hasMore && page.cursor <= cursor) throw new Error('同步游标无效。');
        cursor = page.cursor; hasMore = page.hasMore;
      }
      const visible = [...records.values()].filter(record => record.deletedAt === null && (!args.kind || record.kind === args.kind) && (!args.id || record.id === args.id));
      return { ok: true, records: visible.slice(0, 200), truncated: visible.length > 200, schemas: args.kind ? { [args.kind]: z.toJSONSchema(recordSchemas[args.kind]) } : Object.fromEntries([...writable].map(kind => [kind, z.toJSONSchema(recordSchemas[kind])])), instruction: '写入完整data并传递原记录version作为baseVersion；新建baseVersion=0。主动建议使用propose。' };
    }
    const mode = executionModeForSession(input.sessionId);
    if (args.action === 'write' && mode !== 'interactive') return { ok: false, code: 'proposal_required', error: '定时任务只能生成待审核的日历及训练调整提案。' };
    if (args.action === 'undo') {
      if (mode !== 'interactive') return { ok: false, code: 'proposal_required' };
      let entries = []; try { entries = z.array(undoSchema).parse(JSON.parse(await readFile(undoFile, 'utf8'))); } catch {}
      const entry = entries.find(value => value.id === args.undoId && value.expiresAt > Date.now());
      if (!entry) return { ok: false, code: 'undo_expired', error: '撤销入口已过期。' };
      const response = await service.internalRequest('PUT', '/records/' + entry.mutation.kind + '/' + entry.mutation.id, entry.mutation, identity);
      if (response.status >= 300) return { ok: false, ...response };
      if (!await stillSame()) return { ok: false, code: 'account_changed', mayHaveChangedState: true, retrySafe: false };
      await atomicPrivateJson(undoFile, entries.filter(value => value.id !== entry.id));
      return { ok: true, ...response.body };
    }
    let mutation;
    if (!args.operationId) throw new Error('写入必须使用稳定的 operationId。');
    const stableId = args.id ?? 'ai_' + createHash('sha256').update(JSON.stringify([identity.userId, args.operationId])).digest('hex');
    if (args.action === 'propose') {
      const data = proposalDataSchema.parse({ ...args.data, source: mode === 'interactive' ? 'proactive' : 'scheduled', status: 'pending' });
      for (const change of data.changes) recordMutationSchema.parse({ ...change, operationId: crypto.randomUUID() });
      mutation = createMutation('proposal', data, { id: stableId, operationId: args.operationId });
    } else {
      if (!args.kind || !writable.has(args.kind)) return { ok: false, code: 'read_only_kind', error: '执行回执和审核状态只能由真实执行和用户审核产生。' };
      if (args.id && args.baseVersion === undefined) throw new Error('修改已有记录必须携带 baseVersion。');
      if (!args.operationId) throw new Error('写入必须使用稳定的 operationId。');
      mutation = recordMutationSchema.parse({ kind: args.kind, id: stableId, baseVersion: args.baseVersion ?? 0, operationId: args.operationId, data: args.data, deleted: args.deleted ?? false });
    }
    const response = await service.internalRequest('PUT', '/records/' + mutation.kind + '/' + mutation.id, mutation, identity);
    if (response.status >= 300) return { ok: false, ...response };
    const after = await service.identity();
    if (!after || after.userId !== identity.userId || after.deviceId !== identity.deviceId || after.generation !== identity.generation) return { ok: false, code: 'account_changed', mayHaveChangedState: true, retrySafe: false, error: '账号已改变，操作可能已在原账号完成，请重新连接原账号核对。' };
    const result = z.object({ record: personalRecordSchema, previous: personalRecordSchema.nullable() }).parse(response.body);
    const undoId = crypto.randomUUID(), expiresAt = Date.now() + 24 * 3600000;
    const undo = recordMutationSchema.parse({ kind: result.record.kind, data: result.previous?.data ?? result.record.data, id: result.record.id, baseVersion: result.record.version, operationId: 'undo-' + mutation.operationId, deleted: !result.previous || result.previous.deletedAt !== null });
    let entries = []; try { entries = z.array(undoSchema).parse(JSON.parse(await readFile(undoFile, 'utf8'))); } catch {}
    await atomicPrivateJson(undoFile, [...entries.filter(value => value.expiresAt > Date.now()).slice(-99), { id: undoId, expiresAt, mutation: undo }]);
    return { ok: true, record: result.record, undo: { id: undoId, expiresAt }, reviewRequired: args.action === 'propose' };
  }
  return { execute(raw) {
    // Pin the account when the caller submits, before waiting behind another operation.
    const submitted = Promise.resolve(service.identity()).then(value => value ? { userId: value.userId, deviceId: value.deviceId, generation: value.generation } : null).catch(() => null);
    const result = serial.then(async () => execute(raw, await submitted)); serial = result.catch(() => {}); return result;
  } };
}
