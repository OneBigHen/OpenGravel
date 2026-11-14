# Lane C report: wrong facts and wording (QA-07, 11, 16, 17, 22, 24, 25)

Branch: `fix/qa-facts-wording` (worktree `/root/Vibe/wt/og-qa-c`). `origin/main` merged in
before the work was finished (another lane's "basic route" fix landed there); both sides kept.

Status: every bug in this lane has a test that failed on main and passes now. No browser was
started on docker-dev, per the rules. Nothing merged, nothing deployed.

## QA-07: Explore "Ride this" lost the ride's facts, and called a loop a ride to a town

Cause: the Explore → planner handoff wrote only the line, distance and time. The route's own
surface and curve summary (the words the rider just read) were dropped, so the plan fell back
to measuring a published line itself and said "Surface unknown". `createExploreDerivative` also
copied the catalog's shape, so a line that comes back to its start stayed "destination" and the
trip card named a finish the rider would never arrive at. On the ride page the surface tile
only understood the word "gravel", so "Mostly paved, 1.6 mi dirt" showed `paved` in the tile and
`1.6 mi dirt` in the line right under it.

Fix:
- `PreparedRoute` / `RouteCandidate` carry an optional `publishedFacts` (surface + curves); the
  view model shows them as the ride's badges and truth line (`storedRideTruth`) instead of
  measuring the line again and saying unknown.
- The stored handoff record is parsed defensively: a malformed or older record is ignored, never
  trusted into rider copy.
- `createExploreDerivative` calls a line a loop when its finish is within `LOOP_CLOSE_METERS` of
  its start (`catalog.ts`).
- The ride page's surface tile reads dirt as dirt (`RouteDetail.tsx`).

Test: `tests/unit/application/explore-ride-this.test.ts` "carries the ride's published surface and
curves into the plan, not 'Surface unknown' (QA-07)" and "labels a published line that comes back
to its start as a loop (QA-07)"; `tests/unit/ui/explore.test.tsx` "says a dirt ride is dirt, and
reads each number once (QA-07, QA-22)". On main: `publishedFacts` undefined, shape
`destination`, tile `paved`.

## QA-11: an imported route ended in the start's town again

Cause: reverse geocoding asked Photon for the single nearest feature. Beside the end of the
Palmerton→Bowmanstown track the nearest feature is a house whose OSM `city` tag says Palmerton,
so the finish repeated the start even though the point is beside the next town.

Fix: the reverse lookup now asks for the nearest place-level feature (`osm_tag=place`) in the
same round trip and names the pin from the nearest settlement; the nearest feature still supplies
the POI name (and is the fallback if the place lookup fails). "Near" is measured to the town, not
to the house.

Test: `tests/unit/infrastructure/geocoding/photon.test.ts` "names a pin from the nearest settlement,
not a building's recorded town (QA-11)" and "asks for the nearest settlement alongside the nearest
feature (QA-11)". On main: both read `Palmerton, PA` instead of `Parryville, PA`, and only one
request was made. The `osm_tag` reverse filter is documented Photon API (`docs/api-v1.md`,
"you can also use this feature for reverse geocoding").

## QA-16: Enter on "Jim Thorpe PA" listed realtors

Cause: Enter opens the top suggestion only when exactly one suggestion's name equals what was
typed. The state a rider adds ("Jim Thorpe **PA**") is not part of the town's name, so nothing
matched and Enter fell through to a category/business search of the words.

Fix: `wantsList` strips a trailing US state before comparing (`withoutTrailingUsState`, already
used by the server search). Enter now opens Jim Thorpe.

Test: `tests/unit/ui/search-wants-list.test.ts` "opens the one place whose name is what was typed"
(plus a new "still lists when the typed name is not the town's name" so a real category search is
not broken), and `tests/unit/ui/place-search.test.tsx` "Enter on a town with its state opens the
town, not a list of nearby businesses (QA-16)". On main: `wantsList` true / `onPick` never called.

## QA-17: ride stats said "Average 249 mph" after a GPS jump

Cause: the ride menu calculated distance, moving time and average from the raw recording summary.
The recorded trace includes a GPS jump as distance, so a simulated 51-mile teleport produced an
impossible average even though the filtered telemetry had already rejected the jump.

Fix: when the session has filtered telemetry, the menu's distance, moving time and average all
come from it (`acceptedDistanceMeters`, `movingMs`, `movingAverageSpeedMps`), so the three numbers
agree with each other and with the strip. The raw summary is only the fallback when no telemetry
exists.

Test: `tests/unit/application/ride-focus-view-model.test.ts` "reports the filtered average, not a
GPS jump, in the ride menu (QA-17)". On main: `764 mph`; now `22 mph`, with `0.6 mi` and `1:30`.

## QA-22: leading dots, a dangling dot, and numbers read twice

Cause: three separate wording faults.
- The card's fact separator was `::before` on every fact after the first, so a wrapped row started
  with a stranded "·". Now it is `::after` on every fact but the last (Explore cards and weekend
  cards), so a line starts with a fact.
- The ride page's meta line always printed " · " after the start distance, even when the source
  was empty (a credited ride names its author in the credit line), leaving "Starts 10 mi from you .".
- Each fact printed its short value and a visually-hidden full sentence even when they were the
  same string, so a screen reader heard "77 mi 77 mi". The spoken copy is now only rendered when
  the short value drops words.

Test: `tests/unit/ui/explore.test.tsx` "does not end the header on a separator with nothing after
it (QA-22)" and "says a dirt ride is dirt, and reads each number once (QA-07, QA-22)";
`tests/unit/ui/explore-route-facts.test.ts` asserts the separator rule belongs to the fact before
it. On main: `Distance17 mi17 mi`, tag meta ended on " · ", separator rule missing.

## QA-24: a 2.9 mi rural track read "15 min" (11.6 mph)

Cause: an untimed line (import with no timestamps, catalog ride with no stated time) was estimated
at the app's 28 mph pace but then rounded up to the nearest quarter hour. On a short ride the
rounding outweighed the pace: 2.9 mi became 15 min.

Fix: one module, `application/explore/ride-time-estimate.ts`, states the estimate for the ride
page, the planner's card and the weekend cards. Up to 30 minutes it rounds to the minute (2.9 mi →
6 min); above that to five minutes so it still never reads as a measurement. The old duplicated
28 mph / 15-minute constants in `ride-this.ts`, `route-facts.ts` and `weekend-picks.ts` are gone.

Test: `tests/unit/ui/explore-route-facts.test.ts` "estimates only from a distance somebody measured,
round enough to be honest" and the updated route-page facts; `tests/unit/application/explore-ride-this.test.ts`
"states the route page's own estimate when the catalog carries no ride time". Two older tests that
encoded the quarter-hour rule were updated (`weekend-picks.test.ts`, `imported-loop-opens.test.ts`).
On main: `30` instead of `35` minutes, planner `1800` instead of `2100` seconds.

## QA-25: the arrival moved on every refresh with no input

Cause: the ride summary computed the arrival at render time as `Date.now() + ride time`. Every
re-render (a refresh, a reopen, a navigation) moved it, and it could disagree with the daylight
chip, which is read from the plan's own departure.

Fix: the plan's answer carries its creation instant (`RouteCardVm.plannedAt` from
`RouteBundle.createdAt`); `plannedArrivalClock` reads the arrival from that instant plus the ride
time, so one answer always states one arrival. A card with no plan (an injected view model) still
falls back to the clock. A genuine replan (including a reload, which re-plans "leave now") still
moves the arrival, because the departure moved.

Test: `tests/unit/ui/phone-plan-shell.test.tsx` "keeps the arrival time steady when the page is
reopened with no new input (QA-25)". On main: `Arrive 9:37 PM` vs `Arrive 9:00 PM` for the same plan.

## Checks run (docker-dev, under `/tmp/og-light.lock`)

- `npx tsc --noEmit`: clean.
- `npx vitest run <touched test files> --maxWorkers=2`: 315 passed (11 files); plus the wider set of
  unit tests that import the touched modules (21 + 18 files): all green after the two
  quarter-hour expectations were updated.
- `npx eslint <touched files>`: clean.
- `npm run css:budget`: ok, 158 lines under budget (nothing raised).
- Proof the new tests fail on main: a temporary worktree at `origin/main` with only the new test
  files copied in ran 16 failures for the 16 new assertions (published facts undefined, shape
  destination, Palmerton instead of Parryville, 764 mph, 30 vs 35 min, 9:37 vs 9:00, "Distance17
  mi17 mi", leading-dot rule missing, Enter listing instead of picking). Worktree removed after.

## Not done / honest gaps

- No browser or screenshot run from this lane (no dev server, build or browser on docker-dev; the
  Windows PC offload was not used). The visual parts of QA-07/QA-22 are covered by unit assertions
  on the rendered React output and on the CSS rules, not by a real 320/390 px screenshot.
- QA-11's fix depends on the live Photon service honouring `osm_tag` on `/reverse` (verified in the
  Photon API docs; the request falls back to the old behaviour if it does not).
- QA-17 filters the summary the ride menu shows; the saved-ride statistics already used the filtered
  telemetry, so nothing else changed.
- QA-25 makes an answer's arrival stable. A refresh re-plans the ride (restore then auto-plan), so
  the arrival after a reload is the reload's departure, by design.
