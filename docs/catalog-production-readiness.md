# Catalog production-readiness boundary

Last updated: 2026-07-22

Veud's catalog workers are resumable and suitable for bounded development and
staging runs. Provider-scale production inventory and hydration are still
disabled operationally until the database and policy gates below are complete.

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

The production hold remains. The next batch must run the current
1,564,333-identity target on production-like staging using owner-approved
relationship and member counts, and record database/index size, import and
hydration throughput, search/profile latency, lock and pool behavior,
backup/restore timing, interruption recovery, and canary/rollback behavior.

Cutover evidence automation is available in the
[PostgreSQL cutover runbook](postgresql-cutover-readiness.md): verified backups
now emit archive-bound restore receipts, the read-only canary records public
application and database-health latency, and the final gate hashes and evaluates
all artifacts against an owner-approved policy. The gate now rejects flat
catalog-only load reports, target/checkpoint mismatches, unproven recovery, and
connection or waiting-lock pressure outside policy. The automation enforces the
hold; it does not satisfy the still-unrun production-like staging gates.

## Final local prerequisite audit

The 2026-07-21 roadmap closeout rechecked the active operator environment
without printing secret values:

- `DATABASE_URL` still uses the local `file:` datasource, and no separate
  production-like staging/PostgreSQL target is configured.
- `MAL_CLIENT_ID` is configured. One-record anime and manga inventory dry runs
  each completed a real provider request with zero failures and zero `429`
  responses. Dry-run mode committed no catalog or sync records.
- On 2026-07-22 the deployment owner authorized ingestion and redisplay of
  MAL-curated, non-user catalog metadata under the existing API agreement using
  reference `OWNER-MAL-API-AGREEMENT-2026-07-22`. Reviews, community/forum
  content, profiles, lists, and other user-originated content remain excluded.
  The decision also prohibits sending MAL-sourced metadata to external AI.
- `MAL_CATALOG_POLICY_APPROVAL_REF` should be configured with that non-secret
  reference only on the PostgreSQL staging/production worker environment. No
  committed MAL inventory or hydration run has yet been attempted.

All executable local gates are complete. Resuming the held rollout requires a
clearly identified production-like PostgreSQL staging URL plus protected backup,
restore, and canary destinations; owner-approved staging policy/count budgets;
and the recorded MAL policy authorization reference. The policy reference now
exists; the PostgreSQL staging and evidence inputs do not. After those inputs
exist, follow the PostgreSQL cutover runbook and retain its passing evidence
manifest before beginning bounded committed provider batches.
