# Deployment and operations

Veud is hosting-provider neutral. A production deployment needs Node.js 22,
PostgreSQL, HTTPS termination, persistent application storage, and a process
manager.

## Release build

Build from the exact reviewed `main` commit:

```sh
npm ci
npm run prisma:generate:postgres
npm run build
npm run bundle:check
```

Apply and verify PostgreSQL migrations before starting code that requires them:

```sh
npm run db:migrate:postgres
npm run db:verify:postgres
```

The application listens on `PORT` and exposes `/resources/healthcheck`.
Configure the HTTPS reverse proxy to reach that port and preserve the original
host, scheme, and client address using standard forwarded headers.

## Production process

The current host uses PM2:

```sh
npm run start:prod   # runs the preflight, then PM2 with the launcher
pm2 save             # persist, so a reboot cannot resurrect a stale definition
```

After a restart, verify the local and public health endpoints and confirm the
`x-veud-release` header matches the deployed commit.

`npm start` is **not** a production entry point and refuses to run against the
live database. Production must go through `ops/local-production/run-app.sh` so a
single supervised writer holds the catalog lifetime lock.

### Preflight

`npm run production:preflight` validates the setup before anything restarts: an
activated release that actually contains the launcher entry point, a production
datasource in both config files with parity between them, secrets long enough
for the startup validator, private config file modes, no in-progress cutover,
the supported Node runtime, and that PM2's saved definition still points at the
launcher. It reports only structure and secret lengths, never secret values.

### When a restart is not the fix

The launcher runs the RELEASE's own `scripts/pm2-entry.mjs`, so a release cut
before a launcher change cannot be started by the newer launcher no matter how
many times PM2 retries. The preflight reports this explicitly. The fix is to
deploy a current release with `ops/local-production/deploy-catalog-release.sh`,
not to restart.

A deployment already recreates and saves the PM2 definition itself: it deletes
`veud`, starts it from the new release's own `ecosystem.config.cjs`,
health-checks the release headers, and saves the process list. Do **not** run
`npm run start:prod` afterwards — that would start PM2 with the repository as
the working directory instead of the activated release, which is the same drift
the saved definition caused in the first place. The commands above are for
restarting an already-deployed release.

### Deploying over an outage

A deployment normally opens a maintenance window on a _running_ system, because
the state captured at entry is what a mid-deployment failure restores to. It
therefore refuses to start when the web process is not online.

That leaves one case needing an explicit escape: the activated release cannot
satisfy the launcher contract, so nothing can bring the web process online, and
the only tool able to replace that release is the one refusing to run. Confirm a
recovery deployment explicitly:

```sh
VEUD_PRODUCTION_RECOVERY_DEPLOY=RECOVER_VEUD_PRODUCTION \
  bash ops/local-production/deploy-catalog-release.sh
```

Every other gate still applies — the verified pre-mutation backup, writer
quiescence under the lifetime lock, the release health check, and the required
post-cutover backup. The only difference is that the window targets a running
web process instead of restoring the outage it started from.

`pm2 save` matters: PM2's saved process list is what a reboot resurrects, and a
definition saved before a launcher change will keep failing after the config is
corrected. If `pm2 list` shows repeated restarts, compare the saved definition
against `ecosystem.config.cjs` — `pm2 delete veud` then `npm run start:prod`
recreates it. The app is bounded to five restarts with a twenty-second minimum
uptime so a misconfiguration stops in `errored` state instead of flapping
silently.

Host-specific PostgreSQL provisioning, environment switching, catalog workers,
and status checks are documented in
[`ops/local-production`](../ops/local-production/README.md).

## Staging

Staging must have its own application secrets, database, restore database,
storage, hostname, and provider credentials. Never reuse production data for
browser tests or load tests.

The repository's isolated host implementation is documented in
[`ops/local-staging`](../ops/local-staging/README.md).

## Backups

`npm run db:backup` selects the correct SQLite or PostgreSQL path from
`DATABASE_URL`. Production PostgreSQL backups are retained only after a
custom-format archive restores successfully into the dedicated disposable
verification database.

Required production settings include:

- `POSTGRES_BACKUP_VERIFY_URL` for a database whose name clearly indicates
  restore or verification use;
- `BACKUP_OFFSITE_DIR` on an independently protected filesystem; and
- `BACKUP_VERIFY_USERNAME` for an expected account identity.

Useful commands:

```sh
npm run db:backup
npm run db:verify-backup
npm run production:postgres:status
```

Restore verification destroys and recreates the disposable database's public
schema. Never configure it with the application database URL.

Once PostgreSQL accepts user writes, an old SQLite snapshot is not a valid
rollback target. Use forward repair or a restore-verified PostgreSQL archive.

## Secrets and logs

Keep credentials in mode-restricted environment files outside the repository. Do
not print connection URLs or place secrets in command arguments, logs, commits,
issue reports, or policy reference fields.

Production logs must be rotated and retained according to available storage.
Health and status output must remain credential-free.
