# AI interaction and catalog-integrity release audit

Last updated: 2026-07-24

This document is the release contract for DATA-002, CATALOG-002, DESIGN-003,
AI-FOUNDATION-001, SEARCH-004 through SEARCH-006, TRACKING-002, IMPORT-002,
REVIEW-002, MODERATION-002, and AI-AUDIT-001. Veud remains the system of record.
OpenAI is used only to interpret member-provided input; catalog retrieval, title
and destination resolution, ranking, authorization, compatibility checks,
writes, and audit trails stay inside Veud.

## Capability boundaries

| Capability            | External input                                             | Local-only work                                                      | Durable artifact                                                       | Write boundary                                                |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Text TOMT             | Member memory and selected kind                            | Five-title catalog matching and fallback                             | None                                                                   | Existing quick-track confirmation                             |
| Natural discovery     | Member phrases and closed filter vocabulary                | Filter validation and catalog retrieval                              | Private two-hour session: phrases, plans, versions, timestamps         | None                                                          |
| Tracking command      | Member command only                                        | Resolve titles, lists, collections, compatibility, and current state | Owner-scoped preview and journal                                       | Explicit confirmation; transactional apply; guarded undo      |
| Image TOMT            | Re-encoded upload, optional member note, selected kind     | Hypothesis matching and fallback                                     | None; request bytes remain in memory                                   | Existing quick-track confirmation                             |
| Import reconciliation | Bounded unmatched user-import fields                       | Candidate lookup and identity resolution                             | Prompt/schema version and normalized hypotheses on private import rows | Member selects candidates; normal atomic import apply         |
| Review assistance     | Current member draft and selected operation                | Diff presentation                                                    | None                                                                   | Member accepts text, then separately uses normal save/publish |
| Moderation triage     | Redacted reported user-generated excerpt and report reason | Evidence validation and queue display                                | Staff-only structured assessment                                       | None; every enforcement action remains human-authored         |

MAL-derived titles, aliases, descriptions, images, scores, genres, relations,
recommendations, and candidate rows are prohibited from every external AI
request. Account IDs, usernames, email addresses, list contents, staff notes,
prior actions, private tracking history, and local database IDs are also
excluded. Gateway telemetry records capability, version, model, duration,
outcome, status, and token counts only.

## Shared controls

- `store: false` is included in every Responses API request.
- Strict JSON Schema and Zod validation gate every model result before it can
  reach local business logic.
- Per-capability prompt versions, bounded input schemas, output-token ceilings,
  latency timeouts, and per-member rate limits form the task cost budget.
- Global concurrency defaults to four and is bounded to 1–20 by
  `VEUD_AI_MAX_CONCURRENCY`.
- Authentication/quota/rate-limit/server failures open a capability-local
  circuit; normal deterministic workflows remain usable.
- `VEUD_AI_ENABLED=false` is the global kill switch. Each capability also has an
  independent `VEUD_AI_<CAPABILITY>_ENABLED` switch listed in `.env.example`.
- `OPENAI_DEFAULT_MODEL` sets the evaluated default. A capability can be
  overridden with `OPENAI_<CAPABILITY>_MODEL` without changing another workflow.
- The private operations dashboard reports enabled state, requests, success,
  fallback, p95 latency, and aggregate input/output tokens without content.

## Mutation and authorization invariants

Model output never contains or selects a database ID and never calls a mutation
route. Tracking commands resolve all names locally, reject ambiguous or
incompatible operations, hash source state into an expiring preview, and apply
only after owner confirmation in one transaction. Replay is idempotent, stale
previews fail, and undo is permitted only while the resulting state still
matches the journal.

Import assistance cannot run on matched rows, cannot select a candidate, and
cannot apply an import. Review assistance cannot save or publish. Moderation
assistance cannot dismiss, prioritize, hide, warn, suspend, decide appeals, or
change roles. Moderators retain the complete non-AI workflow when triage is
disabled.

## Image and transient-data handling

Image TOMT accepts JPEG, PNG, or WebP only after magic-byte, MIME, decoded
metadata, dimension, pixel-count, and six-megabyte checks. Sharp re-encodes to a
bounded JPEG in memory, strips metadata, and caps the longest dimension at 1,536
pixels. Remote URLs and catalog thumbnails are not accepted. Import uploads also
remain request-local; neither raw upload type is stored as an AI artifact.

## Evaluation and rollout

`tests/fixtures/ai/offline-evaluation.json` covers every capability and includes
media-kind confusion, multilingual and alternate titles, compound discovery,
ambiguity, import noise, spoiler language, moderation dialect/context, refusals,
prompt injection, and privacy exclusions. Service tests additionally capture
outbound bodies, malformed structured output, timeouts/fallbacks,
rate/circuit/concurrency behavior, authorization, idempotency, stale previews,
transactional activity, rollback, duplicate and wrong-kind handling, and hostile
moderation evidence.

Release progression is operator-controlled: keep a capability off until its
offline and browser gates pass, enable it for staff verification, then for a
bounded operational observation window, and finally for broader use. This
release may proceed to broad availability only after all gates below pass.
Because moderation assessments do not alter ordering or enforcement, override
rate baselines remain a prerequisite for any future use in default queue
ordering.

## Blocking release gates

- Clean ESLint, TypeScript/route generation, formatting, and diff checks.
- All Vitest tests under coverage, including offline evaluations and outbound
  privacy snapshots.
- SQLite migrations from empty and PostgreSQL migrations from an empty, isolated
  database with zero drift; query smoke and cleaned load test.
- Production build, clean server artifact, and every checked raw/gzip bundle
  budget.
- Complete Chromium suite including keyboard, touch/mobile, WCAG A/AA,
  reduced-motion, hidden-tab animation pause, and visual baselines.
- Complete and production-only dependency audits, credential scan, release
  fixture audit, backup/restore verification, and HTTPS production smoke.
- Fresh provider popularity diagnostics with no raw cross-provider ordering.
- Exact fixture cleanup only after a fresh restore-verified production backup;
  any unexpected relation fails closed for manual review.

## Retention, deletion, and export

Natural discovery sessions expire after two hours. Pending tracking previews
expire after twenty minutes and undo journals after twenty-four hours.
Import-derived hypotheses follow the private import batch lifecycle. Moderation
assessments are deleted with their report and remain staff-only. Durable
member-owned AI artifacts are included in account export and cascade on account
deletion. Gateway telemetry is process-local, content-free, and capped at 500
events.

## Release evidence

The 2026-07-24 candidate passed 132 Vitest files and 531 unit/integration tests;
83 of 83 Chromium workflows; ESLint, TypeScript, formatting, diff, and
credential-pattern checks; production builds and every bundle budget; all 39
SQLite migrations from empty; and all 16 PostgreSQL migrations from an empty
isolated database with zero drift. PostgreSQL write/search/import smoke checks
and a cleaned 2,000-row concurrent catalog load passed. Complete and
production-only npm audits both reported zero vulnerabilities.

Before production migration, a 283.19 MB backup covering 9 users, 35 watchlists,
5,484 entries, 1,565,817 media rows, and 13 migrations was restored and
verified, then copied to the separate backup drive. Production applied
migrations 14–16. The fail-closed release audit matched the one exact isolated
fixture account and five exact browser-fixture media records, removed them under
the fresh backup receipt, and then reported zero fixture-family or provider-less
fixture records. Other `example.com` accounts remain untouched for explicit
review.
