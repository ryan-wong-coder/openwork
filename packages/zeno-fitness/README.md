# Zeno fitness domain

Native fitness data and algorithms for Zeno. Public types are aliases of `@zeno/core/schema`;
there is no second persistence format, account, Coach credential, remote service or UI store.
The library performs no network requests. It never installs software, writes user data or
automatically applies imported data.

## Source and media boundary

Text sources are fixed to openGym **v1.4.1**, commit
[`464355ef43d4c8f8a4e0bb6db9c2af7f240593b5`](https://github.com/DuarteSantos8/openGym/tree/464355ef43d4c8f8a4e0bb6db9c2af7f240593b5).
`upstream-manifest.json` records each original SHA-256 and local SHA-256. `LICENSE` and
`UPSTREAM-NOTICE.md` retain the original code/data and attribution notices.

- 5,632 canonical exercises and 922 drawing aliases; all canonical names have Chinese text.
- Exactly 1,324 exercises have upstream Chinese step instructions. Other `instructions` are
  empty and must not be presented as complete translated coaching instructions.
- No Gym visual still, animation, video or other exercise artwork is included. Generated
  exercise metadata has its image/clip filenames removed. The preserved internal media helper
  functions are not public library APIs and must not be used to fetch upstream artwork.
- The `geometry` entry contains the separately MIT-licensed MuscleMap-derived body geometry.
  `exerciseCategorySvg` is an original generic geometric category icon, not a depiction of a
  particular exercise or a replacement exercise video.

The fixed upstream source is AGPL code with distinct notices for some text and geometry.
Gym visual media has separate restrictions and is excluded. These are source facts, not a
legal guarantee about a downstream distribution.

## Public APIs

| Area | Exports |
| --- | --- |
| Catalogue | `fitnessExercises`, `findExercise`, `canonicalExerciseId`, `searchExercises`, filter options, `catalogueCoverage` |
| Running workout | `startTrainingWorkout`, combined/repeat/backfill sessions, safe active exercise swaps and group reorder, `toggleTrainingSet`, `finishTrainingWorkout`, `addTrainingSet`, unit conversion |
| Progression | `calculateNextPrescription`, `estimate1RM`, rounding and deload helpers |
| Statistics | `deriveTrainingStats`, `deriveExerciseRecords`, `deriveRecovery`, `deriveStructuralBalance`, `heatmapDays` |
| Plans | `scheduledRoutineId`, `advanceRotation`, independent scheduled deload, `routineFromWorkout`, starter plans, share/print data |
| Measurements | `measurementSeries`, `deriveBodyTrends`, `measurementFields` |
| Imports | `parseFitnessCsv`, `parseAppleHealthWeight`, `parseHevyWorkouts`, `parseHevyRoutines`, `parseHevyBodyweight`, merge helper |
| Backups | strict JSON backup, openGym JSON/original stored ZIP migration, own stored ZIP with declared-media SHA-256 checks |
| Export | workout CSV, Garmin FIT binary and filename; declarative plan PDF/print data |
| Membership | exact QR payload and expiry projection; the host's QR/barcode renderer handles drawing |
| Art | local SVG body map and generic category illustration |

`calculateNextPrescription` accepts `{routine,routineId?,exercise,workouts,measurements?}`.
Workouts in history include a record `id`. All own-data timestamps are epoch milliseconds;
weight units follow each workout; summary weights and volumes are normalized to kg.
Warm-ups do not contribute work volume or 1RM records. Drop volume is included once and
rest-pause bursts are not double-counted. Adjacent left/right rows are adapted to the upstream
paired-side representation. Started sessions retain their prescription and original plan
snapshots, including triple progression's per-row targets.
`convertRoutineUnit(routine, unit)` converts weights, drop/pyramid loads, weight increments and
prescription snapshots together. Timed progression increments remain seconds; the source plan
is unchanged.

`startTrainingWorkout(routine, {customExercises?, ...options})` saves per-exercise muscle
snapshots. `deriveTrainingStats(workouts, {timeZone?,customExercises?,...filters})`,
`deriveRecovery(workouts, {customExercises?,...options})`, and
`heatmapDays(workouts, from, count, {timeZone?,customExercises?})` accept account-local custom
metadata without registering it in a global exercise index. Historical snapshots remain usable
after a custom exercise is deleted. Statistics default to the host's local time zone; callers
can supply the calendar's IANA time zone. A timezone changes daily buckets, not recorded epochs.

Importers return data for a review step; they do not save or replace anything. Hevy helpers
parse already-fetched JSON only: the host owns authentication and its network boundary.
Legacy weekly plans with several routines on a weekday become several native schedule lanes.
Legacy floating queue progress is projected into a native rotation; native calendar exception
records and reminders remain the core/application layer's responsibility.
`scheduledRoutineId` respects explicit anchors and rest weekdays; full calendar projections and
exception persistence use `@zeno/core`'s `projectTrainingSchedule`.

`startCombinedTrainingWorkout`, `repeatTrainingWorkout`, `routineFromWorkout`, and the backfill
helpers preserve plan ownership and advanced-set prescriptions. A workout snapshots only a
body-weight measurement at or before its actual start. Completed-set timestamps cap a forgotten
session at its actual end; backfills retain the explicitly entered duration. `FitnessContextOptions`
passes account-local equipment and day notes into the source kernel. Rotation anchors and
`deloadAnchorDate` are independent, so completing a rotation cannot reset its deload cycle.
Progression deloads accept 5–50%, matching the source kernel; schedule deloads accept 0–100%.

Backups use `zeno-fitness` version 1, not the complete Zeno account backup format. ZIP archives
are the upstream store-only format (no compression/ZIP64/encryption). Imports reject undeclared,
duplicate or traversal paths and check media size/type declarations and SHA-256. Parsing does
not authorize, upload or restore the returned media; the host must use its normal media import
and reference-mapping flow. A JSON-only openGym import cannot recover absent photo/video bytes.
`importOpenGymBackupZip` reads the original `opengym-backup.json` / `media/<sha256>.<ext>`
layout and maps verified original main-file bytes to own media IDs for custom exercises and
workout history. Missing, damaged or over-limit files produce review warnings and their
references are omitted; remote links and derived posters are never fetched. QuickTime container
files map to MP4 MIME without transcoding; actual playback compatibility remains browser-specific.
Own backups retain workout/custom media references, equipment overrides and dated day notes.
ZIP media uses the shared core limits: images 10 MiB, MP4/WebM video 50 MiB. Archive validation
does not decode media; the server independently validates file signatures during upload.
`planPdfData` returns escaped-by-the-host print data, not a PDF binary or an automatically opened
print window.

## Preserved algorithms and local changes

The JavaScript kernel is deliberately preserved instead of reimplementing complex progression,
history, import and recovery behavior. Typed TypeScript adapters accept `unknown` at those
boundaries and normalize the outputs; the kernel itself is not claimed to have been rewritten
as TypeScript. `onerm.d.ts` and `backfill.d.ts` correct default-null parameter inference.

Two source files have deterministic local changes:

1. `exercises-data.js`: remove restricted-media filename fields from text metadata.
2. `progression.js`: accept validated own-data `stallLimit`; use the configured deload factor
   for the existing linear/timed paths. Calls without overrides retain upstream defaults.

`scripts/sync-upstream.py` retrieves an allowlisted code/JSON dependency closure through
GitHub's official API and applies those two transformations. It refuses external imports and
media paths; it does not clone or execute upstream code. Test copies retain source hashes in
`test/fixtures/upstream-test-manifest.json` and change only the test runner/import paths.

## Verification

Run from the repository root after the normal workspace install:

```sh
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec tsc -p packages/zeno-fitness/tsconfig.json --noEmit
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec tsc -p packages/zeno-fitness/tsconfig.test.json --noEmit
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm exec bun test packages/zeno-fitness/test
```

The suite contains complete upstream 1RM, progression and CSV tests plus own-data integration
fixtures for Chinese lookup, native record validation, custom deload/stall settings, warm-ups,
advanced-set volume, timed and triple snapshots, unit conversion, recovery decay, import
dialects, strict backup round trips, corrupted media, templates, print data, FIT and schedules,
timezone/DST day buckets and account-local or deleted custom-exercise snapshots.
No GUI, real account, credential, external model or network request is used by these tests.

At the recorded verification run, all **240 tests / 2,605 assertions** passed (198 preserved
upstream cases and 42 integration cases), together with strict source and test type checks.
The separate native fixtures also passed **30 tests** with the actual native service/tool
modules, synthetic fetch responses, temporary account directories and an AES-GCM mock of
Electron safeStorage:

```sh
node --test apps/desktop/test/zeno-personal.test.mjs apps/desktop/test/zeno-personal-tools.test.mjs
```

Those fixtures cover PKCE, credential encryption boundaries, lifecycle cancellation, account
binding, stale pagination/queued writes, optimistic conflicts, scheduled proposal-only tools
and append-only undo. They do not prove OS keychain integration, packaged UI, an online account
or a real AI execution. `verification.json` records their precise test scope.
