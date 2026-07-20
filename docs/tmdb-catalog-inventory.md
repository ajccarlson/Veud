# TMDB catalog inventory operations

Veud can stream TMDB's official daily movie and TV ID exports into canonical
`Media` identities without loading an export into memory. This is the inventory
stage only: it retains provider ID, original title, popularity, adult/video
flags, and title-search provenance. Detail hydration remains a separate job.

Official source:
[TMDB daily ID exports](https://developer.themoviedb.org/docs/daily-id-exports).

## Safety model

- The command is a dry-run unless `--commit` is explicit.
- Movie and TV jobs use separate cooperative leases, so two workers cannot
  advance the same cursor concurrently.
- Each committed batch upserts identities and advances its cursor in one
  transaction. A stopped job resumes from the last committed physical line.
- `--limit` creates a successful partial run and never reconciles missing IDs.
- Full reconciliation requires at least 1,000,000 unique movies or 150,000
  unique TV series by default, and the observed export must cover at least 90%
  of currently active identities.
- Reconciliation tombstones a missing provider identity; it does not delete
  canonical media or any user's tracking, diary, review, or collection data.
- A completed `--no-reconcile` run can be rerun later with reconciliation
  enabled. It reuses the completed scan and does not download it again.
- An export older than the durable cursor is rejected to prevent stale dumps
  from removing newer identities.

Before a committed run against an important database:

```sh
npm run db:backup
npx prisma migrate deploy
```

Do not run the million-record production catalog on SQLite. The feasibility
decision requires PostgreSQL and representative load testing before enabling the
full backlog in production.

## Usage

The default date is yesterday in UTC, which avoids requesting today's export
before TMDB has generated it.

Validate a bounded sample without touching the database:

```sh
npm run catalog:tmdb-inventory -- --kind movie --limit 1000
```

Commit a bounded first segment:

```sh
npm run catalog:tmdb-inventory -- \
  --kind movie \
  --date 2026-07-19 \
  --commit \
  --limit 10000
```

Resume that exact export by repeating its date. The new run starts after the
last committed line:

```sh
npm run catalog:tmdb-inventory -- \
  --kind movie \
  --date 2026-07-19 \
  --commit \
  --limit 10000
```

Run both official inventories to completion:

```sh
npm run catalog:tmdb-inventory -- --kind all --commit
```

Use an already downloaded gzip export for one kind:

```sh
npm run catalog:tmdb-inventory -- \
  --kind tv \
  --date 2026-07-19 \
  --source /secure/imports/tv_series_ids_07_19_2026.json.gz \
  --commit
```

`--source` accepts a local path or HTTPS URL and requires `--kind movie` or
`--kind tv`. Other operational controls are documented by:

```sh
npm run catalog:tmdb-inventory -- --help
```

## Failure and recovery

Malformed records, decompression/download failures, expired leases, suspicious
coverage, and database errors fail the current run and preserve its last durable
cursor. Correct the upstream or operational problem, then rerun the same kind
and export date. Never edit a cursor merely to bypass a reconciliation guard;
inspect why the observed inventory shrank first.

The durable `CatalogSyncRun` rows provide run status, absolute counts, errors,
heartbeats, and completion time. `CatalogSyncCursor` contains the current export
date, physical line, cumulative committed record count, stable scan start,
download-complete flag, reconciliation flag, and lease state.

The importer creates `inventory-original` title aliases. Later detail hydration
may replace provider title snapshots with richer localized and alternate-title
data while keeping the canonical identity stable.
