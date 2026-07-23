# MyAnimeList catalog inventory operations

Veud can inventory the anime and manga records exposed by MyAnimeList's `all`
ranking pages into canonical `Media` identities. This is not a claim that MAL
provides a complete database dump: unranked, private, draft, or otherwise
unavailable records may not be enumerable through the ranking API.

Official source:
[MyAnimeList API v2 reference](https://myanimelist.net/apiconfig/references/api/v2).

The inventory retains provider identity, source update time, a monotonic local
popularity value, the provider's primary title, English/Japanese titles,
synonyms, media type, and NSFW signal. It also prioritizes new, changed, or
stale identities for the separate detail-hydration worker.

## Policy and safety model

- The command is a dry-run unless `--commit` is explicit.
- A committed run requires `--policy-approval-ref` or
  `MAL_CATALOG_POLICY_APPROVAL_REF`. The value must identify the deployment's
  documented authorization basis for bulk storage and redisplay; it must not
  contain credentials. Veud's current owner determination is documented in
  [`mal-catalog-policy-decision.md`](mal-catalog-policy-decision.md).
- Anime and manga use separate cooperative leases and durable offset cursors.
- Each fetched page and its next offset commit in one database transaction, so a
  stopped job resumes after the last durable page.
- Requests use `X-MAL-CLIENT-ID`, request at most 500 records, and wait one
  second between pages by default.
- A `429` response records the provider's `Retry-After` deadline. Workers that
  start during that cooldown complete without making another provider request.
- A logical `--date` identifies one full scan. Repeating an incomplete date
  resumes it; repeating a completed date is idempotent; an older date is
  rejected after a newer scan begins.
- Ranking pages are not an authoritative deletion feed, so reconciliation is
  disabled by default. `--reconcile` is explicit and still requires both a
  minimum observed count and at least 90% coverage of active identities.
- Reconciliation tombstones a missing MAL identity. It never deletes canonical
  media or user tracking, reviews, diary history, favorites, or collections.

Before a committed run against an important database:

```sh
npm run db:backup
npx prisma migrate deploy
```

Do not run the full provider catalog on production SQLite. Move the catalog and
search workload to PostgreSQL and complete representative load tests first.

## Usage

Set `MAL_CLIENT_ID` to the client identifier issued for Veud's MAL application.
No member OAuth token is used by the inventory job.

Validate a bounded anime page without touching the database:

```sh
npm run catalog:mal-inventory -- --kind anime --limit 500
```

Commit a bounded segment after the policy gate is cleared:

```sh
npm run catalog:mal-inventory -- \
  --kind anime \
  --date 2026-07-20 \
  --commit \
  --policy-approval-ref OWNER-MAL-API-AGREEMENT-2026-07-22 \
  --limit 5000
```

Resume by repeating the same date. The next run starts at the stored offset:

```sh
npm run catalog:mal-inventory -- \
  --kind anime \
  --date 2026-07-20 \
  --commit \
  --policy-approval-ref OWNER-MAL-API-AGREEMENT-2026-07-22 \
  --limit 5000
```

Scan both inventories to completion without tombstoning anything:

```sh
npm run catalog:mal-inventory -- \
  --kind all \
  --commit \
  --policy-approval-ref OWNER-MAL-API-AGREEMENT-2026-07-22
```

Only enable reconciliation after reviewing scan coverage and confirming that the
ranking inventory is sufficiently authoritative for the deployment:

```sh
npm run catalog:mal-inventory -- \
  --kind anime \
  --date 2026-07-20 \
  --commit \
  --policy-approval-ref OWNER-MAL-API-AGREEMENT-2026-07-22 \
  --reconcile
```

All controls are listed by:

```sh
npm run catalog:mal-inventory -- --help
```

## Data semantics

MAL's `popularity` field is a rank where smaller numbers are more popular, while
Veud's catalog sorts larger popularity values first. Inventory stores the
reciprocal (`1 / rank`) as the provider-neutral sort signal. It does not present
that derived value as MAL's displayed score or compare it numerically with
TMDB's provider popularity.

Inventory title rows use `inventory-primary`, `inventory-english`,
`inventory-japanese`, and `inventory-synonym` provenance. Each scan replaces
only those inventory title types, leaving richer detail-hydration title data
intact.

`CatalogSyncRun` records the policy authorization reference, page-level
progress, requests, rate-limit events, provider cooldown, errors, and
completion. `CatalogSyncCursor` contains the logical scan date, next offset,
cumulative committed count, stable scan start, cooldown, completion,
reconciliation, and lease state.

## Failure and recovery

Invalid payloads, non-advancing or off-origin paging URLs, expired leases,
suspicious reconciliation coverage, authentication errors, and database errors
fail the current run without advancing past the last committed page. Correct the
provider or operational issue, then rerun the same kind and date.

Do not scrape MAL HTML when the API omits a record. Record that limitation as a
coverage gap. Do not substitute Jikan for the policy approval gate: Jikan is an
unofficial API backed by MAL website data, so using it does not establish MAL
storage or redisplay permission.

## Staging execution

The first approved full inventory completed on isolated PostgreSQL staging on
2026-07-23:

- anime committed: 30,245;
- manga committed: 84,465;
- failed requests: 0;
- `429` responses: 0; and
- reconciliation/tombstones: disabled/0.

The resulting active inventory contained 30,246 anime and 84,465 manga
identities because the staging snapshot already contained one additional anime
identity. Both cursors reached provider-reported completion and released their
leases. A restore-tested native backup was retained after the run.

Staging now runs the same non-reconciling inventory once daily through
`veud-staging-mal-inventory.timer`. It shares an exclusive provider lock with
hydration so the two jobs cannot compete for the conservative request budget.
