# Personal tool completeness repair

This change repairs the existing local personal-data tool. The previous
`read kind=exercise` enumerated only synced custom records, leaving the built-in
fitness catalogue inaccessible to agents. Routine reads also lacked search and
continuation after the first 200 records. The existing V1 tool and system
instruction were present; missing operations and incomplete discovery were the
underlying problems.

## Operations

| User intent | Native tool call |
| --- | --- |
| Find a real exercise | `zeno_personal({action:"catalogue",query:"杠铃卧推",equipment:["杠铃"],muscles:["胸肌"]})` |
| Inspect its instructions and existing original demonstration | `zeno_personal({action:"catalogue",id:"0025"})` |
| Find a saved routine | `zeno_personal({action:"read",kind:"routine",query:"上肢"})` |
| Continue a result list | Repeat the same filters with the returned `nextOffset` as `offset` |
| Inspect record fields before editing | `zeno_personal({action:"read",kind:"routine",id:"<returned-record-id>"})` |
| Find the account's task targets | `zeno_personal({action:"read",kind:"task"})`; use `context.currentDeviceId` and its returned workspace/model IDs |
| Apply an explicit user request | `action:"write"`, complete schema-validated `data`, stable `operationId`, and the existing record's version as `baseVersion` |
| Offer a proactive or scheduled adjustment | `action:"propose"`; the proposal remains pending for user review |
| Undo a tool mutation | `action:"undo"` and the returned `undoId` |
| Read a workspace's execution-host path and effective folder settings | `openwork_query({id:"workspace.read",args:{workspaceId:"<actual-workspace-id>"}})` |

The catalogue contains 5,632 canonical built-in exercises plus the current
account's live custom exercises. Only 110 mapped exercises have existing original
demonstrations. Missing media returns `demo:null`; no restricted upstream media
is exposed. Routine and workout writes validate exercise references before
submission. Unknown, noncanonical, deleted, and other-account custom IDs are
rejected.

V1 and V2 advertise `personal.*` descriptors with the dedicated `zeno_personal`
executor. Those descriptors do not turn the generic read bridge into a write
endpoint. The trusted desktop profile and selected private discovery file are
carried into managed V2; connected profiles do not register this personal tool.
Personal writes retain account pinning, optimistic versions, idempotency,
foreground-window checks, feature guards and scheduled proposal restrictions.
Read access to existing personal history remains available when a feature is
disabled. Workspace metadata queries cover the workspaces registered on the
current authenticated backend connection; returning a path grants no additional
file access.
Task context is read from the existing account-scoped device endpoint and
strictly validated. It excludes credentials and carries explicit stale-heartbeat
and local-execution-confirmation markers. A real two-account API test writes a
task using returned IDs and rejects another account's device.

## Verification and delivery boundary

`domain-e2e.md` records the real API/SQLite and registered V1 tool integration,
including 501-record pagination and two-account isolation. Its cryptographic
storage adapter is a fixture, rather than an OS Keychain acceptance test.
`zeno-personal-engine-wiring.test.ts` separately checks V1/V2 registration and the
managed V2 child environment using an explicitly identified engine harness.
`zeno-workspace-access.test.ts` checks the shared workspace reader and actual V2
read bridge. `zeno-workspace-read-only.test.ts` uses a real backend to verify
that metadata reads neither bootstrap missing directories nor repair existing
command/configuration files, while retaining authentication and root checks.
Packaging gates require compiled Node catalogue exports and the
existing upstream license notices.

Final combined verification passed 28 tests and 393 assertions across the seven
integration/registration/workspace/image/context test files, with zero failures.
The full server build also passed after the instruction and discovery changes.
Native tool safety and ASAR checks passed 19 tests; the optional test requiring
an explicitly supplied shipping Electron binary was skipped. Desktop NodeNext
and fitness type checks passed. The release preflight now builds the Node
catalogue before native tests and runs the combined integration suite. Desktop
development and packaged builds prepare the same compiled dependency.

This repair does not claim that every UI-only import/export, media upload,
training timer or derived analysis now has a dedicated agent operation. It also
does not establish full model-driven OpenCode acceptance or an installed-client
upgrade. Version 1.1.3's published immutable artifacts are unchanged by these
source changes; a subsequent client build is required to deliver the repair.
