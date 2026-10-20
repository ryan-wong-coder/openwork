import { z } from "zod";
import { createMutation, personalRecordSchema, recordMutationSchema, recordKey, type PersonalRecord, type RecordMutation } from "@zeno/core";

export const queuedChangeSchema = z.object({ mutation: recordMutationSchema, before: personalRecordSchema.nullable(), queuedAt: z.number(), groupId: z.string().optional(), error: z.string().optional() });
export const conflictSchema = z.object({ mutation: recordMutationSchema, remote: personalRecordSchema.nullable(), groupId: z.string().optional() });
export const cachedMediaSchema = z.object({ id: z.string(), name: z.string(), blob: z.instanceof(Blob), remoteId: z.string().optional(), error: z.string().optional() });
export const syncSnapshotSchema = z.object({ cursor: z.number().int().nonnegative(), records: z.array(personalRecordSchema), outbox: z.array(queuedChangeSchema), conflicts: z.array(conflictSchema), media: z.array(cachedMediaSchema).default([]) });
export type QueuedChange = z.infer<typeof queuedChangeSchema>;
export type SyncConflict = z.infer<typeof conflictSchema>;
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;
export function emptySnapshot(): SyncSnapshot { return { cursor: 0, records: [], outbox: [], conflicts: [], media: [] }; }

export function mergeRecords(current: readonly PersonalRecord[], incoming: readonly PersonalRecord[]) {
  const map = new Map(current.map(record => [recordKey(record), record]));
  for (const record of incoming) {
    const previous = map.get(recordKey(record));
    if (!previous || record.version >= previous.version) map.set(recordKey(record), record);
  }
  return [...map.values()];
}

export function visibleRecords(snapshot: SyncSnapshot, userId: string): PersonalRecord[] {
  const map = new Map(snapshot.records.map(record => [recordKey(record), record]));
  for (const change of snapshot.outbox) {
    const mutation = change.mutation, previous = map.get(recordKey(mutation));
    map.set(recordKey(mutation), personalRecordSchema.parse({ kind: mutation.kind, data: mutation.data, id: mutation.id, userId,
      version: mutation.baseVersion + 1, cursor: previous?.cursor ?? 0, createdAt: previous?.createdAt ?? change.queuedAt,
      updatedAt: change.queuedAt, deletedAt: mutation.deleted ? change.queuedAt : null }));
  }
  return [...map.values()];
}

/** Account and server form one isolation boundary; credentials never enter it. */
export function cacheScope(baseUrl: string, userId: string) { return JSON.stringify([new URL(baseUrl, typeof location === "undefined" ? "http://localhost/" : location.href).href.replace(/\/$/, ""), userId]); }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("zeno-personal-v1", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("此设备无法保存离线修改，请检查浏览器储存权限。"));
    request.onblocked = () => reject(new Error("请关闭旧的泽诺页面后重试。"));
  });
}

export async function readSnapshot(scope: string): Promise<SyncSnapshot> {
  const database = await openDatabase();
  try {
    const value: unknown = await new Promise((resolve, reject) => {
      const request = database.transaction("snapshots", "readonly").objectStore("snapshots").get(scope);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("离线数据暂时无法读取。"));
    });
    if (value === undefined) return emptySnapshot();
    const parsed = syncSnapshotSchema.safeParse(value);
    if (!parsed.success) throw new Error("离线数据格式不兼容。请先导出此设备数据，再重新同步。");
    return parsed.data;
  } finally { database.close(); }
}

export async function writeSnapshot(scope: string, snapshot: SyncSnapshot): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").put(snapshot, scope);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("离线储存已满，修改尚未保存。请释放空间后重试。"));
      transaction.onabort = () => reject(new Error("修改尚未保存，请重试。"));
    });
  } finally { database.close(); }
}

export function discardObjectChanges(snapshot: SyncSnapshot, mutation: RecordMutation): SyncSnapshot {
  const key = recordKey(mutation);
  return { ...snapshot, outbox: snapshot.outbox.filter(change => recordKey(change.mutation) !== key), conflicts: snapshot.conflicts.filter(conflict => recordKey(conflict.mutation) !== key) };
}

export function mutationMediaIds(mutation: RecordMutation): string[] { return mutation.kind === "measurement" ? mutation.data.photoMediaIds : mutation.kind === "exercise" ? mutation.data.mediaIds : mutation.kind === "workout" ? mutation.data.mediaIds ?? [] : []; }
export function mapMutationMedia(mutation: RecordMutation, map: (id: string) => string | null): RecordMutation {
  const ids = mutationMediaIds(mutation).flatMap(id => { const mapped = map(id); return mapped === null ? [] : [mapped]; });
  if (mutation.kind === "measurement") return recordMutationSchema.parse({ ...mutation, data: { ...mutation.data, photoMediaIds: ids } });
  if (mutation.kind === "exercise" || (mutation.kind === "workout" && mutation.data.mediaIds)) return recordMutationSchema.parse({ ...mutation, data: { ...mutation.data, mediaIds: ids } });
  return mutation;
}

/** Verify the entire batch before producing any inverse write. Server versions guard the final commit. */
export function reverseCommittedChanges(changes: QueuedChange[], records: PersonalRecord[]): RecordMutation[] {
  return changes.map(change => {
    const current = records.find(record => recordKey(record) === recordKey(change.mutation));
    if (!current || current.version !== change.mutation.baseVersion + 1) throw new Error("记录已有新的修改，未执行撤销。请查看最新内容后再编辑。");
    return createMutation(change.mutation.kind, change.before?.data ?? change.mutation.data, { id: current.id, baseVersion: current.version, deleted: !change.before || change.before.deletedAt !== null });
  });
}
