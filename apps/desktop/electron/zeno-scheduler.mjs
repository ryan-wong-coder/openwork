import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { personalRecordSchema, recordMutationSchema, runDataSchema, requestDataSchema, modelChoiceSchema, deviceInventorySchema, personalFeaturesSchema, mutationResultSchema } from '@zeno/core/schema';
import { expandSchedule, expandEvent } from '@zeno/core/calendar';
import { atomicPrivateJson } from './zeno-personal.mjs';
import { createDesktopSessionAdapter } from './session-runner-adapter.mjs';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'missed', 'uncertain']);
const selectedKinds = new Set(['task', 'request', 'run', 'event', 'settings']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entrySchema = z.object({
  id: z.string(), taskId: z.string().optional(), taskVersion: z.number(), requestId: z.string().optional(),
  workspaceId: z.string(), model: modelChoiceSchema.nullable(), title: z.string(), instructions: z.string(),
  mode: z.enum(['interactive', 'scheduled']), timeoutMs: z.number(),
  phase: z.enum(['prepared', 'creating', 'created', 'sending', 'observing', 'stopping', 'terminal']),
  receipt: z.object({ sessionId: z.string(), workspaceId: z.string() }).nullable(),
  messageId: z.string(), run: runDataSchema, pendingRun: recordMutationSchema.nullable(),
  pendingRequest: recordMutationSchema.nullable(), admissionUncertain: z.boolean(), notified: z.boolean(),
}).strict();
const journalSchema = z.object({ version: z.literal(1), userId: z.string(), deviceId: z.string(), cursor: z.number(),
  lastTickAt: z.number(), records: z.array(personalRecordSchema), entries: z.array(entrySchema), reminded: z.array(z.string()), features: personalFeaturesSchema.nullable().default(null) }).strict();

/** Local-only scheduler. The website is a data transport, never an execution authority. */
export function createZenoScheduler(options) {
  const now = options.now ?? Date.now;
  let disposed = false, started = false, suspended = false, timer = null, inFlight = null;
  let identity = null, journal = null, file = null, adapter = null, availableSince = null, reminderSince = null, lastHeartbeat = 0;
  let lastInventory = { workspaces: [], models: [], appliedCursor: 0, windowOpen: false }, lastWindowOpen = null;
  const lifetime = new AbortController();
  const save = async () => { if (journal && file) await atomicPrivateJson(file, journalSchema.parse(journal)); };
  const live = () => !disposed && !suspended && options.isWindowOpen();
  const same = async () => {
    const current = await options.service.identity();
    return current && identity && current.userId === identity.userId && current.deviceId === identity.deviceId && current.generation === identity.generation;
  };
  const cache = (kind, id) => journal.records.find(value => value.kind === kind && value.id === id) ?? null;
  const put = value => {
    const record = personalRecordSchema.parse(value); const index = journal.records.findIndex(item => item.kind === record.kind && item.id === record.id);
    if (index < 0) journal.records.push(record); else if (journal.records[index].version <= record.version) journal.records[index] = record;
  };
  const notificationsEnabled = () => journal?.records.filter(value => value.kind === 'settings' && !value.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.data.notifications !== false;
  const note = async (title, body) => { if (!notificationsEnabled()) return; try { await options.notify?.(title, body); } catch {} };
  async function load(current) {
    identity = current;
    const directory = options.root ? path.join(options.root, hash([current.userId, current.deviceId])) : await options.service.accountDirectory(current.userId);
    file = path.join(directory, 'scheduler-' + hash(current.deviceId).slice(0, 24) + '.json');
    try {
      journal = journalSchema.parse(JSON.parse(await readFile(file, 'utf8')));
      if (journal.userId !== current.userId || journal.deviceId !== current.deviceId) throw new Error('Scheduler identity mismatch');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('本地任务记录不可读取，已停止自动执行以避免重复。');
      journal = { version: 1, userId: current.userId, deviceId: current.deviceId, cursor: 0, lastTickAt: now(), records: [], entries: [], reminded: [], features: null };
    }
    adapter = options.adapter ?? createDesktopSessionAdapter({ getLocalRuntime: options.getLocalRuntime, creationOwner: hash([current.userId, current.deviceId]), now,
      observationMessageId: receipt => journal.entries.find(entry => entry.receipt?.sessionId === receipt.sessionId && entry.receipt.workspaceId === receipt.workspaceId)?.messageId });
    // An interrupted create has no safe native receipt. Never invent another session.
    for (const entry of journal.entries) {
      if (entry.phase === 'creating') finish(entry, 'uncertain', '创建结果未确认，请检查本地会话后手动补跑。');
      if (entry.phase === 'sending') { entry.phase = 'observing'; entry.admissionUncertain = true; }
    }
    availableSince = now(); reminderSince = now(); lastWindowOpen = null; lastHeartbeat = 0; lastInventory = { workspaces: [], models: [], appliedCursor: journal.cursor, windowOpen: false }; await save();
  }
  function finish(entry, status, error) {
    entry.phase = 'terminal'; entry.run.status = status; entry.run.finishedAt = now();
    if (error) entry.run.error = error;
  }
  async function pull() {
    for (let page = 0; page < 40; page++) {
      const response = await options.service.sync(journal.cursor);
      if (!await same()) return false;
      for (const record of response.records) if (record.userId === identity.userId && selectedKinds.has(record.kind)) put(record);
      if (response.cursor < journal.cursor || response.hasMore && response.cursor === journal.cursor) throw new Error('Invalid synchronization cursor');
      journal.cursor = response.cursor; await save();
      if (!response.hasMore) return true;
    }
    return false;
  }
  function mutation(kind, id, data, version) {
    return recordMutationSchema.parse({ kind, id, data, baseVersion: version, operationId: 'op_' + hash([kind, id, version, data]), deleted: false });
  }
  async function deliver(pending) {
    if (!await same()) return { acknowledged: false };
    const response = await options.service.internalRequest('PUT', '/records/' + pending.kind + '/' + encodeURIComponent(pending.id), pending, identity);
    if (!await same()) return { acknowledged: false };
    if (response.status === 200) { put(mutationResultSchema.parse(response.body).record); return { acknowledged: true }; }
    if (response.status === 409) {
      const conflict = z.object({ code: z.string(), current: personalRecordSchema.nullable().optional() }).safeParse(response.body);
      if (conflict.success && conflict.data.current) { put(conflict.data.current); return { acknowledged: true, conflicted: true }; }
    }
    return { acknowledged: false };
  }
  async function flush(entry, connected = true) {
    if (!await same()) return;
    const remote = cache('run', entry.id);
    if (!entry.pendingRun && JSON.stringify(remote?.data) !== JSON.stringify(entry.run)) { entry.pendingRun = mutation('run', entry.id, entry.run, remote?.version ?? 0); await save(); }
    if (entry.pendingRun && connected) {
      const result = await deliver(entry.pendingRun).catch(() => ({ acknowledged: false }));
      if (result.acknowledged) { entry.pendingRun = null; await save(); }
    }
    if (entry.requestId) {
      const request = cache('request', entry.requestId);
      if (request?.kind === 'request' && request.data.deviceId === identity.deviceId) {
        const statuses = { queued: 'accepted', running: 'running', waiting_permission: 'waiting_permission', waiting_input: 'waiting_permission', succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled', missed: 'expired', uncertain: 'failed' };
        const data = requestDataSchema.parse({ ...request.data, status: statuses[entry.run.status], runId: entry.id, response: entry.run.summary || entry.run.error || '' });
        if (!entry.pendingRequest && JSON.stringify(data) !== JSON.stringify(request.data)) { entry.pendingRequest = mutation('request', request.id, data, request.version); await save(); }
        if (entry.pendingRequest && connected) {
          const result = await deliver(entry.pendingRequest).catch(() => ({ acknowledged: false }));
          if (result.acknowledged) { entry.pendingRequest = null; await save(); }
        }
      }
    }
    if (terminal.has(entry.run.status) && !entry.notified) { entry.notified = true; await save(); await note(entry.run.status === 'succeeded' ? '任务已完成' : entry.run.status === 'missed' ? '任务已错过' : '任务需要查看', entry.title); }
  }
  async function stop(entry, reason) {
    if (!entry.receipt) { finish(entry, 'cancelled', reason); await save(); return; }
    entry.phase = 'stopping'; entry.run.error = reason; await save();
    try { await adapter.stop(entry.receipt, { messageId: entry.messageId }, lifetime.signal); } catch {}
  }
  async function observe(entry) {
    if (!entry.receipt || terminal.has(entry.run.status)) return;
    const request = entry.requestId ? cache('request', entry.requestId) : null;
    if ((!live() || request?.kind === 'request' && request.data.cancelRequested || now() - (entry.run.startedAt ?? now()) >= entry.timeoutMs) && entry.phase !== 'stopping') await stop(entry, request?.data.cancelRequested ? '已请求取消。' : !live() ? '窗口已关闭或电脑休眠，任务已停止。' : '已达到执行时间上限。');
    let progress;
    try { progress = await adapter.observe(entry.receipt, lifetime.signal); } catch { return; }
    if (!await same()) return;
    if (progress.status === 'error') finish(entry, 'failed', '本地会话执行失败，请打开会话查看。');
    else if (progress.status === 'idle') {
      if (entry.phase === 'stopping') finish(entry, 'cancelled', entry.run.error);
      else if (progress.finalText) { entry.run.summary = progress.finalText.slice(0, 30000); finish(entry, 'succeeded'); }
      else if (entry.admissionUncertain) finish(entry, 'uncertain', '发送结果未确认，没有自动重发，请检查原会话。');
      // Idle without a fresh reply is not a successful task.
    } else if (entry.phase !== 'stopping') entry.run.status = progress.waitingFor === 'permission' ? 'waiting_permission' : progress.waitingFor === 'question' ? 'waiting_input' : 'running';
    await save();
  }
  function add(input) {
    const { scheduledAt, ...fields } = input;
    const entry = entrySchema.parse({ ...fields, phase: 'prepared', receipt: null, messageId: 'msg_' + hash(input.id),
      run: { taskId: input.taskId, taskVersion: input.taskVersion, deviceId: identity.deviceId, scheduledAt: input.scheduledAt, requestId: input.requestId, status: 'queued' },
      pendingRun: null, pendingRequest: null, admissionUncertain: false, notified: false });
    journal.entries.push(entry); return entry;
  }
  async function admission(entry) {
    if (!live() || !await same()) return false;
    // Outbox delivery/observation can take time: re-read definitions immediately
    // before any new native effect, not merely at the start of the timer cycle.
    try {
      if (!await pull() || !live() || !await same()) return false;
      const response = await options.service.internalRequest('GET', '/features', undefined, identity);
      if (response.status !== 200 || !personalFeaturesSchema.parse(response.body).localScheduledTasks || !live() || !await same()) return false;
    } catch { return false; }
    const currentRequest = entry.requestId ? cache('request', entry.requestId) : null;
    const currentTask = entry.taskId ? cache('task', entry.taskId) : null;
    const requestChanged = entry.requestId && (currentRequest?.kind !== 'request' || currentRequest.deletedAt || currentRequest.data.deviceId !== identity.deviceId || currentRequest.data.cancelRequested || currentRequest.data.expiresAt <= now() || currentRequest.data.taskId !== entry.taskId || (currentRequest.data.type === 'coach' ? 'scheduled' : 'interactive') !== entry.mode || (currentTask?.kind === 'task' ? currentTask.data.instructions + (currentRequest.data.prompt ? '\n\n' + currentRequest.data.prompt : '') : currentRequest.data.prompt) !== entry.instructions || currentTask?.kind !== 'task' && ((currentRequest.data.workspaceId ?? entry.workspaceId) !== entry.workspaceId || JSON.stringify(currentRequest.data.model ?? null) !== JSON.stringify(entry.model)));
    if (requestChanged || entry.taskId && (currentTask?.kind !== 'task' || currentTask.deletedAt || currentTask.data.deviceId !== identity.deviceId || currentTask.version !== entry.taskVersion || !entry.requestId && !currentTask.data.enabled)) { finish(entry, 'cancelled', '任务在启动前已修改或取消。'); await save(); return false; }
    if (!entry.requestId && now() - entry.run.scheduledAt > 10_000) { finish(entry, 'missed', '任务时间已错过，请手动补跑。'); await save(); return false; }
    let inventory;
    try { inventory = deviceInventorySchema.parse({ ...await options.getInventory(), appliedCursor: journal.cursor, windowOpen: live() }); } catch { return false; }
    if (!inventory.workspaces.some(value => value.id === entry.workspaceId) || entry.model && !inventory.models.some(value => value.providerId === entry.model.providerId && value.modelId === entry.model.modelId)) { finish(entry, 'failed', '绑定的本地工作区或模型不可用。'); await save(); return false; }
    return live() && await same();
  }
  async function execute(entry, fresh) {
    if (!fresh || !live() || !await same()) return;
    if (entry.phase === 'prepared') {
      if (!await admission(entry)) return;
      entry.phase = 'creating'; await save();
      try {
        entry.receipt = z.object({ sessionId: z.string(), workspaceId: z.string() }).parse(await adapter.create({ commandId: entry.id, kind: 'remote_session_create', title: entry.title, prompt: null, model: entry.model, expiresAt: now() + entry.timeoutMs, workspaceId: entry.workspaceId }, lifetime.signal));
        if (entry.receipt.workspaceId !== entry.workspaceId) throw new Error('Workspace mismatch');
        entry.run.sessionId = entry.receipt.sessionId; entry.phase = 'created'; await save();
      } catch { finish(entry, 'uncertain', '创建结果未确认，请查看本地会话，勿重复提交。'); await save(); return; }
    }
    if (!live() || !await same()) { await stop(entry, '窗口或账号已变化，未发送任务。'); return; }
    if (entry.phase === 'created') {
      // Native creation is empty and may be slow. The paid AI effect is send:
      // revalidate again after creation, including on recovery of an empty receipt.
      if (!await admission(entry)) return;
      entry.phase = 'sending'; entry.run.startedAt = now(); await save();
      if (!live() || !await same()) { await stop(entry, '窗口或账号已变化，未发送任务。'); return; }
      try {
        await adapter.send(entry.receipt, { prompt: entry.instructions, model: entry.model, messageId: entry.messageId }, lifetime.signal);
        entry.run.status = 'running'; entry.phase = 'observing';
      } catch { entry.phase = 'observing'; entry.admissionUncertain = true; entry.run.status = 'running'; }
      await save();
    }
  }
  async function updateRequestOnly(record, status, response) {
    const data = requestDataSchema.parse({ ...record.data, status, response });
    await deliver(mutation('request', record.id, data, record.version)).catch(() => undefined);
  }
  async function heartbeat(inventory = lastInventory) {
    const windowOpen = live();
    if (!await same() || now() - lastHeartbeat < 30_000 && lastWindowOpen === windowOpen) return;
    const value = deviceInventorySchema.parse({ ...inventory, appliedCursor: journal.cursor, windowOpen });
    try {
      const response = await options.service.internalRequest('POST', '/devices/heartbeat', { inventory: value }, identity);
      if (response.status === 200 && await same()) { lastInventory = value; lastWindowOpen = windowOpen; lastHeartbeat = now(); }
    } catch {}
  }
  async function remind(at, features) {
    if (!features?.personalCalendar || !live() || !notificationsEnabled() || !await same()) return;
    for (const event of journal.records.filter(value => value.kind === 'event' && !value.deletedAt && value.data.status === 'planned')) {
      for (const occurrence of expandEvent(event.data, at - 30_000, at + (Math.max(0, ...event.data.reminders) + 1) * 60_000)) for (const minutes of event.data.reminders) {
        if (occurrence.data.status !== 'planned') continue;
        const due = occurrence.startAt - minutes * 60_000; const key = event.id + ':' + occurrence.originalStartAt + ':' + minutes;
        if (due >= Math.max(reminderSince ?? at, journal.lastTickAt, at - 30_000) && due <= at && !journal.reminded.includes(key)) { journal.reminded.push(key); journal.reminded = journal.reminded.slice(-5000); await save(); await note('日程提醒', occurrence.title); }
      }
    }
  }
  async function cycle() {
    const current = await options.service.identity();
    if (disposed) return;
    if (journal && (!current || current.userId !== identity.userId || current.deviceId !== identity.deviceId || current.generation !== identity.generation)) {
      for (const entry of journal.entries) if (!terminal.has(entry.run.status)) await stop(entry, '账号或设备连接已变化，已停止原任务。');
    }
    if (!current) { availableSince = null; reminderSince = null; return; }
    if (!identity || current.userId !== identity.userId || current.deviceId !== identity.deviceId || current.generation !== identity.generation) await load(current);
    const at = now();
    if (!live()) availableSince = null; else if (availableSince === null) availableSince = at;
    if (!live()) reminderSince = null; else if (reminderSince === null) reminderSince = at;
    if (!live()) for (const entry of journal.entries) if (!terminal.has(entry.run.status) && entry.phase !== 'stopping') await stop(entry, '窗口已关闭或电脑休眠，任务已停止。');
    let fresh = false, features = null;
    // A closed window may still synchronize receipts; it never admits AI.
    if (!suspended) {
      try {
        fresh = await pull();
        const response = await options.service.internalRequest('GET', '/features', undefined, identity);
        if (response.status === 200) features = personalFeaturesSchema.parse(response.body);
      } catch { fresh = false; }
    }
    if (!await same()) return;
    if (features) journal.features = features;
    // Existing local executions survive a synchronization outage.
    for (const entry of journal.entries) if (['observing', 'stopping', 'sending'].includes(entry.phase)) await observe(entry);
    for (const entry of journal.entries) await flush(entry, fresh);
    let inventory = null;
    if (fresh) {
      try { const raw = await options.getInventory(); inventory = deviceInventorySchema.parse({ workspaces: raw.workspaces ?? [], models: raw.models ?? [], appliedCursor: journal.cursor, windowOpen: live() }); } catch {}
    }
    // Publish closed/suspended availability once even while task admission is off.
    if (fresh || !live()) await heartbeat(inventory ?? lastInventory);
    // Calendar reminders are local notifications, independent of AI admission
    // and runtime inventory. Cached calendar permission remains useful offline.
    await remind(at, features ?? journal.features);
    if (!fresh || !features?.localScheduledTasks || !live() || !inventory || !await same()) { if (!fresh || !live()) availableSince = null; await save(); return; }
    const busy = () => journal.entries.some(entry => !terminal.has(entry.run.status) && ['creating', 'sending', 'observing', 'stopping'].includes(entry.phase));
    for (const task of journal.records.filter(value => value.kind === 'task' && !value.deletedAt && value.data.deviceId === identity.deviceId && value.data.enabled)) {
      const from = task.data.schedule.frequency === 'once' ? task.data.schedule.startAt : Math.max(task.createdAt, Math.min(journal.lastTickAt, at));
      for (const scheduledAt of expandSchedule(task.data.schedule, from, at + 1, 1000)) {
        const id = 'run_' + hash([identity.userId, identity.deviceId, task.id, scheduledAt]);
        if (journal.entries.some(entry => entry.id === id) || cache('run', id)) continue;
        const entry = add({ id, taskId: task.id, taskVersion: task.version, workspaceId: task.data.workspaceId, model: task.data.model, title: task.data.title, instructions: task.data.instructions, mode: 'scheduled', timeoutMs: task.data.timeoutMinutes * 60_000, scheduledAt });
        if (scheduledAt < availableSince || at - scheduledAt > 10_000 || busy()) finish(entry, 'missed', '任务时间已错过，请选择手动补跑。');
        await save(); await flush(entry);
      }
    }
    for (const record of journal.records.filter(value => value.kind === 'request' && !value.deletedAt && value.data.deviceId === identity.deviceId && value.data.status === 'pending')) {
      if (journal.entries.some(entry => entry.requestId === record.id)) continue;
      if (record.data.cancelRequested || record.data.expiresAt <= at) { await updateRequestOnly(record, record.data.cancelRequested ? 'cancelled' : 'expired', '请求已取消或过期，未启动 AI。'); continue; }
      const task = record.data.taskId ? cache('task', record.data.taskId) : null;
      if (record.data.type === 'run_task' && (task?.kind !== 'task' || task.deletedAt || task.data.deviceId !== identity.deviceId)) { await updateRequestOnly(record, 'failed', '绑定任务不可用。'); continue; }
      const workspaceId = task?.kind === 'task' ? task.data.workspaceId : record.data.workspaceId ?? (inventory.workspaces.length === 1 ? inventory.workspaces[0].id : null);
      if (!workspaceId) { await updateRequestOnly(record, 'failed', '请先选择本地工作区。'); continue; }
      add({ id: 'run_' + hash([identity.userId, identity.deviceId, record.id]), requestId: record.id, taskId: task?.id, taskVersion: task?.version ?? 0, workspaceId,
        model: task?.kind === 'task' ? task.data.model : record.data.model ?? null, title: task?.kind === 'task' ? task.data.title : record.data.type === 'coach' ? '健身计划建议' : '手机请求',
        instructions: task?.kind === 'task' ? task.data.instructions + (record.data.prompt ? '\n\n' + record.data.prompt : '') : record.data.prompt,
        mode: record.data.type === 'coach' ? 'scheduled' : 'interactive', timeoutMs: task?.kind === 'task' ? task.data.timeoutMinutes * 60_000 : 10 * 60_000, scheduledAt: record.data.createdAt });
      await save();
    }
    if (!busy()) {
      const prepared = journal.entries.find(entry => ['prepared', 'created'].includes(entry.phase) && !terminal.has(entry.run.status));
      if (prepared) {
        const request = prepared.requestId ? cache('request', prepared.requestId) : null;
        const task = prepared.taskId ? cache('task', prepared.taskId) : null;
        if (!prepared.requestId && at - prepared.run.scheduledAt > 10_000) finish(prepared, 'missed', '任务时间已错过，请手动补跑。');
        else if (request?.kind === 'request' && (request.data.cancelRequested || request.data.expiresAt <= at) || !prepared.requestId && (task?.kind !== 'task' || task.deletedAt || !task.data.enabled || task.version !== prepared.taskVersion)) finish(prepared, 'cancelled', '任务已在另一端修改或取消。');
        else await execute(prepared, fresh);
        await flush(prepared);
      }
    }
    journal.reminded = journal.reminded.slice(-5000); journal.lastTickAt = at; await save();
  }
  function tick() {
    if (disposed) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = cycle().finally(() => { inFlight = null; }); return inFlight;
  }
  function arm() {
    if (!started || disposed) return;
    timer = setTimeout(() => { void tick().catch(() => {}).finally(arm); }, 2000); timer.unref?.();
  }
  return {
    start() { if (started || disposed) return; started = true; arm(); return tick(); }, tick,
    wake() { suspended = false; availableSince = now(); reminderSince = now(); return tick(); },
    suspend() { suspended = true; availableSince = null; reminderSince = null; return tick(); },
    async dispose() { disposed = true; started = false; if (timer) clearTimeout(timer); lifetime.abort(); await inFlight?.catch(() => {}); },
    executionModeForSession(id) { return journal?.entries.find(entry => entry.receipt?.sessionId === id)?.mode ?? null; },
  };
}
