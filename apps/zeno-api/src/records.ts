import { z } from "zod";
import { batchMutationSchema, personalRecordSchema, recordMutationSchema, recordKindSchema, type PersonalRecord, type RecordMutation, type RecordKind } from "@zeno/core/schema";
import type { FeatureKey } from "@openwork/features";
import type { ZenoDatabase } from "./database";
import type { Identity } from "./auth";
import { digest } from "./crypto";
import { HttpError } from "./errors";

export class ConflictError extends HttpError {
  constructor(readonly current: PersonalRecord | null, readonly submitted: RecordMutation) { super(409, "conflict", "此内容已更新，请核对后重试。"); }
}
const rowSchema = z.object({ id: z.string(), collection: recordKindSchema, version: z.number(), cursor: z.number(), data_json: z.string(), deleted: z.number(), created_at: z.number(), updated_at: z.number() });
function envelope(raw: unknown, userId: string): PersonalRecord {
  const row = rowSchema.parse(raw);
  return personalRecordSchema.parse({ id: row.id, kind: row.collection, data: JSON.parse(row.data_json), userId, version: row.version, cursor: row.cursor, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted ? row.updated_at : null });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function getRecord(database: ZenoDatabase, userId: string, kind: RecordKind, id: string): PersonalRecord | null {
  const row = database.sqlite.query("SELECT * FROM record WHERE user_id=? AND collection=? AND id=?").get(userId, kind, id);
  return row ? envelope(row, userId) : null;
}
const fitnessKinds = new Set<RecordKind>(["routine", "trainingSchedule", "workout", "measurement", "exercise", "membership"]);
export function featureForKind(kind: RecordKind): FeatureKey {
  return fitnessKinds.has(kind) ? "fitnessTracking" : kind === "event" ? "personalCalendar" : kind === "settings" ? "zenoAccounts" : "localScheduledTasks";
}
function requireDevice(database: ZenoDatabase, actor: Identity, deviceId: string, now: number): void {
  if (!database.sqlite.query("SELECT id FROM device WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?").get(deviceId, actor.userId, now)) throw new HttpError(400, "device_unavailable", "请选择本账号的有效设备。");
}
function validateAuthority(database: ZenoDatabase, actor: Identity, mutation: RecordMutation, previous: PersonalRecord | null, batch: readonly RecordMutation[], now: number) {
  if (mutation.kind === "task" && !mutation.deleted) requireDevice(database, actor, mutation.data.deviceId, now);
  if (mutation.kind === "run") {
    if (!actor.deviceId || mutation.data.deviceId !== actor.deviceId || previous?.kind === "run" && previous.data.deviceId !== actor.deviceId) throw new HttpError(403, "device_receipt_required", "运行结果仅由绑定设备报告。");
    if (previous?.kind === "run") for (const key of ["deviceId", "taskId", "taskVersion", "scheduledAt", "requestId"]) {
      if (Reflect.get(previous.data, key) !== Reflect.get(mutation.data, key)) throw new HttpError(400, "run_identity_immutable", "运行身份不可更改。");
    }
    if (mutation.data.taskId) {
      const task = getRecord(database, actor.userId, "task", mutation.data.taskId);
      if (!task || task.kind !== "task" || task.data.deviceId !== actor.deviceId || mutation.data.taskVersion < 1 || mutation.data.taskVersion > task.version) throw new HttpError(400, "run_task_mismatch", "运行与任务不匹配。");
    }
  }
  if (mutation.kind === "request") {
    if (!previous || actor.deviceId) requireDevice(database, actor, mutation.data.deviceId, now);
    if (actor.deviceId) {
      if (actor.deviceId !== mutation.data.deviceId || previous?.kind === "request" && previous.data.deviceId !== actor.deviceId) throw new HttpError(403, "wrong_device", "此请求属于另一台设备。");
    } else if (previous?.kind === "request") {
      if (mutation.deleted || canonical({ ...previous.data, cancelRequested: true }) !== canonical(mutation.data)) throw new HttpError(403, "request_progress_device_only", "网页只能请求取消，执行进度由设备报告。");
    } else if (mutation.deleted || mutation.data.status !== "pending" || mutation.data.response !== "" || mutation.data.runId || mutation.data.cancelRequested) throw new HttpError(403, "request_pending_only", "新请求必须等待设备执行。");
    if (previous?.kind === "request") for (const key of ["type", "prompt", "deviceId", "workspaceId", "model", "taskId", "createdAt", "expiresAt"]) {
      if (canonical(Reflect.get(previous.data, key)) !== canonical(Reflect.get(mutation.data, key))) throw new HttpError(400, "request_identity_immutable", "请求内容不可在执行中改写。");
    }
  }
  if (mutation.kind === "proposal") {
    for (const change of mutation.data.changes) recordMutationSchema.parse({ ...change, operationId: "proposal-validation" });
    if (!previous) {
      if (!actor.deviceId || mutation.data.status !== "pending") throw new HttpError(403, "proposal_device_only", "建议由本地设备生成。");
    } else if (previous.kind === "proposal") {
      if (mutation.deleted || actor.deviceId === null && canonical({ ...previous.data, status: mutation.data.status }) !== canonical(mutation.data)) throw new HttpError(403, "proposal_immutable", "建议内容不可直接改写。");
      if (mutation.data.status === "applied") {
        for (const change of previous.data.changes) {
          const expected = recordMutationSchema.parse({ ...change, operationId: "proposal-validation" });
          if (!batch.some(item => item.kind === expected.kind && item.id === expected.id && item.baseVersion === expected.baseVersion && item.deleted === expected.deleted && canonical(item.data) === canonical(expected.data))) throw new HttpError(400, "proposal_batch_required", "请原子提交建议及其全部改动。");
        }
      }
    }
  }
  // Media references are private capabilities, never arbitrary filesystem paths.
  const mediaIds = mutation.deleted ? [] : mutation.kind === "measurement" ? mutation.data.photoMediaIds : mutation.kind === "exercise" || mutation.kind === "workout" ? mutation.data.mediaIds ?? [] : [];
  for (const id of mediaIds) if (!database.sqlite.query("SELECT id FROM media WHERE id=? AND user_id=?").get(id, actor.userId)) throw new HttpError(400, "media_unavailable", "附件不存在或不属于本账号。");
}
const storedOperation = z.object({ request_hash: z.string(), response_json: z.string() });
function replay(database: ZenoDatabase, userId: string, operationId: string, hash: string): unknown | undefined {
  const raw = database.sqlite.query("SELECT request_hash,response_json FROM operation WHERE user_id=? AND op_id=?").get(userId, operationId);
  if (!raw) return undefined;
  const stored = storedOperation.parse(raw);
  if (stored.request_hash !== hash) throw new HttpError(409, "operation_reused", "操作编号已用于其他内容。");
  return JSON.parse(stored.response_json);
}
function saveOperation(database: ZenoDatabase, userId: string, operationId: string, hash: string, response: unknown, now: number) {
  database.sqlite.query("INSERT INTO operation(user_id,op_id,request_hash,response_json,created_at) VALUES (?,?,?,?,?)").run(userId, operationId, hash, JSON.stringify(response), now);
}
const resultSchema = z.object({ record: personalRecordSchema, previous: personalRecordSchema.nullable(), replayed: z.boolean() });
function apply(database: ZenoDatabase, actor: Identity, mutation: RecordMutation, featureEnabled: (key: FeatureKey) => boolean, now: number, batch: readonly RecordMutation[]) {
  const hash = digest(canonical(mutation)); const old = replay(database, actor.userId, mutation.operationId, hash);
  if (old !== undefined) return { ...resultSchema.parse(old), replayed: true };
  if (!featureEnabled(featureForKind(mutation.kind))) throw new HttpError(404, "feature_disabled", "此功能暂未启用。");
  const previous = getRecord(database, actor.userId, mutation.kind, mutation.id);
  if (mutation.kind === "settings" && !featureEnabled("fitnessTracking")) {
    const before = previous?.kind === "settings" && previous.deletedAt === null ? previous.data : undefined;
    const after = mutation.deleted ? undefined : mutation.data;
    if (canonical(before?.fitnessEquipment) !== canonical(after?.fitnessEquipment) || canonical(before?.fitnessDayNotes) !== canonical(after?.fitnessDayNotes)) throw new HttpError(404, "feature_disabled", "健身已停用，现有器械和记录会保留。");
  }
  if ((previous?.version ?? 0) !== mutation.baseVersion) throw new ConflictError(previous, mutation);
  validateAuthority(database, actor, mutation, previous, batch, now);
  const version = (previous?.version ?? 0) + 1; const createdAt = previous?.createdAt ?? now; const data = JSON.stringify(mutation.data);
  const inserted = database.sqlite.query("INSERT INTO change_log(user_id,collection,record_id,version,data_json,deleted,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(actor.userId, mutation.kind, mutation.id, version, data, mutation.deleted ? 1 : 0, createdAt, now);
  const cursor = Number(inserted.lastInsertRowid);
  if (!Number.isSafeInteger(cursor)) throw new Error("Cursor overflow");
  database.sqlite.query("INSERT INTO record(user_id,collection,id,version,cursor,data_json,deleted,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,collection,id) DO UPDATE SET version=excluded.version,cursor=excluded.cursor,data_json=excluded.data_json,deleted=excluded.deleted,updated_at=excluded.updated_at").run(actor.userId, mutation.kind, mutation.id, version, cursor, data, mutation.deleted ? 1 : 0, createdAt, now);
  const record = getRecord(database, actor.userId, mutation.kind, mutation.id);
  if (!record) throw new Error("Missing committed record");
  const result = { record, previous, replayed: false };
  saveOperation(database, actor.userId, mutation.operationId, hash, result, now);
  return result;
}
export function mutateRecord(database: ZenoDatabase, actor: Identity, raw: unknown, featureEnabled: (key: FeatureKey) => boolean, now = Date.now()) {
  const mutation = recordMutationSchema.parse(raw);
  return database.sqlite.transaction(() => apply(database, actor, mutation, featureEnabled, now, [mutation])).immediate();
}
export const batchSchema = batchMutationSchema;
export function mutateBatch(database: ZenoDatabase, actor: Identity, raw: unknown, featureEnabled: (key: FeatureKey) => boolean, now = Date.now()) {
  const batch = batchSchema.parse(raw); const hash = digest(canonical(batch));
  if (new Set(batch.mutations.map(item => `${item.kind}:${item.id}`)).size !== batch.mutations.length || new Set([batch.operationId, ...batch.mutations.map(item => item.operationId)]).size !== batch.mutations.length + 1) throw new HttpError(400, "duplicate_batch_record", "批量操作包含重复记录或操作编号。");
  return database.sqlite.transaction(() => {
    const old = replay(database, actor.userId, batch.operationId, hash);
    if (old !== undefined) return { ...z.object({ results: z.array(resultSchema) }).parse(old), replayed: true };
    const results = batch.mutations.map(item => apply(database, actor, item, featureEnabled, now, batch.mutations));
    const result = { results, replayed: false }; saveOperation(database, actor.userId, batch.operationId, hash, result, now);
    return result;
  }).immediate();
}
export function syncRecords(database: ZenoDatabase, userId: string, cursor: number, limit: number) {
  const rows = database.sqlite.query("SELECT record_id AS id,collection,version,cursor,data_json,deleted,created_at,updated_at FROM change_log WHERE user_id=? AND cursor>? ORDER BY cursor LIMIT ?").all(userId, cursor, limit + 1);
  const records = rows.slice(0, limit).map(row => envelope(row, userId));
  return { records, cursor: records.at(-1)?.cursor ?? cursor, hasMore: rows.length > limit };
}
