import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createMutation, dateTimeInZone, eventDataSchema, expandEvent, exportIcs, localDateKey, personalRecordSchema, routineDataSchema, trainingScheduleDataSchema, workoutDataSchema, type PersonalRecord } from "@zeno/core";
import { createFitnessBackup } from "@zeno/fitness";
const ownsDom = !GlobalRegistrator.isRegistered && typeof document === "undefined";
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/app/calendar" });
const { cacheScope, emptySnapshot, mergeRecords, visibleRecords, discardObjectChanges, mapMutationMedia, mutationMediaIds, reverseCommittedChanges } = await import("../src/react-app/domains/zeno/sync-store");
const { clearAccountHint, readAccountHint, writeAccountHint, markAccountSignedOut, isAccountSignedOut, clearAccountSignedOut, conflictFields } = await import("../src/react-app/domains/zeno/account-hint");
const { fitnessImportMutations, remapImportedEquipment } = await import("../src/react-app/domains/zeno/fitness-data");
const { dueReminders } = await import("../src/react-app/domains/zeno/use-personal-reminders");
const { rescheduleCalendarEvent, updateEntireEventSeries } = await import("../src/react-app/domains/zeno/calendar-mutations");
const { remainingRestSeconds } = await import("../src/react-app/domains/zeno/fitness-workout");
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });

const event = eventDataSchema.parse({ title: "写作", startAt: 1000000, endAt: 4600000, timeZone: "Asia/Shanghai" });
function record(version: number, deletedAt: number | null = null): PersonalRecord { return personalRecordSchema.parse({ id: "event-a", userId: "user-a", kind: "event", data: event, version, cursor: version, createdAt: 1, updatedAt: version, deletedAt }); }

test("cache keys isolate both account and service origin", () => {
  expect(cacheScope("https://one.example/", "a")).toBe(cacheScope("https://one.example", "a"));
  expect(cacheScope("https://one.example", "a")).not.toBe(cacheScope("https://one.example", "b"));
  expect(cacheScope("https://one.example", "a")).not.toBe(cacheScope("https://two.example", "a"));
});
test("history folding selects newest version and tombstone independent of order", () => {
  expect(mergeRecords([], [record(1), record(3, 3), record(2)])[0]).toEqual(record(3, 3));
  expect(mergeRecords([record(3, 3)], [record(1)])[0]).toEqual(record(3, 3));
});
test("offline optimistic edits and deletes keep version and previous entity metadata", () => {
  const mutation = createMutation("event", { ...event, title: "离线修改" }, { id: "event-a", baseVersion: 3 });
  const snapshot = { ...emptySnapshot(), records: [record(3)], outbox: [{ mutation, before: record(3), queuedAt: 100 }] };
  const visible = visibleRecords(snapshot, "user-a")[0];
  expect(visible.version).toBe(4); expect(visible.createdAt).toBe(1); expect(visible.data).toMatchObject({ title: "离线修改" });
  snapshot.outbox[0].mutation = createMutation("event", event, { id: "event-a", baseVersion: 3, deleted: true });
  expect(visibleRecords(snapshot, "user-a")[0].deletedAt).toBe(100);
  expect(discardObjectChanges(snapshot, mutation).outbox).toHaveLength(0);
});
test("offline identity hints contain metadata only and never carry credentials between accounts", () => {
  const service = "https://hint.example"; clearAccountHint(service);
  writeAccountHint(service, { user: { id: "a", email: "a@example.test", name: "用户甲", role: "user" } }, { zenoAccounts: true, personalCalendar: true, fitnessTracking: true, localScheduledTasks: true });
  expect(readAccountHint(service)?.features?.fitnessTracking).toBe(true);
  const serialized = localStorage.getItem("zeno.personal.account-hint:" + service) ?? "";
  expect(serialized).not.toMatch(/password|cookie|token|authorization/i);
  writeAccountHint(service, { user: { id: "b", email: "b@example.test", name: "用户乙", role: "user" } });
  expect(readAccountHint(service)?.features).toBeNull();
  expect(readAccountHint(service)?.session.user.id).toBe("b");
  markAccountSignedOut(service); expect(isAccountSignedOut(service)).toBe(true); clearAccountSignedOut(service); expect(isAccountSignedOut(service)).toBe(false);
  clearAccountHint(service); expect(readAccountHint(service)).toBeNull();
});
test("conflict view exposes changed time, notes and status even when titles are identical", () => {
  const diff = conflictFields({ title: "不变", startAt: 1000000, notes: "本地", status: "planned" }, { title: "不变", startAt: 2000000, notes: "远端", status: "completed" });
  expect(diff.map(row => row.key)).toEqual(["startAt", "notes", "status"]); expect(diff[1]).toMatchObject({ label: "备注", local: "本地", remote: "远端" });
  expect(conflictFields({ title: "本地内容", notes: "保留说明" }, null)).toContainEqual({ key: "notes", label: "备注", local: "保留说明", remote: "已删除" });
});
test("fitness import remaps relations and history IDs while rejecting dangling photos", () => {
  const routine = routineDataSchema.parse({ title: "计划", exercises: [{ id: "entry", exerciseId: "custom-a", name: "动作", sets: [{ id: "set", reps: 5, weight: 10 }] }] });
  const schedule = trainingScheduleDataSchema.parse({ title: "安排", mode: "weekly", timeZone: "Asia/Shanghai", week: { "1": "routine-a", "2": "missing" }, rotation: ["routine-a", "missing"] });
  const workout = workoutDataSchema.parse({ title: "历史", routineId: "routine-a", eventId: "old-event", deviceId: "old-device", startedAt: 100, finishedAt: 1000, exercises: routine.exercises });
  const backup = createFitnessBackup({ routines: [{ id: "routine-a", data: routine }], schedules: [{ id: "schedule-a", data: schedule }], workouts: [{ ...workout, id: "workout-a" }], measurements: [{ at: 100, photoMediaIds: ["photo-a", "missing"], circumferences: {}, notes: "" }], memberships: [], customExercises: [{ id: "custom-a", name: "自定义", englishName: "", category: "strength", categoryId: "strength", bodyPart: "", bodyPartId: "", equipment: "", equipmentId: "", primaryMuscles: [], primaryMuscleIds: [], secondaryMuscles: [], secondaryMuscleIds: [], instructions: [], description: "" }] });
  const mutations = fitnessImportMutations(backup, new Map([["photo-a", "local-media-a"]]));
  const importedRoutine = mutations.find(item => item.kind === "routine"), importedExercise = mutations.find(item => item.kind === "exercise"), importedSchedule = mutations.find(item => item.kind === "trainingSchedule"), importedWorkout = mutations.find(item => item.kind === "workout"), importedMeasurement = mutations.find(item => item.kind === "measurement");
  expect(importedRoutine?.id).not.toBe("routine-a");
  if (importedRoutine?.kind !== "routine" || importedSchedule?.kind !== "trainingSchedule" || importedWorkout?.kind !== "workout" || importedMeasurement?.kind !== "measurement") throw new Error("Missing imports");
  expect(importedRoutine.data.exercises[0].exerciseId).toBe(importedExercise?.id);
  expect(importedRoutine.data.exercises[0].sets[0].id).not.toBe("set");
  expect(importedSchedule.data.week).toEqual({ "1": importedRoutine.id }); expect(importedSchedule.data.rotation).toEqual([importedRoutine.id]);
  expect(importedWorkout.data.routineId).toBe(importedRoutine.id); expect(importedWorkout.data.eventId).toBeUndefined(); expect(importedWorkout.data.finishedAt).toBe(1000);
  expect(importedMeasurement.data.photoMediaIds).toEqual(["local-media-a"]);
});
test("reminders respect exact minute offsets and skip historical or completed events", () => {
  const now = 10_000_000; const reminder = personalRecordSchema.parse({ ...record(1), data: { ...event, startAt: now + 600000, endAt: now + 4200000, reminders: [10] } });
  expect(dueReminders([reminder], now)).toHaveLength(1); expect(dueReminders([reminder], now + 30001)).toHaveLength(0); expect(dueReminders([reminder], now - 1)).toHaveLength(0);
  const completed = personalRecordSchema.parse({ ...reminder, data: { ...reminder.data, status: "completed" } }); expect(dueReminders([completed], now)).toHaveLength(0);
});
test("rest timer derives from wall clock across reload and suspended tabs", () => { expect(remainingRestSeconds(100000, 70000)).toBe(30); expect(remainingRestSeconds(100000, 99999)).toBe(1); expect(remainingRestSeconds(100000, 200000)).toBe(0); expect(remainingRestSeconds(null, 200000)).toBe(0); });


test("all media owners share lossless remap and failed-file removal", () => {
  const workout = createMutation("workout", workoutDataSchema.parse({ title: "训练", startedAt: 10, finishedAt: 20, exercises: [], mediaIds: ["local-media-video", "keep"] }));
  const exercise = createMutation("exercise", { name: "动作", primaryMuscles: [], secondaryMuscles: [], equipment: [], instructions: [], category: "strength", mediaIds: ["local-media-video", "keep"] });
  const measurement = createMutation("measurement", { at: 10, photoMediaIds: ["local-media-video", "keep"], circumferences: {}, notes: "说明" });
  for (const mutation of [workout, exercise, measurement]) {
    const remapped = mapMutationMedia(mutation, id => id === "local-media-video" ? "remote-video" : id);
    expect(mutationMediaIds(remapped)).toEqual(["remote-video", "keep"]); expect(remapped.operationId).toBe(mutation.operationId);
    expect(mutationMediaIds(mapMutationMedia(remapped, id => id === "remote-video" ? null : id))).toEqual(["keep"]);
  }
  const equipment = remapImportedEquipment({ barWeights: { kg: { "custom-old": 20, builtin: 10 } }, dbLoad: { "custom-old": "each" }, loadKind: { "custom-old": "pairs" } }, new Map([["custom-old", "custom-new"]]));
  expect(equipment).toEqual({ barWeights: { kg: { "custom-new": 20, builtin: 10 }, lb: undefined }, dbLoad: { "custom-new": "each" }, loadKind: { "custom-new": "pairs" } });
});

test("atomic undo restores both halves and rejects a newer remote version before any writes", () => {
  const before = record(1), mutation = createMutation("event", { ...event, title: "修改后" }, { id: before.id, baseVersion: 1 });
  const added = createMutation("event", { ...event, title: "后半系列" }, { id: "new-series" });
  const current = personalRecordSchema.parse({ ...record(2), data: mutation.data });
  const newRecord = personalRecordSchema.parse({ ...record(1), id: added.id, data: added.data });
  const changes = [{ mutation, before, queuedAt: 10 }, { mutation: added, before: null, queuedAt: 10 }];
  const reverse = reverseCommittedChanges(changes, [current, newRecord]);
  expect(reverse).toHaveLength(2); expect(reverse[0]).toMatchObject({ id: before.id, baseVersion: 2, deleted: false, data: event });
  expect(reverse[1]).toMatchObject({ id: added.id, baseVersion: 1, deleted: true });
  expect(() => reverseCommittedChanges(changes, [record(3), newRecord])).toThrow("记录已有新的修改");
});

test("whole-series and month drag preserve all-day wall dates across DST and export correct ICS", () => {
  const zone = "America/New_York";
  const series = eventDataSchema.parse({ title: "每日安排", startAt: dateTimeInZone("2026-03-01", "00:00", zone), endAt: dateTimeInZone("2026-03-02", "00:00", zone), startDate: "2026-03-01", endDate: "2026-03-02", timeZone: zone, allDay: true, recurrence: { frequency: "daily", interval: 1, weekdays: [], count: 20, until: null } });
  const occurrence = expandEvent(series, dateTimeInZone("2026-03-08", "00:00", zone), dateTimeInZone("2026-03-09", "00:00", zone))[0];
  const changed = eventDataSchema.parse({ ...series, startDate: "2026-03-09", endDate: "2026-03-10", startAt: dateTimeInZone("2026-03-09", "00:00", zone), endAt: dateTimeInZone("2026-03-10", "00:00", zone) });
  const updated = updateEntireEventSeries(series, occurrence, changed);
  expect(localDateKey(updated.startAt, zone)).toBe("2026-03-02"); expect(updated.startDate).toBe("2026-03-02"); expect(updated.endDate).toBe("2026-03-03");
  expect(exportIcs([{ id: "series", data: updated }])).toContain("DTSTART;VALUE=DATE:20260302");
  const moved = rescheduleCalendarEvent(series, dateTimeInZone("2026-11-01", "00:00", zone), dateTimeInZone("2026-11-01", "00:00", zone) + 86400000);
  expect(moved.endAt - moved.startAt).toBe(25 * 3600000); expect(moved.endDate).toBe("2026-11-02");
});

test("reminders skip single completed exceptions and support a year of advance notice", () => {
  const zone = "Asia/Shanghai", now = dateTimeInZone("2026-01-01", "12:00", zone);
  const at = now + 365 * 86400000;
  const far = personalRecordSchema.parse({ ...record(1), data: { ...event, startAt: at, endAt: at + 3600000, reminders: [525600], timeZone: zone } });
  expect(dueReminders([far], now)).toHaveLength(1);
  const completed = personalRecordSchema.parse({ ...far, data: { ...far.data, exceptions: { [localDateKey(at, zone)]: { cancelled: false, status: "completed" } } } });
  expect(dueReminders([completed], now)).toHaveLength(0);
});
