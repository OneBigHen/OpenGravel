# L5: Ride this, with turns, anywhere

**Rider sentence:** "I tap Ride this and get turns, anywhere in the country."
**Worker:** Opus (or Codex Sol). **Size:** L. **Needs:** L1 merged; `routing/valhalla-outside` on main for
anything outside PA/NJ (inside coverage can start now).
Rules: `.fable/briefs/lib-0-rules.md`. Plan sections 1 (point 7), 3.3 and 6 ("Precompute, decided").

## Why
A library track is somebody's line, often from 2010 to 2013, often one point every 100 m. Following it gives no
turn prompts and no checks. The invariant stands: the router builds the ride; the library track is the reference.
Inside our coverage that router is GraphHopper with the bike and closure rules. Outside, it is the basic
motorcycle router, and the ride must say "Basic route".

## Build
1. **Ride this.** On a library ride with a usable line (not rough, not a trail bundle, type not `trail`), the
   primary button becomes "Ride this": hand the track to the planner as shaping points
   (`routeAlongShapingPoints` in `src/application/import/import-artifact.ts`, the same path an imported GPX takes
   for "Plan it again"), draw the router's line as the ride and the source track under it as a thin dashed
   reference, and keep the credit on the ride (`RideCredit` travels on provenance already).
2. **Match line.** Measure how much of the source track the built route follows (the scorecard's rider-match
   measure; reuse it, do not write a second) and show one truth line: "Follows 96% of the source track." Under
   85%: "Follows 71% of the source track. Compare before you ride." with the reference line kept visible.
   Under 50%, or the router fails: do not show the router's line as the ride; fall back to "Follow this track"
   and say once "Our router could not build this ride. Showing the source track."
3. **Which router.** Start point inside coverage: GraphHopper, full truth lines, bike limits and closures as for
   any plan. Outside: the basic router with the "Basic route" label wherever the route is summarised, no surface
   or closure claims beyond what that router returns; unknown reads unknown. A ride that crosses the coverage
   edge is treated as outside.
4. **Follow this track** stays as the secondary action on every ride with a line ("the line as drawn, no turn
   prompts"), and is the primary for Trails.
5. **Ride to the start.** One row under the actions: "Ride to the start, 38 mi" using the existing ride-to-start
   flow; hidden when no router covers the rider's position.
6. **Measured surface inside coverage.** When GraphHopper built the ride, the surface truth line is the measured
   one and replaces "the source says" for that session only; nothing is written back to the pack.
7. No precomputing of routes in the pack in this package. If first-route time is over 8 s on the 20 longest
   in-coverage library rides, report it; do not add a cache without a new brief.

## Files
`src/application/explore/ride-this.ts`, `src/ui/planner/hooks/useOpenCuratedRide.ts`,
`src/application/route-library/ride-this.ts` (decision: which action, which router, which wording),
`src/ui/explore/RouteDetail.tsx` (buttons), the planner's reference-line layer in
`src/infrastructure/map/maplibre/host.ts`, `src/application/planner/ride-truth.ts` (match line).

## Pass/fail
- `npx vitest run tests/unit/route-library tests/unit/planner tests/unit/application` passes, with cases: the
  action table (rough, trail, bundle, link-only, in coverage, outside, edge-crossing); match wording at 96, 71
  and 40%; router failure falls back with the one sentence; the credit survives into the saved ride and its GPX;
  a basic-router ride never states a surface or a closure result it did not get.
- Real router (attach output): 10 in-coverage library rides (5 twisty, 5 dirt, chosen from PA and NJ records,
  ids listed in the PR) through `npm run test:real-router` or a small script against the tunnel: each gives a
  route, a match share and a first-route time; list them in a table. Trust failures count as in the scorecard.
- Once the basic router is on main: the same table for 10 rides outside coverage (include Tail of the Dragon,
  Cherohala Skyway, one Texas hill-country road, one Colorado pass, one Ozarks road); every one carries the
  "Basic route" label in the summary and on the ride screen.
- `tests/e2e/critical/explore-ride-this.spec.ts` (fixture router): Ride this shows the built line, the dashed
  reference and the match line; Start is enabled; Follow this track still opens the stored line.
- Shots at 390 x 844 and 320 x 568, Day and Night: the route summary with the match line and reference track; a
  "Basic route" summary; the fallback state.
- The scorecard is unchanged (attach the headline line): this package may not lower wins or raise trust failures.
