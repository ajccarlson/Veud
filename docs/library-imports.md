# Cross-platform library imports

Veud accepts member-owned exports from MyAnimeList, AniList, Trakt, and
Letterboxd at `/settings/profile/import`. Imports never create catalog records:
each row must reconcile to an existing canonical `Media` record before it can be
selected.

## Supported export shapes

| Source      | Input                                          | Primary identity                       |
| ----------- | ---------------------------------------------- | -------------------------------------- |
| MyAnimeList | anime or manga XML export                      | MAL anime/manga ID                     |
| AniList     | JSON containing media-list entries             | MAL ID when present, then AniList ID   |
| Trakt       | JSON history/list records                      | TMDB ID when present, then Trakt ID    |
| Letterboxd  | CSV diary, ratings, watched, or watchlist rows | Letterboxd slug, then normalized title |

Identity lookup always uses media kind as part of the key. Provider IDs are
preferred over titles. Exact canonical or normalized alternate titles are the
fallback; multiple candidates remain ambiguous until the member chooses one.
Reconciliation is bulk-loaded in bounded chunks and previews are limited to
2,000 normalized rows.

## Privacy and retention

- The uploaded file exists only for the request that parses it. Veud does not
  store the raw file or send it to an AI service.
- Veud stores a private owner-scoped batch, normalized source values,
  reconciliation candidates, the member's choices, and a rollback journal.
- New status lists created by an import are private by default.
- Imports appear in the member's account-data export and are deleted by the
  existing account cascade.
- MAL-derived content remains excluded from external AI processing.

## Conflict choices

- **Add** requires that the title has no existing canonical tracking state.
- **Merge progress** keeps the larger progress and repeat counters, preserves
  existing dates or scores when the import omits them, and otherwise accepts
  explicit imported values.
- **Replace Veud details** makes the imported score, dates, progress, and repeat
  count authoritative.
- **Skip** makes no change.

Provider statuses map to Veud's compatible Watching/Reading, Completed,
Planning, On hold, and Dropped lists. Media/list compatibility is checked again
by the existing server-owned tracking boundary during apply.

## Atomic apply and rollback

Applying a batch uses one database transaction. Duplicate selected matches,
unresolved rows, invalid destinations, or any write failure abort the entire
batch. Each changed title journals its exact prior member-owned tracking,
progress, list position, score, and legacy history plus a post-apply
fingerprint.

Import audit events are private, so restoring an old library never floods the
community feed.

Rollback first validates every post-apply fingerprint. If any title has been
edited since the import, the complete rollback is rejected instead of
overwriting newer work. Otherwise it restores the batch in reverse order,
normalizes affected list positions, removes empty lists created by the import,
and appends private `import_rollback` activity rather than erasing audit
history.
