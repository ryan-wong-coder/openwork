import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createMutation, deviceSchema, personalFeaturesSchema, personalRecordSchema, proposalDataSchema, recordKindSchema, recordMutationSchema, recordSchemas } from '@zeno/core';
import { agentCatalogueCoverage, findAgentExercise, searchAgentExercises } from '@zeno/fitness/agent-catalogue';
import { atomicPrivateJson } from './zeno-personal.mjs';

export const personalToolCallSchema = z.object({ action: z.enum(['read', 'catalogue', 'write', 'propose', 'undo']), kind: recordKindSchema.optional(), id: z.string().max(128).optional(), query: z.string().max(240).optional(), equipment: z.array(z.string().min(1).max(100)).max(30).optional(), muscles: z.array(z.string().min(1).max(100)).max(50).optional(), category: z.string().max(100).optional(), bodyPart: z.string().max(100).optional(), offset: z.number().int().min(0).max(50000).optional(), limit: z.number().int().min(1).max(200).optional(), baseVersion: z.number().int().nonnegative().optional(), operationId: z.string().max(128).optional(), data: z.record(z.string(), z.unknown()).optional(), deleted: z.boolean().optional(), undoId: z.string().max(128).optional() }).strict();
const undoSchema = z.object({ id: z.string(), expiresAt: z.number(), mutation: recordMutationSchema });
const writable = new Set(['event', 'routine', 'trainingSchedule', 'workout', 'measurement', 'exercise', 'membership', 'task', 'settings']);
export function createZenoPersonalToolsService({ service, isWindowOpen, executionModeForSession = sessionId => 'interactive' }) {
  let serial = Promise.resolve();
  async function execute(raw, submitted) {
    if (!isWindowOpen()) return { ok: false, code: 'window_closed', error: '请打开电脑上的泽诺后操作。' };
    const input = z.object({ input: personalToolCallSchema, sessionId: z.string().min(1).max(300) }).strict().parse(raw);
    if (!submitted) return { ok: false, code: 'account_required', error: '请先在泽诺连接自己的账号。' };
    const identity = await service.identity();
    if (!identity || identity.userId !== submitted.userId || identity.deviceId !== submitted.deviceId || identity.generation !== submitted.generation) return { ok: false, code: 'account_changed' };
    const stillSame = async () => { const current = await service.identity(); return current && current.userId === identity.userId && current.deviceId === identity.deviceId && current.generation === identity.generation; };
    const currentSession = await service.getSession(); if (!currentSession || currentSession.user.id !== identity.userId) return { ok: false, code: 'account_changed' };
    const args = input.input; const directory = service.accountDirectory(identity.userId);
    const undoFile = path.join(directory, 'undo.json');
    async function liveRecords() {
      const records = new Map(); let cursor = 0, hasMore = true, changes = 0;
      while (hasMore) {
        const page = await service.sync(cursor);
        if (!await stillSame()) return null;
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
      return [...records.values()].filter(record => record.deletedAt === null);
    }
    const customExercises = records => records.filter(record => record.kind === 'exercise').map(record => ({ id: record.id, name: record.data.name, englishName: record.data.name, category: record.data.category, categoryId: record.data.category, bodyPart: '自定义', bodyPartId: 'custom', equipment: record.data.equipment.join('、'), equipmentId: 'custom', primaryMuscles: record.data.primaryMuscles, primaryMuscleIds: record.data.primaryMuscles, secondaryMuscles: record.data.secondaryMuscles, secondaryMuscleIds: record.data.secondaryMuscles, instructions: record.data.instructions, description: '', mediaIds: record.data.mediaIds }));
    const paginate = (rows, defaultLimit) => {
      const offset = args.offset ?? 0, limit = args.limit ?? defaultLimit, end = Math.min(rows.length, offset + limit);
      return { rows: rows.slice(offset, end), total: rows.length, offset, limit, nextOffset: end < rows.length ? end : null, truncated: end < rows.length };
    };
    if (args.action === 'read' || args.action === 'catalogue') {
      if (args.action === 'catalogue') {
        const response = await service.internalRequest('GET', '/features', undefined, identity);
        if (!await stillSame()) return { ok: false, code: 'account_changed' };
        if (response.status >= 300) return { ok: false, ...response };
        if (!personalFeaturesSchema.parse(response.body).fitnessTracking) return { ok: false, code: 'feature_disabled', error: '健身功能已停用，已有个人记录仍可通过 read 查看和导出。' };
      }
      const records = await liveRecords(); if (!records) return { ok: false, code: 'account_changed' };
      if (args.action === 'catalogue') {
        const custom = customExercises(records);
        const exercise = args.id ? findAgentExercise(args.id, custom) : undefined;
        const matches = args.id ? exercise ? [exercise] : [] : searchAgentExercises({ query: args.query, equipment: args.equipment, muscles: args.muscles, category: args.category, bodyPart: args.bodyPart, customExercises: custom });
        const { rows: exercises, ...pagination } = paginate(matches, 20);
        return { ok: true, exercises, ...pagination, coverage: { ...agentCatalogueCoverage, ownCustomExercises: custom.length }, instruction: '使用返回的 exerciseId 原样填写 routine/workout.exercises[].exerciseId；不要编造编号。demo 为已存在原创演示的官网相对路径，null 表示暂无素材；mediaIds 仅引用自己的鉴权媒体。训练计划用 read kind=routine 查询，写入字段用 read 返回的 schemas。' };
      }
      const query = (args.query ?? '').normalize('NFKC').trim().toLocaleLowerCase(), words = query.split(/\s+/).filter(Boolean);
      const matches = records.filter(record => (!args.kind || record.kind === args.kind) && (!args.id || record.id === args.id) && words.every(word => `${record.id} ${JSON.stringify(record.data)}`.normalize('NFKC').toLocaleLowerCase().includes(word))).sort((left, right) => right.updatedAt - left.updatedAt || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
      const { rows: visible, ...pagination } = paginate(matches, 200);
      let context;
      if (!args.kind || args.kind === 'task') {
        const response = await service.internalRequest('GET', '/devices', undefined, identity);
        if (!await stillSame()) return { ok: false, code: 'account_changed' };
        if (response.status >= 300) return { ok: false, status: response.status, code: response.status === 401 ? 'account_required' : response.status === 403 ? 'forbidden' : response.status === 409 ? 'account_changed' : 'device_context_unavailable', error: '设备清单暂时无法读取，请检查账号连接后重试。' };
        const { devices } = z.object({ devices: z.array(deviceSchema) }).strict().parse(response.body);
        context = { currentDeviceId: identity.deviceId, heartbeatMayBeStale: true, executionRequiresLocalConfirmation: true, devices: devices.map(device => ({ id: device.id, name: device.name, platform: device.platform, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt, expiresAt: device.expiresAt, windowOpen: device.windowOpen, workspaces: device.workspaces, models: device.models })) };
      }
      return { ok: true, records: visible, ...pagination, ...(context ? { context } : {}), schemas: args.kind ? { [args.kind]: z.toJSONSchema(recordSchemas[args.kind]) } : Object.fromEntries([...writable].map(kind => [kind, z.toJSONSchema(recordSchemas[kind])])), instruction: '写入完整data并传递原记录version作为baseVersion；新建baseVersion=0，operationId保持稳定。主动建议使用propose。完整内置及自定义动作目录用 action=catalogue 查询真实 exerciseId。无kind或kind=task时的context提供本账号设备、工作区和模型ID；心跳可能过期，任务是否可启动必须由本机实际确认。' };
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
    const exerciseChanges = mutation.kind === 'proposal' ? mutation.data.changes : [mutation];
    const referenced = [];
    for (const change of exerciseChanges) if (!change.deleted && (change.kind === 'routine' || change.kind === 'workout')) {
      const data = recordSchemas[change.kind].parse(change.data);
      referenced.push(...data.exercises.map(exercise => exercise.exerciseId));
    }
    if (referenced.length) {
      const records = await liveRecords(); if (!records) return { ok: false, code: 'account_changed' };
      const custom = customExercises(records);
      const unavailable = [...new Set(referenced)].filter(id => { const found = findAgentExercise(id, custom); return !found || found.exerciseId !== id; });
      if (unavailable.length) return { ok: false, code: 'exercise_unavailable', exerciseIds: unavailable, error: '动作不存在或不属于当前账号。请先用 catalogue 查询，并使用返回的真实 exerciseId。' };
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
