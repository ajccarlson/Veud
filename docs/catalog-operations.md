# Catalog operations

Veud stores local TMDB and MyAnimeList catalog data so search, recommendations,
and lists do not depend on interactive provider requests.

## Commands

All inventory and hydration commands are previews unless `--commit` is provided.
Use `--help` for current options.

```sh
npm run catalog:status
npm run catalog:quality-scan

npm run catalog:tmdb-inventory -- --help
npm run catalog:tmdb-hydrate -- --help
npm run catalog:mal-inventory -- --help
npm run catalog:mal-hydrate -- --help
npm run catalog:mal-trending -- --help
```

The trending refresh stores six-hour audience snapshots. Anime starts from MAL's
current seasonal chart; manga starts from MAL popularity and changes to measured
audience momentum as history accumulates.

Before a committed manual job, confirm the target database, take a
restore-verified backup, and begin with a bounded batch. Production scheduled
workers are deployed from an exact release:

```sh
npm run production:catalog:deploy
npm run production:postgres:status
```

The deploy command is also the one-time catalog-provenance cutover boundary. It
packages the release before downtime, records and stops every web, backup,
catalog, retention, and notification writer, and takes a fresh restore-tested
PostgreSQL backup before migrating. The exact local and off-drive archives and
restore receipts stay pinned for the whole cutover. It then previews and commits
the provenance repair in bounded batches, reconciles linked list metadata,
requires a clean epoch, activates and health-checks the exact compatible
release, and restores services before persistent timers, with backups last.

Do not run the provenance repair directly against a live production application.
If a failure occurs after migration begins, the deploy leaves the site in
maintenance with writers stopped and records recovery state at
`$VEUD_PRODUCTION_ROOT/run/catalog-release-maintenance.state`. Correct the cause
and rerun `npm run production:catalog:deploy`; do not manually restart the old
release. The PM2 and systemd launchers enforce this marker, including across a
reboot; do not bypass those launchers with a raw application or worker command.
Every live catalog writer must inherit the launcher-issued runtime proof; direct
writer commands fail closed. Recovery must use the same Git revision recorded by
the marker. A retry after database mutation reuses and verifies the pinned
pre-mutation backup instead of creating or pruning a replacement.

Local staging uses the same fail-closed boundary for both `veud_staging` and
`veud_staging_load`. Its application and operations configurations must name the
same application database, and its load and restore databases must remain
distinct. A first deployment may bootstrap an intentionally inactive provisioned
staging host; it activates the application, both verified-backup timers, and
only the provider or notification timers whose credentials are configured.
Immediately before the first migration it rechecks that both databases are
exactly pristine, then creates migrated restore-tested backups before enabling
persistent timers.

Notification timer launchers commit at most 100 due digests per invocation.

The production and staging service details live in
[`ops/local-production`](../ops/local-production/README.md) and
[`ops/local-staging`](../ops/local-staging/README.md).

## Safety rules

- Use official provider APIs or official exports.
- Preserve provider attribution, identifiers, provenance, and source links.
- Honor provider rate limits and persisted cooldowns.
- Keep inventory and hydration workers mutually exclusive per provider.
- Treat reconciliation as a tombstone operation; never delete canonical or
  member-owned data because a provider record disappears.
- Do not run provider-scale ingestion on SQLite.
- Do not clear leases, cooldowns, or retry deadlines merely to accelerate a
  worker.

Inventory and hydration jobs are resumable and transactional. Re-running an
interrupted job may repeat a provider request but must not partially commit an
identity.

## MyAnimeList policy

Authorization reference: `OWNER-MAL-API-AGREEMENT-2026-07-22`.

The deployment owner authorized server-side ingestion and redisplay of non-user
MAL catalog metadata under the existing API agreement. This is an operator
interpretation, not separate written approval from MyAnimeList.

Committed MAL jobs require the reference through
`MAL_CATALOG_POLICY_APPROVAL_REF` or `--policy-approval-ref`.

Required limits:

- use only the official MAL API and Veud's registered client;
- ingest curated anime and manga metadata, not reviews, community posts, user
  profiles, user lists, credentials, or other user-originated data;
- retain visible MAL attribution and source links;
- correct or tombstone a requested removal within 24 hours without deleting
  member-owned records;
- keep MAL requests sequential and honor cooldowns; and
- never send MAL-sourced metadata to OpenAI or another external AI provider.

Reassess the agreement before commercial use or a material expansion of scope.

## MangaUpdates policy

Authorization reference: `MANGAUPDATES_CATALOG_POLICY_APPROVAL_REF`.

The deployment owner accepted the MangaUpdates API terms for server-side
ingestion and redisplay of released-chapter records. Committed MangaUpdates jobs
require the reference through that variable or `--policy-approval-ref`.

Required limits:

- use only the official MangaUpdates API;
- ingest release records for tracked series, not user data or forum content;
- retain visible MangaUpdates attribution and source links;
- keep requests sequential and spaced by `--delay-ms`; and
- correct or remove a requested record within 24 hours.

**MangaUpdates records releases after they happen and publishes no forward
schedule.** This ingestion therefore produces a factual record of chapters that
have shipped, shown on the day they released. It does not predict a future
chapter date, and no such date may be inferred from publication cadence: a
guessed date in a release calendar reads as fact.

Series are matched by exact, case-insensitive title. A near match would attach
one series' chapters to another title, so anything less than exact is skipped
and counted as unresolved.

## Monitoring and recovery

The administrator catalog page and `npm run catalog:status` report coverage,
queues, failures, leases, cooldowns, and recent runs without changing data.

```sh
npm run catalog:status -- --json
npm run catalog:status -- --fail-on-degraded
```

Status is:

- `critical` when a running worker has not checkpointed for 15 minutes;
- `degraded` for active cooldowns, recent failures, expired leases, stale
  inventory, missing worker state, or material deferred failures; and
- `healthy` when initialized workers cross none of those thresholds.

An expired lease can be reclaimed by the next worker. For provider or systemic
failures, correct the cause and rerun the same bounded command. Do not bypass a
recorded provider deadline.
