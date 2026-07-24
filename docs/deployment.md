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
npm run start:prod
pm2 save
```

After a restart, verify the local and public health endpoints and confirm the
`x-veud-release` header matches the deployed commit.

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
