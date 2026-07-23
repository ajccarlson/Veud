# Watchlist client performance

## Responsive module boundary

The watchlist route chooses its view after hydration with the same `56rem`
breakpoint used by the layout CSS. Mobile clients import the card view, while
larger clients import AG Grid and its theme. The initial server and client
render both use a neutral loading state, so the boundary does not create a
hydration mismatch.

List-entry state lives above both lazy modules. A mutation made in one layout
therefore survives resizing into the other layout. A local error boundary gives
failed dynamic imports a clear retry action instead of leaving the list blank.

Quick Add, the advanced entry editor, TMDB helpers, and MAL helpers are also
loaded only when their corresponding interaction needs them.

## Production measurements

The pre-change production watchlist JavaScript chunk was 888.97 kB raw and
229.90 kB gzip. The production build after splitting reports:

| Asset                     |       Raw |      Gzip | Loaded on a fresh mobile list |
| ------------------------- | --------: | --------: | ----------------------------- |
| Watchlist route bootstrap |   5.1 KiB |   2.0 KiB | Yes                           |
| Mobile watchlist view     |   6.1 KiB |   2.3 KiB | Yes                           |
| Advanced entry editor     |   9.2 KiB |   3.2 KiB | After Quick Edit              |
| Desktop AG Grid view      | 850.0 KiB | 217.8 KiB | No                            |
| Watchlist route CSS       |  19.9 KiB |   4.1 KiB | Yes                           |
| Desktop grid CSS          | 193.4 KiB |  32.0 KiB | No                            |

Shared utility chunks are reported separately by the bundler. The browser
regression test observes real network requests and verifies that a fresh mobile
list does not request the desktop grid, desktop theme, advanced editor, catalog
search, TMDB helper, or MAL helper. It then verifies that Quick Add and Quick
Edit fetch their own modules while the desktop grid remains unloaded.

## Guardrails

`npm run bundle:check` checks raw and gzip limits for every watchlist boundary
asset after `npm run build`. The GitHub build job runs this check immediately
after compilation. The budgets leave normal implementation headroom but fail
large regressions before they can silently restore the monolithic route.

`tests/e2e/list-reliability.test.ts` protects both network isolation and
desktop-to-mobile state continuity in a production browser.

The desktop module remains intentionally large because it contains AG Grid.
Replacing that dependency or creating a smaller desktop table is a separate
product decision; this boundary keeps its cost off mobile clients in the
meantime.
