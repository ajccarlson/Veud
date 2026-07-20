# Global catalog search

Veud's `/discover` route searches the shared canonical catalog rather than
calling TMDB, MyAnimeList, or another provider during an interactive request.
That keeps search responsive, avoids consuming provider quota per keystroke, and
lets tracking state and quick-add use the same stable `Media` identity.

## Search contract

The route supports:

- canonical and normalized alternate-title matching;
- movie, TV, anime, and manga kinds;
- exact genre, release year, provider, and provider release-status filters;
- provider popularity, provider/community rating, release date, title, and
  personalized ranking;
- public aggregate counts without leaking private-list tracking;
- the signed-in viewer's own tracking state; and
- direct quick-track into any compatible watchlist.

Results expose the alternate title that matched the query, active source
providers, provider score, release status, and existing community metadata.
Tombstoned provider identities do not satisfy a provider filter or badge, while
the canonical work and user-owned history remain intact.

## Query boundary and scale

Standard catalog searches apply predicates, counts, ordering, pagination, and
the 24-row page limit in the database. The server computes privacy-aware
community statistics only for the returned page. This replaces the previous
behavior that loaded every matching `Media` row before filtering and paging.

Personalized ranking needs per-viewer genre weights. It uses a bounded blend of
the 250 most popular matching works and 250 works matching preferred genres,
then ranks that candidate set in memory. Already tracked and favorited works
remain excluded.

The route depends on Prisma-level query functions in
`app/utils/discovery.server.ts`, so PostgreSQL-specific full-text or trigram
search can replace SQLite's substring predicates without changing the route,
filter contract, cards, or quick-track action. Before enabling the full catalog
in production, move this workload to PostgreSQL and benchmark common, broad,
alternate-title, and paginated searches against representative inventory.

## Search metadata

Inventory and detail hydration maintain provider-neutral `catalogPopularity`,
`catalogScore`, and `releaseStatus` fields on `Media`. Provider-specific scores
remain available for attribution. Search metadata has dedicated indexes for
popularity, score, release date, status, and canonical title; normalized
alternate titles use the existing `MediaTitle.normalized` index.

Deploy the metadata migration before importing or hydrating new catalog rows:

```sh
npm run db:backup
npx prisma migrate deploy
```
