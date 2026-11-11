# R3-8: Where to ride this weekend, and the truth about each ride

**Rider sentence:** "Explore tells me where to ride this weekend, and each ride page tells me the truth about it."
**Worker:** DeepSeek for the module and tests (overflow server), Sonnet for the screens, Opus reviews. **Size:** M (estimate). **Lane:** explore; land R3-5 first. The fuel truth line touches the planner summary: do that part after R3-4.

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/next`. Read `AGENTS.md`, and `DESIGN.md` before any screen work.
House rules: on docker-dev run only `npm run typecheck`, `npm run lint` and the unit tests you touched; never `npm run build`, the full suite or the scorecard there (one heavy job at a time, 10 GB box). Never scan `/` or `~`. Frozen areas stay untouched: hiking, Spotify, cameras, Ask/Jev, wind, sun lighting, long trip, live follow. Unknown or unavailable is never shown as open, clear, legal, paved or safe. `npm run css:budget` must not rise. Report in plain English with the commands you ran and their results. Audit screenshots named below are in `.fable/shots/audit/`.

## What exists
- 112 rider-picked rides with distance, curve miles, gravel miles and a start point (`data/catalog/routes.json.gz`, `src/application/explore/catalog.ts`, `query.ts`), "Near me" sorting (`src/ui/explore/rider-distance.ts`), a time lens (`src/application/explore/time-lens.ts`, `src/ui/explore/RideTimeLens.tsx`).
- A free point forecast from the National Weather Service (`/api/weather`, used by the conditions chip on the map).
- The bike's fuel range and reserve (`src/application/garage/garage-model.ts`), fuel along a route (`src/ui/planner/PlannerFuelAlong.tsx`, `src/application/ride-session/fuel-ahead.ts`), and a fuel note on the curated page under the heading "Long-trip considerations" (long trip is frozen; `phone-light-41b-ride-page-full.png`).
- The three truth lines for planned routes (`src/application/planner/ride-truth.ts`, `src/ui/planner/RideTruthLines.tsx`).

## Build
1. **Module** `src/application/explore/weekend-picks.ts` (pure): from the catalog, the rider's position, the bike and two day forecasts, pick up to 3 rides: start within 60 mi, ride time 1.5 to 6 h, not hidden by the rider, at least one mostly unpaved and one twisty when available, ranked by nearness then by the drier day. Each pick carries a weather phrase per day built only from the forecast ("Sat: dry, 54°", "Sun: rain after 2 PM") or "Forecast not available". Never "dry" without a forecast. No position: no strip.
2. **Explore** (`src/ui/explore/ExplorePanel.tsx`, `src/app/ExploreClient.tsx`): above the list, a strip titled "Near you this weekend" (Monday to Thursday: "Near you this weekend"; Friday to Sunday: the days left). Three cards in one row that scrolls sideways on a phone (not a three-column feature grid): map thumbnail, name, miles and time, "42 mi gravel" or "17 mi of curves", the weather phrase, distance to the start. Tap opens the ride page. One forecast request per card start, made once per visit.
3. **Curated ride page** (`src/ui/explore/RouteDetail.tsx`, `route-detail.css`): under the four numbers, the same truth lines as a planned route, computed from the ride's stored line: surface (known miles only), bike fit, and "Checked today" when the closure check ran, else "Closures not checked for this ride". Replace the "Long-trip considerations" heading and box with the fuel line below. The action bar keeps two buttons, **Ride this** and **Save**; Share and GPX move under "Take it with you"; the bar must not cover text (`phone-light-41-ride-page.png`).
4. **Fuel line** (in `ride-truth.ts`, shown on the curated page and, after R3-4, in the one route summary): only when the ride is longer than range minus reserve: "Fuel: 104 mi ride, 120 mi usable range. Gas at mile 61 (Sunoco)" or "No gas found on this ride: fill up first". When gas data did not load: "Fuel stops not checked". Shorter rides show no fuel line.

## Files
New `src/application/explore/weekend-picks.ts`, `src/ui/explore/WeekendPicks.tsx` (new), `ExplorePanel.tsx`, `src/app/ExploreClient.tsx`, `explore.css`, `RouteDetail.tsx`, `route-detail.css`, `src/application/planner/ride-truth.ts`, `src/ui/planner/RideTruthLines.tsx`. Do not edit `src/application/explore/long-trip.ts` (frozen); just stop rendering its heading on this page.

## Pass/fail
- `npx vitest run tests/unit/application tests/unit/planner` with new `weekend-picks.test.ts` (fixed catalog slice, fixed forecasts: stable order, mix rule, no pick over 60 mi, missing forecast reads "Forecast not available") and new fuel cases in `ride-truth.test.ts` (under range: no line; over range with gas; over range without gas; gas data missing).
- Browser (CI), new assertions in `explore.spec.ts` at 440x956 with geolocation set: the strip shows 1 to 3 cards, each with a weather phrase or "Forecast not available"; tapping one opens its page; without geolocation the strip is absent. On the ride page: truth lines present, the text "Long-trip considerations" absent, the action bar has exactly 2 buttons and does not overlap the first truth line (bounding boxes).
- Browser test sees at most 3 forecast requests per Explore visit.
- Shots: Explore top and a ride page; phone and desktop; both themes.
