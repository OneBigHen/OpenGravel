# RM-5: loops follow real gravel and real curves, and never a dead end

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/r3b` after RM-4 merges.
Owner model: Opus (routing core). Machines: docker-dev for code and scorecards; the anchors table is
built against the v2 router on the Windows PC (tunnel on local 8988). Size: L.
Plan: `.fable/ROUTING-MASTER.md` section 6. Needs RM-2 (v2 graph up) and RM-4.

## Goal (rider sentence)
"Loops follow real gravel and real curves, and never a dead end."

## Current state
- A loop is the engine's `round_trip`: a random far point per seed. Per lane: 3 seeds, 2 time
  corrections, 2 re-seeds when the answer rides a dead end (`provider.ts`: `DISCOVERY_SEED_COUNT`,
  `LOOP_CALIBRATION_PASSES`, `LOOP_RESEED_ATTEMPTS`). Loop plans made 21 to 53 router calls in the last
  run, and 34 calls failed with "Could not find a valid point after 3 tries".
- Dirt loops add atlas tours (`atlas-generators.ts`, `atlas-dirt-loops.ts`, `corridor-prize-loop.ts`,
  `OGV_DIRT_LOOP_GENERATORS`, `OGV_ATLAS_CALLS`). Their dead-end check counts map links; the router
  disagrees, so most tours are rejected after the calls are spent.
- The curvy loop pick only chooses among the random loops. Hawley (1.66%) and Crystal Cave (1.97%) miss
  the 2.39% bar; the riders' own lines there reach 3.39% and 4.83%.
- The Gravel Atlas (`gravel-atlas-v3.sqlite`, table `corridors`): 4,929 dirt corridors (9,635 miles) and
  3,215 paved backroads (12,039 miles), 505 in NJ, each with geometry, length, bend share, grade mix,
  sand share, legal and seasonal flags, entry and exit links, and `routable`.
- The v2 graph carries `og_through` and `og_through_street` (not dead-end territory) and `og_curve`.
  `/info` returns the graph's `import_date`.

## Build
1. **Anchors table**, `scripts/build-loop-anchors.ts --atlas <v4 atlas> --url http://127.0.0.1:8988
   --out loop-anchors-v1.sqlite`. One row per atlas corridor that is `routable`, legal and not closed:
   midpoint, heading, kind (dirt or curvy), length, quality, max grade, sand share, seasonal flags, and
   from one short router call along its middle 200 m with details: `og_through`, `og_through_street`,
   mean `og_curve`. Curvy anchors are backroad corridors with `og_curve` of 0.25 or more. Store the
   graph's `import_date` in a meta table. Expect about 6,500 calls, a few minutes.
2. **Loader**, `src/server/roads/loop-anchors.ts` (pattern: `gravel-atlas.ts`, read-only, `node:sqlite`):
   anchors in a box, filtered for the bike. A missing file, or an `import_date` that does not match the
   running router, is an empty table plus one health line. Never a planning failure.
3. **Rings**, new `src/application/planner/loop-skeletons.ts`, pure and seeded by the request id:
   - Size: ride time times the profile's speed (start from the constants in `request-builder.ts`),
     divided by 1.3 for road wiggle, gives the ring's length; radius from that.
   - Three directions at least 60 degrees apart where usable anchors are densest; a rider's "which way"
     heading fixes the first.
   - Per direction, a circle through the start; take two or three anchors nearest the circle at about a
     quarter, a half and three quarters of the way round, best quality first, never two on the same
     corridor, never one with sand share over 10%, never one beyond the bike's limits.
   - One request per ring: start, anchors in order, start; the rider's profile; `pass_through` on; a
     request rule that makes dead-end territory expensive (`!og_through` x 0.05, or the street flag for
     street and touring bikes).
4. **Plan:** the first answer is ring 1 alone. The full plan sends the three rings together, measures
   time against the asked time, and corrects once: rescale the radius of the best one or two rings
   (clamped 0.6 to 1.6) and ask again. At most 6 router calls per loop plan.
5. **Pick:** same gates and the same scorer as RM-4. Most good miles within 15% of the asked time.
6. **Fallback:** fewer than two usable anchors in range, or no table: the engine's `round_trip`, one
   seed, with the dead-end rule when the graph has it. On the old graph (no `og_through`) rings are
   still routed, without the rule.
7. **A-to-B detours:** implement the anchors port RM-4 left open. Anchors inside the budget ellipse
   between start and end, top two by quality times length, at least 5 km apart.
8. **Delete:** `atlas-generators.ts`, `atlas-dirt-loops.ts`, `corridor-prize-loop.ts`, their tests,
   `OGV_DIRT_LOOP_GENERATORS`, `OGV_ATLAS_CALLS`, the calibration and re-seed loops and the 3-seed set in
   `provider.ts` (one seed stays for the fallback), `FAST_FIRST_*` and `FIRST_ANSWER_LOOP_SEEDS` in
   `plan-service.ts`, and `scripts/dirt-loop-benchmark.ts`.

## Files
New: `scripts/build-loop-anchors.ts`, `src/server/roads/loop-anchors.ts`,
`src/application/planner/loop-skeletons.ts`, tests `tests/unit/planner/loop-skeletons.test.ts`,
`tests/unit/server/loop-anchors.test.ts`. Changed: `src/server/planning/plan-service.ts`,
`src/infrastructure/routing/graphhopper/{provider,request-builder}.ts`,
`src/application/planner/{ride-search,route-provider}.ts`, `scripts/scorecard/run.ts` (anchors path,
switches), `.env.example` (`OGV_LOOP_ANCHORS_PATH`). Deleted: as listed.

## Pass / fail
- `npx vitest run tests/unit/planner tests/unit/server tests/unit/infrastructure tests/architecture`,
  `npm run typecheck`, `npm run lint`.
- Unit cases: same request id gives the same rings; no ring uses an anchor beyond the bike's limits, a
  sandy one or a closed one; a missing or stale table falls back without an error; a loop plan never
  exceeds 6 calls.
- Scorecard, tuning, v2 graph, against the RM-4 run on the same graph:
  - v3 wins up by at least 3 across the loop rows (candidates: Hawley, Crystal Cave, Phoenixville,
    Rothrock, The Quick and the Dead); no loop row that was a Win stops being one; trust failures 0.
  - Good miles summed over loop rows higher than before.
  - Every loop plan makes 6 router calls or fewer. No "Could not find a valid point" errors in
    `scorecard-out/`.
  - First-answer seconds p95 is 5 or less on loop rides.
- Scorecard, tuning, production graph: v3 not lower than the RM-4 run, trust 0 (the fallback path works).
- NJ set on v2: not lower; the NJ loops (rides 3, 4, 7, 8) all return a route.
- `grep -rc "OGV_DIRT_LOOP_GENERATORS\|OGV_ATLAS_CALLS\|LOOP_RESEED" src scripts .env.example` prints 0.

## Stop rule
If the loop rows gain fewer than 3 wins after one fix attempt, stop. Attach, per loop row: the rings
tried, the anchors in each, minutes, good miles, share. Do not tune ring sizes or anchor quality cut-offs
against individual rows; bring the table back to the advisor.

## Rules
- Read `CLAUDE.md` and `AGENTS.md` first. Hard gates stay exactly as they are. The atlas and the anchors
  table are optional files: planning must work without them.
- No new switches. Do not run `--set holdout`. Never push to `main`, never deploy.
- On docker-dev run only typecheck, lint and the tests named here. One scorecard at a time.
- Small plain-English commits. Final message: what a rider gets, the scorecard lines, calls per plan,
  anything you could not do.
