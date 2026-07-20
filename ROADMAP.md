# Veud product roadmap

This is the living product and engineering roadmap for moving Veud toward the
depth and usability of MyAnimeList, AniList, Trakt, and Letterboxd. Priorities
favor data safety and core tracking workflows before expanding discovery.

Status values: **Now**, **Next**, **Later**, and **Done**.

## Execution order

1. List-grid reliability and data safety
2. Responsive list UX, entry editing, and list privacy
3. Canonical catalog coverage and global search
4. Homepage discovery and quick-add workflows
5. Profile performance and visual polish
6. Optional AI-assisted discovery

Responsive behavior, accessibility, and visual polish are acceptance criteria
for every phase rather than a final cleanup pass.

## Now: list-grid reliability and data safety

These issues can lose data or block the primary tracking workflow, so they are
the immediate `list-grid-reliability` feature batch.

### LIST-001 — Make cross-list moves atomic

- Fix dragging an entry to another list deleting the source without creating the
  target entry.
- A move must create/update the target and remove the source in one server-side
  transaction. If any step fails, the original entry must remain unchanged.
- Add route-level and browser regression coverage for successful moves, rejected
  targets, and failures.

### LIST-002 — Repair manual and drag reordering

- Pressing Enter after typing a position must persist the requested move.
- Row dragging within a list must persist instead of snapping back.
- Positions must be deterministic, unique, and contiguous after a move.
- Concurrent or stale requests must not duplicate or silently discard entries.

### LIST-003 — Allow repeated adds during one session

- Fix the state/request bug that prevents adding another search result after the
  first successful add.
- A member must be able to add several different titles to several lists without
  refreshing or restarting the app.
- Clear stale search, loading, request, and selected-row state after every
  success or failure.

### LIST-004 — Reconcile positions immediately after deletion

- Normalize positions on the server when an entry is deleted.
- Update the visible grid immediately from the mutation response; no refresh
  should be necessary.
- Cover deletion from the beginning, middle, and end of a list.

## Next: responsive list experience

### LIST-005 — Fit the grid to the available viewport

- Replace the fixed-feeling grid length with a layout derived from the current
  viewport and surrounding navigation.
- Keep grid scrolling inside the available area and avoid large blank regions.
- Verify common phone, tablet, laptop, desktop, ultrawide, and zoomed layouts.

### LIST-006 — Make headers readable at every width

- Give important columns usable minimum widths and sensible responsive
  priorities.
- Prevent headers from growing excessively or stacking one character per line.
- Use controlled wrapping, truncation/tooltips, column hiding, or horizontal
  scrolling instead of illegible vertical text.
- Consolidates the squished-header and narrow-screen header-growth issues.

### LIST-007 — Restore all grid icons

- Ensure sort, filter, column-menu, drag, and other AG Grid icons render in
  every theme and production build.
- Add a focused visual/browser assertion for the filter and column-menu icons.

### LIST-008 — Render missing calculated scores as blank

- `Personal`, `Difference Personal`, `TMDB Score`, and `Difference Objective`
  must be blank when their required inputs are absent.
- Never show `NaN`, `Infinity`, or misleading zeroes for unknown values.
- Centralize null-safe numeric parsing and calculation.

### LIST-009 — Improve row actions

- Replace hard-to-discover additional settings with a consistent row action menu
  for insert, delete, move, and advanced edit.
- Keep destructive actions labeled and confirmed where appropriate.
- Support keyboard and touch interaction in addition to pointer input.

### LIST-010 — Add a quick advanced-entry editor

- Add a MAL-style edit action that opens a compact dialog or sheet.
- Allow editing status, progress, score, dates, repeat count, notes, priority,
  and fields currently hidden as grid columns.
- Validate and save all changes through one authoritative server action.

### LIST-011 — Improve cross-list drag positioning

- While dragging over another list tab, switch to that list after a short hover
  delay so the member can choose the destination position.
- Auto-scroll when the dragged row approaches the top or bottom edge.
- Preserve a visible insertion marker and support cancelling without mutation.
- Depends on LIST-001 and LIST-002 being complete first.

### LIST-012 — Build an image-rich quick-add flow

- Show poster, title, year/season, media type, provider, and duplicate/tracking
  state in search results.
- Allow choosing the destination list and initial tracking state before adding.
- Work well as both an improved inline list add and a reusable global quick-add
  component.

### LIST-013 — Support private lists

- Add an explicit visibility setting with safe defaults and clear UI copy.
- Enforce privacy in loaders, mutations, search, profiles, feeds, exports, and
  direct URLs—not only in the client UI.
- Add authorization tests proving private lists and their activity cannot leak.

## Next: canonical catalog and search

### CATALOG-001 — Build broad TMDB and MAL catalog coverage

- Store provider-backed movie, television, anime, and manga records locally so
  recommendations and search are not limited to titles already added by users.
- Begin with a documented feasibility pass covering provider API terms,
  permitted data retention, rate limits, change feeds/dumps, and attribution.
- Implement resumable, idempotent backfills plus incremental refresh jobs.
- Preserve provider provenance, canonical identity deduplication, alternate
  titles, images, genres, credits/studios, popularity, and scoring metadata.
- Track coverage, freshness, failures, and provider quotas operationally.

### SEARCH-001 — Add global media search

- Search canonical titles and alternate titles across all supported media.
- Support useful filters such as kind, year, genre, status, and provider.
- Results must expose tracking state and support direct quick-add.
- Design the index/query boundary so it can scale beyond SQLite if needed.

## Next: homepage discovery

### HOME-001 — Lead with trending media

- Move trending sections to the top of the signed-in and public homepages.
- Keep useful personalized context without delaying the initial trending view.

### HOME-002 — Make trending rails horizontally scrollable

- Show more titles in accessible horizontal carousels with mouse, touch,
  keyboard, and visible previous/next controls.
- Avoid trapping page scrolling and preserve useful card sizes on mobile.

### HOME-003 — Quick-add from trending cards

- Add a title directly to a chosen list/tracking state without leaving home.
- Reuse the quick-add flow from LIST-012 and show immediate saved state.

## Next: profile performance and presentation

### PROFILE-001 — Make profile tab changes fast

- Measure loader, database, serialization, and client-navigation time before
  changing behavior.
- Remove repeated/oversized queries, parallelize independent work, and use
  appropriate caching or prefetching.
- Set and test a navigation performance budget with representative profile
  history rather than an empty fixture.

### PROFILE-002 — Finish the profile visual system

- Establish clearer hierarchy for identity, social actions, navigation,
  statistics, favorites, activity, reviews, diary, and collections.
- Improve spacing, typography, empty/loading/error states, cards, and visual
  consistency while retaining Veud's general color and stylistic identity.
- Treat desktop and mobile layouts as deliberately designed variants.

## Later: optional AI discovery

### SEARCH-002 — “Tip of My Tongue” search

- Let a member describe remembered plot, visual, cast, era, setting, or scene
  details and return the five strongest candidates.
- Show a short summary under each poster with evidence-backed matching details
  highlighted; do not invent supporting facts.
- Support direct add to a selected list.
- Make the feature optional and clearly distinguish AI-ranked results.
- Define privacy, moderation, latency, cost limits, and a non-AI fallback.
- Depends on CATALOG-001 and SEARCH-001 so retrieval is grounded in a broad,
  searchable local catalog.

## Cross-cutting product quality

### DESIGN-001 — Modernize without erasing Veud's identity

- Consolidate reusable typography, spacing, color, surface, button, form,
  loading, empty, and error patterns.
- Polish incrementally alongside feature work instead of doing a risky global
  reskin.

### DESIGN-002 — Mobile and dynamic scaling

- Every changed route must be usable at narrow widths, with touch targets,
  readable text, sensible content priority, and no accidental overflow.
- Test responsive states in browser coverage for the list grid, profiles,
  homepage rails, search, dialogs/sheets, and drag alternatives.
- Provide non-drag controls for every essential drag-and-drop operation.

## Deferred but retained

- Notification channel preferences and digest controls remain planned after the
  list reliability batch; the release-reminder system already supports in-app
  delivery and per-title timing.
