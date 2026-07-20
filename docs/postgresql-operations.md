# PostgreSQL transfer, backup, and restore operations

Last rehearsed: 2026-07-20 with PostgreSQL 16

This runbook covers the operational path from a verified SQLite snapshot to a
fresh PostgreSQL deployment and the PostgreSQL-native backup/restore boundary.
It does not remove the provider-scale load-test or final cutover approval gates.

## Prerequisites

- Apply and verify `prisma/postgresql/migrations` on a new PostgreSQL database.
- Generate the PostgreSQL Prisma client before a committed transfer.
- Install compatible `pg_dump`, `pg_restore`, and `psql` client binaries on the
  application/backup host. Override their paths with `PG_DUMP_BIN`,
  `PG_RESTORE_BIN`, and `PSQL_BIN` when needed.
- Provision a dedicated disposable restore database and set
  `POSTGRES_BACKUP_VERIFY_URL`. Its database name must contain `restore`,
  `verify`, or `drill`; every verification drops and recreates its `public`
  schema. It must never point at production.
- Use an independently protected `BACKUP_OFFSITE_DIR` for disaster recovery.

Connection passwords are passed to PostgreSQL tools through libpq environment
variables, not command arguments. Restrict process environments and backup files
to the service account as normal secrets and production data.

## Snapshot transfer

Take and verify an immutable SQLite snapshot while production is still on
SQLite:

```sh
npm run db:backup
npm run db:verify-backup -- backups/data-<timestamp>.db
```

Inventory the snapshot without connecting to PostgreSQL:

```sh
npm run db:transfer:postgres -- \
  --source backups/data-<timestamp>.db
```

Prepare the empty target, generate the provider-specific client, and transfer:

```sh
export DATABASE_URL='postgresql://...'
npm run prisma:generate:postgres
npm run db:migrate:postgres
npm run db:verify:postgres
npm run db:transfer:postgres -- \
  --source backups/data-<timestamp>.db \
  --commit
```

Commit mode refuses the configured live SQLite file and refuses a non-empty
PostgreSQL target. It validates SQLite integrity, foreign keys, and every
required SQLite migration; derives model order from Prisma relations; converts
SQLite booleans and millisecond dates; preserves blobs and decimals; transfers
self-referencing rows parent-first; and copies Prisma's implicit role/permission
join tables.

The transfer writes a mode-`0600` checkpoint beside the snapshot by default. It
contains the snapshot SHA-256, credential-free PostgreSQL target identity, table
progress, and completion state. After an interruption, repeat the exact snapshot
and target with `--resume`; the command refuses a mismatched checkpoint and uses
PostgreSQL conflict handling to avoid duplicate rows:

```sh
npm run db:transfer:postgres -- \
  --source backups/data-<timestamp>.db \
  --commit \
  --resume
```

Completion requires exact source/target counts for every Prisma model and both
implicit joins, with no unvalidated PostgreSQL foreign keys. Keep the checkpoint
with the cutover record.

## PostgreSQL backups

Provider-aware `db:backup` and the PM2 backup process dispatch to the PostgreSQL
path when `DATABASE_URL` uses `postgresql://`. A PostgreSQL backup succeeds only
after its custom-format archive is restored into the dedicated verification
database and passes:

- required PostgreSQL migration checks;
- core user, watchlist, entry, and media counts;
- foreign-key validation state;
- `pg_trgm` presence; and
- optional `BACKUP_VERIFY_USERNAME` identity validation.

Run and independently repeat the drill with:

```sh
export POSTGRES_BACKUP_VERIFY_URL='postgresql://.../veud_restore'
npm run db:backup
npm run db:verify-backup
```

Archives are named `postgres-<timestamp>.dump`; SQLite and PostgreSQL retention
patterns are separate. Offsite copies are written through a partial file and
must pass `pg_restore --list` before becoming visible.

## Measured rehearsal

The 2026-07-20 local rehearsal used a verified 24.68 MB SQLite snapshot and a
disposable PostgreSQL 16 instance:

| Check                                 |      Result |
| ------------------------------------- | ----------: |
| Canonical media transferred           |       5,372 |
| Entries transferred                   |       5,483 |
| Tracking states transferred           |       5,447 |
| Tracking progress rows transferred    |       4,446 |
| First transfer wall time              | 7.8 seconds |
| Idempotent resume inserts             |           0 |
| PostgreSQL archive size               |     6.34 MB |
| Backup plus full restore verification | 6.8 seconds |
| Standalone restore verification       | 6.0 seconds |

These figures validate correctness and operator flow only. They are not
provider-scale capacity evidence.

## Cutover and rollback rehearsal

Before the real maintenance window:

1. Repeat the complete process against a production-like staging snapshot.
2. Follow the [PostgreSQL catalog load runbook](postgresql-load-readiness.md) at
   representative volume and record transfer, index-build, search, hydration,
   backup, and restore behavior under concurrency.
3. Stop application writes; take and verify the final SQLite snapshot.
4. Transfer to a new empty PostgreSQL target and run migration, schema, smoke,
   count, backup, and restore verification.
5. Generate the PostgreSQL client, build once with the production environment,
   update `DATABASE_URL`, and start one canary application process.
6. Verify authentication, list reads/edits/reordering, search, profiles,
   activity, reviews, collections, notifications, and catalog workers before
   ending maintenance.

Keep the SQLite database immutable during the initial PostgreSQL observation
window. A rollback before PostgreSQL accepts new writes is an environment/client
switch back to that snapshot. Once PostgreSQL accepts writes, this repository
does not provide a PostgreSQL-to-SQLite reverse sync; rollback requires either
forward repair or a separately rehearsed change-capture/export plan. Do not
declare cutover reversible after opening writes without that plan.
