# PostgreSQL catalog load readiness

Last rehearsed: 2026-07-20 with PostgreSQL 16

This runbook measures the PostgreSQL catalog schema with deterministic synthetic
records. It is safe to use only against an empty or disposable load-test
database. It does not fetch or persist provider content and does not replace the
final production-like staging rehearsal.

## Safety boundary

The load command is dry-run by default. Commit mode requires all of the
following:

- `DATABASE_URL` uses `postgresql://` or `postgres://`;
- the database name contains a `_`- or `-`-delimited `load`, `bench`, `perf`,
  `stag`, `stage`, `staging`, or `test` marker;
- the generated Prisma client targets PostgreSQL; and
- an existing synthetic run is absent unless `--resume` is supplied.

Synthetic records use the `load-catalog-` ID prefix. Cleanup deletes only media
with that prefix and relies on the schema's cascading relations. Never weaken
the database-name guard to point this command at production.

## Running the rehearsal

Prepare a dedicated PostgreSQL 16 database and apply the checked-in schema:

```sh
export DATABASE_URL='postgresql://.../veud_load_test'
npm run prisma:generate:postgres
npm run db:migrate:postgres
npm run db:verify:postgres
```

Preview the target and parameters without writing:

```sh
npm run db:loadtest:postgres -- --count 1564333
```

Then run the representative-size test. Keep the data initially so the database,
indexes, query plans, and JSON report can be inspected:

```sh
npm run db:loadtest:postgres -- \
  --commit \
  --count 1564333 \
  --require-trigram-indexes
```

The count matches the current combined TMDB and MAL inventory estimate in the
catalog coverage feasibility study. The command creates one canonical media, one
provider identity, one primary title, and an alternate title for every fourth
identity. It then runs `ANALYZE`, records `EXPLAIN (ANALYZE, BUFFERS)`
summaries, performs concurrent title searches and hydration-style updates, and
writes a credential-free mode-`0600` JSON report under `test-results/`.

An interrupted deterministic load can be continued with `--resume`. After the
report and database have been inspected, repeat with both `--resume` and
`--cleanup-after` to measure idempotence and delete the synthetic data:

```sh
npm run db:loadtest:postgres -- \
  --commit \
  --resume \
  --count 1564333 \
  --require-trigram-indexes \
  --cleanup-after
```

Use `--help` for batch, concurrency, and report-path controls. Restore the
normal development client afterward with `npm run prisma:generate:sqlite`.

## What is measured

The report includes:

- inserted, existing, and total synthetic identity counts;
- insert wall time and identity throughput;
- database and core catalog relation sizes before and after loading;
- planner node types, index names, execution time, and shared buffer activity
  for canonical title, alternate title, selective and broad description,
  no-match, and popularity-page reads; and
- wall time for concurrent searches plus small hydration-style update batches.

PostgreSQL may correctly prefer a sequential scan when a table is small or a
predicate matches much of it. For that reason, `--require-trigram-indexes`
checks that every catalog trigram index appears somewhere in the complete query
set, and should be used at representative scale rather than in the small CI
smoke run.

## Measured local rehearsal

The 2026-07-20 disposable PostgreSQL 16 rehearsal used 100,000 synthetic media
identities. It validated the harness and index gate, but represents only about
6.4% of the current 1,564,333-identity target.

| Check                             |                         Result |
| --------------------------------- | -----------------------------: |
| Inserted identities               |                        100,000 |
| Insert throughput                 | 9,012.15 identities per second |
| Database growth                   |                     156.66 MiB |
| Canonical title query             |                       6.492 ms |
| Alternate title query             |                       4.352 ms |
| Selective description query       |                       3.269 ms |
| Broad description query           |                      66.239 ms |
| No-match query                    |                       0.772 ms |
| Popularity page query             |                      17.249 ms |
| 20 searches plus 5 update batches |                      29.147 ms |
| Synthetic cleanup                 | 100,000 rows in 11.637 seconds |

The canonical-title, broad-description, and alternate-title/no-match plans
collectively used `Media_title_trgm_idx`, `Media_description_trgm_idx`, and
`MediaTitle_normalized_trgm_idx`. The selective description and popularity
queries used planner-chosen non-trigram paths; the index gate still passed over
the representative query set.

These values are local warm-cache observations, not service-level objectives.
Network latency, real title distributions, full related metadata, catalog
workers, member traffic, and production hardware can materially change them.

## CI boundary

CI loads and cleans up 2,000 identities after the PostgreSQL migration, drift,
and application smoke checks. That proves command safety, schema compatibility,
generation, measurement, report creation, and cascading cleanup. CI deliberately
does not enforce planner choices or performance thresholds on shared runners.

## Remaining cutover gates

Before PostgreSQL cutover approval:

1. Run the 1,564,333-identity test on production-like staging hardware and
   retain the report with the release evidence.
2. Agree on query, import, concurrency, backup, and restore budgets with the
   deployment owner; compare cold- and warm-cache results against them.
3. Repeat with representative alternate titles, descriptions, relationships,
   images, and member tracking data, then run inventory/hydration workers under
   interactive reads and writes.
4. Exercise interruption/resume, native backup/restore, locks, connection-pool
   saturation, disk headroom, monitoring, and one-process canary behavior.
5. Rehearse the final maintenance-window and rollback decision points in the
   [PostgreSQL operations runbook](postgresql-operations.md).
