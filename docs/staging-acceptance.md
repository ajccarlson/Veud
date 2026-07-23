# Staging release acceptance

Last updated: 2026-07-21

Veud's staging gate has two layers: deterministic release checks run locally
before promotion and a read-only canary against the deployed HTTPS origin.
Authenticated acceptance is deliberately manual because it uses a disposable
member and mutates only the isolated staging database.

## Environment boundary

Staging must have its own database, cache database, session and honeypot
secrets, port, backup destination, logs, and provider credentials. Never point a
staging process or acceptance account at the production SQLite file or
PostgreSQL database. Use a verified snapshot copy when representative data is
needed, and keep provider-scale catalog workers disabled until their separate
policy and PostgreSQL gates pass.

Build the exact commit that will be promoted:

```sh
npm ci
npm audit --audit-level=high
npm run build
npx prisma migrate deploy
NODE_ENV=production npm start
```

The current single-host production process remains managed by PM2. A staging
process may use the same release command under an independently named process
manager entry, but it must use a different `PORT`, database, cache, and backup
configuration.

## Local release gate

Before every candidate is committed or promoted, run the complete deterministic
gate documented in [local-release-validation.md](./local-release-validation.md).
It covers lint, typecheck, unit coverage, the production build, client bundle
budgets, critical Playwright workflows, dependency auditing, and the isolated
PostgreSQL schema/query/load gate.

GitHub Actions is intentionally manual-only to conserve the repository's hosted
Actions allowance. The `Release operations` workflow can be started through
**Run workflow** when an off-machine recheck or deployment is useful; pushes and
pull requests do not consume hosted minutes automatically.

After deploying the candidate, preview the canary configuration:

```sh
npm run staging:check -- --base-url https://staging.example.com
```

Then execute three read-only passes per route:

```sh
npm run staging:check -- \
  --base-url https://staging.example.com \
  --repeat 3 \
  --run
```

Remote targets must use HTTPS and cannot include credentials, paths, query
strings, or fragments. The canary remains on the supplied origin and checks the
database-backed health endpoint, homepage, discovery, calendar, reviews,
collections, provider credits, and login. It rejects wrong content, failed or
off-origin responses, missing CSP/referrer/content-type-protection headers,
exposed Express identity, and p95 latency over two seconds. The private JSON
report is written under `test-results/`.

The GitHub workflow can run the same check through **Run workflow** by supplying
the deployed staging origin. Its report is retained as a workflow artifact.

## Authenticated acceptance

Use a disposable staging-only account and check both a 390-pixel phone viewport
and a desktop viewport:

1. Sign in and sign out; verify password recovery uses the staging mail path.
2. Search each media type and confirm incompatible list types cannot be chosen.
3. Add two titles in one session from search and trending.
4. Reorder by position input and touch-friendly controls; delete an entry and
   confirm positions update immediately.
5. Move an entry across compatible lists and confirm incompatible destinations
   remain unavailable.
6. Open quick edit, update hidden details, change default sorting, and verify a
   private list is absent from another account and direct URLs.
7. Switch Live Action, Anime, and Manga list families without refreshing.
8. Visit every profile tab, notifications, collections, media details, and the
   release calendar; confirm no horizontal document overflow.
9. Exercise Tip of My Tongue only when the staging OpenAI key is intentionally
   enabled; otherwise confirm its unavailable state is clear.
10. Inspect server errors, browser console errors, backup output, and the
    database health endpoint before approval.

Record the release commit, staging origin, database identity (never its
credentials), automated report, tester, start/end time, failures, and final
approve/reject decision. A failing canary or functional check blocks promotion;
repair the candidate and repeat the entire gate instead of waiving a failure.
