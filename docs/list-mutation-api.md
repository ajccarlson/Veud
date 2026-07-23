# Versioned list mutation API

Veud's browser clients use one same-origin resource contract for list writes:

```text
POST /resources/lists/v1
Content-Type: application/json
```

List-entry reads use:

```text
GET /resources/lists/v1/entries?watchlistId=<id>
```

This replaces the original `/lists/fetch/*/:request` transport, which placed
identifiers and serialized JSON in route path segments. Those routes remain
registered temporarily for backwards compatibility and route-level regression
tests, but no application caller uses them.

## Request contract

Every mutation has an explicit version, intent, and intent-specific input:

```json
{
	"version": 1,
	"intent": "move-entry",
	"input": {
		"entryId": "entry-id",
		"destinationWatchlistId": "watchlist-id",
		"position": 3
	}
}
```

The shared schemas live in `app/utils/lists/mutation-contracts.ts`. They cover
entry creation, movement, ordering, cell and full-entry updates, advanced
editing, deletion, watchlist creation/settings/deletion, and favorite
creation/removal/ordering. Unknown intents, missing IDs, invalid positions,
oversized collections, malformed JSON, and bodies larger than one megabyte are
rejected before domain code runs.

Ownership and media/list compatibility remain server decisions. A client cannot
select an owner, directly connect arbitrary canonical media, change protected
columns, or move media between incompatible list families.

## Response contract

Successes always use:

```json
{ "ok": true, "data": {} }
```

Failures use an HTTP error status and:

```json
{
	"ok": false,
	"error": {
		"code": "VALIDATION_FAILED",
		"message": "Invalid move request",
		"issues": [{ "path": "input.position", "message": "..." }]
	}
}
```

Stable error codes are `INVALID_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED`, and `INTERNAL_ERROR`. Browser
clients receive authentication failures as `401`, not an HTML login redirect.
Unexpected server failures never expose raw exception details.

`app/utils/lists/mutation-client.ts` validates the response envelope and throws
a typed `ListMutationClientError`. Existing optimistic grid state remains in
place, while failed mutations restore authoritative list data. Settings and
advanced-edit surfaces show explicit save errors without discarding the user's
previous server state.

## Compatibility removal

The legacy route implementations currently provide the established domain
behavior behind the v1 adapter. Remove their public route registrations only
after deployed clients no longer call them and access logs show no external use.
Before removal, move the remaining domain operations into server-only service
modules so route tests can target the same implementation without maintaining a
second transport.

## Release evidence

Commit `623c6a90ba3b7e10eda8f05e2c6140ba2a089bb3` was deployed as an immutable
release to the isolated PostgreSQL staging environment on 2026-07-23.

- A fresh `npm ci` audited 1,431 packages with zero vulnerabilities.
- The PostgreSQL source/schema parity check, migrations, drift checks, and
  application query smoke tests passed for both the application and catalog-load
  databases.
- The active release symlink resolved to the exact commit, and the PostgreSQL
  service, application service, application backup timer, and catalog backup
  timer were active.
- The HTTPS acceptance gate passed 192 of 192 requests across eight public
  routes, including security-header checks, with p95 latency of 185.794 ms.
- A direct HTTPS mutation probe returned `401` with the structured
  `UNAUTHENTICATED` JSON envelope instead of redirecting to HTML.
- Local release gates passed ESLint, TypeScript, all 84 Vitest files and 384
  tests, the 11-test list reliability browser suite, and the exact 47-test CI
  browser/accessibility/visual command.

GitHub Actions is not included as affirmative evidence for this release. All 42
recorded `main` workflow runs fail with `startup_failure` before GitHub creates
a job. The workflow passes `actionlint`, and every referenced action tag exists,
so repository/account Actions state remains an owner-side operational follow-up;
the locally reproducible and deployed-staging gates above were used for this
release.
