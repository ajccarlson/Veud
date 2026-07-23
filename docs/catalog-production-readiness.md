# Catalog production-readiness boundary

Last updated: 2026-07-23

Veud's catalog workers are resumable and suitable for bounded development and
staging runs. The production-like PostgreSQL staging and policy evidence gate
passed on 2026-07-23. Bounded, monitored staging inventory and hydration may
proceed; unbounded production ingestion remains disabled until production
cutover and monitoring ownership are explicit.

## Completed controls

- `/credits` publishes the approved TMDB logo and required non-endorsement
  notice, identifies the other catalog providers, and separates provider data
  from member-owned tracking and reviews.
- MAL commit mode requires a documented storage/redisplay authorization
  reference. Every committed MAL inventory or hydration run stores the
  normalized reference on its `CatalogSyncRun` audit record; credentials must
  never be used as the reference. The current basis is the deployment owner's
  API-agreement interpretation in
  [`mal-catalog-policy-decision.md`](mal-catalog-policy-decision.md), not
  provider-issued written approval.
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
4. MAL storage/redisplay has a documented authorization basis, its limitations
   are technically enforced, and its reference is supplied to every committed
   MAL run.
5. Current provider terms, attribution, commercial-use posture, refresh windows,
   and rate limits have been rechecked for the deployment.
6. Coverage, freshness, queue depth, failures, request volume, and `429` events
   are monitored with an operator response path.

The TMDB and MAL runbooks intentionally keep dry-run defaults. Start any
approved rollout with a backup and a small `--limit`, inspect the persisted run
and coverage metrics, then increase the batch only after the previous batch is
healthy.

## PostgreSQL handoff status

The provider-specific PostgreSQL schema, migration baseline, trigram search
indexes, drift checks, and application smoke checks are now complete; see the
[PostgreSQL catalog schema handoff](postgresql-catalog-readiness.md). SQLite
remains the fast isolated test datasource.

Snapshot transfer and PostgreSQL-native backup/restore automation have passed a
full local rehearsal. A guarded synthetic load harness now records storage,
throughput, query plans, indexed search timing, relationships, feed rows, member
tracking/history, profile reads, and concurrent catalog/member reads and writes.
Its original 100,000-identity PostgreSQL 16 rehearsal passed the three-index
plan gate; later disposable smoke runs proved the richer relational/member
shape, deliberate interruption/resume, connection/lock sampling, checkpoint hash
binding, and complete cleanup. See the
[PostgreSQL catalog load runbook](postgresql-load-readiness.md).

The production-like staging batch completed on 2026-07-23 with the
owner-approved 1,564,333-identity, 1,000-member, 100,000-tracking/entry, and
20,000-activity shape. It passed interruption/resume, sequential query budgets,
mixed concurrency, connection/lock pressure, exact snapshot transfer,
restore-tested backup, and the one-process HTTPS canary.

Cutover evidence automation is available in the
[PostgreSQL cutover runbook](postgresql-cutover-readiness.md): verified backups
now emit archive-bound restore receipts, the read-only canary records public
application and database-health latency, and the final gate hashes and evaluates
all artifacts against an owner-approved policy. The gate now rejects flat
catalog-only load reports, target/checkpoint mismatches, unproven recovery, and
connection or waiting-lock pressure outside policy. The staging manifest passed
on 2026-07-23; the automation still does not change the production datasource or
open writes.

## Staging prerequisite audit

The 2026-07-21 roadmap closeout rechecked the active operator environment
without printing secret values:

- Local development remains on SQLite. Isolated staging uses PostgreSQL 16.14 on
  a dedicated live drive with a distinct restore database and offsite backup
  drive.
- `MAL_CLIENT_ID` is configured. One-record anime and manga inventory dry runs
  each completed a real provider request with zero failures and zero `429`
  responses. Dry-run mode committed no catalog or sync records.
- On 2026-07-22 the deployment owner authorized ingestion and redisplay of
  MAL-curated, non-user catalog metadata under the existing API agreement using
  reference `OWNER-MAL-API-AGREEMENT-2026-07-22`. Reviews, community/forum
  content, profiles, lists, and other user-originated content remain excluded.
  The decision also prohibits sending MAL-sourced metadata to external AI.
- `MAL_CATALOG_POLICY_APPROVAL_REF` is configured with that non-secret reference
  on staging.
- The 2026-07-23 committed inventory completed the provider-reported ranking
  pages for both kinds: 30,245 anime and 84,465 manga were committed with zero
  failed requests and zero `429` responses. The isolated catalog database
  retained 30,246 active anime and 84,465 active manga identities, including one
  pre-existing anime identity.
- Initial detail batches hydrated 24 of 25 anime candidates and all 25 manga
  candidates with zero `429` responses. The sole anime miss was a pre-existing
  malformed external ID that returned `404`; its normal 30-day retry deferral
  remains intact instead of being force-cleared.
- Release `6de3b8a` enables serialized systemd inventory, hydration, and
  restore-tested catalog-backup timers. The resumable hydration worker started
  successfully on 2026-07-23 and continued at the one-request-per-second limit
  with no early failures or rate limits. Inventory and hydration share a
  provider lock, and the database has pre- and post-inventory restore-tested
  backups on separate physical filesystems.

The staging gate and initial provider execution are complete. Continue
monitoring hydration coverage, failures, request volume, `429` events, and daily
backup receipts while the backlog drains. Production-wide ingestion still
requires explicit production datasource/write cutover and monitoring ownership.
