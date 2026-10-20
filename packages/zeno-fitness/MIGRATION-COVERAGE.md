# Fitness migration coverage

The reference is openGym **v1.4.1**, fixed commit
[`464355ef43d4c8f8a4e0bb6db9c2af7f240593b5`](https://github.com/DuarteSantos8/openGym/tree/464355ef43d4c8f8a4e0bb6db9c2af7f240593b5),
not a moving upstream branch. This table maps the selected web fitness baseline into Zeno's
own pages, account records and domain functions. It does not assert identical screens,
implementation, every gesture or native platform integration.

## Visible feature and data map

| User entry in Zeno | Domain / preserved source | Own data and API boundary |
| --- | --- | --- |
| 健身 → 动作库: Chinese/English lookup, muscle/equipment filters, instructions when present | `catalogue.ts`; fixed exercise text, alias and Chinese-language tables | 5,632 canonical exercises, 922 aliases; 1,324 have Chinese steps. Remaining instructions are empty. No remote catalogue request. |
| 动作库 → 自定义动作: create, edit, delete, own image/GIF/video | `FitnessExercise`, account-local muscle snapshots; `backup.ts` media references | Versioned `exercise` records; authenticated media upload/read. Past workout snapshots remain after an exercise is deleted. |
| 健身 → 计划: create/edit/copy/delete, four starter plans, share | `plans.ts`, `upstream/lib/starter.js`, routine adapters | Versioned `routine` records; share JSON contains selected plans, not history or credentials. |
| 计划 → 训练安排: weekly/rotation, rest weekdays, time, independent deload anchor | `scheduledRoutineId`, `advanceRotation`, `scheduledDeload`; core `projectTrainingSchedule` | `trainingSchedule` plus calendar overrides/workout links. Completing a rotation does not reset the deload epoch. |
| 计划编辑: linear/Greyskull/double/triple/time progression, per-exercise override, exclusion | `calculateNextPrescription`, preserved `progression.js` with the two documented local overrides | Own routine/exercise progression and prescription/plan snapshots. Progression deload accepts 5–50%, matching the actual source kernel. |
| 计划/训练组: warm-up, left/right, drop sets, rest-pause, failure, RIR/RPE, incline, speed/distance/duration, pyramid/backoff | `upstream-adapter.ts`, preserved workout/progression/pyramid/backoff kernels | Typed `TrainingSet` and `RoutineExercise` fields; advanced sub-sets survive own JSON/ZIP and session operations. |
| 今日 → 开始/自由训练: prescription prefill, completed sets, rest timer, optional screen wake lock | `startTrainingWorkout`, `toggleTrainingSet`, `finishTrainingWorkout`; source session start/finish logic | An active `workout` record autosaves and syncs. Body-weight snapshot only uses measurements at or before the actual start. Browser wake-lock denial is harmless. |
| Training exercise menu: replace, move, end an exercise | `swapTrainingExercise` uses source `active-exercise-swap.js`; `moveTrainingExercise` uses whole-supergroup ordering | Logged results retain the old exercise identity. Logged/grouped replacement requires explicit confirmation; group membership is chosen. Removing unfinished work preserves completed set IDs. |
| 今日 → 组合训练 / 补录训练 | `startCombinedTrainingWorkout`, `startBackfillWorkout`, source session merge and `historyAsOf` | Combined owner IDs and unit conversion retained. Backfill computes from preceding history, excludes a replaced session and uses entered duration. |
| 记录 → 再练一次 / 存为训练计划 / 编辑 | `repeatTrainingWorkout`, `routineFromWorkout`, gap-aware finish, `finishBackfillWorkout` | Existing history is not silently rewritten by repeat/save-as-plan. Editing is a versioned write; statistics derive from the resulting records. |
| 今日状态 / 过往备注 | Typed day notes and source `withDayNote` | Settings retain dated tag/text/timestamp, including clear tombstones. Future day creation is rejected. |
| 计划 → 我的器械 | `FitnessContextOptions`, `exercisePlateLoad`, source plates/bar/dumbbell kernels | Settings retain per-unit plates, owned dumbbells, bar overrides, each/total dumbbell meaning and paired/single load policy. |
| 统计: sessions, sets, volume, duration, trend, PR / 1RM formulas, heatmap, recovery, structural balance | `deriveTrainingStats`, `estimate1RM`, `deriveRecovery`, `deriveStructuralBalance`, `heatmapDays`; preserved numerical kernels | Computed locally from own records and selected time zone. Actual Ant Design Charts trend; no hosted statistics service. Recovery is an estimate, not a medical measurement. |
| 记录 → 身体: weight/body fat/circumferences/goals, dated photos and comparison | `body.ts`, `measurementSeries`, `deriveBodyTrends` | `measurement` records and authenticated photo media. Photo comparison uses two selected recorded dates and their original private uploads. |
| 记录 → 会员卡 | `membership.ts` payload/expiry helpers; host QR/barcode renderers | `membership` record; its value is not transformed into an upstream account or membership network request. |
| 导入与导出: CSV, Apple Health weight XML, shared plan, openGym JSON/original media ZIP, own JSON/ZIP | `imports.ts`, preserved CSV/Hevy parsing kernels, `parseOpenGymBackup`, `importOpenGymBackupZip`, own strict archive helpers | Import is reviewed and appended as independent copies with remapped record/media relations; existing records are not overwritten. File parsers perform no network request. |
| 完整备份 | `createFitnessBackup`, `fitnessBackupMediaIds`, `exportFitnessBackupZip`, `importFitnessBackupZip` | Own archive includes custom/workout/body media, equipment and day notes. Every declared media file is size/type/SHA-256 checked; server independently checks upload signatures. |
| 计划 → 打印或存为 PDF; history → FIT; CSV export | `planPdfData`, source Garmin FIT binary and CSV kernels | Print uses a separate same-origin document containing only the plan. It includes advanced sub-sets, RIR/RPE, incline and materialized pyramid values. The browser decides actual printing/PDF saving. |
| 日历 projection and mobile/offline use | `@zeno/core` calendar/time-zone helpers plus Zeno sync store | The same `event`, `trainingSchedule` and `workout` records synchronize through `/api/zeno/v1`. Real optimistic versions, batch transactions, conflict review and append-only undo replace upstream whole-document sync. |
| 健身助理 / 任务 / 问泽诺 | Zeno proposal and local-computer execution interfaces, not openGym's hosted Coach | Account data syncs through the own server. Executions belong to an explicitly paired computer; scheduled AI creates proposals for review. Domain tests make no model calls. Separate native/AI reports describe their own scope. |

All record persistence uses authenticated `/api/zeno/v1/records/<kind>/<id>` or the atomic
`/records/batch` route. Sync uses `/sync`; media uses authenticated `/media` routes. There is
no second openGym store, database, account session, credential or remote Coach inside the
fitness library. Display preferences (time zone, kg/lb), equipment and day notes use Zeno
settings records. Existing loaded routine values are physically converted when their unit
changes; changing the default unit does not reinterpret recorded history.

## Explicit scope differences

- **Catalogue artwork is excluded.** No restricted upstream exercise photo, GIF, clip or
  video is bundled, fetched, referenced by media filename or generated as an imitation.
  Users may upload their own media. The local body-map geometry retains its separate MIT
  notice; the generic category SVG is an original diagram, not a movement demonstration.
- **Mobile is the Zeno PWA.** This migration does not include upstream's Android Capacitor
  application, Android Health Connect platform bridge, app-store distribution or a new
  native iOS client. Apple Health support here means importing weight XML files.
- **Hevy API helpers are parsers.** Hevy JSON and CSV data can be parsed; a direct Hevy
  authenticated network client and background imports are outside the selected scope.
- **Authentication is Zeno's own invited account and paired-computer system.** Upstream
  passkeys, password QR flows, Coach/provider credential storage, hosted API and read-only
  MCP service are not embedded. Native secret storage and proposal tools have separate
  tests and are not proven by a browser run.
- **Interactions follow Zeno.** The Chinese pages, native dialogs, explicit confirmation,
  date controls and menus replace upstream's exact visual layout, flash/swipe interactions
  and localization selector. Optional wake lock depends on browser availability. This is
  not a pixel or gesture parity claim.
- **Media limits follow Zeno:** images/GIF 10 MiB, MP4/WebM 50 MiB. Legacy QuickTime main
  bytes can be relabelled MP4 without transcoding; playback remains browser-dependent.
  Missing/damaged/over-limit legacy ZIP files are omitted with review warnings. Derived
  posters and remote links are not fetched. JSON alone cannot restore absent media bytes.
- **Backups are fitness backups, not entire-account restores.** They omit cookies, tokens,
  devices, passwords, calendar/task records and executors. Import appends copies; it is not
  disaster recovery for the complete server. No actual mobile background push delivery is
  claimed; page/browser/native reminders have their respective runtime constraints.

## Verification and limits

`verification.json` and the package README record strict facade/test type checks and the
preserved source plus integration cases. Upstream numerical/CSV cases are retained with
runner/import-path adaptations and source hashes. Own cases exercise unit/time-zone/DST
boundaries, advanced sets, body-weight snapshots, progression/deload, owned equipment,
session operations, custom/deleted snapshots, imports and original-byte media archives.
No test installs or executes external upstream application code.

The reproducible browser fixture uses the **production PWA bundle**, real local Bun API,
temporary SQLite/media data, synthetic accounts and owned headless Chrome. It extracts the
exact HTML/canvas policies from the deployment's nginx configuration and records enforced
CSP violations. The authoritative result and screenshot hashes are in
[`pwa-browser-report.json`](../../docs/evidence/zeno-1.1.0/pwa-browser-report.json) and the
method is documented in [`pwa-browser.md`](../../docs/evidence/zeno-1.1.0/pwa-browser.md).
Only entries explicitly listed in that report were exercised through the actual browser;
other domain paths have the numerical/integration coverage described above.

The plan-print browser check inspects the actual separate print document and its applied
style under production CSP. It **does not save or visually inspect a PDF**, and must not be
reported as a completed PDF export. Browser evidence also does not prove a packaged native
upgrade, OS keychain integration, installed-mobile offline behavior, public HTTPS deployment
or actual AI reasoning. Those require their own explicitly identified reports.

Primary source references: [fixed upstream README](https://github.com/DuarteSantos8/openGym/blob/464355ef43d4c8f8a4e0bb6db9c2af7f240593b5/README.md),
[progression](https://github.com/DuarteSantos8/openGym/blob/464355ef43d4c8f8a4e0bb6db9c2af7f240593b5/frontend/src/lib/progression.js),
[active replacement](https://github.com/DuarteSantos8/openGym/blob/464355ef43d4c8f8a4e0bb6db9c2af7f240593b5/frontend/src/lib/active-exercise-swap.js),
[media backup format](https://github.com/DuarteSantos8/openGym/blob/464355ef43d4c8f8a4e0bb6db9c2af7f240593b5/frontend/src/lib/backup-media.js).
The fixed license and source notices in this package are facts of the imported sources;
this document makes no legal guarantee about downstream distribution.
