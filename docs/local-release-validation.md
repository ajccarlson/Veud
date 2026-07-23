# Local release validation

GitHub-hosted quality gates are intentionally manual-only. Routine pull
requests, branch pushes, and Dependabot updates do not start hosted runners.
Before a feature branch is merged into `develop`, and again before `develop` is
promoted to `main`, Codex runs the equivalent checks in the release workspace.

## Application gate

From a clean dependency installation:

```sh
npm ci
cp .env.example .env
npm run test:e2e:install
npm run validate:release
npm audit --audit-level=high
```

`validate:release` runs generated-icon verification, ESLint, TypeScript, Vitest
with coverage, the production build, client-bundle budgets, and the Chromium
acceptance suite. Test databases are disposable SQLite databases; the command
must never point `DATABASE_URL` at staging or production.

## PostgreSQL gate

Run the database gate only against an empty, isolated PostgreSQL database:

```sh
DATABASE_URL=postgresql://.../veud_release_gate \
  npm run validate:release:postgres
```

This generates the PostgreSQL Prisma client, applies and verifies migrations,
smoke-tests application queries, and exercises the catalog load harness with
cleanup. Never run the load gate against staging or production.

## Staging gate

After deploying the exact reviewed revision:

```sh
npm run staging:check -- \
  --base-url https://staging.example.com \
  --repeat 3 \
  --run
```

Record the commit, database identity, gate results, deployment health, and
acceptance evidence in the relevant release audit document.

## Emergency hosted validation

The **Manual quality gates** workflow remains available through GitHub's Actions
interface. Choose `app`, `postgres`, `staging`, or `all`. The staging suite
requires an HTTPS `staging_url`. It should be used only when independent hosted
evidence is materially useful.

Branch rules must not require the old automatic job names; otherwise GitHub will
wait forever for checks that are no longer triggered.
