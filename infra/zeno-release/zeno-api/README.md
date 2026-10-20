# Independent account/data deployment

This is an operator recipe, not evidence of a live installation. The service
never runs AI, stores ModelHelm keys or exposes desktop host routes. Existing
website, release JSON, immutable downloads and updater feeds are retained.

1. Build the frozen checkout with pnpm: shared core/features followed by
   `pnpm --filter @zeno/api build` and the independent `/app/` web build.
   Run the API tests/typecheck before copying anything to the server.
2. Put API bundle files in `/opt/zeno-data/releases/<commit>/apps/zeno-api/dist`
   and static `apps/app/dist-personal/` in a NEW
   `/srv/zeno/personal-releases/<commit>/`. Preserve previous directories.
   Never place databases, environment files or uploads in either public tree.
3. Create the dedicated system user `zeno-data`, private state directory
   `/var/lib/zeno-data` (0700) and private environment directory `/etc/zeno-data`.
   Install the pinned Bun 1.3.14 Linux x64 binary at
   `/opt/zeno-data/runtime/bun-1.3.14/bin/bun`, verifying the official release
   archive checksum first. Do not replace a host-wide runtime. The root-owned
   `/etc/zeno-data/service.env` must be 0600 and contains the variables documented
   in `apps/zeno-api/README.md`. Generate the auth secret privately; never send it
   to build logs, GitHub or verification evidence.
4. Before enabling the public routes, run the candidate on a separate private
   port with a disposable DB/media root/profile. Execute
   `node infra/zeno-release/zeno-api/smoke.mjs http://127.0.0.1:PRIVATE_PORT/`.
   Its loopback restriction prevents accidentally mutating a public service.
   It performs only reads and requests guaranteed-disabled signup/engine paths;
   invitation, owner isolation, reset, PKCE and conflict behavior are covered by
   the synthetic API suite. Stop the private candidate and discard only its
   explicitly created test state.
5. Bootstrap the initial admin via the bundled `dist/admin.js` using private
   stdin for its password. Use that CLI to enable the four operator flags
   deliberately. Invite/reset links are operator outputs shared privately,
   not public evidence. Existing data is not deleted when flags are disabled.
6. Create `/opt/zeno-data/current` and `/srv/zeno/personal-current` with temporary
   symlinks followed by atomic rename. Install the provided systemd unit and
   include `nginx-locations.conf` only inside the existing Zeno HTTPS vhost.
   Review actual paths and `systemd-analyze verify`; run `nginx -t` before
   reloading. Do not replace another vhost or change `/srv/zeno/release-current`.
7. Start the service, verify private health, then perform public HTTPS cookie,
   invitation/PKCE, device revocation, mobile sync and media ownership acceptance
   with dedicated synthetic accounts. Keep credentials and personal media out
   of screenshots/reports. Independently verify all old download/update paths.

The systemd unit restricts writes to private state and permits only loopback
network traffic (`IPAddressDeny=any`, `IPAddressAllow=localhost`). Verify those
controls on the actual host; an unsupported systemd/kernel security directive
does not prove egress was blocked. No auth provider, SMTP or model network
access is required. Nginx must overwrite X-Real-IP/X-Forwarded-For. The API
listener remains loopback and cannot be used as a public single-user engine.

Rollback changes only code/static symlinks and reloads their services. Preserve
SQLite/media/profile; never roll the database back with an old website bundle.
For schema changes beyond version 1, use explicit forward/backward compatibility
checks and a private database backup/restore gate before deployment.

Include `backup.py` in the candidate's `infra/zeno-release/zeno-api/` directory
and install the supplied backup service and timer in `/etc/systemd/system/`.
The daily timer writes private snapshots
under `/var/lib/zeno-data/backups/`: a consistent SQLite backup, referenced
media, and a checksum manifest. It does not copy the running WAL database as
ordinary files. Verify `backup.test.py` and restore a snapshot into a disposable
private directory before enabling the timer. Keep the auth secret and operator
profile separately in an operator-controlled private backup; neither belongs in
the public site or release assets.

`smoke.mjs` confirms a private listener, not public TLS, secure-cookie behavior,
PWA installation/offline behavior, systemd sandbox enforcement, backups or local
desktop execution. Those require separate acceptance evidence.
