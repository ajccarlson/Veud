# Profile visual system

Profile pages use one responsive presentation layer across Overview, Reviews,
Diary, Collections, Stats, Favorites, Activity, and Social. It retains Veud's
dark plum, mint, cream, and amber identity while giving every tab the same
spacing, hierarchy, surface, and state conventions.

## Shared structure

- The banner, identity, social counts, and primary actions form one bounded hero
  card rather than separate floating regions.
- Profile navigation is a single-row, icon-labeled tab rail. It remains visible
  during scrolling and uses native horizontal overflow on narrow screens instead
  of wrapping labels into multiple rows.
- Tab content shares one maximum width and reusable page header, section
  heading, panel, metadata badge, and empty/error-state treatments.
- Reviews, diary rows, favorites, activity, comments, collections, and charts
  use the same border, radius, elevation, typography, and focus conventions.

## Responsive behavior

Desktop keeps identity and actions in one horizontal hero and displays summary
cards in three columns. Tablet reduces cards and collections to two columns.
Phone layouts use a compact stacked hero, full-width primary actions, a
horizontally scrollable tab rail, one-column summary cards, two-column poster
shelves, and bounded chart surfaces.

The profile surface clips accidental inline overflow without preventing the tab
rail or chart areas from using their intentional local scrolling behavior.

## Interaction states and accessibility

- Tab links and selector buttons have visible keyboard focus and at least a
  40-pixel target.
- Type switchers use semantic buttons with accessible previous, choose, and next
  labels.
- Child navigation exposes an animated progress bar plus a polite screen-reader
  status while preserving the current tab until the next payload is ready.
- Every profile child route has a consistent recoverable error state. Empty
  states explain what belongs in the section and, where relevant, how the owner
  can populate it.
- Motion is reduced when the operating system requests reduced motion.

## Data consistency

Analytics Decimal fields are normalized to plain numbers at the loader boundary.
This keeps server rendering and browser hydration deterministic and prevents the
Stats watchlist chart from changing a valid mean score to `N/A` after hydration.

## Regression contract

The profile browser test visits every tab at a 390-pixel viewport and verifies:

- the profile surface has no accidental horizontal overflow;
- all tabs remain on one locally scrollable row;
- the mobile hero stays bounded;
- each tab exposes its intended page heading;
- server and client Stats values agree without hydration errors;
- the desktop summary cards return to a single three-card row.
