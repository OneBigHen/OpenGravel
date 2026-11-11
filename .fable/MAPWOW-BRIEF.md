# Brief: first-minute wow on the map (W1 + W5)

This codebase is yours. Branch `feat/map-wow`. Don't push or deploy. Never scan outside the repo folder.

## Goal
Read `.fable/DESIGN-PICKS.md` section 5 (rows W1 and W5) and `DESIGN.md` (2026-11-10 entries). A new rider opening the map should immediately see where the good riding is, with zero taps.

## W1: cold open shows roads worth riding
- On first open (no saved layer choice), the map shows the `gravel` and `great-roads` (Twisty roads) layers on by default, from `src/application/map-layers/catalog.ts`. Find where default visible layers are decided (`rg -n "defaultLayers|DEFAULT_LAYERS|enabledLayers|initialLayers" src`). A rider's own saved choice still wins; turning them off sticks.
- One small legend chip bottom-left on the map: tan dash = gravel, orange = twisty, tap to open the Layers sheet. Glass (it sits on the map), small, must not collide with the scale bar or the map buttons at 320 px, 440 px and 1440 px.
- The home screen keeps only search, Loop and Ride as controls (2026-11-10 front-door rule): the legend is a legend, not a new control row.
- Performance: layer data must not delay the first map paint; load after the map is ready.

## W5: curated rides on the map
- The curated catalog rides (`data/catalog/routes.json.gz`, the ones Explore lists "From PA Adventure Bike Rides") as thin plum lines (`--og-route-alt`-ish plum, not the selected-route colour) when zoomed out (about zoom 7–10), as a new optional layer "Rider-picked rides" in the roads category, on by default with W1's layers.
- Tap a line: a small card with name, miles, gravel share (only if known; otherwise "surface unknown") and a "Ride this" button that uses the existing "Ride this" path from Explore (`rg -n "Ride this" src`). Nothing changes on the map before the rider taps "Ride this".
- Serve the lines simplified (a few hundred points per route) through the existing map-layer provider pattern (`src/server/map-layers/providers.ts`), cached.
- Licence: see `docs/PLAN.md` risk 5. Keep the source credit "From PA Adventure Bike Rides" on the card, like Explore does.

## Pass / fail
- Unit tests for: default-layers logic (saved choice wins), the provider (simplification, cache), the card's surface line (unknown never shown as paved).
- `npx vitest run tests/unit/map tests/unit/ui tests/unit/map-layers` (whichever exist) pass; `npx tsc --noEmit -p .` clean; `npm run lint` clean; `npm run css:budget` ok (adjust only the per-file count for files you grew, keep growth small).
- Update any browser test that assumed no layers at cold open (`rg -n "layers" tests/e2e | head`).
- Commits with plain-English messages. Finish with a 5-line summary.
