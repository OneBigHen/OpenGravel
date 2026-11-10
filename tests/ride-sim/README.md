# Ride simulation (ride-sim)

`npm run ride-sim` replays ten committed tracks through the real navigation
stack and prints a pass/fail table. It never needs a network, a router, a device
or a browser, and it never waits in real time: a 25-minute ride replays in a few
hundred milliseconds while every fix keeps the `observedAt` instant it would have
had on the road.

## What is real

Everything under `src/` is the product code:

- `buildGuidedNavigationRoute` turns the route fixture's provider instructions
  into maneuvers (`src/application/ride-session/navigation-route.ts`).
- `createRideSessionController` owns the session (`src/application/ride-session/ride-session-controller.ts`).
- `createPositionPipeline` smooths fixes, derives speed and normalizes
  accuracy (`src/application/ride-session/position-pipeline.ts`).
- `createRideNavigationEngine` matches progress, decides off-route, issues
  instructions and drives the speech coordinator (`src/application/ride-session/navigation-engine.ts`).
- `rerouteOfferState` and `buildRerouteRequest` decide and build the reroute
  (`src/application/ride-session/reroute.ts`).

Only two things are test doubles: the position source (this directory) and the
speech port (a recorder that captures every cue).

## Layout

- `tests/fixtures/ride-sim/<id>.json` — one replay track: speed, sample
  interval, noise seed and the anchors each scenario needs.
- `tests/fixtures/route-plan/ride-sim/<id>.json` — the route-plan fixture the
  track rides: geometry plus instructions with `geometryIndex` and turn
  directions.
- `replay-position-source.ts` — emits the timestamped fixes, with optional
  seeded GPS noise.
- `track-timeline.ts` — turns a track into fixes for one scenario.
- `run-scenario.ts` — composes the real stack and records frames, events and
  cues.
- `assertions.ts` — the rider-facing promises, shared by every track.
- `ride-sim.test.ts` — ten tracks × five scenarios, plus a corpus check.
- `pass-fail-reporter.ts` — the table printed by `npm run ride-sim`.

## Scenarios

| Scenario | What it does |
| --- | --- |
| clean follow | Rides the exact route line at the recorded speed. |
| 8 m GPS noise | Displaces every fix by a seeded random radius of up to 8 m. |
| missed turn | Rides on along the incoming bearing instead of turning. |
| 30 s without GPS | Omits every fix for 30 s of the ride; the clock keeps running. |
| 2 minute stop | Emits 1 Hz stationary fixes for 120 s. |

The no-GPS and stop anchors are placed on a straight leg by the fixture
generator, so those scenarios test loss and rest handling rather than a turn
that was skipped because there was no fix to announce it.

## Adding a track

Add the route-plan fixture first (one candidate, `"fixture": true`, geometry,
instructions with `geometryIndex`, a `finish` instruction), then a track file
with the same id that names it in `routeFixture`. Keep these invariants, which
the corpus test enforces:

- at least three guidance instructions (turn, roundabout, keep-left/right);
- the missed-turn vertex is interior geometry and turns at least 80°;
- `noGps.startMeters + speedMps × 30` stays inside one leg, at least 25 m clear
  of both ends' turns;
- the stop sits at least 100 m from any turn.

## Known navigation bugs found by this suite

None at the time of writing. If a scenario finds a real bug, the case is marked
`it.fails` with a one-line reason and listed in the pull request description;
the assertion is never weakened.
