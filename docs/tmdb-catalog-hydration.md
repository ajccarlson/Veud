# TMDB prioritized hydration operations

Veud can hydrate canonical TMDB movie and TV identities with localized and
original titles, alternate titles, poster provenance, dates, description,
genres, runtime/episode count, certification, language, studios, popularity, and
score. The worker uses TMDB's detail endpoint with `append_to_response`, keeping
one provider request per work.

Official references:

- [Movie details](https://developer.themoviedb.org/reference/movie-details)
- [Append to response](https://developer.themoviedb.org/docs/append-to-response)
- [Popularity and trending](https://developer.themoviedb.org/docs/popularity-and-trending)
- [Rate limiting](https://developer.themoviedb.org/docs/rate-limiting)

## Queue order

Eligible identities are processed in this order:

1. user demand from quick-add, tracking, favorites, collections, or reminders;
2. upcoming movies and currently-airing TV series;
3. weekly trending works;
4. popular works;
5. the remaining inventory by TMDB popularity.

Priority-feed ranks are durable and idempotent. A successful detail write clears
the priority request. A failed write keeps its priority but becomes ineligible
until its retry deadline.

Each successful priority-feed refresh also replaces its ranked `CatalogFeedItem`
snapshot in the same transaction. The homepage uses fresh weekly-trending ranks
directly and treats snapshots older than eight days as stale, falling back to
canonical catalog popularity without making an interactive provider request.

## Safety model

- The command is a read-only queue preview unless `--commit` is explicit.
- Cooperative movie/TV hydration leases prevent two workers from processing the
  same kind concurrently.
- Detail and priority-feed requests use bounded concurrency with a hard maximum
  of ten. The command also spaces request starts by 100 milliseconds by default,
  enforcing the staging target of at most ten request starts per second even
  when responses are fast.
- Each response batch, normalized media update, title replacement, source
  freshness update, and run checkpoint commit in one database transaction.
- HTTP `429` honors `Retry-After` when present, checkpoints other successful
  responses in the batch, and persists a provider-wide deadline. Later runs do
  not call TMDB before that deadline.
- Network/server failures use capped exponential backoff, missing records retry
  after 30 days, and authentication failures pause the provider for one day.
- Successful details refresh after 150 days by default, staying inside the
  documented six-month retention requirement.
- Hydration updates provider-derived canonical metadata only. It never deletes
  user tracking, history, reviews, diary entries, favorites, collections, or
  reminders.

Before a committed run against an important database:

```sh
npm run db:backup
npx prisma migrate deploy
```

Set `TMDB_API_KEY` to a TMDB API Read Access Token. Do not enable the full
million-record backlog on SQLite; move the catalog/search workload to PostgreSQL
and complete representative load testing first.

## Usage

Preview the highest-priority movie and TV work without calling TMDB:

```sh
npm run catalog:tmdb-hydrate
```

Seed priority feeds and hydrate a bounded movie batch:

```sh
npm run catalog:tmdb-hydrate -- \
  --kind movie \
  --seed-priorities \
  --commit \
  --limit 100 \
  --concurrency 4 \
  --delay-ms 100
```

Hydrate a long-tail batch without spending requests on priority feeds again:

```sh
npm run catalog:tmdb-hydrate -- \
  --kind all \
  --commit \
  --limit 1000 \
  --concurrency 4
```

Use selected feeds only:

```sh
npm run catalog:tmdb-hydrate -- \
  --kind tv \
  --seed-priorities \
  --feeds upcoming,trending \
  --commit
```

All controls are documented by:

```sh
npm run catalog:tmdb-hydrate -- --help
```

## Metrics and recovery

Every invocation prints before/after totals for active and tombstoned
identities, hydration coverage, 150-day freshness, eligible queue depth,
prioritized work, deferred failures, provider requests, and `429` events.
`CatalogSyncRun` retains per-run request counts, rate-limit events, and provider
retry deadlines alongside its normal progress and error fields.

A process interruption can cause already-issued provider requests to repeat, but
database writes are idempotent and only committed batches change source state.
Re-run the same command after correcting an operational failure. For a persisted
provider deadline, wait until the printed timestamp; repeatedly starting workers
earlier will not issue upstream requests.

For an initial scheduled deployment, seed priority feeds daily, run small
bounded long-tail batches, and alert on rising queue depth, falling freshness,
repeated `429` events, or a cluster of authentication/systemic failures.

Local isolated staging installs `veud-staging-tmdb-hydration.timer`. Its worker
targets `STAGING_LOAD_DATABASE_URL`, shares `tmdb-provider.lock` with inventory,
seeds priority feeds, and hydrates at most 100,000 records per kind per daily
pass. It defaults to four concurrent responses and at least 100 milliseconds
between all provider request starts. A failed process restarts after one minute;
a successful bounded pass resumes on the next timer activation.
