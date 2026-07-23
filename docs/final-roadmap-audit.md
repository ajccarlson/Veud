# Final roadmap audit

Last updated: 2026-07-23

This audit closes the implementation roadmap with a repository-wide review of
Veud's application, data, operations, and release boundaries. It supplements
the feature-specific evidence in `ROADMAP.md` and the documents in this
directory. The source candidate is the
`final-roadmap-comprehensive-audit` branch based on `develop` commit
`251003b619f1`.

## Reviewed surfaces

- Route registration, root data loading, error boundaries, navigation,
  authentication, onboarding, password recovery, OAuth, two-factor
  authentication, and account settings.
- Homepage modules, global discovery and memory search, catalog detail pages,
  calendars and reminders, reviews, collections, profiles, social actions,
  notifications, and data export.
- Watchlist creation, settings, visibility, default sorting, quick add,
  advanced editing, row deletion, reordering, cross-list movement, favorites,
  desktop grids, and compact mobile cards.
- SQLite and PostgreSQL Prisma schemas, all migrations, catalog ingestion and
  quality operations, backups, restore verification, staging services, and
  deployment automation.
- Server trust boundaries, canonical URLs, rate limiting, uploads, remote
  images, outbound requests, email delivery, session lifecycle, CI
  permissions, dependency installation, browser isolation, and release gates.
- Desktop, narrow mobile, keyboard, reduced-motion, accessibility, screenshot,
  bundle-budget, and end-to-end interaction coverage.

## Corrections made by the audit

### Authentication and account safety

- Canonical application URLs no longer trust an arbitrary request host in
  production. `VEUD_ORIGIN` is validated when supplied and otherwise falls back
  to Veud's canonical HTTPS origin. Inline public environment data is escaped
  before it is written into HTML.
- Password resets revoke all existing sessions. Password changes revoke every
  other session while preserving the session that performed the verified
  change. Reset verification records are replaced instead of accumulating.
- Password and email changes require the current password. Account deletion
  requires both the current password and a recent authenticated session.
  Password forms validate on submit so failed attempts do not prematurely clear
  browser-managed password fields.
- Password-recovery responses no longer disclose whether an account exists.
  Login continues to accept either username or email.
- OAuth logs no longer include authorization codes or raw callback queries.
  Provider avatars require HTTPS, bounded downloads, an approved redirect
  chain, a supported image signature, and a supported content type.
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
  resource endpoints instead of embedding user-controlled content in paths.
  The routes validate ownership, identifiers, message length, and content type.

### Data integrity and privacy

- Watchlists have a monotonic `mutationVersion` in both database schemas.
  Add, delete, reorder, move, and empty-row cleanup operations use compare-and-
  swap updates so concurrent tabs cannot silently overwrite each other.
- List creation and settings updates use explicit schemas and allowlisted
  fields. Owner identifiers, protected schema data, and unexpected properties
  cannot be mass-assigned by clients.
- Deleting rows and cleaning empty rows normalize positions in the same
  transaction. Cross-list operations preserve strict media/list compatibility.
- Profile history tolerates malformed legacy JSON and invalid dates, avoids
  duplicate same-day progress, and correctly aggregates episodes, chapters,
  and volumes.
- Account-email changes and deletion are protected by current-password checks.
  Social mutations remain owner-scoped, and private-list data stays out of
  public activity and recommendation signals.

### Reliability, performance, and release safety

- Ordinary profile-tab navigation no longer reloads the stable root shell.
  Route and browser tests protect the improvement.
- The account menu is now an actual labelled button with semantic menu actions;
  logout no longer depends on a nested form/button that can detach while the
  menu closes.
- The compact header remains usable at narrow widths, and the intentional
  mobile screenshot baseline was refreshed.
- CI uses `npm ci`, least-privilege workflow permissions, PostgreSQL checks, and
  the complete browser suite. Browser email links are forced to the disposable
  local origin so production-mode tests can never target the live site.
- The SQLite and PostgreSQL schemas include the same watchlist revision
  migration. Disposable browser databases apply every migration from an empty
  database.

## Release evidence

The final local candidate passed:

- ESLint and TypeScript/React Router type generation.
- 106 Vitest files and 445 unit/integration tests.
- All 33 SQLite migrations from an empty database and an up-to-date migration
  status check.
- PostgreSQL schema synchronization and Prisma validation.
- Production client and server builds.
- Every checked raw and gzip client-bundle budget.
- 76 of 76 Chromium end-to-end tests in one clean full-suite run, including
  authentication, two-factor login, account deletion, settings, social
  actions, list reliability, responsive routes, accessibility, reduced motion,
  and screenshot baselines.
- Fresh npm audits of both the production-only and complete dependency graphs,
  each reporting zero known vulnerabilities.
- A credential-pattern scan. Matches are limited to documented local/test
  PostgreSQL examples; no access tokens or private keys are tracked.

The production build still reports two non-blocking upstream AG Grid Sass
deprecations and a size warning for the deferred desktop watchlist grid. The
checked bundle budget passes at 850.0 KiB raw / 217.8 KiB gzip, and mobile
clients do not load that desktop-only module.

## Operational acceptance

The exact committed candidate must still pass the isolated local PostgreSQL
staging deployment before promotion:

1. Archive and install the exact Git commit with `npm ci`.
2. Generate and validate the PostgreSQL client.
3. Build the production application.
4. Apply and verify migrations to both staging databases.
5. Run PostgreSQL write and search smoke checks.
6. Restart the staged application and verify its health endpoint.
7. Confirm HTTPS canary checks, timers, catalog status, live storage, backup
   storage, and restore-tested backup operations.

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
2. Introduce OpenTelemetry traces, structured audit events, error aggregation,
   database/query dashboards, provider health SLOs, and user-visible incident
   status. Release canaries would then enforce latency and error budgets rather
   than only point-in-time health.
3. Add first-class imports and reconciliation for MAL, AniList, Trakt, and
   Letterboxd exports. A previewable conflict resolver should preserve history,
   ratings, rewatch counts, and source provenance without treating an import as
   a destructive replacement.
4. Build a moderation and support console for reports, appeals, review/comment
   actions, privacy requests, catalog corrections, and immutable operator audit
   trails before broad public growth.
5. Move recommendations toward offline candidate generation plus incremental
   personalization, with diversity controls, cold-start onboarding, explicit
   explanations, evaluation datasets, and opt-out controls. Keep MAL metadata
   outside external AI systems.
6. After a restore rehearsal and explicit production approval, perform the
   PostgreSQL production cutover with a written rollback window, row-count and
   checksum comparison, session validation, and post-cutover backup restore.
