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
