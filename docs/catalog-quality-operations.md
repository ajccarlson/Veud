# Catalog quality review operations

Veud keeps catalog-quality detection separate from destructive catalog changes.
The scanner finds review candidates; it never merges or deletes media, moves
member data, or calls a provider. Every administrator decision is an append-only
audit event and can be reopened.

## Findings

The initial detectors cover:

- `possible_duplicate`: two records with the same normalized primary title,
  media kind, and release year;
- `title_conflict`: a hydrated provider source title is absent from the
  canonical record's searchable title provenance;
- `missing_image`: a hydrated record has no poster; and
- `invalid_image`: a poster URL is malformed or does not use HTTPS.

Duplicate confidence is deliberately conservative. Exact matching creates a
candidate for human review, not proof that two works are interchangeable.
Remakes, regional releases, compilations, and split seasons can share title and
year.

## Scanner

Preview the first bounded page without writing:

```sh
npm run catalog:quality-scan -- --limit 500
```

Persist idempotent findings only after reviewing the preview:

```sh
npm run catalog:quality-scan -- --limit 500 --commit
```

The command prints a media cursor. Resume the next page with:

```sh
npm run catalog:quality-scan -- \
  --limit 500 \
  --after LAST_PRINTED_CURSOR \
  --commit
```

Continue until `Complete: yes`. A later pass can restart without `--after`;
finding fingerprints prevent duplicates while `lastSeenAt` records current
evidence.

## Administrator review

The protected `/admin/catalog` page shows findings alongside catalog worker
health. Available decisions are:

- **Confirm candidate**: records that a possible duplicate deserves later merge
  planning; it does not merge anything.
- **Dismiss**: records a false positive or accepted condition.
- **Mark resolved**: records that the underlying condition was corrected.
- **Queue provider repair**: requeues active provider identities at quality
  priority so the normal idempotent hydration worker can refresh titles or
  posters.
- **Reopen review**: returns any reviewed finding to `open` while retaining its
  prior events.

Review notes are bounded to 500 characters. Audit events retain actor, action,
previous and next status, timestamp, note, and repair-source count. Deleting a
user preserves the issue and event while nulling the former actor reference.

## Merge boundary

Confirmed duplicates are not safe to merge until a separate transaction planner
can account for uniqueness conflicts in tracking states, reviews, collections,
favorites, reminders, feed rows, and provider relations. That future planner
must emit a complete preflight, preserve a reversal journal, and refuse any move
whose member-owned semantics are ambiguous. Direct media deletion or ad hoc
foreign-key rewrites are not an approved review action.
