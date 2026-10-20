import { measurementDataSchema, membershipDataSchema, routineDataSchema, trainingScheduleDataSchema, workoutDataSchema, idSchema, dateSchema, fitnessEquipmentSchema, fitnessDayNoteSchema } from "@zeno/core/schema";
import { zipStore, readZip } from "../upstream/lib/zip.js";
import type { BodyMeasurement, FitnessDayNotes, FitnessEquipment, FitnessExercise, IdentifiedWorkout, MembershipCard, TrainingRoutine, TrainingSchedule } from "./types.js";
import { finite, isRecord, list, record, stringList, text } from "./value.js";
import { fromUpstreamRoutine, fromUpstreamWorkout, withExerciseSnapshot } from "./upstream-adapter.js";
import { exerciseFromUpstream } from "./catalogue.js";
import { parseOpenGymSchedules } from "./plans.js";
import { measurementFields } from "./body.js";
import { normalizeMediaRef } from "../upstream/lib/media-refs.js";
import { validatePersonalMedia } from "@zeno/core/media";

export interface FitnessBackup {
  format: "zeno-fitness"; version: 1; exportedAt: number;
  routines: Array<{ id: string; data: TrainingRoutine }>;
  schedules: Array<{ id: string; data: TrainingSchedule }>;
  workouts: IdentifiedWorkout[]; measurements: BodyMeasurement[];
  memberships: MembershipCard[]; customExercises: FitnessExercise[];
  equipment?: FitnessEquipment; dayNotes?: FitnessDayNotes;
}
export function createFitnessBackup(data: Omit<FitnessBackup, "format" | "version" | "exportedAt">, now = Date.now()): FitnessBackup {
  return parseFitnessBackup({ ...data, format: "zeno-fitness", version: 1, exportedAt: now });
}
export function serializeFitnessBackup(backup: FitnessBackup): string { return JSON.stringify(parseFitnessBackup(backup), null, 2); }
function customExercise(value: unknown): FitnessExercise {
  const raw = record(value); const id = idSchema.parse(raw.id);
  const primary = stringList(raw.primaryMuscles); const secondary = stringList(raw.secondaryMuscles);
  return { id, name: text(raw.name, "自定义动作").slice(0, 240), englishName: text(raw.englishName), bodyPart: text(raw.bodyPart), bodyPartId: text(raw.bodyPartId), category: text(raw.category), categoryId: text(raw.categoryId), equipment: text(raw.equipment), equipmentId: text(raw.equipmentId), primaryMuscles: primary, primaryMuscleIds: stringList(raw.primaryMuscleIds), secondaryMuscles: secondary, secondaryMuscleIds: stringList(raw.secondaryMuscleIds), instructions: stringList(raw.instructions), description: text(raw.description), ...(raw.mediaIds !== undefined ? { mediaIds: idSchema.array().max(10).parse(raw.mediaIds) } : {}) };
}
export function parseFitnessBackup(content: string | unknown): FitnessBackup {
  const parsed: unknown = typeof content === "string" ? JSON.parse(content) : content;
  if (!isRecord(parsed) || parsed.format !== "zeno-fitness" || parsed.version !== 1) throw new Error("不支持的健身备份版本");
  const arrays = [parsed.routines, parsed.schedules, parsed.workouts, parsed.measurements, parsed.memberships, parsed.customExercises];
  if (arrays.some(value => !Array.isArray(value) || value.length > 100000)) throw new Error("备份的数据列表无效或过大");
  if (parsed.dayNotes !== undefined && !isRecord(parsed.dayNotes)) throw new Error("休息说明格式无效");
  return { format: "zeno-fitness", version: 1, exportedAt: finite(parsed.exportedAt),
    routines: list(parsed.routines).map(value => { const row = record(value); return { id: idSchema.parse(row.id), data: routineDataSchema.parse(row.data) }; }),
    schedules: list(parsed.schedules).map(value => { const row = record(value); return { id: idSchema.parse(row.id), data: trainingScheduleDataSchema.parse(row.data) }; }),
    workouts: list(parsed.workouts).map(value => { const { id, ...data } = record(value); return { ...workoutDataSchema.parse(data), id: idSchema.parse(id) }; }),
    measurements: list(parsed.measurements).map(value => measurementDataSchema.parse(value)),
    memberships: list(parsed.memberships).map(value => membershipDataSchema.parse(value)), customExercises: list(parsed.customExercises).map(customExercise),
    ...(parsed.equipment !== undefined ? { equipment: fitnessEquipmentSchema.parse(parsed.equipment) } : {}),
    ...(parsed.dayNotes !== undefined ? { dayNotes: Object.fromEntries(Object.entries(record(parsed.dayNotes)).map(([day, value]) => [dateSchema.parse(day), fitnessDayNoteSchema.parse(value)])) } : {}),
  };
}
export function equipmentFromOpenGym(value: unknown, unit: "kg" | "lb" = "kg"): FitnessEquipment {
  const state = record(value); const plates = record(state.plates); const dumbbells = record(state.dumbbells);
  const loadKind = Object.fromEntries(Object.entries(record(state.loadKind)).flatMap(([id, value]) => { const kind = typeof value === "string" ? value : record(value).kind; return kind === "pairs" || kind === "single" || kind === "none" ? [[id, kind]] : []; }));
  const dbLoad = Object.fromEntries(Object.entries(record(state.dbLoad)).flatMap(([id, value]) => { const mode = typeof value === "string" ? value : record(value).mode; return mode === "as" || mode === "each" || mode === "total" ? [[id, mode]] : []; }));
  return fitnessEquipmentSchema.parse({ available: stringList(state.equipment), plates: Object.fromEntries(["kg", "lb"].map(unit => [unit, Object.entries(record(plates[unit])).flatMap(([weight, pairs]) => Number(weight) > 0 && typeof pairs === "number" && Number.isInteger(pairs) && pairs >= 0 ? [{ weight: Number(weight), pairs }] : [])])), dumbbells: Object.fromEntries(["kg", "lb"].map(unit => [unit, list(record(dumbbells[unit]).weights).filter((weight): weight is number => typeof weight === "number" && Number.isFinite(weight) && weight > 0)])), barWeights: { [unit]: Object.fromEntries(Object.entries(record(state.barWeights)).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= 0)) }, loadKind, dbLoad });
}
/** Import legacy openGym JSON without executing anything or keeping account/provider secrets. */
export function parseOpenGymBackup(content: string | unknown): FitnessBackup {
  const value: unknown = typeof content === "string" ? JSON.parse(content) : content;
  const state = record(value);
  if (!Array.isArray(state.workouts) && !Array.isArray(state.routines)) throw new Error("不是 openGym 训练备份");
  const unit = state.unit === "lb" ? "lb" : "kg";
  const customExercises = list(state.customEx).map(exerciseFromUpstream);
  return createFitnessBackup({
    routines: list(state.routines).map((routine, index) => ({ id: text(record(routine).id, `routine-${index}`), data: fromUpstreamRoutine(routine, unit) })),
    workouts: list(state.workouts).map((workout, index) => { const result = fromUpstreamWorkout(workout, unit, index); return { ...result, exercises: result.exercises.map(exercise => withExerciseSnapshot(exercise, customExercises)) }; }),
    measurements: [...list(state.bodyweight).map(raw => { const entry = record(raw); return { at: finite(entry.t, new Date(text(entry.d)).getTime()), weightKg: finite(entry.w) * (unit === "lb" ? 0.45359237 : 1), circumferences: {}, photoMediaIds: [], notes: "" }; }), ...list(state.measurements).map(raw => {
      const entry = record(raw); const fields = [...measurementFields.map(field => [field.id, entry[field.id]]), ...list(entry.other).map(item => [text(record(item).name, text(record(item).id)), record(item).value])];
      const circumferences = Object.fromEntries(fields.filter((field): field is [string, number] => typeof field[0] === "string" && typeof field[1] === "number" && Number.isFinite(field[1]) && field[1] > 0));
      return { at: finite(entry.t, new Date(text(entry.d)).getTime()), ...(typeof entry.bodyFat === "number" ? { bodyFatPercent: entry.bodyFat } : {}), circumferences, photoMediaIds: [], notes: "" };
    })],
    schedules: parseOpenGymSchedules(state),
    memberships: list(state.gymCards).map(raw => { const card = record(raw); return membershipDataSchema.parse({ name: text(card.name, "会员卡"), code: text(card.value, text(card.code)), format: card.format === "barcode" ? "barcode" : "qr", notes: text(card.notes) }); }), customExercises,
    equipment: equipmentFromOpenGym(state, unit),
    dayNotes: Object.fromEntries(Object.entries(record(state.dayNotes)).map(([day, value]) => { const note = record(value); return [dateSchema.parse(day), fitnessDayNoteSchema.parse({ ...(note.tag === "sick" || note.tag === "travel" || note.tag === "rest" || note.tag === "injured" ? { tag: note.tag } : {}), text: text(note.text).slice(0, 4000), at: finite(note._ts) })]; })),
  });
}
export interface FitnessBackupMedia { id: string; name: string; mime: string; blob: Blob }
interface MediaManifest { id: string; name: string; mime: string; size: number; sha256: string }
export function fitnessBackupMediaIds(backup: FitnessBackup): string[] { return [...new Set([...backup.measurements.flatMap(row => row.photoMediaIds), ...backup.customExercises.flatMap(exercise => exercise.mediaIds ?? []), ...backup.workouts.flatMap(workout => workout.mediaIds ?? [])])]; }
function validateMediaReferences(backup: FitnessBackup, mediaIds: readonly string[]): void {
  const available = new Set(mediaIds); if (fitnessBackupMediaIds(backup).some(id => !available.has(id))) throw new Error("备份缺少引用的媒体文件");
}
async function sha256(blob: Blob): Promise<string> { const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())); return [...hash].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
export async function exportFitnessBackupZip(backup: FitnessBackup, media: readonly FitnessBackupMedia[] = []): Promise<Blob> {
  if (media.length > 1998 || new Set(media.map(item => item.id)).size !== media.length) throw new Error("媒体数量或编号无效");
  const validated = parseFitnessBackup(backup); validateMediaReferences(validated, media.map(item => item.id));
  const manifest: MediaManifest[] = [];
  for (const item of media) {
    idSchema.parse(item.id);
    validatePersonalMedia({ type: item.mime, size: item.blob.size });
    manifest.push({ id: item.id, name: item.name.slice(0, 240), mime: item.mime, size: item.blob.size, sha256: await sha256(item.blob) });
  }
  const entries = [{ name: "backup.json", blob: new Blob([serializeFitnessBackup(validated)], { type: "application/json" }) }, { name: "media.json", blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }) }, ...media.map(item => ({ name: `media/${item.id}`, blob: item.blob }))];
  const result: unknown = await zipStore(entries); if (!(result instanceof Blob)) throw new Error("备份生成失败"); return result;
}
export async function importFitnessBackupZip(file: Blob): Promise<{ backup: FitnessBackup; media: FitnessBackupMedia[] }> {
  const raw: unknown = await readZip(file);
  const entries = list(raw).map(value => record(value));
  const names = entries.map(entry => text(entry.name));
  if (new Set(names).size !== names.length || names.some(name => name !== "backup.json" && name !== "media.json" && !/^media\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(name))) throw new Error("备份包含无效或重复路径");
  const content = entries.find(entry => entry.name === "backup.json")?.blob;
  const manifestBlob = entries.find(entry => entry.name === "media.json")?.blob;
  if (!(content instanceof Blob) || !(manifestBlob instanceof Blob) || content.size > 20 * 1024 * 1024 || manifestBlob.size > 1024 * 1024) throw new Error("备份清单缺失或过大");
  const backup = parseFitnessBackup(await content.text());
  const manifest: unknown = JSON.parse(await manifestBlob.text());
  if (!Array.isArray(manifest) || manifest.length > 1998) throw new Error("媒体清单无效");
  const media: FitnessBackupMedia[] = [];
  for (const value of list(manifest)) {
    const item = record(value); const id = idSchema.parse(item.id); const mime = text(item.mime);
    const blob = entries.find(entry => entry.name === `media/${id}`)?.blob;
    if (!(blob instanceof Blob) || blob.size !== item.size || await sha256(blob) !== item.sha256 || media.some(existing => existing.id === id)) throw new Error("媒体校验失败");
    validatePersonalMedia({ type: mime, size: blob.size });
    media.push({ id, name: text(item.name), mime, blob: blob.slice(0, blob.size, mime) });
  }
  if (entries.length !== media.length + 2) throw new Error("备份含有清单未声明的文件");
  validateMediaReferences(backup, media.map(item => item.id));
  return { backup, media };
}

/** Reads the fixed upstream's original stored ZIP; no remote link or poster is fetched. */
export async function importOpenGymBackupZip(file: Blob): Promise<{ backup: FitnessBackup; media: FitnessBackupMedia[]; warnings: string[] }> {
  const raw: unknown = await readZip(file); const entries = list(raw).map(record);
  const names = entries.map(entry => text(entry.name));
  if (new Set(names).size !== names.length || names.some(name => name !== "opengym-backup.json" && name !== "README.txt" && !/^media\/[0-9a-f]{64}\.(jpg|png|webp|gif|mp4|mov|webm)$/.test(name))) throw new Error("openGym 备份路径无效");
  const json = entries.find(entry => entry.name === "opengym-backup.json")?.blob;
  if (!(json instanceof Blob) || json.size > 20 * 1024 * 1024) throw new Error("openGym 备份清单缺失或过大");
  const state: unknown = JSON.parse(await json.text()); const source = record(state); const backup = parseOpenGymBackup(state);
  const media: FitnessBackupMedia[] = [], warnings: string[] = []; const loaded = new Map<string, string | null>();
  const load = async (value: unknown): Promise<string | null> => {
    const normalized: unknown = normalizeMediaRef(value); if (!normalized) return null;
    const ref = record(normalized), hash = text(ref.hash); if (loaded.has(hash)) return loaded.get(hash) ?? null;
    try {
      const entry = entries.find(entry => text(entry.name).startsWith(`media/${hash}.`));
      const blob = entry?.blob, mime = text(ref.mime) === "video/quicktime" ? "video/mp4" : text(ref.mime);
      if (!(blob instanceof Blob) || blob.size !== ref.size || await sha256(blob) !== hash) throw new Error("media mismatch");
      validatePersonalMedia({ type: mime, size: blob.size });
      const id = `legacy-${hash}`; media.push({ id, name: hash + (mime.startsWith("video/") ? ".mp4" : "." + mime.split("/")[1]), mime, blob: blob.slice(0, blob.size, mime) }); loaded.set(hash, id); return id;
    } catch { loaded.set(hash, null); warnings.push("一个缺失、损坏或超出泽诺媒体限制的文件未导入。"); return null; }
  };
  for (const [index, exercise] of backup.customExercises.entries()) { const id = await load(record(list(source.customEx)[index]).media); exercise.mediaIds = id ? [id] : []; }
  for (const [index, workout] of backup.workouts.entries()) {
    const ids: string[] = []; for (const ref of list(record(list(source.workouts)[index]).media)) { const id = await load(ref); if (id && !ids.includes(id) && ids.length < 6) ids.push(id); } workout.mediaIds = ids;
  }
  return { backup: parseFitnessBackup(backup), media, warnings };
}
