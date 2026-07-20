# Homepage trending rails

Veud's public and signed-in homepages lead with horizontally scrollable movie,
TV, anime, and manga discovery rails backed by canonical `Media` records. Cards
link to Veud media pages and use the shared quick-track flow, so adding or moving
a title updates normalized tracking state and the compatible legacy list row in
one transaction.

## Ranking and freshness

Committed TMDB priority seeding stores each successful provider feed as a
ranked `CatalogFeedItem` snapshot. A refresh replaces only the selected
provider/kind/feed snapshot and never mutates user-owned history.

The homepage uses a trending snapshot for up to eight days. It fills missing
slots—or an entire stale/unseeded rail—from `Media.catalogPopularity`. Each rail
is capped at 18 canonical titles, and the loader reads no provider API during an
interactive request. This gives the homepage a fast, deterministic fallback
while daily feed seeding keeps movie and TV charts current. Anime and manga use
the same fallback boundary until their provider feed ingestion is added.

## Interaction and accessibility

- Trending renders before following activity and upcoming releases for both
  anonymous and signed-in visitors.
- Rails support native mouse-wheel, trackpad, touch, and keyboard scrolling,
  plus named previous/next buttons.
- Fixed-width, snap-aligned cards preserve readable poster and title sizes from
  mobile through desktop instead of wrapping into a fixed grid.
- Signed-in members choose a compatible list and save without leaving home.
  Anonymous visitors receive a login action that returns them to the homepage.
- Missing posters and empty catalogs have explicit fallback states.

Run the TMDB hydration command with priority seeding at least daily to keep
provider ranks fresh:

```sh
npm run catalog:tmdb-hydrate -- \
  --kind all \
  --seed-priorities \
  --commit \
  --limit 100 \
  --concurrency 4
```
