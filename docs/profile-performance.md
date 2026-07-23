# Profile performance

Profile routes use a stable shell plus tab-specific loaders. The shell contains
identity, follower counts, list-type metadata, and visible watchlist metadata;
it no longer serializes every profile feature on every request.

## Data boundaries

- `users+/$username` loads the stable profile shell. Same-member tab navigation
  does not revalidate it; an explicit refresh, mutation revalidation, or a move
  to another member still does.
- Overview and Stats load the reduced analytics projection. Large entry fields
  such as descriptions, notes, provider metadata, and unused list columns never
  cross the profile JSON boundary.
- Reviews, Diary, Favorites, Collections, and Social load only their own rows.
- Activity combines normalized events with the legacy-history fallback on the
  server, limits the result to the newest 100 items, and sends only
  display-ready feed rows.
- Profile tab links use intent prefetching, so the destination child loader can
  start while a pointer or keyboard focus rests on the tab.

Stats renders and downloads only the selected chart. Switching chart types no
longer builds all eight Nivo chart trees, scans analytics entries for hidden
charts, or includes every Nivo renderer in the Stats route bootstrap.

The Overview completion-history aggregation is a small framework-independent
utility. Its Nivo calendar renderer is imported only when the profile has a
valid month to display. Empty profiles therefore avoid the calendar and shared
Nivo payload entirely. Every deferred visualization has a consistent loading
state and a recoverable error boundary.

## Measurement

The baseline and after measurements used a migrated temporary copy of the local
database and its largest account: 5,391 entries across 17 watchlists. Each
result is the median of five warm direct-loader samples on the same development
machine. These figures establish direction and a local regression reference;
they are not a production latency guarantee.

| Loader                           |  Median before | Payload before | Median after | Payload after |
| -------------------------------- | -------------: | -------------: | -----------: | ------------: |
| Every profile tab / stable shell |       314.7 ms |       9.55 MiB |       1.0 ms |       5.6 KiB |
| Overview analytics               | included above | included above |     171.6 ms |      3.00 MiB |
| Activity                         | included above | included above |      39.8 ms |      31.9 KiB |
| Reviews (empty fixture)          | included above | included above |       0.5 ms |          14 B |
| Diary (empty fixture)            | included above | included above |       0.5 ms |   under 1 KiB |
| Favorites                        | included above | included above |       0.4 ms |       1.2 KiB |

The stable shell is roughly 1,790 times smaller and its warm loader median is
roughly 315 times lower. Most tab changes now request only a small child
payload; the heavyweight analytics projection is limited to Overview and Stats.

## Budgets and observability

Automated tests enforce deterministic budgets with a 500-entry profile that
contains intentionally large descriptions and private notes:

- stable shell payload: less than 32 KiB;
- reduced analytics payload: less than 512 KiB;
- omitted large entry fields must not appear in analytics JSON;
- same-member tab navigation must skip shell revalidation;
- explicit refresh and cross-member navigation must retain revalidation.

Profile loader responses expose `Server-Timing` entries for the total loader,
database phases, and server-side aggregation. Runtime latency varies by storage,
hardware, and deployment load, so the checked-in budgets focus on query shape,
payload size, and navigation behavior rather than a flaky wall-clock assertion.

## Client visualization boundaries

The production client build before visualization splitting reported a
255.18 KiB raw / 74.17 KiB gzip Stats route. The split build reports:

| Asset | Raw | Gzip | Loaded initially |
| --- | ---: | ---: | --- |
| Profile Stats route | 4.4 KiB | 1.8 KiB | On Stats |
| Profile Overview route | 118.9 KiB | 36.0 KiB | On Overview |
| Watchlist overview chart | 22.7 KiB | 7.3 KiB | Default Stats chart only |
| Score distribution chart | 29.3 KiB | 9.7 KiB | When selected |
| Completion-history calendar | 25.1 KiB | 8.0 KiB | Only with completion data |
| Shared Nivo theme/runtime | 176.4 KiB | 60.5 KiB | With the first Nivo chart |

Other Stats visualizations are isolated in their own 16.2–53.3 KiB raw
chunks. Shared Nivo internals remain separate and are cached across chart
changes.

`npm run bundle:check` enforces raw and gzip budgets for both profile routes,
each visualization boundary, and the shared Nivo chunk. The production-browser
profile test also observes actual asset requests: an empty Overview must not
download Nivo, the populated calendar must load on demand, default Stats must
not fetch unselected chart modules, and choosing Score Distribution must fetch
only that newly selected visualization.
