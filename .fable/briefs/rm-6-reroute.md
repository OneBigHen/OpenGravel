# RM-6: miss a turn and it puts me back on my ride, not a new one

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/r3b`. Owner models: Opus for the
pure rejoin module, Sonnet for wiring, the ride-sim scenarios and the live test. Machine: docker-dev.
Size: M. Plan: `.fable/ROUTING-MASTER.md` section 7. Runs beside the graph and planner lanes: it touches
only `src/application/ride-session/`, `tests/ride-sim/`, and one live test. Works on today's graph.

## Goal (rider sentence)
"Miss a turn and it puts me back on my ride, not a new one."

## Current state
- `src/application/ride-session/guided-reroute.ts` (`createGuidedReroutePlanner`) builds one request
  from the rider's position with `buildRerouteRequest` (`reroute.ts`), `includeAlternatives: false`,
  the rider's heading (`withRiderHeading`) and the rider's reported spots (`currentRiderReportRings`),
  and sends it through the planning service.
- A loop gets up to 15 shaping points, one every 6 km along the loop still ahead
  (`loop-rejoin.ts`: `REJOIN_SPACING_METERS`, `REJOIN_MAX_POINTS`). The router then routes the whole
  remainder again between those points, so the rest of the ride can change, and a long loop is a large
  request.
- An A-to-B ride is replanned from here to the end on the same profile. The line the rider chose (a
  detour through a good road, a picked alternative) is lost.
- A rider report (R3-6) changes the next plan. It does not move the ride in progress.
- The ride simulator (`npm run ride-sim`, `tests/ride-sim/assertions.ts`) checks that off-route is
  raised within 10 s and that a reroute request can be built. It does not check what the reroute is.
- The router answers a short route in under 0.1 s (measured).

## Build
1. New pure module `src/application/ride-session/rejoin-splice.ts`:
   - `rejoinTargets(aheadLine, { nextStopAlongMeters, blockedRings })`: up to three points on the line
     ahead, about 0.8 km, 3 km and 8 km beyond the nearest point ahead of the rider. Never beyond the
     next stop still to visit, never inside a reported or avoided ring, never within 300 m of the finish.
   - `chooseRejoin(connectors, aheadLine, goodMilesAlong)`: the earliest target whose connector has no
     U-turn; a later one wins only when it saves more time than the good miles it skips are worth (use
     the trade in `geometry-fun.ts`: one bend kilometre per 17 minutes; for dirt rides, dirt metres at
     the same rate).
   - `splice(connector, original, rejoinAlongMeters)`: connector, then the original line from the rejoin
     point, with turn instructions, distances, durations, surface spans and speed-limit spans
     re-indexed. The part after the rejoin point is identical to the original, vertex for vertex.
2. `guided-reroute.ts`: when a line ahead exists and the ride has no sketch:
   - send the (up to three) connector requests together: from the rider's position, with heading, to
     each target, on the ride's own profile and options, bike limits and reported rings applied, one
     route each, no alternatives;
   - gates on the connector only, through the planning service as today (it already runs the trust
     gates on a single-route request);
   - choose, splice, store and return the binding exactly as today's result shape, so the caller does
     not change.
   - Fall back to today's single replan when: no connector passes, the best connector takes more than a
     quarter of the time left, the ride has a sketch, or there is no line ahead.
   - After two reroutes in a row that the rider rides away from (off-route again within 1 km of the
     connector's start), the next set of targets starts at 3 km.
3. Loops stop using the 15 shaping points for the normal case; `loopRejoinAnchors` stays for the
   fallback and for "Head to the start".
4. Rider report during a ride: when a new report ring crosses the line ahead, trigger the same reroute
   with targets beyond the ring. Wire it where reports are saved
   (`src/application/persistence/rider-report-repository.ts` is the source of rings; the ride view model
   decides when to ask). No new screen; the existing reroute card and voice line are reused.
5. No signal: no change. The line stays; reroute when a fix and a connection are back.

## Files
New: `src/application/ride-session/rejoin-splice.ts`, `tests/unit/ride-session/rejoin-splice.test.ts`.
Changed: `src/application/ride-session/{guided-reroute,loop-rejoin,ride-focus-view-model}.ts`,
`tests/ride-sim/{assertions,run-scenario,ride-sim.test}.ts`, `tests/unit/ride-session/reroute.test.ts`,
`tests/real-router/rider-report-live.test.ts` (or a new `reroute-live.test.ts` beside it).
Do not change `src/ui/ride/RideFocus.tsx` layout or `ride.css`.

## Pass / fail
- `npx vitest run tests/unit/ride-session` passes, with cases: targets never pass a remaining stop or
  sit in a ring; the earliest target wins unless it needs a U-turn; after `splice`, the geometry from
  the rejoin point on equals the original exactly and distances add up to within 1 m; instructions are
  in order with no duplicate at the join.
- `npm run ride-sim` passes with three new checks on the missed-turn scenario of all 10 tracks, using a
  fake connector provider: a new route is bound within 5 s of off-route; the bound route's tail equals
  the planned line from the rejoin point; at least 90% of the good miles that were still ahead are kept.
  One new scenario: a report placed 2 km ahead on the line produces a route that does not enter the
  ring and rejoins beyond it. Any case that exposes a real navigation bug is marked `it.fails` with a
  one-line reason and listed in the PR; no assertion is loosened.
- Live, through the tunnel (`npm run test:real-router -- reroute`): for one curvy A-to-B and one dirt
  loop from the tuning set, start 400 m off the line at three places; each time at most 3 router calls,
  under 3 s in total, the tail equals the planned line, and the connector uses the ride's profile.
- `npm run typecheck`, `npm run lint`.
- PR description: before and after for one loop (how many kilometres of the remaining ride changed
  after a missed turn: before, most of it; after, 0 beyond the rejoin point).

## Stop rule
If splicing instructions cannot be made exact for some route shape, do not approximate: fall back to
the single replan for that shape and list it in the PR.

## Rules
- Read `CLAUDE.md` and `AGENTS.md` first. Keep one RideSession lifecycle: the only session change is
  still the one `mode.changed` binding. A failed reroute leaves the current route in charge.
- Unknown is never shown as clear: a connector whose closure check did not answer carries that label.
- On docker-dev run only typecheck, lint, `npm run ride-sim` and the tests named here.
- Never push to `main`, never deploy. Small plain-English commits. Final message: what a rider gets, the
  ride-sim table, the live numbers, anything you could not do.
