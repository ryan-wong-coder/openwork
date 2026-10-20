# Zeno account and data service

This independent service owns invited accounts, browser sessions, revocable
desktop credentials, private media and per-user data synchronization. It does
not import Den, start OpenCode, schedule AI, hold ModelHelm credentials or
forward model requests. AI schedules are data; the selected computer evaluates
them locally. A device heartbeat is presence, never proof a task executed.

## Local verification

Install through the repository's pnpm workspace, then:

```sh
pnpm --filter @zeno/api typecheck
pnpm --filter @zeno/api test
node packages/zeno-core/scripts/generate-contract.mjs --check
```

Tests create private disposable databases and use synthetic accounts. They do
not invoke models, production services or personal credentials.

## Deployment

Run Bun 1.3.14 with this workspace and its pinned lockfile. Use a dedicated
unprivileged service user; store the database/media/profile outside every
Nginx root, release bundle and download directory. Required private environment:

```text
ZENO_DATABASE_PATH=/var/lib/zeno-data/accounts.sqlite
ZENO_MEDIA_ROOT=/var/lib/zeno-data/media
ZENO_PUBLIC_ORIGIN=https://www.zeno.ryan-wong.cn
ZENO_AUTH_SECRET=<operator-generated random secret, at least 32 characters>
ZENO_API_PORT=8790
ZENO_OPERATOR_PROFILE=/var/lib/zeno-data/operator-profile.json
```

The server listens on loopback only. The schema initializer touches only this
new database, not the desktop runtime DB or Den. Keep the secret stable through
deployments and protect the environment file. Back up SQLite using its backup
API or a stopped service, together with private media; copying only the main
file of a live WAL database is not a safe backup. Test restoration privately.

The four registry flags default off. Explicit operator rollout, or immediate
rollback without deleting stored records:

```sh
pnpm --filter @zeno/api admin features set zenoAccounts true
pnpm --filter @zeno/api admin features set personalCalendar true
pnpm --filter @zeno/api admin features set fitnessTracking true
pnpm --filter @zeno/api admin features set localScheduledTasks true
```

Each request reads the strict profile and resolves through the shared feature
registry. Missing/invalid profiles fail closed. Disabling a domain rejects new
writes; authenticated sync/history and private media reads remain available.
Disabling accounts rejects new logins/invitations/device grants; existing
sessions retain read access and can sign out/revoke. There is no hidden env
switch that makes the registry default true.

Create the first administrator with `admin bootstrap --email EMAIL --name NAME`.
Its password is read from private stdin, never arguments. `admin invite --email
EMAIL --admin ADMIN_EMAIL` emits an email-bound, one-time invitation link.
`admin reset --email EMAIL --admin ADMIN_EMAIL` emits a one-hour password-reset
link. Neither sends mail; share links privately through an authorized channel.
Do not save those outputs into Git, QA evidence, public logs or shell history.
Reset redemption revokes all sessions, devices and pending approved grants.

Only after local tests and a private deployment check should the operator add
a narrow location to this vhost (preserve all release/download/update paths):

```nginx
location ^~ /api/zeno/v1/ {
    proxy_pass http://127.0.0.1:8790;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Origin $http_origin;
    client_max_body_size 52m;
    proxy_buffering off;
    add_header Cache-Control "no-store" always;
}
```

Do not expose openwork-server, its bootstrap token, filesystem, host routes or
engine mounts. `/health` is available on the private loopback listener; proxy
it only if an operator deliberately wants a public health check. The website's
static `/api/releases/` remains independent. The authenticated web UI is served
separately under `/app/`; device confirmation uses `/app/device?code=...`.

## HTTP contract

Prefix: `/api/zeno/v1`. Errors are JSON `{code,message}`; conflicts additionally
return `{current,submitted}`. All private responses are no-store. Web requests
use Better Auth's HttpOnly session cookie. Native requests use a revocable
`Bearer zdt_…` stored only in the desktop main process. Tokens are never URL
parameters and only their SHA-256 digests enter device tables.
Successful browser authentication responses omit bearer/session token fields;
the browser transports its session only through the HttpOnly cookie. Native
credentials are issued only through the separate one-time PKCE exchange.
Personal clients send `X-Zeno-Account` with their bound account ID. After
authentication, any mismatch returns `409 account_changed` before reading a
business payload or producing side effects. This also protects `/me`; public
sign-in/invitation endpoints do not assume a pre-existing account.

- `/auth/sign-in/email`, `/auth/get-session`, `/auth/sign-out` use Better Auth.
  Public signup and email-reset endpoints are refused server-side. Password
  change uses `/auth/change-password`; administrators cannot read business data.
- `POST /invites/redeem {token,email,name,password}` creates the account and
  consumes the invite in one SQLite transaction. `POST /password/reset
  {token,password}` atomically consumes an operator reset link.
- `GET /me` returns `{user:{id,email,name,role},deviceId}`. `GET /features`
  returns the four resolved feature booleans.
- `POST /devices/authorization {name,platform,codeChallenge}` uses S256 PKCE,
  returning `{deviceCode,userCode,verificationUri,verificationUriComplete,
  expiresAt,interval}`. Cookie-only `POST /devices/approve {userCode}` approves;
  `POST /devices/token {deviceCode,codeVerifier}` consumes once and returns
  `{deviceId,accessToken,tokenType,expiresAt}`. Device grants expire after 90 days.
- `GET /devices` returns `{devices:Device[]}`; `DELETE /devices/:id` revokes.
  Device-only `POST /devices/heartbeat {inventory}` accepts only shared
  workspaces/models/appliedCursor/windowOpen fields, never paths or secrets.
- `PUT|PATCH /records/:kind/:id` accepts shared `RecordMutation`; the actor
  supplies ownership. Success is `{record,previous,replayed}`. An operation ID
  cannot be reused with changed content. Repeated successful operations return
  the original receipt, including after later edits.
- `POST /records/batch {operationId,mutations}` returns `{results,replayed}`.
  Validation, authority, version checks, records, change cursors and receipts
  are transactional. A single conflict rolls everything back. Applying an AI
  proposal requires its exact proposed mutations in the same batch.
- `GET /sync?cursor=0&limit=500` returns `{records,cursor,hasMore}` including
  tombstones. Reads and every SQL mutation are scoped by the actor's user ID.
  There is no admin route for reading another person's records.
- Only the bound device may write runs or request progress. Browsers create
  pending requests or set their cancelRequested flag. The server performs no
  AI execution, command claiming, cloud scheduling or automatic device failover.
- `POST /media` accepts multipart `file`, returning `{id,name,mime,size,
  createdAt}`; only JPEG/PNG/WebP/GIF (10 MiB) and MP4/WebM (50 MiB), with signature
  checks. `GET|HEAD /media/:id` is owner-authenticated, supports a single byte
  range and rejects active HTML/SVG. `DELETE /media/:id` is owner-only. Files
  have opaque generated paths and never live under a public static root.
- Admin browser-only `/admin/users` and `/admin/devices` return account/device
  management metadata. `POST /admin/invites` and `/admin/password-resets` accept
  `{email}` and return `{email,expiresAt,url}`; `DELETE /admin/devices/:id`
  revokes a credential. `GET /admin/invites` returns invitation metadata without
  tokens/hashes; `DELETE /admin/invites/:id` revokes an unused invitation.
  `GET /admin/features` returns the four resolved flags; `PUT /admin/features
  {key,enabled}` atomically updates the same private operator profile as the
  CLI. Only the four declared keys are accepted. Existing administrator browser
  sessions can undo a rollout even if new account sign-in is disabled. Device
  credentials cannot administer accounts.

## Independent generated contract

`contract/openapi.json` and `packages/zeno-core/src/gen/**` are generated together
from the dispatcher's shared route paths and current `@zeno/core` Zod schemas:

```sh
node packages/zeno-core/scripts/generate-contract.mjs
node packages/zeno-core/scripts/generate-contract.mjs --check
```

The generator borrows the already pinned Hey API 0.97.3 and formatter from the
SDK workspace. It creates `ZenoClient` with same-origin relative API paths, no
official service default, and includes private multipart media, Cookie/Bearer
auth, account fences and atomic conflict responses. The hand-written
`ZenoApiClient` remains the runtime-validating transport/native wrapper. Check
mode regenerates into disposable temporary files and compares both snapshots;
it never starts MySQL, Den, a database, a network service or an AI request.

## Acceptance limits

Local tests do not prove a live installation, HTTPS cookie behavior on the
public domain, mobile delivery, media backup restoration, or a packaged
desktop's credential storage and actual local AI execution. Those require the
separate release/deployment and native acceptance records. This service's
tests deliberately deny outbound fetches rather than calling a real model.
