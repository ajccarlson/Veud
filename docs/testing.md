# Testing

Use the smallest relevant checks while developing, then run the release gate
before promotion.

## Standard checks

```sh
npm run lint
npm run typecheck
npm run test -- --run
npm run build
npm run bundle:check
```

Vitest uses a disposable SQLite database. If the generated Prisma client
currently targets PostgreSQL, regenerate the SQLite client first:

```sh
npm run prisma:generate:sqlite
```

## Browser tests

Install Chromium once:

```sh
npm run test:e2e:install
```

Run the browser suite in CI mode:

```sh
PORT=4122 npm run test:e2e:run
```

Use an unused port. Port `4022` is reserved by the repository's local staging
deployment.

Accessibility and representative visual checks run with:

```sh
PORT=4122 npm run test:e2e:gates
```

Update screenshots only for intentional visual changes:

```sh
PORT=4122 npx playwright test tests/e2e/visual-regression.test.ts \
  --project=chromium --update-snapshots
```

Inspect every changed image at native size and rerun without
`--update-snapshots`.

## Release gates

The application release gate runs static checks, unit coverage, the production
build, bundle budgets, and Chromium acceptance:

```sh
npm run validate:release
```

The PostgreSQL gate must target a new, isolated database:

```sh
DATABASE_URL=postgresql://.../veud_release_gate \
  npm run validate:release:postgres
```

Never run this command against staging or production. It applies migrations,
checks drift, runs smoke queries, and exercises the load harness.

After deploying staging:

```sh
npm run staging:check -- \
  --base-url https://staging.example.com \
  --repeat 3 \
  --run
```

Browser automation does not replace keyboard, focus, screen-reader, mobile, and
authenticated workflow review for changed interfaces.
