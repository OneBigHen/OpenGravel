# RM-8: first route in 5 seconds, and a dial for how far out of my way

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/r3b` after RM-5 merges.
Owner models: Sonnet for the speed gate and tests, Opus for the dial (it is a screen). Machine:
docker-dev; iPhone-size shots as `DESIGN.md` requires. Size: S to M.
Plan: `.fable/ROUTING-MASTER.md` section 6.

## Goal (rider sentence)
"First route in 5 seconds, and a dial for how far out of my way."

## Current state
- After RM-4 and RM-5 a plan is one first-answer call plus one wave (5 calls A-to-B, 6 loop). The
  router answers a route in 0.05 to 0.25 s (measured on production).
- RM-0 made the scorecard report first-answer seconds (p50, p75, p95) and calls per plan. Nothing fails
  when they slip.
- The trust gate may wait up to 2.5 s for closures on the first answer
  (`src/application/route-intelligence/coordinator.ts`).
- The detour budget exists in code (`src/application/planner/ride-budget.ts`: Direct 1.15, Balanced
  1.35, Scenic 1.75) with no control. `src/ui/planner/RideStyleControls.tsx` holds the ride-style
  controls.

## Part A: the speed gate (Sonnet)
1. `scripts/scorecard/run.ts`: exit code 3 when first-answer seconds p95 is over 5.0, or any plan makes
   more than 6 router calls. Print which rides broke it. `--no-speed-gate` exists for runs against a
   slow tunnel and prints a warning line in the report.
2. A server unit test, `tests/unit/server/plan-service-performance.test.ts`: with a fake provider that
   takes 200 ms per call, a first answer returns in under 1.0 s and a full plan in under 1.5 s, for one
   A-to-B and one loop. This catches a wave that has quietly become a chain.
3. Find what the first answer still waits on besides the one router call and the trust gates, and
   remove it. If closures are the long pole, do not weaken the gate: cache the authority assessment by
   area for the minutes its feeds allow, so the second request in the same area does not wait. A closure
   check that has not answered stays "not checked yet", never "clear".
4. Report in the PR, from one tuning run and one NJ run: first-answer p50, p75, p95; full-plan p95;
   calls per plan maximum.

## Part B: the dial (Opus)
1. Read `DESIGN.md` first; iPhone-simulator shots before and after. One control with three stops
   (Direct, Balanced, Scenic) in `RideStyleControls.tsx`, default Balanced, using existing tokens and an
   existing control pattern. No new colours, no new component family. Words a rider uses: the stop
   names plus one line under it, for example "Up to about a third longer than the fastest way".
2. The choice travels in the plan request to `ride-budget.ts`. Loops ignore it (their budget is the ride
   time); hide the dial for loops.
3. The route card says when a route is over the chosen budget (RM-4 labels it); it never hides that.
4. Log the taste call in the `DESIGN.md` decision log with the PR. Do not ask the owner; the look is
   delegated.

## Files
`scripts/scorecard/{run,report,load}.ts`, `tests/unit/server/plan-service-performance.test.ts`,
`src/application/route-intelligence/coordinator.ts` and `src/server/planning/road-assessments.ts` (only
if the cache is needed), `src/ui/planner/RideStyleControls.tsx`, its CSS file, the planner view model
field that carries the budget, `src/application/planner/build-plan-request.ts`,
`tests/unit/planner/build-plan-request.test.ts`, one browser check in `tests/e2e/critical/`.

## Pass / fail
- `npm run scorecard -- --set tuning` and `--set nj` on the graph production runs: exit 0 with the gate
  on; first-answer p95 5.0 s or less; no plan over 6 calls; v3 wins and trust failures unchanged from
  the RM-5 run.
- `npx vitest run tests/unit/server tests/unit/planner tests/unit/scorecard`, `npm run typecheck`,
  `npm run lint`, `npm run css:budget`.
- Browser check: on an A-to-B plan, choosing Direct then Scenic sends two different budgets and the
  second route is not shorter in time than the first; the dial is absent on a loop; keyboard focus is
  visible on the dial; it respects reduced motion.
- Shots: planner with the dial, phone and desktop, both themes.

## Stop rule
If p95 is over 5 s and the cause is the box (production memory, a slow tunnel) and not the app, say so
with the split (router seconds against everything else) and stop. Do not hide the number.

## Rules
- Read `CLAUDE.md`, `AGENTS.md`, `DESIGN.md`. Unknown is never shown as clear.
- On docker-dev run only typecheck, lint and the tests named here; CI runs the build and browser suite.
- Never push to `main`, never deploy. Small plain-English commits. Final message: the three timing
  numbers, the shots, anything you could not do.
