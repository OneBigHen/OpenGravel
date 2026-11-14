# CSS-BLUR (#281) — blur only where a panel sits on the map

## What changed

Twelve CSS rules asked for `backdrop-filter: var(--og-glass-blur)` on panels that never
sit on a map. Each one carried both the `-webkit-` prefixed and the standard declaration,
so 24 declaration lines were removed. No other property was touched, and
`scripts/qa/css-budget.json` was left alone.

The stylesheets were already telling the truth about those surfaces: `src/app/tokens.css`
turns the glass tokens solid on the three map-free page containers

```css
/* 2026-11-10: no map behind these pages, so no glass. */
.og-explore,
.og-library,
.og-settings {
  --og-glass: var(--og-surface);
  --og-glass-dense: var(--og-surface);
  --og-glass-blur: none;
  --og-glass-highlight: none;
  --og-glass-well: var(--og-surface-2);
}
```

Every removed declaration lives inside one of those three containers, and nothing inside
them redefines `--og-glass-blur` (checked: the only definitions are the two theme values
and the three solid scopes in `tokens.css`). So `var(--og-glass-blur)` resolved to `none`,
which is the initial value of `backdrop-filter`: removing the declaration cannot change a
single computed value, a stacking context, or a pixel.

## The removed declarations

Line numbers refer to the files before this change (`git show 3b6872c:<path>`).

| # | File:line | Selector | Surface it sits on | Why it was solid |
|---|---|---|---|---|
| 1 | `src/ui/explore/explore.css:74` | `.og-explore__lens` | Explore, Rides/Hikes switch | Inside `<main class="og-explore">`; the Explore page is a solid page on the fixed topo backdrop, with `--og-glass-blur: none`. |
| 2 | `src/ui/explore/explore.css:114` | `.og-explore .og-explore__search input[type="search"]` | Explore search box | Same `.og-explore` scope; no map behind the Explore list. |
| 3 | `src/ui/explore/explore.css:165` | `.og-explore__quick-chip` | Explore quick-filter chips | Same `.og-explore` scope. |
| 4 | `src/ui/explore/explore.css:235` | `.og-explore__controls[data-open="true"]` | Explore filter sheet/popover | Same `.og-explore` scope; it opens over the solid results page, not the map. |
| 5 | `src/ui/explore/explore.css:501` | `.og-explore__list:has(.og-explore-card--ride)` | Explore ride-results list | Same `.og-explore` scope. |
| 6 | `src/ui/explore/explore.css:851` | `.og-explore__header::before` (phone breakpoint) | Explore sticky header backdrop | The header scrolls over the solid Explore page; the pseudo-element was already `none`. It is shared with the (frozen) hike page, which also lives inside `.og-explore` and is equally solid. |
| 7 | `src/ui/rides/rides.css:105` | `.og-library__list` | My rides, saved-ride list | Inside `<main class="og-library og-rides">`; `--og-glass-blur: none`. |
| 8 | `src/ui/rides/rides.css:260` | `.og-rides__menu-popover` | My rides, per-row “…” menu | Rendered by `RideRowMenu`, which is only used by `RidesLibrary` on the solid My rides page. |
| 9 | `src/ui/rides/rides.css:405` | `.og-library__empty, .og-rides__empty` | My rides empty state | Same `.og-library` scope. (`og-rides__empty` is the page's own modifier, not the ride-screen `.og-empty-state`, whose blur over the map is kept.) |
| 10 | `src/ui/rides/rides.css:448` | `.og-library__state` | My rides status / notice cards | Same `.og-library` scope. |
| 11 | `src/ui/rides/rides.css:533` | `.og-import` | GPX import panel | `ImportPanel` is only imported by `RidesLibrary`, on the solid My rides page. |
| 12 | `src/ui/settings/settings.css:94` | `.og-settings__card` | Settings group cards | Inside `<main class="og-settings">`; `--og-glass-blur: none`. |

Deliberately **not** removed, because they do sit on the live map or are shared with it:
`.og-empty-state` (used by the ride screen, `RideFocus`), every `top-search`, `nav`,
`sheet`, `map`, `layers`, `ride`, `route-detail`, `planner` and `places` rule. The small
`backdrop-filter: none` resets (`gmaps-layout`, `itinerary`, `sheet`, `route-context`,
`rides` `.og-import--quiet`) were left in place; they are not blurs.

## Checks

| Check | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run css:budget` | **ok** — `backdropFilter` 99 → 75 (−24 = 12 rules × prefix + standard). Every other metric unchanged or lower (`totalLines` −37, `maxFileLines` −14). `scripts/qa/css-budget.json` not edited. |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run --project architecture` | 15 files, 179 tests passed |
| `npm run build` (Next 16.4.1, production) | exit 0 |
| `npx playwright install chromium` | chromium already present (Playwright 1.64.1 / chromium-1248) |

## Visual proof

`playwright.config.ts` says the checked-in baselines are recorded on the GitHub runner,
“never on a laptop: fonts and GPU rasterisers differ.” That is what happened here: on this
copy, with the CSS unchanged, 34 of the 44 `visual-chromium` baselines already fail, by
tiny text-raster deltas (a few hundred pixels, channel delta well under a font edge) and by
timing on the map-settling tests. Recording a baseline here would be the wrong fix, so no
baseline file was changed.

To make the gate meaningful anyway, the same run was done before and after the change on
this host, and the locally rendered screenshots were compared pixel for pixel:

- **12/12 Explore, My rides and Settings screenshots (phone/desktop × light/dark) are
  identical before and after** — these are the only states that contain any of the removed
  rules.
- 23 of the 27 locally differing states compared are identical. The other four are
  unrelated to this change: `planner-error`'s horizontally scrolling suggestion chips strip
  moves between two runs of the *same* build (10k–18k differing pixels), and a 6-pixel
  sub-pixel flash on `desktop light plan-idle` / `layers-open` disappeared on rerun.
- Standard (non-update) baseline run: 10/44 passed before, 11/44 after (one flaky ride
  test), with **no state that passed before now failing**. No rule needed to be put back.

A live computed-style probe against the production build confirms the mechanism and that
the map is untouched:

| Page / element | `--og-glass-blur` | computed `backdrop-filter` |
|---|---|---|
| `/explore` `.og-explore__lens` | `none` | `none` |
| `/explore` search input | `none` | `none` |
| `/explore` quick chip | `none` | `none` |
| `/explore` header `::before` | `none` | `none` |
| `/rides` empty state, import panel | `none` | `none` |
| `/settings` card | `none` | `none` |
| `/` map legend (unchanged) | `blur(24px) saturate(170%)` | `blur(24px) saturate(1.7)` |

Nothing was merged, pushed or deployed.
