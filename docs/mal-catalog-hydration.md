# MyAnimeList prioritized hydration operations

Veud can hydrate canonical MAL anime and manga identities with full normalized
details after the inventory job discovers them. Interactive catalog and search
requests continue to read the local database; they do not wait on MAL.

Official source:
[MyAnimeList API v2 reference](https://myanimelist.net/apiconfig/references/api/v2).

## What the worker stores

The detail adapter normalizes:

- primary, English, Japanese, and synonym titles;
- poster/source link, media subtype, start/end dates, year/season, status, and
  synopsis;
- genres, MAL mean score, and a monotonic local popularity signal;
- anime episode/runtime, content rating, and studio metadata;
- manga chapter/volume, serialization, and author metadata; and
- provider-backed anime and manga relations such as sequels, prequels,
  adaptations, side stories, and alternative versions.

Related works are canonical lightweight identities until their own detail job
runs. Replacing a MAL relation snapshot never removes relations sourced from a
different provider.

## Queue and freshness

The worker processes eligible identities in this order:

1. media connected to member tracking, favorites, collections, or reminders;
2. explicit hydration priorities created by inventory;
3. MAL popularity order; and
4. oldest first-seen identity.

Inventory compares MAL's `updated_at` with `lastFetchedAt`. A newer provider
timestamp moves an otherwise fresh identity back to `pending` immediately.
Successfully hydrated identities default to a 180-day refresh deadline; a newer
inventory timestamp can make them eligible sooner.

Requests are strictly sequential and wait one second between starts by default.
There is intentionally no concurrency switch while MAL publishes no numeric
request quota. `429` and `Retry-After` set a provider-wide cooldown that later
workers honor without issuing a request. Other failures receive capped
exponential backoff; authentication failures pause for a day and missing works
are retried after 30 days.

## Policy gate

The command is a no-request dry-run unless `--commit` is explicit. A committed
run also requires `--policy-approval-ref` or `MAL_CATALOG_POLICY_APPROVAL_REF`,
identifying the deployment's documented authorization basis for bulk storage and
redisplay. Veud's current owner determination is documented in
[`mal-catalog-policy-decision.md`](mal-catalog-policy-decision.md). Never put
credentials in that value.

Before a committed production run:

```sh
npm run db:backup
npx prisma migrate deploy
```

Do not run the full backlog on production SQLite. Use PostgreSQL and complete
representative catalog/search load tests before enabling continuous hydration.

## Usage

Inspect the next 100 anime candidates without calling MAL:

```sh
npm run catalog:mal-hydrate -- --kind anime
```

Hydrate a small reviewed batch:

```sh
npm run catalog:mal-hydrate -- \
  --kind anime \
  --commit \
  --policy-approval-ref OWNER-MAL-API-AGREEMENT-2026-07-22 \
  --limit 25
```

Process both queues using the conservative defaults:

```sh
npm run catalog:mal-hydrate -- \
  --kind all \
  --commit \
  --policy-approval-ref OWNER-MAL-API-AGREEMENT-2026-07-22
```

List every control:

```sh
npm run catalog:mal-hydrate -- --help
```

## Observability and recovery

The command prints before/after coverage, freshness, eligible queue, prioritized
count, deferred failures, request count, and `429` count. `CatalogSyncRun`
persists the policy authorization reference alongside per-run progress and
telemetry. The hydration cursor persists the provider cooldown and last
completed source ID.

Each identity's detail write, title replacement, relation replacement, source
freshness, success/failure state, and run checkpoint share one transaction. If
that transaction fails, the candidate stays eligible. Correct systemic errors
before running deferred repairs; do not clear cooldowns or failure deadlines to
force a tight retry loop.
