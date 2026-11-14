# L1b: The whole country on the Explore map

**Rider sentence:** "I open Explore, see rides across the whole country, and open one."
**Worker:** Sonnet. **Size:** about 7 hours. **Lane:** screen. Starts when L1a has pushed the fixture pack.
Rules: `.fable/briefs/lib-0-rules.md`. Layout: `.fable/LIBRARY-PLAN.md` section 3.2 (the two sketches) and 3.3.
Design-log text to paste into `DESIGN.md`: plan section 4. Add the `docs/PLAN.md` row named there too.

## Why
Explore lists 112 PA/NJ rides. The pack from L1a holds about 5,800 across 51 states. This package is the proof
of concept: the map, the list of what is in view, the card, and a tap through to the ride page that already
exists (L1a's adapter makes `/explore/<id>` work for any library ride). No new ride page here.

## Build
1. **Client store** `src/application/route-library/client.ts`: fetch the manifest, then the versioned index once
   (browser cache does the rest); expose rows, `sources`, `stateCounts`; pure helpers `filterRows(rows, { types,
   standoutOnly, bounds })` and `sortBest(rows, origin?)` (score, then has a line, then distance when the rider's
   place is known). When the manifest is 404 the store says "off" and Explore renders exactly as today.
2. **Map view** `src/ui/explore/RoutesMap.tsx` on the existing MapLibre host (`createMapLibreHost`, as
   `ExploreMap.tsx` uses it):
   - zoom under 5: one neutral bubble per state with its count at the state's centre (ship a 51-row centre table);
   - zoom 5 to 7: MapLibre GeoJSON clustering of the rows that have `p`; tap a bubble to zoom to it;
   - zoom 7 and up: fetch `lines/<ST>.json` for each state in view (once each) and draw thin plum lines, dashed
     where `t` is `dirt` or `trail`; a row with a point but no line is a small plum dot;
   - tap: hit area 12 px around the finger; the best-scored ride under it opens the card; several under the
     finger give "1 of 3" with swipe or arrows; the chosen line is drawn in `--og-route` at full weight.
   Colours and the bubble recipe come from tokens only; map style code reads the same token values.
3. **Ride card** `src/ui/explore/RoutesMapCard.tsx` (glass-dense): name, quality word, miles, type, states,
   credit line (`creditText`), one green "Open ride" to `/explore/<id>`. At 320 px the credit line is dropped.
4. **List of what is in view:** the pill "214 rides here · List" switches to the list view showing those rows as
   the existing 96 px rows (reuse `og-explore-card` styles), best first, in pages of 30 with "Show more". The
   thumbnail is the row's 24-point line through `RouteLinePreview`. Row facts: quality word and type; miles and
   "about 1 h 30" (`estimatedRideMinutes`); credit. A row whose record has no place says "Not on the map yet".
5. **Chips:** Twisty, Scenic, Dirt, Trails, Big trips (Big trips = rows with `k: "trip"`). Neutral selected
   style per DESIGN.md. They filter the map and the list together and live in the URL (`?type=twisty,dirt`),
   through `parseExploreQuery` / `serializeExploreQuery`.
6. **Views.** Phone: list view and map view, one floating 48 px pill above the tab bar ("Map" / "List"), view in
   the URL (`?view=map`). Tablet and desktop: the existing split (`og-explore__split`). The existing curated and
   personal rides stay in the list under their current rules; library rows appear after them in "recommended".
   The existing Filters sheet keeps working for the old entries; do not redesign it here (that is L4).
7. **Ride page, one wording change.** When the entry has `referenceTrack`, the primary button on
   `RouteDetail.tsx` reads "Follow this track" (same action and `data-testid="ride-this"` as today: it opens
   the stored line), and a ride with no line shows the source link as its primary action instead.
8. Add og-shots states `explore-country-list` and `explore-country-map` to `scripts/og-shots/journeys.mjs`,
   running with `OGV_ROUTE_LIBRARY_PACK=tests/fixtures/route-library/pack.sqlite`.

## Files
New: `src/application/route-library/client.ts`, `src/ui/explore/RoutesMap.tsx`, `RoutesMapCard.tsx`,
`src/ui/explore/routes.css` (at most 260 lines; raise `scripts/qa/css-budget.json` by exactly that).
Touched: `src/app/ExploreClient.tsx`, `src/ui/explore/ExplorePanel.tsx` (view switch, chips, library rows),
`src/ui/explore/RouteDetail.tsx` (button wording only),
`src/application/explore/query.ts`, `scripts/og-shots/journeys.mjs`, `DESIGN.md` (log line), `docs/PLAN.md` (row).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/ui` passes, with new cases: `filterRows` by type, by
  Standout and by bounds; `sortBest` order; 6,000 synthetic rows filter in under 50 ms; the chips round-trip
  through the URL; manifest 404 renders today's Explore with no map pill.
- New `tests/e2e/critical/explore-country.spec.ts` (390 x 844, fixture pack): open `/explore?view=map`; state
  bubbles show; zoom to the Smokies fixture; a line is visible; tap it; the card shows the name, "Standout" and
  the credit line; "Open ride" lands on `/explore/<id>` with the line drawn and the source link present; back
  returns to the same map position. Second case: the Dirt chip hides the twisty fixture ride from map and list.
- Shots at 390 x 844 and 320 x 568, Day and Night, for: list view, map zoomed out, map with lines and a card
  open, the in-view list. Check in the 320 shots: nothing clipped, card buttons at least 48 px, map at least 55%
  of the screen with the card open, no light map under Night.
- One run against the real pack (not for CI): with the real `OGV_ROUTE_LIBRARY_PACK`, shots of the national map
  and of North Carolina at zoom 8, attached to the PR; note the time from navigation to first bubbles.
- `npm run typecheck`, `npm run lint`, `npm run css:budget` pass (budget raised only by `routes.css`).
- Existing `tests/e2e/critical/explore*.spec.ts` and the architecture tests for Explore still pass in CI.
