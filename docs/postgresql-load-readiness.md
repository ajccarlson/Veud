# PostgreSQL catalog load readiness

Last rehearsed: 2026-07-20 with PostgreSQL 16

This runbook measures the PostgreSQL catalog and member-facing schema with
deterministic synthetic records. It is safe to use only against an empty or
disposable load-test database. It does not fetch or persist provider content and
does not replace the final production-like staging rehearsal.

## Safety boundary

The load command is dry-run by default. Commit mode requires all of the
following:

- `DATABASE_URL` uses `postgresql://` or `postgres://`;
- the database name contains a `_`- or `-`-delimited `load`, `bench`, `perf`,
  `stag`, `stage`, `staging`, or `test` marker;
- the generated Prisma client targets PostgreSQL; and
- an existing synthetic run is absent unless `--resume` is supplied.

Synthetic records use the `load-catalog-` ID prefix. Cleanup deletes only
members and media with that prefix, then removes only temporary list types that
the harness itself inserted; schema cascades remove their dependent rows. Exact
post-cleanup counts should be zero for all three prefixes. Never weaken the
database-name guard to point this command at production.

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

Then run the representative-size test. Use stable private report/checkpoint
paths so the same configuration can be resumed. The first command deliberately
exits nonzero after two complete media batches; this is the expected rehearsal
result, not a pass:

```sh
npm run db:loadtest:postgres -- \
  --commit \
  --count 1564333 \
  --member-count 1000 \
  --tracking-per-member 100 \
  --activity-per-member 20 \
  --member-read-iterations 20 \
  --tracking-write-batches 5 \
  --checkpoint test-results/postgres-load-staging.checkpoint.json \
  --report test-results/postgres-load-staging.json \
  --interrupt-after-batches 2
```

Confirm that the checkpoint reports `status: "interrupted"` and that its
`loadedRows` exist in PostgreSQL. Resume with the identical data-shape settings;
the harness rejects a changed target, count, or member shape. This command
finishes the measurements and can clean the synthetic rows after writing both
artifacts:

```sh
npm run db:loadtest:postgres -- \
  --commit \
  --resume \
  --count 1564333 \
  --member-count 1000 \
  --tracking-per-member 100 \
  --activity-per-member 20 \
  --member-read-iterations 20 \
  --tracking-write-batches 5 \
  --checkpoint test-results/postgres-load-staging.checkpoint.json \
  --report test-results/postgres-load-staging.json \
  --require-trigram-indexes \
  --cleanup-after
```

The media count matches the current combined TMDB and MAL inventory estimate in
the catalog coverage feasibility study. The member values above are illustrative
floors, not approved production distributions; replace them with a shape agreed
by the deployment owner. The command creates rich canonical metadata, one
provider identity, one primary title, an alternate title for every fourth
identity, a relation for every tenth identity, and a feed item for every
hundredth identity. When `--member-count` is positive, it also creates three
compatible watchlists per member plus deterministic tracking states, legacy
entries, and activity history. Synthetic images use the non-routable
`synthetic.invalid` domain and no provider content is fetched.

The harness then runs `ANALYZE`, records each `EXPLAIN (ANALYZE, BUFFERS)`
summary sequentially so the individual query budgets are not distorted by the
separate concurrency test, performs concurrent catalog/profile reads and
hydration/tracking writes, samples `pg_stat_activity` and waiting locks while
that work is active, and writes credential-free mode-`0600` report/checkpoint
JSON under `test-results/`.

Use `--help` for batch, concurrency, and report-path controls. Restore the
normal development client afterward with `npm run prisma:generate:sqlite`.

## What is measured

The report includes:

- inserted, existing, and total synthetic identity counts;
- exact relation, feed, member, watchlist, tracking, entry, and activity counts;
- insert wall time and identity throughput;
- database, catalog, relationship, tracking, entry, and activity relation sizes
  before and after loading;
- planner node types, index names, execution time, and shared buffer activity
  for canonical title, alternate title, selective and broad description,
  no-match, popularity-page, related-media, trending-feed, profile-entry, and
  profile-activity reads; and
- wall time for concurrent searches, member reads, hydration updates, and
  tracking writes;
- database-pressure sample count, configured connection capacity, peak total and
  active connections, peak utilization, and waiting locks; and
- an atomic batch checkpoint with interruption, resume, completion, accumulated
  insertion time, and initial-storage evidence. The final report embeds the
  checkpoint SHA-256 so later edits are detected by the cutover gate.

PostgreSQL may correctly prefer a sequential scan when a table is small or a
predicate matches much of it. For that reason, `--require-trigram-indexes`
checks that every catalog trigram index appears somewhere in the complete query
set, and should be used at representative scale rather than in the small CI
smoke run.

## Measured local rehearsal

The 2026-07-20 disposable PostgreSQL 16 rehearsal used 100,000 synthetic media
identities. It validated the original flat-catalog harness and index gate, but
represents only about 6.4% of the current 1,564,333-identity target and predates
the mandatory relationship/member workload. It therefore cannot satisfy the
current cutover evidence policy.

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
Network latency, real title distributions, catalog workers, member traffic, and
production hardware can materially change them.

## Representative PostgreSQL 16 smoke result

The 2026-07-20 implementation smoke run used a disposable local PostgreSQL 16
container with 2,000 media, 199 relationships, 20 feed items, 20 members, 60
watchlists, 1,000 tracking states/entries, and 200 activity events. All ten
catalog/profile query plans and 20 catalog searches, five hydration updates,
eight member reads, and three tracking writes completed. Cleanup removed every
synthetic media, member, and temporary list-type row. This proves correctness of
the richer harness; it is intentionally not performance or cutover evidence.

A second smoke deliberately stopped after 1,000 of 2,000 media rows and resumed
from the same checkpoint. Resume observed all 1,000 persisted rows, completed
the representative workload, and bound the completed checkpoint SHA-256 into the
report. Concurrent work sampled a peak of 17/100 connections (17%), seven active
connections, and zero waiting locks. Cleanup again left zero synthetic media,
members, or list types. These small local values prove the recovery and
measurement paths only; staging must establish its own approved budgets.

## Full local target rehearsal

On 2026-07-21, the guarded representative harness completed the entire current
1,564,333-identity target on a disposable local PostgreSQL 16 database. The
logical run deliberately stopped after 20,000 committed identities, observed
those exact rows on resume, completed the remaining catalog and member shape,
bound the completed checkpoint hash into the report, and removed every synthetic
media, member, and temporary list-type row afterward.

| Check                                   |               Result |
| --------------------------------------- | -------------------: |
| Inserted identities                     |            1,564,333 |
| Insert throughput                       | 6,279.49 rows/second |
| Database growth                         |             3.89 GiB |
| Relationships / feed rows               |     156,433 / 15,643 |
| Members / watchlists                    |        1,000 / 3,000 |
| Tracking states / entries               |    100,000 / 100,000 |
| Activity events                         |               20,000 |
| Mixed concurrent workload               |           122.092 ms |
| Peak connections / capacity             |             17 / 100 |
| Peak waiting locks                      |                    0 |
| Slowest measured query (`popular-page`) |           150.274 ms |
| Synthetic cleanup                       |         zero residue |

The rehearsal also corrected two measurement-fixture defects before retaining
evidence: the broad-description needle now shares the generator's exact casing,
and the popularity-page query no longer includes a synthetic-only ID predicate
that the application does not use. The corrected broad match returned 24 rows in
0.038 ms, while selective title, alternate-title, description, and no-match
plans collectively exercised all three required trigram indexes.

This is meaningful correctness and workstation-scale capacity evidence, but it
is not production-like staging approval. Network latency, storage class,
container limits, connection pooling, cold-cache behavior, real provider data,
and live catalog-worker contention still require the separate deployment gate.

## CI boundary

CI loads and cleans up 2,000 identities after the PostgreSQL migration, drift,
and application smoke checks. That proves command safety, schema compatibility,
generation, measurement, report creation, and cascading cleanup. CI deliberately
does not enforce planner choices or performance thresholds on shared runners.

## Remaining cutover gates

Before PostgreSQL cutover approval:

1. Repeat the now-proven 1,564,333-identity test on production-like staging
   hardware and retain that environment's report with the release evidence.
2. Agree on query, import, concurrency, backup, and restore budgets with the
   deployment owner; compare cold- and warm-cache results against them.
3. Run the representative relationship/member mode documented above using
   owner-approved counts, then run inventory/hydration workers alongside the
   interactive read and write workload.
4. Exercise interruption/resume, native backup/restore, locks, connection-pool
   saturation, disk headroom, monitoring, and one-process canary behavior.
5. Rehearse the final maintenance-window and rollback decision points in the
   [PostgreSQL operations runbook](postgresql-operations.md), then bind the
   artifacts with the
   [PostgreSQL cutover evidence gate](postgresql-cutover-readiness.md).
