# Final roadmap audit

Last updated: 2026-07-23

This audit closes the implementation roadmap with a repository-wide review of
Veud's application, data, operations, and release boundaries. It supplements the
feature-specific evidence in `ROADMAP.md` and the documents in this directory.
The current source candidate is the `import-release-audit` branch based on the
promoted `develop` release line.

## Reviewed surfaces

- Route registration, root data loading, error boundaries, navigation,
  authentication, onboarding, password recovery, OAuth, two-factor
  authentication, and account settings.
- Homepage modules, global discovery and memory search, catalog detail pages,
  calendars and reminders, reviews, collections, profiles, social actions,
  notifications, and data export.
- Watchlist creation, settings, visibility, default sorting, quick add, advanced
  editing, row deletion, reordering, cross-list movement, favorites, desktop
  grids, and compact mobile cards.
- SQLite and PostgreSQL Prisma schemas, all migrations, catalog ingestion and
  quality operations, backups, restore verification, staging services, and
  deployment automation.
- Server trust boundaries, canonical URLs, rate limiting, uploads, remote
  images, outbound requests, email delivery, session lifecycle, CI permissions,
  dependency installation, browser isolation, and release gates.
- Desktop, narrow mobile, keyboard, reduced-motion, accessibility, screenshot,
  bundle-budget, and end-to-end interaction coverage.

## Corrections made by the audit

### Authentication and account safety

- Canonical application URLs no longer trust an arbitrary request host in
  production. `VEUD_ORIGIN` is validated when supplied and otherwise falls back
  to Veud's canonical HTTPS origin. Inline public environment data is escaped
  before it is written into HTML.
- Password resets revoke all existing sessions. Password changes revoke every
  other session while preserving the session that performed the verified change.
  Reset verification records are replaced instead of accumulating.
- Password and email changes require the current password. Account deletion
  requires both the current password and a recent authenticated session.
  Password forms validate on submit so failed attempts do not prematurely clear
  browser-managed password fields.
- Password-recovery responses no longer disclose whether an account exists.
  Login continues to accept either username or email.
- OAuth logs no longer include authorization codes or raw callback queries.
  Provider avatars require HTTPS, bounded downloads, an approved redirect chain,
  a supported image signature, and a supported content type.
- Email delivery fails closed when delivery is unavailable and normalizes
  provider failures without exposing credentials or internal responses.

### Request, file, and network boundaries

- The health check only probes the configured same-origin service and cannot be
  redirected into an arbitrary internal or external target.
- Proxy-derived client addresses are accepted only through the configured
  trusted-proxy boundary. Malformed encoded log payloads are handled without
  taking down request processing.
- Media relay requests use an explicit host and path allowlist. They no longer
  proxy arbitrary URLs or unsupported provider assets.
- Uploaded profile photos and banners must match their claimed supported image
  signature and receive `nosniff` response protection.
- Media links reject non-HTTP(S) protocols.
- Follow and profile-comment mutations now use bounded JSON bodies at static
  resource endpoints instead of embedding user-controlled content in paths. The
  routes validate ownership, identifiers, message length, and content type.

### Data integrity and privacy

- Watchlists have a monotonic `mutationVersion` in both database schemas. Add,
  delete, reorder, move, and empty-row cleanup operations use compare-and-swap
  updates so concurrent tabs cannot silently overwrite each other.
- List creation and settings updates use explicit schemas and allowlisted
  fields. Owner identifiers, protected schema data, and unexpected properties
  cannot be mass-assigned by clients.
- Deleting rows and cleaning empty rows normalize positions in the same
  transaction. Cross-list operations preserve strict media/list compatibility.
- Profile history tolerates malformed legacy JSON and invalid dates, avoids
  duplicate same-day progress, and correctly aggregates episodes, chapters, and
  volumes.
- Account-email changes and deletion are protected by current-password checks.
  Social mutations remain owner-scoped, and private-list data stays out of
  public activity and recommendation signals.
- Member-owned MAL, AniList, Trakt, and Letterboxd exports now use bounded,
  kind-aware reconciliation, an explicit conflict preview, a single atomic apply
  transaction, exact owner-scoped journals, and guarded all-or-nothing rollback.
  Existing imported progress remains visible through the legacy list counters,
  and first-release journals remain rollback-compatible.

### Reliability, performance, and release safety

- Ordinary profile-tab navigation no longer reloads the stable root shell. Route
  and browser tests protect the improvement.
- The account menu is now an actual labelled button with semantic menu actions;
  logout no longer depends on a nested form/button that can detach while the
  menu closes.
- The compact header remains usable at narrow widths, and the intentional mobile
  screenshot baseline was refreshed.
- Hosted GitHub Actions are manual-only while the monthly allowance is
  constrained. Equivalent application, PostgreSQL, and staging gates are exposed
  as local `validate:release:*` commands and run before promotion. Browser email
  links are forced to the disposable local origin so production-mode tests can
  never target the live site.
- The SQLite and PostgreSQL schemas include the same watchlist revision
  migration. Disposable browser databases apply every migration from an empty
  database.
- Every response now carries a generated request ID. Production request logs are
  structured, exclude query strings, client addresses, and bodies, and redact
  secret-like error values. Health responses identify the release and
  environment.
- A least-privilege `site-operator` role can inspect bounded process, request,
  integration, and database readiness at `/admin/operations`. Operators can
  publish append-only incident updates to `/status` without unrelated
  administrator access.
- Invalid root form submissions now fail as client errors instead of producing
  server failures. Clients with stale deployment chunks perform one
  cooldown-protected recovery reload, avoiding a persistent broken session
  without creating a reload loop.

## Release evidence

The final local candidate passed:

- ESLint and TypeScript/React Router type generation.
- 122 Vitest files and 498 unit/integration tests.
- All 36 SQLite migrations from an empty database and an up-to-date migration
  status check.
- PostgreSQL schema synchronization and Prisma validation.
- Production client and server builds.
- Every checked raw and gzip client-bundle budget.
- 80 of 80 Chromium end-to-end tests in one clean full-suite run, including
  authentication, two-factor login, account deletion, settings, social actions,
  list reliability, responsive routes, accessibility, reduced motion, and
  screenshot baselines.
- Fresh npm audits of both the production-only and complete dependency graphs,
  each reporting zero known vulnerabilities.
- A credential-pattern scan. Matches are limited to documented local/test
  PostgreSQL examples; no access tokens or private keys are tracked.

The production build still reports two non-blocking upstream AG Grid Sass
deprecations and a size warning for the deferred desktop watchlist grid. The
checked bundle budget passes at 850.0 KiB raw / 217.8 KiB gzip, and mobile
clients do not load that desktop-only module.

## Operational acceptance

The cross-platform import production line through `main` commit `f2696ed` passed
isolated PostgreSQL, staging, and production acceptance on 2026-07-23:

- The archived source generated its PostgreSQL client and built successfully.
- The atomic library-import migration applied to both `veud_staging` and
  `veud_staging_load`. Both databases reported migration 13, no pending
  migrations, and no schema drift.
- PostgreSQL schema, `pg_trgm` indexes, model writes, portable searches, and the
  atomic import/rollback boundary passed the production smoke probe.
- The application restarted on Node 22, returned a healthy database-backed
  response, and remained reachable through the Cloudflare HTTPS boundary.
- The staging matrix passed 24 of 24 HTTPS requests at 90.025 ms p95. After
  promotion, the production matrix passed 192 of 192 requests across eight
  routes at 677.207 ms p95, including security-header, origin, status, content,
  and latency checks. Health responses identified the exact release and
  environment.
- PostgreSQL 16.14, the application, daily backup timers, digest delivery, and
  all enabled MAL/TMDB inventory and hydration workers were healthy. Catalog
  telemetry reported zero provider rate-limit responses.
- Fresh pre- and post-migration backups were written, restored into the
  verification database, checked at migrations 12 and 13 respectively, and
  copied to the physically separate backup drive. The final receipt covered 9
  users, 35 watchlists, 5,484 entries, and 1,565,817 media rows.

MAL and TMDB hydration are intentionally resumable operational processes, not
release blockers while their queues continue to drain without errors. External
AI processing must continue to exclude MAL-derived content.

## Transformative follow-on opportunities

These are intentionally new product/operations work rather than defects in the
completed roadmap:

1. Replace the remaining AG Grid desktop editor with a smaller headless,
   virtualized list workspace. A shared typed command layer could power desktop
   table, mobile cards, bulk edits, undo/redo, and collaborative conflict
   resolution without shipping the full grid framework.
2. Move recommendations toward offline candidate generation plus incremental
   personalization, with diversity controls, cold-start onboarding, explicit
   explanations, evaluation datasets, and opt-out controls. Keep MAL metadata
   outside external AI systems.
3. Replace process-local telemetry with OpenTelemetry export and durable
   time-series SLOs when Veud moves beyond its single-host deployment. The
   current bounded dashboard deliberately avoids that dependency early.
4. Evolve imports into portable scheduled sync adapters only where provider
   terms and member authorization allow it. Preserve the current preview,
   owner-scoped provenance, atomic mutation, and guarded rollback boundaries
   instead of turning external accounts into silent sources of truth.
