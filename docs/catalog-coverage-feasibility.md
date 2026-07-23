# Catalog coverage feasibility

Last verified: 2026-07-19

## Decision

Veud can build broad, locally searchable TMDB and MyAnimeList coverage, but it
should not treat either provider as an unrestricted, permanent database dump.

- **TMDB: conditional go.** Use the official daily ID inventories to discover
  movie and TV records, hydrate only normalized fields Veud needs, poll the
  change feeds, refresh every cached record within six months, and ship the
  required attribution. A production bulk catalog should not remain on the
  current SQLite datastore.
- **MyAnimeList: technical go, policy hold for a full mirror.** The official
  ranking endpoints can enumerate the observed anime and manga inventories and
  expose provider update timestamps, but MAL publishes no bulk dump, change
  feed, numeric rate limit, or storage permission in its API v2 reference. Keep
  the current on-demand cache and prototype the resumable importer, but obtain
  written confirmation from MAL before continuously mirroring the full catalog.
- **AI features: separate approval gate.** TMDB's current API terms prohibit
  using its API or content in connection with an ML/AI application, including
  training. Do not feed TMDB-derived titles, descriptions, images, or metadata
  into the planned “Tip of My Tongue” feature without a written agreement.

This is an engineering feasibility decision, not legal advice. Provider terms
and approvals must be rechecked before production launch or monetization.

## Current measured inventory

Measurements were taken against the official provider endpoints on 2026-07-19.
They are operational sizing inputs, not permanent constants.

| Provider inventory | Observed records | Inventory mechanism              |
| ------------------ | ---------------: | -------------------------------- |
| TMDB movies        |        1,222,483 | Daily movie ID export            |
| TMDB TV series     |          227,208 | Daily TV ID export               |
| MAL anime          |           30,237 | `anime/ranking?ranking_type=all` |
| MAL manga          |           84,405 | `manga/ranking?ranking_type=all` |
| **Total**          |    **1,564,333** | Provider-owned inventories       |

The TMDB exports explicitly contain IDs and a few high-level attributes, not
full title metadata. The MAL numbers are the currently enumerable `all` ranking
inventories; they do not prove that private, draft, or otherwise unranked
provider records are available to API clients.

At one detail request per work:

- TMDB's 1,449,691 movie/TV records require about 10.1 hours at 40 requests per
  second or 40.3 hours at a safer 10 requests per second, before retries.
- MAL's 114,642 anime/manga records require about 31.8 hours at Veud's current
  conservative one request per second.
- Refreshing every TMDB record inside 180 days means an average floor of 8,054
  refreshes per day, in addition to change-feed work.
- A full MAL inventory scan needs about 230 ranking pages at the documented
  maximum of 500 records per page. Comparing `updated_at` before fetching full
  details keeps recurring work substantially smaller than a full rehydrate.

## Provider constraints

### TMDB

Official sources:

- [Daily ID exports](https://developer.themoviedb.org/docs/daily-id-exports)
- [Tracking content changes](https://developer.themoviedb.org/docs/tracking-content-changes)
- [Rate limiting](https://developer.themoviedb.org/docs/rate-limiting)
- [API terms of use](https://www.themoviedb.org/api-terms-of-use)
- [Logos and attribution](https://www.themoviedb.org/about/logos-attribution)

Implementation consequences:

1. Download the movie and TV ID exports daily. They are available for only three
   months and are an inventory/reconciliation source, not a metadata dump.
2. Poll movie and TV change lists at least daily. The documented window is 24
   hours by default and at most 14 days, so alert before a cursor falls outside
   that recovery window.
3. Treat roughly 40 requests per second as an upper operational ceiling, honor
   `429`, and default bulk work to 10 requests per second with bounded
   concurrency, exponential backoff, and jitter.
4. Refresh or remove all cached TMDB-derived content before it is six months
   old. Target 150 days to leave recovery margin.
5. Store provenance so TMDB-derived fields can be refreshed and can be purged if
   access ends. Avoid storing provider payloads Veud does not use.
6. Add the approved TMDB logo and the required non-endorsement notice to an
   About/Credits surface before expanding public use.
7. Confirm commercial licensing before Veud's primary purpose becomes revenue.
8. Keep TMDB content outside ML/AI features unless TMDB gives written approval.

### MyAnimeList

Official source:

- [MyAnimeList API v2 reference](https://myanimelist.net/apiconfig/references/api/v2)

The current reference documents client-ID authentication, paginated anime and
manga ranking endpoints, a maximum ranking page size of 500, detail endpoints,
selectable fields, and provider `updated_at` values. It does not document a bulk
export, incremental change endpoint, numeric request limit, cache duration, or
permission to operate a persistent public mirror.

Implementation consequences:

1. Use `ranking_type=all`, `limit=500`, and offsets as the inventory pass.
2. Request only identity, title, type, NSFW, popularity, and `updated_at` fields
   during inventory. Fetch detail payloads only for new or changed records.
3. Keep the existing one-request-per-second default until MAL supplies a limit.
   Honor `429` and `Retry-After`; pause the provider queue instead of retrying
   in a tight loop.
4. Run inventory no more often than needed under the documented deployment
   policy, and reassess if provider guidance changes acceptable mirroring or
   refresh behavior.
5. Do not scrape MAL HTML as a fallback. A missing API capability remains a
   provider limitation.
6. Record the storage/redisplay authorization basis, attribution requirements,
   production request limits, and any commercial-use conditions before enabling
   a full production backfill. Veud's 2026-07-22 owner determination is recorded
   in [`mal-catalog-policy-decision.md`](mal-catalog-policy-decision.md).

## Veud's current foundation and gaps

The existing canonical model is a strong starting point:

- `MediaExternalId(provider, kind, externalId)` provides idempotent provider
  identity.
- `Media` is shared across users and already stores the core title, release,
  description, genre, image, and provider-score fields.
- Entry creation and the existing backfill reuse canonical media rather than
  creating one catalog row per user.

It is not yet sufficient for a provider-scale catalog:

| Gap                                           | Required boundary                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No source freshness                           | Add first-seen, last-seen, last-fetched, provider-updated, refresh-after, deletion, and fetch-status fields per external identity. |
| No sync checkpoints                           | Add durable provider/kind job runs and cursors with counts, timestamps, last error, and lease ownership.                           |
| Alternate titles are not normalized           | Add a `MediaTitle` table with provider, locale/language, title type, original value, and normalized search value.                  |
| Provider fields overwrite one shared snapshot | Make source precedence explicit and retain enough provenance to refresh or purge provider-derived fields.                          |
| No tombstone/reconciliation state             | Mark missing IDs before deletion; never destroy user tracking because a provider record disappears.                                |
| SQLite is the only datasource                 | Move the production catalog/search workload to PostgreSQL before full hydration; keep small SQLite fixtures for tests.             |
| Search is row-scan oriented                   | Build title search on PostgreSQL full-text plus trigram indexes (or an equivalent dedicated index), not `%LIKE%` over 1.5M works.  |
| No catalog observability                      | Track coverage, freshness percentiles, queue depth, response status, retries, throughput, and provider quota/429 events.           |

Do not automatically merge a MAL anime with a TMDB TV record merely because
their titles and dates resemble each other. Cross-provider identity requires a
verified external-ID bridge or a reviewed mapping. False merges would corrupt
every user's tracking, recommendations, and activity for both works.

## Proposed ingestion architecture

The next implementation batch should introduce a provider-neutral job boundary,
not begin with a one-off million-row script.

```text
provider inventory
       |
       v
identity upsert ----> durable sync cursor/run
       |
       v
new/stale/changed priority queue
       |
       v
provider detail adapter
       |
       v
normalized media + alternate titles + source freshness
       |
       +----> discovery/search index
       +----> coverage/freshness metrics
```

Required job modes:

- `inventory`: stream IDs/pages and upsert source identity without loading the
  entire provider response into memory.
- `hydrate`: fetch normalized detail for new records, prioritizing upcoming,
  trending, popular, and user-requested works.
- `refresh`: process provider changes and age-based refresh deadlines.
- `reconcile`: tombstone records missing from repeated inventories while
  preserving user-owned tracking and history.
- `repair`: retry dead-letter jobs after an operator reviews systemic failures.

Every unit of work must be idempotent under the unique provider identity, commit
its cursor only after its database transaction succeeds, and be safe to resume
after process termination. Interactive requests should read the local catalog
and enqueue missing/stale hydration; they should not wait on a bulk provider
request.

## Rollout sequence

### Phase 0 — approvals and attribution

- Obtain MAL's written answer for full-catalog storage and redisplay.
- Decide Veud's commercial posture and confirm TMDB licensing if needed.
- Add a provider credits page and field/source attribution conventions.
- Keep AI search isolated from provider content pending explicit permission.

### Phase 1 — sync foundation

- Add source freshness, alternate-title, sync-run, and cursor models.
- Implement provider-neutral leases, checkpoints, backoff, and metrics.
- Add fake-provider tests for resume, duplicate pages, 429, partial failure,
  tombstones, and two workers attempting the same lease.

### Phase 2 — TMDB inventory and prioritized hydration

- Stream daily movie/TV exports into identities.
- Hydrate upcoming/trending/popular records first, then the long tail.
- Poll changes and enforce the 150-day refresh target.
- Run production load tests on PostgreSQL before enabling the full backlog.

### Phase 3 — MAL inventory and hydration

- Begin only after the policy gate is cleared.
- Inventory ranking pages and compare `updated_at`.
- Hydrate changed/new titles at one request per second initially.
- Measure whether observed rankings cover the records users expect; document
  unavoidable API coverage gaps.

### Phase 4 — global search and recommendations

- Index canonical and alternate titles with kind/year/genre/provider filters.
- Prefer locally fresh metadata and expose source/freshness to operators.
- Rebuild recommendation candidates from the broad catalog without allowing
  private tracking data to influence public aggregates.

## Exit criteria for CATALOG-001

“Full catalog available” is complete only when:

- every currently discoverable provider identity exists locally or is recorded
  as an explained ingestion failure;
- normalized metadata coverage and freshness meet documented service targets;
- inventory and refresh jobs resume safely and stay inside provider policy;
- attribution is visible in production;
- global search uses canonical and alternate titles without synchronous bulk
  provider dependence;
- provider removal or tombstoning cannot delete user tracking/history; and
- the team can purge one provider's derived content without damaging data owned
  by users or sourced from another provider.
