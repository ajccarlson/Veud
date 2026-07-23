# Production PostgreSQL cutover evidence

Date: 2026-07-23  
Deployment owner and incident owner: Veud deployment owner  
Released application commit: `6635274b5007589af7dcf20a7d83f8001bc59281`

## Outcome

Veud's production application now uses the isolated local PostgreSQL 16 database
at the guarded `veud_production` identity. The application does not point at
either staging database. PostgreSQL remains bound to loopback port 5433, its
user service is enabled at boot and active, and no database port is published
through the router or Cloudflare tunnel.

Production was restarted from exact released `main` with one PM2 application
instance. The provider-aware backup worker completed its first PostgreSQL backup
and stopped normally; its hourly PM2 schedule remains saved for boot recovery.

## Pre-cutover rollback evidence

General application writes were stopped before the final SQLite snapshots.

- The stopped pre-migration online snapshot passed SQLite integrity and
  foreign-key checks with 9 users, 35 watchlists, 5,484 entries, 5,377 media
  records, and 28 applied migrations.
- Its SHA-256 was
  `464dbe0d07a4812c26306ad77b528fab344dafbf5900fe589b02f7f84cab3f99`, exactly
  matching the canonical snapshot used to seed the prepared PostgreSQL target.
  This proves no user-owned production data changed between seeding and the
  maintenance window.
- The snapshot is retained on the production data drive and independently at
  `/media/sdd/veud-production-backups/rollback/`.
- Six pending SQLite migrations were then applied successfully. A second,
  release-compatible SQLite snapshot passed integrity, foreign-key, required
  migration, count, restore, and independent-copy checks with 34 recorded
  migrations.
- The prior environment is retained mode `0600` at
  `/media/sde/veud-production/config/sqlite-cutover.env`.

These SQLite artifacts are historical rollback evidence, not a writable primary.
PostgreSQL accepted a successful self-cleaning model-write smoke test before
traffic opened. From that boundary onward, recovery is forward repair on
PostgreSQL or restore from a verified PostgreSQL archive; the old SQLite file
must never overwrite newer PostgreSQL writes.

## PostgreSQL data and schema gates

The production target was restored from the approved, receipt-verified catalog
archive, migrated, and restored into the disposable production restore database
before selection.

The final post-selection status gate reported:

| Gate                                  |    Result |
| ------------------------------------- | --------: |
| PostgreSQL version                    |     16.14 |
| Users                                 |         9 |
| Watchlists                            |        35 |
| Entries                               |     5,484 |
| Media                                 | 1,565,817 |
| PostgreSQL migrations                 |        10 |
| Pending migrations                    |         0 |
| Schema drift                          |      none |
| Model-write and portable-search smoke |    passed |

The production and restore roles are separate, `PUBLIC` database access is
rejected, and credentials are stored outside the repository in mode-`0600`
configuration.

## Runtime and backup gates

- Local health at port 4021: `OK`.
- Public health at `https://veud.net/resources/healthcheck`: `OK`.
- Public acceptance: 192/192 requests passed across health, home, discovery,
  calendar, reviews, collections, credits, and login; p95 was 525.272 ms while
  the first production backup was running.
- PM2: one `veud` instance online with zero restarts.
- PM2 backup worker: completed successfully and stopped with zero restarts,
  confirming the one-shot process no longer retains the SQLite worker's idle
  handle.
- Initial PostgreSQL archive:
  `/media/sde/veud-production/backups/postgres-2026-07-23T18-16-55-746Z.dump`.
- Archive size: 296,913,080 bytes.
- Archive SHA-256:
  `d5365e6a5cf3906e9055320f227dffd64aa7df42d1f4e3a3b4348e108ac26e75`.
- The archive was restored into the disposable verification database, checked
  for the configured production account identity and exact core counts, and
  copied with a matching receipt to `/media/sdd/veud-production-backups/`.

The off-drive filesystem had approximately 465 GB free at cutover but was 94%
utilized. Free-space and retention monitoring remains operationally important.

## Dependency security reconciliation

The exact local and `origin/main` lockfiles had matching SHA-256 values. Fresh
full and runtime-only npm audits both reported zero vulnerabilities.

GitHub nevertheless retained eight old, inconclusive Dependabot alerts:

- Vite alerts 7, 11, and 12 referenced versions no newer than 6.4.2; released
  `main` resolves Vite 8.1.5.
- Vitest alert 9 referenced versions older than 3.2.6; released `main` resolves
  Vitest 4.1.10.
- Alerts 2, 3, 4, and 5 referenced `@remix-run/react`, `@remix-run/node`, and
  `@remix-run/server-runtime`; none of those packages exist in the released
  manifest or lockfile.

Each alert was dismissed as inaccurate with its package-specific lockfile and
audit evidence. GitHub then reported zero open Dependabot alerts. Automated
Dependabot security-update pull requests were enabled so future actionable
alerts create remediation branches.

## Verification commands

The release used these repository gates:

```sh
npm test -- --run
npm run lint
npm run typecheck
npm run prisma:generate:postgres
npm run build
npm run db:verify:postgres
npm run db:smoke:postgres
npm run production:postgres:status
npm run staging:check -- --base-url https://veud.net --repeat 24 --run
npm audit
npm audit --omit=dev
```

The application gate covered 448 passing tests after the cutover path hotfix.
