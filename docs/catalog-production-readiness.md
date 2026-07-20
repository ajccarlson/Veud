# Catalog production-readiness boundary

Last updated: 2026-07-20

Veud's catalog workers are resumable and suitable for bounded development and
staging runs. Provider-scale production inventory and hydration are still
disabled operationally until the database and policy gates below are complete.

## Completed controls

- `/credits` publishes the approved TMDB logo and required non-endorsement
  notice, identifies the other catalog providers, and separates provider data
  from member-owned tracking and reviews.
- MAL commit mode requires a written storage/redisplay approval reference. Every
  committed MAL inventory or hydration run stores the normalized reference on
  its `CatalogSyncRun` audit record; credentials must never be used as the
  reference.
- Inventory and hydration jobs use durable leases, cursors, cooldowns, retry
  state, progress counters, and provider request/rate-limit metrics.
- The reusable test database now applies pending migrations before workers clone
  it, preventing new audit columns from being skipped by an old local fixture.

## Production hold

The current application datasource is SQLite. It remains appropriate for local
development, small fixtures, and bounded operator-reviewed imports, but it is
not the approved deployment target for the roughly 1.5 million provider
identities plus hydration, search, refresh, and interactive traffic.

Do not enable an unbounded production backfill until all of these are true:

1. The production catalog is on PostgreSQL with verified backup and restore
   procedures.
2. Canonical and alternate-title search uses PostgreSQL full-text/trigram
   indexes, and query plans remain inside the documented latency budget at
   representative catalog size.
3. Inventory, hydration, refresh, reconciliation, and interactive reads have
   passed a concurrent load and interruption/resume test.
4. MAL's written storage/redisplay approval is on file and its reference is
   supplied to every committed MAL run.
5. Current provider terms, attribution, commercial-use posture, refresh windows,
   and rate limits have been rechecked for the deployment.
6. Coverage, freshness, queue depth, failures, request volume, and `429` events
   are monitored with an operator response path.

The TMDB and MAL runbooks intentionally keep dry-run defaults. Start any
approved rollout with a backup and a small `--limit`, inspect the persisted run
and coverage metrics, then increase the batch only after the previous batch is
healthy.

## Next engineering batch

Create a PostgreSQL deployment schema and migration handoff while retaining
SQLite as the fast isolated test datasource. Then load a representative catalog
snapshot and record database size, import throughput, search latency, hydration
throughput, lock contention, and restore time before changing this hold.
