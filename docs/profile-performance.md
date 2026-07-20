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

Stats renders only the selected chart. Switching chart types no longer builds
all eight Nivo chart trees or scans the analytics entries for hidden charts.

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
