# Configurable home dashboard

Signed-in members can arrange the home page around six account-synced modules:
Trending, Continue, Recommendations, Following activity, Your library, and
Release alerts.

## Preference contract

- Density is either `comfortable` or `compact`.
- Module order always contains every supported module exactly once.
- Collapsed modules remain visible as compact headers and can be expanded in
  place.
- Invalid or stale stored values are repaired to the safe defaults. Newly added
  modules are appended automatically so schema evolution does not hide them.
- Preferences are private, use no-store mutation responses, are included in a
  member's data export, and are removed with the member account.

The preference action accepts a complete ordered set rather than individual
move operations. This keeps each saved configuration internally consistent.

## Loading behavior

The loader resolves the preference before personalized home data. Collapsed
modules skip their associated catalog, social, recommendation, release, and
tracking queries. Expanding a module saves the preference and route
revalidation loads that module's current data.

Anonymous visitors retain the public Trending home page and do not create or
load dashboard preferences.

## Quality boundaries

Unit coverage protects normalization, validation, private persistence, export,
and collapsed-module loading. Production-browser coverage protects cross-reload
ordering, density, collapsed state, recommendation/continuation rendering, and
mobile overflow. The signed-in dashboard is also part of the automated WCAG
gate.

## Release evidence

Application commit `1bde56cc8d407b4f9c924c378ce2e24ef8cb29fa` was deployed
as an immutable release to the isolated PostgreSQL staging environment on
2026-07-23.

- A fresh install audited 1,431 packages with zero vulnerabilities.
- Both staging databases applied the dashboard-preference migration, reported
  no schema drift, and passed the PostgreSQL write/search smoke checks.
- All 393 unit and integration tests, lint, type checking, the production
  build, and every checked client bundle budget passed.
- Focused production-browser coverage passed the preference, cross-reload,
  continuation, recommendation, 390-pixel overflow, and signed-in WCAG flows.
  The complete accessibility and visual-regression gate passed 18 of 18 tests.
- The public HTTPS acceptance matrix passed 192 of 192 requests at p95
  128.932 ms. The active release symlink resolved to the exact application
  commit above, core services and backup timers were active, and post-deploy
  application logs contained no errors.
