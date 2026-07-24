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
```

Before a committed manual job, confirm the target database, take a
restore-verified backup, and begin with a bounded batch. Production scheduled
workers are deployed from an exact release:

```sh
npm run production:catalog:deploy
npm run production:postgres:status
```

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
