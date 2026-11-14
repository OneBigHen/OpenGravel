# L6: Great roads on my map and along my route

**Rider sentence:** "Great roads show up on my map and along the route I just planned."
**Worker:** Sonnet. **Size:** M. **Needs:** L1 and L4 merged.
Rules: `.fable/briefs/lib-0-rules.md`. Plan sections 3.1 ("On my way") and 3.5.

## Why
The home map already draws the 112 curated rides as the "Rider-picked rides" layer (thin plum lines, tap for a
card, `src/application/map-layers/curated-rides.ts`, served by `curatedRidesProvider`). The library should feed
the same layer everywhere in the country, from the same index and line files Explore uses. And a rider who has
just planned A to B should be told about the best road a few miles off their line; no rival does that.

## Build
1. **Rider-picked layer goes national.** The layer reads the route-library client store: bubbles are not shown
   on the home map (it is a planning map, not a browse map); lines appear from zoom 7 for the states in view,
   best 150 by score in the viewport, the rest as the rider zooms in. Curated rides keep drawing as today. Tap
   gives the existing map card (`InfoFeatureCard`) with name, miles, type, quality word, credit and "Open ride".
   The layer's existing on/off choice and the 35% dim while a ride is shown stay as they are. Line data loads
   after the map's first paint, as the layer rule already requires.
2. **Near your route.** When a route is on the map and it is 20 mi or longer: find library rides of kind `road`
   with score 4 or 5 whose start or line comes within 15 mi of the planned line (work from index boxes first,
   then the 64-point lines; all on the phone). Show one quiet row in the full plan sheet, under the weather
   line: "3 great roads near your route". It opens a short list: name, quality word, miles, "4 mi off your
   route", credit. Each has "Show on map" and "Open ride". Nothing is added to the route by itself; the rider
   adds a road only by opening it and choosing an action there (discovery never mutates a route).
3. The row is absent at half sheet and peek (the phone-first rule: half never grows), absent while riding, and
   absent when nothing qualifies.

## Files
`src/application/map-layers/curated-rides.ts` and `default-layers.ts`, `src/server/map-layers/providers.ts`
(curated stays server-fed; library is client-fed), `src/ui/layers/LayeredMap.tsx`, `InfoFeatureCard.tsx`,
`src/application/route-library/near-route.ts`, `src/ui/planner/RideSummary.tsx` or the full-sheet section that
holds the weather line, the planner stylesheet that owns the full sheet (at most 60 new lines; raise the budget by exactly that).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/map-layers tests/unit/planner` passes, with cases:
  `nearRoute` finds a ride 4 mi off a line and not one 20 mi off; score 3 rides never qualify; a 12 mi route
  shows no row; 6,000 rows against a 300-point route answer in under 80 ms; the layer caps at 150 lines and
  prefers higher scores; with the manifest 404 the layer shows only curated rides, as today.
- `tests/e2e/critical/map-library-layer.spec.ts` (390 x 844, fixture pack): at zoom 8 over the fixture rides the
  lines draw after first paint; tap one; the card shows the credit; "Open ride" lands on its page. With a
  fixture route planned past a fixture Standout road: the full sheet shows the row; the list shows the distance
  off route; the planned route is unchanged after opening and closing the list.
- Shots at 390 x 844 and 320 x 568, Day and Night: home map with library lines; the map card; the full plan
  sheet with the row; the near-route list. Half sheet height unchanged against main (state it in pixels).
- `npm run typecheck`, `npm run lint`, `npm run css:budget` pass.
