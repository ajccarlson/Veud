# Reversible catalog duplicate merges

Veud can merge only a `possible_duplicate` finding that an administrator has
already confirmed. The workflow is deliberately three-stage:

1. choose the canonical survivor and persist a read-only preflight;
2. type the exact merge phrase and apply only if the preflight fingerprint is
   unchanged; and
3. retain a versioned journal that can reconstruct the source record and every
   catalog row pruned during apply.

Preparation never edits media or member data. Apply and reversal run in
serializable transactions with explicit claimed states, a 30-second transaction
limit, and append-only quality and merge events.

## Audited relation inventory

The preflight covers every direct `Media` relation in the Prisma schema:

- provider external IDs;
- searchable provider titles;
- ranked catalog feeds;
- outgoing and incoming media relations;
- legacy watchlist entries;
- favorites;
- tracking states and immutable activity;
- reviews;
- diary history;
- collection items;
- release reminders; and
- catalog-quality findings.

Apply ends with a database count assertion across that same list. The source
record is not deleted if even one audited relation remains.

## Hard blockers

Veud refuses to infer a winner for member-owned state. A merge is blocked when
the two records occur in the same:

- watchlist;
- member and favorite media-type slot;
- member tracking state;
- member review;
- collection; or
- member release-reminder set.

Different media kinds and participation in another applied merge are also hard
blockers. An administrator must resolve these cases explicitly, then prepare a
new plan. Apply recomputes the full inventory fingerprint and rejects any stale
plan.

## Deterministic catalog handling

The selected target always wins conflicting non-empty scalar metadata. Empty
target fields are filled from the source and both the previous and applied
values are journaled.

Provider IDs and non-conflicting catalog rows move to the target. Exact
title/feed duplicates, self-relations, and duplicate directed relations are safe
to prune only because the journal stores their complete source rows.
Member-authored bodies, scores, progress, dates, and history are never merged or
deduplicated.

After apply, old `/media/:sourceId` links return a permanent redirect to the
target. The operation retains the source ID without a media foreign key so the
redirect and reversal remain available while the source row is absent.

## Reversal guardrails

Reversal requires its own exact phrase and refuses to run when:

- a moved row was deleted or no longer targets the survivor;
- a moved media relation changed;
- a target field filled by the merge changed afterward;
- an affected quality finding disappeared;
- the source ID was recreated by another process;
- the target disappeared; or
- the merge issue received another review decision after apply.

When all checks pass, reversal recreates the source scalar row, moves the
journaled IDs back, restores pruned title/feed/relation rows with their original
IDs and timestamps, restores quality references, and returns the duplicate
finding to `confirmed`. The merge record and its append-only
prepare/apply/revert events remain as audit history.

## Operator workflow

On `/admin/catalog`, open a confirmed duplicate:

1. select **Keep …** for the canonical record;
2. inspect blockers, warnings, row counts, target fills, and target conflicts;
3. if the plan is safe, type the displayed `MERGE source INTO target` phrase;
4. apply the journaled merge; and
5. use `REVERT operation-id` only if restoration is required and its guardrails
   still pass.

No bulk-merge command exists. Each candidate requires an explicit survivor,
fresh preflight, and typed confirmation.

Before releasing a schema or merge-service change, validate the complete
transaction path against the isolated PostgreSQL restore database:

```bash
npm run prisma:generate:postgres
DATABASE_URL="$POSTGRES_BACKUP_VERIFY_URL" \
  npx tsx scripts/canary-catalog-media-merge.ts --run
npm run prisma:generate:sqlite
```

The canary refuses remote hosts and database names that do not contain
`restore`, `verify`, or `drill`. It creates synthetic rows, prepares and applies
a merge, verifies the journaled moves and scalar fill, reverses the operation,
verifies exact ownership restoration, and removes the fixture.

## Staging evidence

Commit `c56c15dea4f266f9f014a26338c96699b7a7ab87` was deployed on 2026-07-23.
The release:

- installed from the lockfile with an npm audit result of zero vulnerabilities;
- built the production client and server;
- applied the migration to both `veud_staging` and `veud_staging_load`;
- reported no Prisma migration or schema drift;
- passed the PostgreSQL schema/write/search smoke test;
- passed the guarded PostgreSQL prepare/apply/journal/revert canary on the
  isolated restore database;
- passed all 83 unit-test files and 378 tests, plus the focused catalog browser
  workflow;
- passed lint and TypeScript checks; and
- passed all 16 HTTPS acceptance requests with a 426.403 ms p95.

The protected catalog route returned the expected anonymous `302`, the deployed
release symlink resolved to the exact commit, and both new audit tables were
empty before any human-reviewed merge.
