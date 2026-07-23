# Accessibility and visual-regression gates

Veud treats keyboard access, automated WCAG checks, reduced motion, and stable
responsive composition as release requirements. The browser gate runs against a
fresh disposable database and never uses development or staging data.

## Run the gates locally

Install Chromium once:

```sh
npm run test:e2e:install
```

Run the accessibility and visual checks together:

```sh
npm run test:e2e:gates
```

The full browser acceptance job also runs these tests in CI. When a test fails,
the workflow retains both the Playwright HTML report and `test-results`
attachments for 14 days.

## Accessibility contract

`tests/e2e/accessibility.test.ts` verifies:

- automated WCAG 2.0/2.1 A and AA rules on primary public routes;
- authenticated profile and account settings;
- media details and the desktop list-tracking surface with deterministic data;
- the expanded mobile navigation;
- keyboard-only skip-link and menu navigation; and
- the global `prefers-reduced-motion` behavior.

Automated scanning is a durable regression gate, not a claim of complete WCAG
conformance. New interactive patterns still need keyboard, focus, label,
contrast, zoom, and screen-reader review. Do not suppress an Axe rule to make a
failure pass. Fix the affected interface or document a narrowly scoped,
standards-based exception.

## Visual contract

`tests/e2e/visual-regression.test.ts` protects a small set of representative,
stable views:

- the credits page at desktop size;
- the same content and mobile navigation shell at phone size; and
- the desktop login form and site shell.

Screenshots use a fixed locale, timezone, dark color scheme, reduced-motion
preference, viewport, hidden caret, and disabled animations. Toasts and progress
indicators are excluded because they are transient. The one-percent pixel
tolerance accommodates minor renderer and font rasterization differences; it
must not be increased to conceal a real layout change.

## Updating baselines

Only update screenshots when the visual change is intentional:

```sh
npx playwright test tests/e2e/visual-regression.test.ts \
  --project=chromium --update-snapshots
```

Then:

1. inspect every changed PNG at its native dimensions;
2. rerun the test without `--update-snapshots`;
3. confirm that unrelated regions did not move or disappear; and
4. commit the snapshots with the interface change that required them.

Prefer stable, representative pages over broad screenshot coverage. Data-heavy,
time-dependent, or personalized pages should first receive deterministic
fixtures and explicit masking before becoming visual baselines.

## 2026-07-23 release evidence

Application commit `12ffe844b49ba46d1b77186af9565ffee7988494` passed:

- ESLint and TypeScript;
- 83 unit files containing 378 tests;
- the exact 47-test CI browser acceptance command;
- all 16 focused accessibility and visual-regression contracts;
- a clean production build and npm audit with zero vulnerabilities;
- PostgreSQL app/load migration and drift verification plus the PostgreSQL smoke
  suite; and
- 24 of 24 HTTPS staging canary requests, with 213.308 ms p95 latency.

The staging app, PostgreSQL service, and backup timer remained active, and the
current staging release symlink resolved to the exact application commit above.
