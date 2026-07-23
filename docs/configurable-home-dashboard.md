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
