# Brief: layout polish (Fable's three gaps)

This codebase is yours. Branch `design/polish`. Don't push or deploy. Never scan outside the repo folder.

## Goal
Close the three gaps Fable ranked in `.fable/DESIGN-PICKS.md` section 4, following `DESIGN.md` (read its 2026-11-10 decision-log entries first: green only on the action; selected options neutral; glass only over a live map).

## Do
1. **Explore at night shows day pictures.** Route thumbnails and the Explore overview map must use the night static style when the theme is Night. `src/application/map/static-map.ts` already accepts `night: true`; find the Explore callers (`src/ui/explore/ExplorePanel.tsx`, `src/ui/explore/TrailMedia.tsx`, `rg -n "staticRouteMapUrl|staticPointsMapUrl" src`) and pass the current theme (see `src/ui/appearance/use-appearance.ts`). Hiking stays frozen: don't change hike-only screens. The overview map's routes should be thin `--og-route-alt` lines, not a merged grey blob (if the overview is a live map, lower line width/opacity; keep it simple).
2. **Desktop rail: no dead button, no cut-off text.** In the desktop planner rail, the helper line under "Create ride" ("Search for a destination, or press and hold the map") is cut off by the panel edge. Make the rail end in a fixed footer (the action + its helper line fully visible), with the options above scrolling if needed. Files: `src/ui/planner/` CSS (`gmaps-layout.css`, `planner-shell.css`, `ride-style.css`) and the rail component. Remove the "No plan yet." header line if it is pure filler (keep the close button working).
3. **Chip-row icons that mean nothing.** Places chips on the map (Gas, Lodging, Food, Coffee…) use random colours for icons. Make them `--og-ink-2` (`src/ui/places/`, `src/ui/place/top-search.css`). On phone, cap the Loop sheet at about 46% of the screen height so the map keeps the rest, with the less-used "Which way?" row folded behind a summary row if it doesn't fit (`src/ui/sheet/`, `src/ui/planner/plan-sheet.css`).

## Pass / fail
- `npx vitest run tests/unit/ui tests/unit/planner` passes; `npx tsc --noEmit -p .` clean; `npm run lint` clean; `npm run css:budget` ok (net CSS lines must go down or stay flat; update `scripts/qa/css-budget.json` per-file counts only to match real line counts).
- If a browser test references text you removed, update it (`rg` in `tests/e2e`).
- One commit per item, plain-English messages. Finish with a 5-line summary.
