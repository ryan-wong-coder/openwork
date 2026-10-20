import { z } from 'zod';

export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const timestampSchema = z.number().int().nonnegative();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid date');
export const timeZoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
}, 'Invalid time zone');
export const recurrenceSchema = z.object({
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly']).default('once'),
  interval: z.number().int().min(1).max(365).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  until: timestampSchema.nullable().default(null),
  count: z.number().int().min(1).max(10000).nullable().default(null),
}).strict();
export const scheduleSchema = recurrenceSchema.extend({ startAt: timestampSchema, timeZone: timeZoneSchema });
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;

export const eventExceptionSchema = z.object({
  cancelled: z.boolean().default(false), startAt: timestampSchema.optional(), endAt: timestampSchema.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  status: z.enum(['planned', 'completed', 'cancelled']).optional(),
}).strict();
export const eventDataSchema = z.object({
  title: z.string().trim().min(1).max(240), description: z.string().max(20000).default(''),
  startAt: timestampSchema, endAt: timestampSchema, timeZone: timeZoneSchema,
  allDay: z.boolean().default(false), startDate: dateSchema.optional(), endDate: dateSchema.optional(),
  recurrence: recurrenceSchema.default({ frequency: 'once', interval: 1, weekdays: [], until: null, count: null }),
  exceptions: z.record(dateSchema, eventExceptionSchema).default({}),
  reminders: z.array(z.number().int().min(0).max(525600)).max(8).default([10]),
  status: z.enum(['planned', 'completed', 'cancelled']).default('planned'),
  category: z.enum(['plan', 'todo', 'training', 'ai']).default('plan'),
  linkedId: idSchema.optional(), workspaceId: idSchema.optional(), location: z.string().max(1000).default(''),
  trainingScheduleId: idSchema.optional(), occurrenceDate: dateSchema.optional(),
}).strict().refine(value => value.endAt >= value.startAt, 'End precedes start');
export type EventData = z.infer<typeof eventDataSchema>;

export const progressionSchema = z.object({
  mode: z.enum(['none', 'linear', 'greyskull', 'double', 'triple', 'time']).default('none'),
  increment: z.number().min(0).max(100).default(2.5), repMin: z.number().int().min(1).max(1000).default(6),
  repMax: z.number().int().min(1).max(1000).default(12), maxSets: z.number().int().min(1).max(30).default(5),
  deloadPercent: z.number().min(5).max(50).default(10), stallLimit: z.number().int().min(1).max(20).default(3),
}).strict();
export type Progression = z.infer<typeof progressionSchema>;
export const fitnessEquipmentSchema = z.object({
  available: z.array(z.string().max(100)).max(100).optional(),
  plates: z.object({ kg: z.array(z.object({ weight: z.number().positive().max(2000), pairs: z.number().int().min(0).max(100) }).strict()).max(100).optional(), lb: z.array(z.object({ weight: z.number().positive().max(2000), pairs: z.number().int().min(0).max(100) }).strict()).max(100).optional() }).strict().optional(),
  dumbbells: z.object({ kg: z.array(z.number().positive().max(2000)).max(500).optional(), lb: z.array(z.number().positive().max(2000)).max(500).optional() }).strict().optional(),
  barWeights: z.object({ kg: z.record(idSchema, z.number().min(0).max(2000)).optional(), lb: z.record(idSchema, z.number().min(0).max(2000)).optional() }).strict().optional(),
  dbLoad: z.record(idSchema, z.enum(['as', 'each', 'total'])).optional(), loadKind: z.record(idSchema, z.enum(['pairs', 'single', 'none'])).optional(),
}).strict();
export type FitnessEquipment = z.infer<typeof fitnessEquipmentSchema>;
export const fitnessDayNoteSchema = z.object({ tag: z.enum(['sick', 'travel', 'rest', 'injured']).optional(), text: z.string().max(4000).default(''), at: timestampSchema }).strict();
export type FitnessDayNote = z.infer<typeof fitnessDayNoteSchema>;
export const trainingSetSchema = z.object({
  id: idSchema, kind: z.enum(['normal', 'warmup', 'drop', 'rest_pause']).default('normal'),
  reps: z.number().int().min(0).max(10000).optional(), weight: z.number().min(0).max(2000).optional(),
  durationSeconds: z.number().min(0).max(604800).optional(), distanceMeters: z.number().min(0).max(1000000).optional(),
  speedKmh: z.number().min(0).max(200).optional(), rpe: z.number().min(0).max(10).optional(), rir: z.number().min(0).max(20).optional(),
  inclinePercent: z.number().min(0).max(40).optional(),
  side: z.enum(['both', 'left', 'right']).default('both'), restSeconds: z.number().int().min(0).max(900).optional(),
  drops: z.array(z.object({ weight: z.number().min(0).max(2000), reps: z.number().int().min(0).max(10000) }).strict()).max(20).optional(),
  restPause: z.array(z.object({ reps: z.number().int().min(0).max(10000), restSeconds: z.number().min(0).max(900) }).strict()).max(20).optional(),
  failure: z.boolean().optional(),
  completed: z.boolean().default(false), completedAt: timestampSchema.nullable().default(null),
}).strict();
export type TrainingSet = z.infer<typeof trainingSetSchema>;
export const prescriptionSchema = z.object({
  sets: z.number().int().min(1).max(100), reps: z.number().int().min(0).max(10000).optional(),
  repMin: z.number().int().min(0).max(10000).optional(), maxSets: z.number().int().min(1).max(100).optional(),
  weight: z.number().min(0).max(2000).optional(), durationSeconds: z.number().min(0).max(604800).optional(),
  rowReps: z.array(z.number().int().min(0).max(10000)).max(100).optional(), backoffStep: z.number().min(0).max(100).optional(),
}).strict();
export const routineExerciseSchema = z.object({
  id: idSchema, exerciseId: idSchema, name: z.string().min(1).max(240),
  sets: z.array(trainingSetSchema).max(100), restSeconds: z.number().int().min(0).max(900).default(90),
  groupId: idSchema.optional(), progression: progressionSchema.optional(), notes: z.string().max(4000).default(''),
  pyramid: z.object({ reps: z.array(z.number().int().min(0).max(10000)).max(100), weights: z.array(z.number().min(0).max(2000)).max(100) }).strict().optional(),
  backoffPercent: z.number().min(0).max(100).optional(),
  noProg: z.boolean().optional(), bodyweight: z.boolean().optional(), dbLoad: z.enum(['as', 'each', 'total']).optional(), loadKind: z.enum(['pairs', 'single', 'none']).optional(), routineId: idSchema.optional(),
  prescription: prescriptionSchema.optional(), planSnapshot: prescriptionSchema.optional(),
  muscleSnapshot: z.object({ primaryMuscles: z.array(z.string().max(100)).max(50), secondaryMuscles: z.array(z.string().max(100)).max(50), equipment: z.string().max(100), bodyPart: z.string().max(100) }).strict().optional(),
}).strict();
export type RoutineExercise = z.infer<typeof routineExerciseSchema>;
export const routineDataSchema = z.object({
  title: z.string().trim().min(1).max(240), description: z.string().max(10000).default(''),
  unit: z.enum(['kg', 'lb']).default('kg'), exercises: z.array(routineExerciseSchema).max(200),
  progression: progressionSchema.default({ mode: 'none', increment: 2.5, repMin: 6, repMax: 12, maxSets: 5, deloadPercent: 10, stallLimit: 3 }),
  noProg: z.boolean().optional(),
}).strict();
export type RoutineData = z.infer<typeof routineDataSchema>;
export const trainingScheduleDataSchema = z.object({
  title: z.string().trim().min(1).max(240), mode: z.enum(['weekly', 'rotation']),
  week: z.record(z.string().regex(/^[0-6]$/), idSchema).default({}), rotation: z.array(idSchema).max(100).default([]),
  position: z.number().int().min(0).default(0), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('18:00'),
  durationMinutes: z.number().int().min(1).max(1440).default(60), enabled: z.boolean().default(true),
  timeZone: timeZoneSchema, deloadEveryWeeks: z.number().int().min(0).max(52).default(0), deloadPercent: z.number().min(0).max(100).default(10),
  anchorDate: dateSchema.optional(), restDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  deloadAnchorDate: dateSchema.optional(),
}).strict();
export type TrainingScheduleData = z.infer<typeof trainingScheduleDataSchema>;
export const workoutDataSchema = z.object({
  title: z.string().trim().min(1).max(240), routineId: idSchema.optional(), eventId: idSchema.optional(), deviceId: idSchema.optional(),
  unit: z.enum(['kg', 'lb']).default('kg'), startedAt: timestampSchema, finishedAt: timestampSchema.nullable().default(null),
  notes: z.string().max(10000).default(''), exercises: z.array(routineExerciseSchema).max(200),
  restEndsAt: timestampSchema.nullable().default(null), bodyWeightKg: z.number().min(1).max(700).optional(),
  routineIds: z.array(idSchema).max(100).optional(), noProg: z.boolean().optional(), mediaIds: z.array(idSchema).max(6).optional(),
  backfill: z.object({ day: dateSchema, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: timeZoneSchema, durationMinutes: z.number().min(1).max(1440), replaceId: idSchema.optional() }).strict().optional(),
}).strict();
export type WorkoutData = z.infer<typeof workoutDataSchema>;
export const measurementDataSchema = z.object({
  at: timestampSchema, weightKg: z.number().min(1).max(700).optional(), bodyFatPercent: z.number().min(0).max(100).optional(),
  circumferences: z.record(z.string().max(50), z.number().min(0).max(1000)).default({}),
  photoMediaIds: z.array(idSchema).max(20).default([]), notes: z.string().max(5000).default(''), goalWeightKg: z.number().min(1).max(700).optional(),
}).strict();
export type MeasurementData = z.infer<typeof measurementDataSchema>;
export const exerciseDataSchema = z.object({
  name: z.string().trim().min(1).max(240), primaryMuscles: z.array(z.string().max(100)).max(50),
  secondaryMuscles: z.array(z.string().max(100)).max(50).default([]), equipment: z.array(z.string().max(100)).max(30).default([]),
  instructions: z.array(z.string().max(4000)).max(100).default([]),
  category: z.enum(['strength', 'bodyweight', 'timed', 'cardio']).default('strength'), mediaIds: z.array(idSchema).max(10).default([]),
}).strict();
export type ExerciseData = z.infer<typeof exerciseDataSchema>;
export const membershipDataSchema = z.object({
  name: z.string().trim().min(1).max(240), code: z.string().min(1).max(4000), format: z.enum(['qr', 'barcode']).default('qr'),
  expiresAt: timestampSchema.nullable().default(null), notes: z.string().max(4000).default(''),
}).strict();
export type MembershipData = z.infer<typeof membershipDataSchema>;

export const modelChoiceSchema = z.object({ providerId: z.string().min(1).max(200), modelId: z.string().min(1).max(300), label: z.string().max(240).optional(), variant: z.string().max(100).optional() }).strict();
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export const workspaceChoiceSchema = z.object({ id: idSchema, name: z.string().min(1).max(240) }).strict();
export type WorkspaceChoice = z.infer<typeof workspaceChoiceSchema>;
export const taskDataSchema = z.object({
  title: z.string().trim().min(1).max(240), instructions: z.string().min(1).max(50000),
  deviceId: idSchema, workspaceId: idSchema, model: modelChoiceSchema, schedule: scheduleSchema,
  enabled: z.boolean().default(true), timeoutMinutes: z.number().int().min(1).max(120).default(10),
}).strict();
export type TaskData = z.infer<typeof taskDataSchema>;
export const runStatusSchema = z.enum(['queued', 'running', 'waiting_permission', 'waiting_input', 'succeeded', 'failed', 'cancelled', 'missed', 'uncertain']);
export const runDataSchema = z.object({
  taskId: idSchema.optional(), taskVersion: z.number().int().nonnegative().default(0), deviceId: idSchema,
  scheduledAt: timestampSchema, requestId: idSchema.optional(), startedAt: timestampSchema.nullable().default(null), finishedAt: timestampSchema.nullable().default(null),
  status: runStatusSchema, sessionId: z.string().max(300).optional(), summary: z.string().max(30000).default(''), error: z.string().max(5000).optional(),
}).strict();
export type RunData = z.infer<typeof runDataSchema>;
export const requestDataSchema = z.object({
  type: z.enum(['chat', 'run_task', 'coach']), prompt: z.string().max(50000).default(''), deviceId: idSchema,
  workspaceId: idSchema.optional(), model: modelChoiceSchema.optional(), taskId: idSchema.optional(),
  status: z.enum(['pending', 'accepted', 'running', 'waiting_permission', 'succeeded', 'failed', 'cancelled', 'expired']).default('pending'),
  createdAt: timestampSchema, expiresAt: timestampSchema, runId: idSchema.optional(), response: z.string().max(100000).default(''),
  cancelRequested: z.boolean().default(false),
}).strict();
export type RequestData = z.infer<typeof requestDataSchema>;
export const proposalChangeSchema = z.object({
  kind: z.enum(['event', 'routine', 'trainingSchedule']), id: idSchema, baseVersion: z.number().int().nonnegative(),
  data: z.record(z.string(), z.json()), deleted: z.boolean().default(false),
}).strict();
export const proposalDataSchema = z.object({
  title: z.string().trim().min(1).max(240), description: z.string().max(20000).default(''),
  source: z.enum(['scheduled', 'proactive']), status: z.enum(['pending', 'applied', 'rejected', 'stale']).default('pending'),
  changes: z.array(proposalChangeSchema).min(1).max(100), createdAt: timestampSchema, runId: idSchema.optional(),
}).strict();
export type ProposalData = z.infer<typeof proposalDataSchema>;
export const settingsDataSchema = z.object({
  timeZone: timeZoneSchema, weekStartsOn: z.literal(1).default(1), unit: z.enum(['kg', 'lb']).default('kg'),
  profileName: z.string().max(200).default(''), notifications: z.boolean().default(true),
  fitnessEquipment: fitnessEquipmentSchema.optional(), fitnessDayNotes: z.record(dateSchema, fitnessDayNoteSchema).optional(),
}).strict();
export type SettingsData = z.infer<typeof settingsDataSchema>;

export const recordSchemas = {
  event: eventDataSchema, routine: routineDataSchema, trainingSchedule: trainingScheduleDataSchema,
  workout: workoutDataSchema, measurement: measurementDataSchema, exercise: exerciseDataSchema,
  membership: membershipDataSchema, task: taskDataSchema, run: runDataSchema, request: requestDataSchema,
  proposal: proposalDataSchema, settings: settingsDataSchema,
};
export const recordKindSchema = z.enum(['event', 'routine', 'trainingSchedule', 'workout', 'measurement', 'exercise', 'membership', 'task', 'run', 'request', 'proposal', 'settings']);
export type RecordKind = z.infer<typeof recordKindSchema>;
export type RecordData<K extends RecordKind> = z.infer<(typeof recordSchemas)[K]>;
export const recordPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), data: eventDataSchema }), z.object({ kind: z.literal('routine'), data: routineDataSchema }),
  z.object({ kind: z.literal('trainingSchedule'), data: trainingScheduleDataSchema }), z.object({ kind: z.literal('workout'), data: workoutDataSchema }),
  z.object({ kind: z.literal('measurement'), data: measurementDataSchema }), z.object({ kind: z.literal('exercise'), data: exerciseDataSchema }),
  z.object({ kind: z.literal('membership'), data: membershipDataSchema }), z.object({ kind: z.literal('task'), data: taskDataSchema }),
  z.object({ kind: z.literal('run'), data: runDataSchema }), z.object({ kind: z.literal('request'), data: requestDataSchema }),
  z.object({ kind: z.literal('proposal'), data: proposalDataSchema }), z.object({ kind: z.literal('settings'), data: settingsDataSchema }),
]);
const recordEnvelope = {
  id: idSchema, userId: z.string().min(1).max(200), version: z.number().int().nonnegative(), cursor: z.number().int().nonnegative(),
  createdAt: timestampSchema, updatedAt: timestampSchema, deletedAt: timestampSchema.nullable(),
};
const mutationEnvelope = { operationId: idSchema, id: idSchema, baseVersion: z.number().int().nonnegative(), deleted: z.boolean().default(false) };
export const personalRecordSchema = z.discriminatedUnion('kind', [
  recordPayloadSchema.options[0].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[1].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[2].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[3].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[4].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[5].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[6].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[7].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[8].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[9].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[10].extend(recordEnvelope).strict(),
  recordPayloadSchema.options[11].extend(recordEnvelope).strict(),
]);
export type PersonalRecord = z.infer<typeof personalRecordSchema>;
export type KindRecord<K extends RecordKind> = Extract<PersonalRecord, { kind: K }>;
export const recordMutationSchema = z.discriminatedUnion('kind', [
  recordPayloadSchema.options[0].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[1].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[2].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[3].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[4].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[5].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[6].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[7].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[8].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[9].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[10].extend(mutationEnvelope).strict(),
  recordPayloadSchema.options[11].extend(mutationEnvelope).strict(),
]);
export type RecordMutation = z.infer<typeof recordMutationSchema>;
export const mutationResultSchema = z.object({ record: personalRecordSchema, previous: personalRecordSchema.nullable(), replayed: z.boolean().default(false) });
export type MutationResult = z.infer<typeof mutationResultSchema>;
export const syncResultSchema = z.object({ records: z.array(personalRecordSchema), cursor: z.number().int().nonnegative(), hasMore: z.boolean() });
export type SyncResult = z.infer<typeof syncResultSchema>;

export const accountUserSchema = z.object({ id: z.string().min(1), email: z.email(), name: z.string(), role: z.enum(['user', 'admin']).default('user') });
export type AccountUser = z.infer<typeof accountUserSchema>;
export const accountSessionSchema = z.object({ user: accountUserSchema, deviceId: idSchema.nullable().optional(), expiresAt: z.union([z.string(), timestampSchema]).optional() });
export type AccountSession = z.infer<typeof accountSessionSchema>;
export const deviceInventorySchema = z.object({
  workspaces: z.array(workspaceChoiceSchema).max(100).default([]), models: z.array(modelChoiceSchema).max(200).default([]),
  appliedCursor: z.number().int().nonnegative().default(0), windowOpen: z.boolean().default(false),
}).strict();
export type DeviceInventory = z.infer<typeof deviceInventorySchema>;
export const deviceSchema = deviceInventorySchema.extend({
  id: idSchema, name: z.string().min(1).max(200), createdAt: timestampSchema, lastSeenAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(), platform: z.enum(['darwin', 'win32', 'linux']).optional(), expiresAt: timestampSchema.optional(),
});
export type Device = z.infer<typeof deviceSchema>;
export const personalFeaturesSchema = z.object({ zenoAccounts: z.boolean(), personalCalendar: z.boolean(), fitnessTracking: z.boolean(), localScheduledTasks: z.boolean() });
export type PersonalFeatures = z.infer<typeof personalFeaturesSchema>;
export type JsonValue = z.infer<ReturnType<typeof z.json>>;
export const mediaSchema = z.object({ id: idSchema, name: z.string(), mime: z.string(), size: z.number().int().nonnegative(), createdAt: timestampSchema });
export type Media = z.infer<typeof mediaSchema>;
export const batchMutationSchema = z.object({ operationId: idSchema, mutations: z.array(recordMutationSchema).min(1).max(101) }).strict();
export const batchMutationResultSchema = z.object({ results: z.array(mutationResultSchema), replayed: z.boolean().default(false) });

export function recordsOfKind<K extends RecordKind>(records: readonly PersonalRecord[], kind: K): KindRecord<K>[] {
  return records.filter((record): record is KindRecord<K> => record.kind === kind && record.deletedAt === null);
}
export function createMutation<K extends RecordKind>(kind: K, data: RecordData<K>, options: { id?: string; baseVersion?: number; deleted?: boolean; operationId?: string } = {}): RecordMutation {
  return recordMutationSchema.parse({ kind, data, id: options.id ?? crypto.randomUUID(), baseVersion: options.baseVersion ?? 0, deleted: options.deleted ?? false, operationId: options.operationId ?? crypto.randomUUID() });
}
export function recordKey(record: { kind: RecordKind; id: string }): string { return record.kind + ':' + record.id; }
