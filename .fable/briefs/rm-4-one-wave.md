# RM-4: A-to-B in one wave, one scorer, one budget

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/r3b` after RM-3 merges.
Owner model: Opus (routing core). Machine: docker-dev; scorecard through the tunnels (8989 production
graph, 8988 the v2 graph on the Windows PC once RM-2 has it up). Size: L.
Plan: `.fable/ROUTING-MASTER.md` section 6.

## Goal (rider sentence)
"A-to-B in one go, inside the detour I allowed."

## Current state
- An A-to-B plan makes 6 to 11 router calls: character lanes (`candidate-lanes.ts`), then one of three
  searches with three different caps against different baselines: `curvy-search.ts` (1.35),
  `balanced-search.ts` (1.25), `rider-mode-search.ts` (dirt, 7 strengths with alternatives, 1.75).
  The scorecard allows 1.35 over fastest. Lock Haven to Slate Run loses only because the planner let it
  run 37% over. Harrisburg to Lancaster loses by 5 seconds.
- The pipeline ranks again on every screen and verify step (`rank(...)` inside `screen` and `verify`
  callbacks in `plan-service.ts`).
- The router answers one route in 0.05 to 0.25 s (measured). An alternatives call costs 1.0 s. A request
  with extra penalties costs 0.58 s.
- At most 3 router calls run at once for the whole server (`src/infrastructure/routing/concurrency.ts`,
  `MAX_ROUTING_SEARCHES = 3`).
- The first answer already uses the rider's profile (`firstAnswerLane`).
- Good miles are computed in more than one place (`scripts/scorecard/measure.ts`, `geometry-fun.ts`,
  `rider-mode-search.ts`).
- The v2 graph (RM-2) bakes the default "protect the ride" penalties and the curve field into the
  profiles. Production may still be on the old graph when this ships, so the code must work on both.

## Build
1. **Know the graph.** The provider reads `/info` once (cached, refreshed on error) and exposes which
   encoded values exist. Rules that name `og_curve` or `og_through` are sent only when present. On a v2
   graph, do not also send the request-time busy-road penalties the profile already bakes
   (`rider-modes.ts`, the `protect-ride` block at strength 1).
2. **One scorer:** new `src/domain/route/good-miles.ts`: dirt metres for dirt modes, `bendMeters` for
   curvy, from a candidate's road runs and geometry. `scripts/scorecard/measure.ts`, the planner's pick
   and the route card's numbers all import it. Delete the duplicates.
3. **One budget:** new `src/application/planner/ride-budget.ts`: Direct 1.15, Balanced 1.35, Scenic 1.75,
   times the fastest route's seconds. Default Balanced. No UI in this package (RM-8 adds the dial); the
   request carries an optional budget name.
4. **One wave:** new `src/application/planner/ride-search.ts` replaces `curvy-search.ts`,
   `balanced-search.ts` and `rider-mode-search.ts` for A-to-B. At most 5 single-route calls, sent
   together:
   1. fastest (the reference);
   2. the rider's profile (the same request as the first answer, so `shareIdenticalRequests` reuses it);
   3. the rider's profile at "strong": on v2 a request rule on `og_curve` for curvy
      (`og_curve < 0.25` x 0.6); for dirt, the existing dirt strength 3;
   4. and 5. up to two detours through a known good road inside the budget, taken from an anchors source
      passed in as a port. RM-5 provides the source; until then the wave is 3 calls. Do not build the
      anchors table here.
   No `alternative_route` calls. Requests with a sketch, stops, shaping points or road spans keep today's
   single call (as the searches skip them today).
5. **Pick once:** among candidates that pass every hard gate and fit the budget, the most good miles;
   ties go to the shorter time; keep today's exposure guard (busy share at most 10 points over the
   reference, residential at most 3). If nothing fits the budget, the closest to it, labelled as over.
   The pipeline ranks one time, after the wave. Remove the per-candidate `screen` and `verify` ranking.
6. Raise `MAX_ROUTING_SEARCHES` to 8.
7. Loops are not changed here except that they use the same scorer and pick (RM-5 does loops).

## Files
New: `src/domain/route/good-miles.ts`, `src/application/planner/ride-budget.ts`,
`src/application/planner/ride-search.ts`, tests `tests/unit/planner/ride-search.test.ts`,
`tests/unit/domain/good-miles.test.ts`. Changed: `src/server/planning/plan-service.ts`,
`src/application/planner/{candidate-lanes,geometry-fun,route-provider}.ts`,
`src/infrastructure/routing/graphhopper/{provider,request-builder,rider-modes}.ts`,
`src/infrastructure/routing/concurrency.ts`, `scripts/scorecard/{measure,run}.ts`.
Deleted with their tests: `curvy-search.ts`, `balanced-search.ts`, `rider-mode-search.ts` (move
`riderEnvelopeMetrics` if something still needs it).

## Pass / fail
- `npx vitest run tests/unit/planner tests/unit/server tests/unit/infrastructure tests/unit/scorecard
  tests/unit/domain tests/architecture`, `npm run typecheck`, `npm run lint`.
- Unit cases: wave is at most 5 calls and all start before any finishes; nothing over budget is picked
  while something fits; `og_curve` rules are absent when the graph does not list the value; the pick is
  the candidate with the most good miles by `good-miles.ts`.
- Scorecard, tuning, on the production graph and on v2 (if RM-2 is up), against the previous run on the
  same graph:
  - v3 wins not lower on either graph, and at least +1 on one of them (Lock Haven to Slate Run is the
    expected one); trust failures 0.
  - No A-to-B ride over 1.35 times fastest. Every A-to-B plan makes 5 router calls or fewer.
  - First-answer seconds p95 is 5 or less on A-to-B rides.
  - Loop rows: verdicts unchanged.
- NJ set: not lower than before.
- `grep -rc "CURVY_DETOUR_CAP\|BALANCED_DETOUR_CAP" src` prints 0 everywhere.

## Stop rule
If v3 does not rise on either graph after one fix attempt, stop and attach the A-to-B row table with the
candidates each wave produced. Do not adjust the budget numbers or the strong rule to chase a row.

## Rules
- Read `CLAUDE.md` and `AGENTS.md` first. Hard gates (bike limits, access, closures, dead-end spur) stay
  exactly as they are. Unknown is never turned into clear or safe.
- No new switches: this is on, or it is not merged.
- On docker-dev run only typecheck, lint and the tests named here. One scorecard at a time.
- Do not run `--set holdout`. Never push to `main`, never deploy.
- Small plain-English commits. Final message: what a rider gets, the scorecard lines for both graphs,
  calls per plan, anything you could not do.
