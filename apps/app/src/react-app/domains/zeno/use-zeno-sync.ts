import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMutation, personalRecordSchema, recordMutationSchema, recordKey, validatePersonalMedia, type MutationResult, type PersonalRecord, type RecordData, type RecordKind, type SyncResult } from "@zeno/core";
import { cacheScope, discardObjectChanges, emptySnapshot, mapMutationMedia, mergeRecords, mutationMediaIds, readSnapshot, reverseCommittedChanges, visibleRecords, writeSnapshot, type QueuedChange, type SyncSnapshot } from "./sync-store";

export type SyncTransport = { sync: (cursor: number) => Promise<SyncResult>; mutate: (mutation: QueuedChange["mutation"]) => Promise<MutationResult>; mutateBatch: (mutations: QueuedChange["mutation"][], operationId?: string) => Promise<{ results: MutationResult[] }>; uploadMedia: (blob: Blob, name?: string) => Promise<{ id: string }>; readMedia: (id: string) => Promise<Blob> };
export type ExistingRecord = { id: string; version: number };
export type SaveRecord = <K extends RecordKind>(kind: K, data: RecordData<K>, existing?: ExistingRecord) => Promise<void>;
export type PersonalStore = ReturnType<typeof useZenoSync>;

function statusOf(error: unknown) { return error && typeof error === "object" && "status" in error ? error.status : null; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "连接暂时不可用，请重试。"; }

export function useZenoSync(client: SyncTransport, userId: string, baseUrl: string) {
  const scope = cacheScope(baseUrl, userId);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(emptySnapshot);
  const stateRef = useRef(snapshot); const serial = useRef<Promise<void>>(Promise.resolve());
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [syncing, setSyncing] = useState(false); const [error, setError] = useState<string | null>(null);
  const [undoChange, setUndoChange] = useState<QueuedChange[] | null>(null);
  const [accountChanged, setAccountChanged] = useState(false); const halted = useRef(false);
  const [writable, setWritable] = useState(false); const writer = useRef(false); const broadcast = useRef<BroadcastChannel | null>(null);
  const alive = useRef(0); const flushing = useRef(false);
  const draftFlushers = useRef(new Map<string, () => Promise<void>>());
  const registerDraftFlusher = useCallback((id: string, flush: () => Promise<void>) => { draftFlushers.current.set(id, flush); return () => { if (draftFlushers.current.get(id) === flush) draftFlushers.current.delete(id); }; }, []);
  const flushDrafts = useCallback(async () => { for (const flush of draftFlushers.current.values()) await flush(); }, []);
  useEffect(() => {
    const generation = ++alive.current; setLoadedScope(null); setError(null); setUndoChange(null); setAccountChanged(false); halted.current = false;
    void readSnapshot(scope).then(next => { if (alive.current !== generation) return; stateRef.current = next; setSnapshot(next); setLoadedScope(scope); }).catch(caught => { if (alive.current === generation) setError(errorMessage(caught)); });
    return () => { ++alive.current; };
  }, [scope]);
  useEffect(() => {
    let stopped = false, checking = false; let release: (() => void) | undefined;
    writer.current = false; setWritable(false);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("zeno-personal:" + scope); broadcast.current = channel;
    channel?.addEventListener("message", () => { if (writer.current || stopped) return; void readSnapshot(scope).then(next => { if (!stopped && !writer.current) { stateRef.current = next; setSnapshot(next); } }).catch(() => {}); });
    const acquire = async () => {
      if (stopped || checking || !navigator.locks) return;
      checking = true;
      try { await navigator.locks.request("zeno-personal-writer:" + scope, { ifAvailable: true }, async lock => {
        if (!lock || stopped) return;
        const latest = await readSnapshot(scope); if (stopped) return;
        stateRef.current = latest; setSnapshot(latest); writer.current = true; setWritable(true);
        await new Promise<void>(resolve => { release = resolve; });
        writer.current = false;
      }); } catch (caught) { if (!stopped) setError(errorMessage(caught)); }
      finally { checking = false; }
    };
    void acquire(); const timer = window.setInterval(() => void acquire(), 2000);
    return () => { stopped = true; writer.current = false; window.clearInterval(timer); channel?.close(); broadcast.current = null; void serial.current.finally(() => release?.()); };
  }, [scope]);
  const commit = useCallback((change: (current: SyncSnapshot) => SyncSnapshot, generation = alive.current) => {
    const operation = serial.current.then(async () => {
      if (generation !== alive.current) return;
      if (!writer.current || halted.current) throw new Error("请在正在编辑的泽诺页面操作，或关闭该页面后重试。");
      const next = change(stateRef.current);
      await writeSnapshot(scope, next);
      if (generation !== alive.current) return;
      stateRef.current = next; setSnapshot(next); broadcast.current?.postMessage("updated");
    });
    serial.current = operation.catch(() => {});
    return operation;
  }, [scope]);
  const records = useMemo(() => loadedScope === scope ? visibleRecords(snapshot, userId) : [], [snapshot, userId, loadedScope, scope]);
  const recordsRef = useRef(records); recordsRef.current = records;
  const save: SaveRecord = useCallback(async (kind, data, existing) => {
    if (loadedScope !== scope) throw new Error("离线储存尚未就绪，请重试。");
    const mutation = createMutation(kind, data, { id: existing?.id, baseVersion: existing?.version });
    const before = recordsRef.current.find(record => recordKey(record) === recordKey(mutation)) ?? null;
    const change = { mutation, before, queuedAt: Date.now() };
    await commit(current => ({ ...current, outbox: [...current.outbox, change] })); setUndoChange([change]);
  }, [commit, loadedScope, scope]);
  const remove = useCallback(async (record: PersonalRecord) => {
    const mutation = createMutation(record.kind, record.data, { id: record.id, baseVersion: record.version, deleted: true });
    const change = { mutation, before: record, queuedAt: Date.now() };
    await commit(current => ({ ...current, outbox: [...current.outbox, change] })); setUndoChange([change]);
  }, [commit]);
  const saveMutations = useCallback(async (mutations: QueuedChange["mutation"][]) => {
    if (mutations.length === 0) return;
    if (mutations.length > 101) throw new Error("每次最多保存 101 项，请分批导入。");
    const groupId = crypto.randomUUID(), queuedAt = Date.now();
    const changes = mutations.map(mutation => ({ mutation, groupId, queuedAt, before: recordsRef.current.find(record => recordKey(record) === recordKey(mutation)) ?? null }));
    await commit(current => ({ ...current, outbox: [...current.outbox, ...changes] })); setUndoChange(changes);
  }, [commit]);
  const addMedia = async (blob: Blob, name: string) => {
    validatePersonalMedia(blob);
    const id = "local-media-" + crypto.randomUUID();
    await commit(current => ({ ...current, media: [...current.media, { id, name, blob }] }));
    return id;
  };
  const readMedia = async (id: string) => {
    const cached = stateRef.current.media.find(item => item.id === id || item.remoteId === id);
    if (cached) return cached.blob;
    const generation = alive.current;
    const blob = await client.readMedia(id);
    if (generation !== alive.current) throw new Error("账号已改变，请重试。");
    if (!writer.current || halted.current) return blob;
    await commit(current => ({ ...current, media: [...current.media.filter(item => item.id !== id), { id, name: "photo", blob, remoteId: id }] }), generation);
    return blob;
  };

  const synchronize = useCallback(async () => {
    if (flushing.current || halted.current || !writer.current || loadedScope !== scope || !navigator.onLine) return;
    flushing.current = true; setSyncing(true); const generation = alive.current;
    try {
      let more = true;
      while (more && generation === alive.current) {
        const result = await client.sync(stateRef.current.cursor);
        await commit(current => ({ ...current, records: mergeRecords(current.records, result.records.filter(record => record.userId === userId)), cursor: result.cursor }), generation);
        more = result.hasMore;
      }
      const localReferences = new Set(stateRef.current.outbox.flatMap(change => mutationMediaIds(change.mutation)));
      for (const media of stateRef.current.media) {
        if (generation !== alive.current) break;
        if (media.remoteId || media.error || !localReferences.has(media.id)) continue;
        let remote: { id: string };
        try { remote = await client.uploadMedia(media.blob, media.name); }
        catch (caught) {
          if ([400, 413, 415, 422].includes(Number(statusOf(caught)))) { await commit(current => ({ ...current, media: current.media.map(item => item.id === media.id ? { ...item, error: errorMessage(caught) } : item) }), generation); continue; }
          throw caught;
        }
        await commit(current => ({ ...current, media: current.media.map(item => item.id === media.id ? { ...item, remoteId: remote.id } : item), outbox: current.outbox.map(change => ({ ...change, mutation: mapMutationMedia(change.mutation, id => id === media.id ? remote.id : id) })) }), generation);
      }
      // A later edit may still refer to a cached local ID that was uploaded in an earlier pass.
      const mediaIds = new Map(stateRef.current.media.filter(media => media.remoteId).map(media => [media.id, media.remoteId]));
      if (stateRef.current.outbox.some(change => mutationMediaIds(change.mutation).some(id => mediaIds.has(id)))) await commit(current => ({ ...current, outbox: current.outbox.map(change => ({ ...change, mutation: mapMutationMedia(change.mutation, id => mediaIds.get(id) ?? id) })) }), generation);
      const pending = [...stateRef.current.outbox];
      const processed = new Set<string>();
      for (const change of pending) {
        if (generation !== alive.current) break;
        if (processed.has(change.mutation.operationId)) continue;
        const group = change.groupId ? pending.filter(item => item.groupId === change.groupId) : [change];
        group.forEach(item => processed.add(item.mutation.operationId));
        if (group.some(item => item.error || (mutationMediaIds(item.mutation)).some(id => id.startsWith("local-media-") && !stateRef.current.media.find(media => media.id === id)?.remoteId))) continue;
        if (stateRef.current.conflicts.some(conflict => recordKey(conflict.mutation) === recordKey(change.mutation))) continue;
        try {
          const results = change.groupId ? (await client.mutateBatch(group.map(item => item.mutation), change.groupId)).results : [await client.mutate(change.mutation)];
          if (results.some(result => result.record.userId !== userId)) throw new Error("账号已改变，请重新登录。");
          const ids = new Set(group.map(item => item.mutation.operationId));
          await commit(current => ({ ...current, records: mergeRecords(current.records, results.map(result => result.record)), outbox: current.outbox.filter(item => !ids.has(item.mutation.operationId)) }), generation);
        } catch (caught) {
          if (caught && typeof caught === "object" && "code" in caught && caught.code === "account_changed") throw caught;
          if ([400, 403, 413, 415, 422].includes(Number(statusOf(caught)))) { const ids = new Set(group.map(item => item.mutation.operationId)); await commit(current => ({ ...current, outbox: current.outbox.map(item => ids.has(item.mutation.operationId) ? { ...item, error: errorMessage(caught) } : item) }), generation); continue; }
          if (statusOf(caught) !== 409) throw caught;
          let cursor = 0, hasMore = true; const remoteRecords: PersonalRecord[] = [];
          while (hasMore && generation === alive.current) { const result = await client.sync(cursor); remoteRecords.push(...result.records); cursor = result.cursor; hasMore = result.hasMore; }
          const ids = new Set(group.map(item => item.mutation.operationId));
          const latestRemote = mergeRecords([], remoteRecords.filter(record => record.userId === userId));
          await commit(current => ({ ...current, records: mergeRecords(current.records, latestRemote), conflicts: [...current.conflicts.filter(item => !ids.has(item.mutation.operationId)), ...group.map(item => ({ mutation: item.mutation, groupId: item.groupId, remote: latestRemote.find(record => recordKey(record) === recordKey(item.mutation)) ?? null }))] }), generation);
        }
      }
      if (generation === alive.current) { setOffline(false); setError(null); }
    } catch (caught) { if (generation === alive.current) { if (statusOf(caught) === 401 || (caught && typeof caught === "object" && "code" in caught && caught.code === "account_changed")) { halted.current = true; setAccountChanged(true); } setOffline(!navigator.onLine || statusOf(caught) === null); setError(errorMessage(caught)); } }
    finally { flushing.current = false; if (generation === alive.current) setSyncing(false); }
  }, [client, commit, loadedScope, scope, userId, writable]);

  useEffect(() => {
    const online = () => { setOffline(!navigator.onLine); if (navigator.onLine) void synchronize(); };
    window.addEventListener("online", online); window.addEventListener("offline", online);
    const timer = window.setInterval(() => void synchronize(), 5000);
    void synchronize();
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", online); window.clearInterval(timer); };
  }, [synchronize]);
  useEffect(() => { if (snapshot.outbox.length) void synchronize(); }, [snapshot.outbox.length, synchronize]);

  const resolveConflict = async (operationId: string, keep: "local" | "remote") => {
    const conflict = stateRef.current.conflicts.find(item => item.mutation.operationId === operationId);
    if (!conflict) return;
    if (conflict.groupId) {
      const conflicts = stateRef.current.conflicts.filter(item => item.groupId === conflict.groupId);
      const groupId = crypto.randomUUID();
      await commit(current => {
        const cleared = { ...current, outbox: current.outbox.filter(item => item.groupId !== conflict.groupId), conflicts: current.conflicts.filter(item => item.groupId !== conflict.groupId) };
        if (keep === "remote") return cleared;
        return { ...cleared, outbox: [...cleared.outbox, ...conflicts.map(item => ({ mutation: createMutation(item.mutation.kind, item.mutation.data, { id: item.mutation.id, baseVersion: item.remote?.version ?? 0, deleted: item.mutation.deleted }), before: item.remote, queuedAt: Date.now(), groupId }))] };
      });
      return;
    }
    const matching = stateRef.current.outbox.filter(item => recordKey(item.mutation) === recordKey(conflict.mutation));
    const last = matching.at(-1)?.mutation ?? conflict.mutation;
    await commit(current => {
      const cleared = discardObjectChanges(current, conflict.mutation);
      if (keep === "remote") return cleared;
      const mutation = createMutation(last.kind, last.data, { id: last.id, baseVersion: conflict.remote?.version ?? 0, deleted: last.deleted });
      return { ...cleared, outbox: [...cleared.outbox, { mutation, before: conflict.remote, queuedAt: Date.now() }] };
    });
  };
  const undo = async () => {
    const changes = undoChange; if (!changes?.length) return;
    if (flushing.current) throw new Error("正在同步，完成后可撤销。");
    const ids = new Set(changes.map(change => change.mutation.operationId));
    const pending = stateRef.current.outbox.filter(change => ids.has(change.mutation.operationId));
    if (pending.length === changes.length) {
      await commit(state => ({ ...state, outbox: state.outbox.filter(item => !ids.has(item.mutation.operationId)), conflicts: state.conflicts.filter(item => !ids.has(item.mutation.operationId)) }));
    } else {
      if (pending.length) throw new Error("部分修改的同步状态已变化，请先处理同步或冲突。");
      const reverse = reverseCommittedChanges(changes, recordsRef.current);
      await saveMutations(reverse);
    }
    setUndoChange(null);
  };
  const discardFailedChange = async (operationId: string) => { const change = stateRef.current.outbox.find(item => item.mutation.operationId === operationId); if (change) await commit(current => discardObjectChanges(current, change.mutation)); };
  const retryFailedChange = async (operationId: string) => { await commit(current => ({ ...current, outbox: current.outbox.map(change => change.mutation.operationId === operationId ? { ...change, error: undefined } : change) })); void synchronize(); };
  const retryFailedMedia = async (id: string) => { await commit(current => ({ ...current, media: current.media.map(media => media.id === id ? { ...media, error: undefined } : media) })); void synchronize(); };
  const discardFailedMedia = async (id: string) => { await commit(current => ({ ...current, media: current.media.filter(item => item.id !== id), outbox: current.outbox.map(change => ({ ...change, mutation: mapMutationMedia(change.mutation, value => value === id ? null : value) })) })); };
  return { records, ready: loadedScope === scope, writable, offline, syncing, error, accountChanged, pending: snapshot.outbox.length, conflicts: snapshot.conflicts, failedChanges: snapshot.outbox.filter(item => item.error), failedMedia: snapshot.media.filter(item => item.error), retryFailedChange, retryFailedMedia, discardFailedChange, discardFailedMedia, registerDraftFlusher, flushDrafts, save, remove, saveMutations, addMedia, readMedia, synchronize, resolveConflict, undo, undoKinds: [...new Set(undoChange?.map(change => change.mutation.kind) ?? [])], canUndo: undoChange !== null };
}
