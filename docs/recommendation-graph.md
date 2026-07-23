# Explainable recommendation graph

Veud's signed-in `For you` discovery view uses a deterministic, local
recommendation graph. It does not send catalog records, MAL metadata, member
activity, or feedback to an external AI service.

## Separate evidence lanes

The graph avoids presenting one opaque universal score. It creates up to four
deduplicated lanes, in evidence order:

1. **Continue a world you love** follows canonical provider-backed media
   relations from highly rated, repeated, favorited, or positively reviewed
   titles.
2. **From people you follow** uses only followed members' public tracking
   scores, repeat signals, and published reviews.
3. **From collections you trust** uses public collections from followed members
   and public collections the viewer explicitly liked.
4. **Matches your taste** derives weighted genre affinity from normalized
   tracking scores, repeat counts, favorites, the viewer's reviews, and liked
   reviews. Low scores and “less like this” feedback subtract affinity.

Every card states the concrete evidence that placed it in its lane. A title
appears in at most one lane per response, already tracked and favorited works
are excluded, and direct tracking reuses the same media-type compatibility rules
as the rest of Discover.

## Private, reversible feedback

`RecommendationFeedback` stores one private signal per member and canonical
work. “Not interested” hides that exact title. “Less like this” also reduces the
relevant genre weights. Neither signal changes community scores, popularity,
another member's ranking, or provider metadata.

Feedback writes are authenticated, schema-validated, owner-scoped, idempotent,
and returned with `private, no-store`. Hidden titles remain reviewable in the
For You view (the 50 most recent are shown when the history is longer) and can
be restored at any time. Database foreign keys cascade on account or
canonical-media deletion.

## Privacy boundaries

- A viewer's own private tracking may shape their own recommendations.
- Another member's tracking is eligible only when it is unbound to a list or
  bound to a public list.
- Collection evidence requires a public collection.
- Reviews are public product content; private list state is never inferred from
  them.
- Feedback and derived preferences are never included in public aggregates.

## Bounded execution

The graph reads at most 1,000 relevant tracking states, 500 reviews, follows,
and recent feedback rows, 250 favorites, and 40 high-value relation seeds. Each
candidate source is capped at 240 rows and each lane at six cards. Queries for
independent sources run in parallel, and the graph is loaded only for the
signed-in, unfiltered, first-page `For you` view. Search, filters, memory
search, anonymous discovery, and ordinary popularity views do not pay this cost.

Unit coverage protects lane separation, explanations, private-list exclusion,
feedback isolation, genre suppression, restoration, and the legacy For You
fallback. Production-browser coverage protects responsive layout, evidence copy,
feedback/undo revalidation, and direct tracking.
