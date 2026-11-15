# L6 report: great roads on the map and along a planned route

**Branch:** `library/l6-great-roads`  
**Not merged, not deployed.**

## What a rider sees

When a ride is planned, the ride sheet now shows **Great roads near your route**:
up to three national-library rides whose stated start is within 15 miles of the
line on screen. Each row says the ride’s name, quality and type (for example
“Great ride · Twisty”), its length, how far its start is from the route, and the
site it came from. **Open** goes to the ride page.

The same rides are drawn on the planner’s map as thin plum lines, dashed where
the ride is dirt or trail, with a small start dot. They are a suggestion beside
the chosen route, never a second route and never a claim that they are on it.
The existing “Twisty roads” layer from the curvature catalogue is unchanged and
still opens on the planner map by default.

With no library pack, no route, or no ride within 15 miles, nothing is shown.
The planner stays exactly as it was.

## How it works

- `src/application/route-library/along-route.ts` is a pure projection. It takes
  the index rows and the planned line, keeps rides with a stated start inside
  the 15-mile reach, sorts best first (score, then has a line, then nearest),
  and returns at most three. It never invents a start or a distance. A ride with
  no coordinates is left out.
- The planner asks for the library only once a route exists. The index is
  fetched once and the browser caches it by version.
- `PlannerGreatRoads` renders the three rows in the existing along-ride visual
  language. `GreatRoadsOnMap` fetches the rides’ own state line files and draws
  them in one small map overlay.
- Credits are the library’s own: “Route from <site>”. No author or fact is added
  that the index does not carry.

## Real data

- Ride names, starts, scores, types, lengths, state lines and credits come only
  from the route-library pack (`scripts/route-library/*`,
  `src/server/route-library/*`).
- No permit, access, surface or closure fact is inferred; the rows repeat only
  what the index says.
- The 15-mile rule is the one in `.fable/LIBRARY-PLAN.md` section 3.1.
- The browser test’s planned line is the real stored Lancaster County Loop Tour
  line from `tests/fixtures/route-library/pack.sqlite`; the test only routes the
  page’s fixture answer onto that real line.

## Files

New:

- `src/application/route-library/along-route.ts`
- `src/ui/planner/PlannerGreatRoads.tsx`
- `src/ui/planner/GreatRoadsOnMap.tsx`
- `src/ui/planner/hooks/usePlannerRouteLibrary.ts`
- `src/ui/planner/hooks/usePlannerGreatRoads.ts`
- `tests/unit/route-library/along-route.test.ts`
- `tests/unit/ui/planner-great-roads.test.tsx`
- `tests/e2e/critical/great-roads.spec.ts`

Changed (wiring only):

- `src/ui/planner/PlannerPreparation.tsx`
- `src/ui/planner/PlannerRouteBriefing.tsx`
- `src/ui/planner/PlannerWorkspace.tsx`
- `src/ui/planner/PlannerWorkspaceSurfaces.ts`
- `src/ui/planner/controllers.ts`

No CSS was added or changed. The planner composition root still meets its
line and static-import budget by putting the new concern in its own hook.

## Checks run

| Check | Result |
|---|---|
| `npm ci` | passed |
| `npx tsc --noEmit` | passed |
| `npm run lint` | 0 errors (6 existing warnings in `.fable/phonefirst-shot.mjs`) |
| `npx vitest run tests/unit/route-library tests/unit/ui/planner-great-roads.test.tsx tests/unit/ui/planner-workspace.test.tsx` | 239 passed |
| `npm run test:architecture` | 179 passed |
| `npm run css:budget` | ok, 428 lines under budget; budget file unchanged |
| `npm run build` | passed |
| `npx playwright install chromium` | no download needed |
| `npx playwright test tests/e2e/critical/great-roads.spec.ts --project=critical-chromium` | 2 passed (390×844 and 320×568) |

The browser test proves, at both phone sizes:

- the section is present after a real library line is planned;
- the row names the real ride, says “Great ride · Twisty”, “On route”, and
  “Route from …”;
- the Open link points at the ride page;
- the map overlay reports the ride line drawn (`data-count="1"`);
- the page and the section do not overflow horizontally.

Screenshots taken during the run: `/tmp/og-l6-shots/great-roads-390x844.png`
and `/tmp/og-l6-shots/great-roads-320x568.png` (not committed).

## Commits

- `5cc0f38` Great roads near a planned route, within 15 miles of its line
- `7784339` A planned ride names and draws the great roads beside its line
- `388a5f1` Prove great roads along a planned route at 390 and 320 pixels

## Not done

- No “add this road to my route” action; the issue asks for showing, not
  replanning.
- No new map colour, no new filter switch, no card re-ranking.
- Nothing merged, pushed, or deployed.
