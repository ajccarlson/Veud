# PostgreSQL catalog schema handoff

Last validated: 2026-07-20 against PostgreSQL 16

Veud now has a deployable PostgreSQL schema and migration baseline for the full
application, including the catalog. This is a staging/readiness boundary, not
authorization to point production at a new empty database or begin an unbounded
provider backfill.

## Why there are two schemas

Prisma 5 selects a datasource provider when its client is generated; the
provider cannot be changed by replacing only `DATABASE_URL` at runtime. Veud
therefore keeps:

- `prisma/schema.prisma` and `prisma/migrations` for local development and the
  isolated SQLite test suite; and
- `prisma/postgresql/schema.prisma` and `prisma/postgresql/migrations` for the
  production-scale deployment target.

The PostgreSQL schema is generated mechanically from the SQLite schema by
`scripts/sync-postgres-prisma-schema.mjs`. It changes the provider and adds only
the PostgreSQL catalog-search indexes. CI rejects model drift, deploys the
PostgreSQL migration history to PostgreSQL 16, compares the live database with
the datamodel, and runs application-level CRUD and search smoke checks.

Never edit the generated PostgreSQL model definitions directly. For a model
change:

1. update `prisma/schema.prisma` and add the normal SQLite migration;
2. run `npm run prisma:postgres:sync-schema`;
3. add an equivalent incremental migration under `prisma/postgresql/migrations`;
   and
4. run both provider validation paths before merging.

## Search indexes

The PostgreSQL baseline installs `pg_trgm` and creates GIN trigram indexes for:

- canonical `Media.title` substring searches;
- `Media.description` substring searches; and
- normalized canonical/alternate `MediaTitle.normalized` searches.

The existing provider popularity, score, release, status, identity, hydration,
and cursor indexes are represented in both schemas. Representative load testing
must measure the description index's storage/write cost as well as broad and
paginated search latency before the production hold is removed.

The remaining handwritten application SQL for user search now quotes mixed-case
identifiers, uses portable case-insensitive matching, and has a regression test
under SQLite plus a PostgreSQL smoke check.

## Commands

Keep the normal local/test client on SQLite:

```sh
npm run prisma:generate:sqlite
npm run test -- --run
```

Validate and generate the PostgreSQL client:

```sh
npm run prisma:postgres:check
npm run prisma:generate:postgres
```

With `DATABASE_URL` set to a PostgreSQL URL, prepare and verify a new empty
staging database:

```sh
npm run db:migrate:postgres
npm run db:verify:postgres
npm run db:smoke:postgres
```

`db:verify:postgres` requires the migration history to be current and reports a
failure if the live database differs from the generated datamodel.
`db:smoke:postgres` verifies `pg_trgm`, required catalog indexes, model writes,
normalized title matching, and the portable user query, then removes its test
records.

Generating one provider's client replaces the other provider's generated client
in `node_modules`. Regenerate SQLite before running the local Vitest suite and
generate PostgreSQL after dependency installation but before a PostgreSQL
production build.

## Cutover hold

The baseline migration is for a new empty PostgreSQL database. It does not copy
the current SQLite users, member history, media, or catalog records. Do not run
it as a substitute for a data migration.

Production cutover remains blocked until a following operations batch provides
and exercises all of these:

1. a consistent SQLite snapshot-to-PostgreSQL transfer with per-table counts,
   relationship/integrity checks, and an idempotent rehearsal;
2. PostgreSQL-native automated backups plus an independent restore drill;
3. representative catalog loading and concurrent search/hydration tests;
4. measured database/index size, import throughput, query latency, lock
   contention, backup time, and restore time; and
5. a rehearsed maintenance-window cutover and rollback procedure.

Until those gates pass, production remains on its current SQLite database and
provider-scale backfills remain disabled.

The existing `db:backup`/PM2 backup job now fails closed when `DATABASE_URL`
uses PostgreSQL. This prevents a leftover SQLite file from producing reassuring
but irrelevant backup-success messages; replace it with verified
PostgreSQL-native backup automation before cutover.
