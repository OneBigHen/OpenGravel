# RM-3: planning stops waiting on things no rider sees (deletions)

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/r3b` after RM-0 merges.
Owner model: DeepSeek V4.1 Flash for the bulk; Opus reviews the diff and runs the scorecard.
Machine: docker-dev. Size: M. Plan: `.fable/ROUTING-MASTER.md` section 6.
This is the one plumbing PR of the round. It must change no route.

## Goal (rider sentence)
"Planning stops waiting on things no rider sees."

## Current state
About 5,600 lines of routing experiments still ship, none of which picks a route today:
- Jev judge and frontier harness: `src/application/planner/{fun-judge,fun-judge-selection,
  jev-frontier-shadow,jev-frontier-evaluation,jev-frontier-replay,frontier-routing,
  frontier-probe-allocation,frontier-comparison-policy}.ts`,
  `src/infrastructure/routing/{jev-fun-judge,jev-frontier-judge,jev-fun-character,jev-models}.ts`,
  `scripts/jev-frontier-replay.ts`, `scripts/jev-fun-judge-eval.ts`. Measured in October: the judge
  would have changed 0 of 16 Best Rides.
- Fun generators (shadow: they run after the answer and only log):
  `src/application/planner/{fun-generators,fun-generator-strategies,fun-generator-sources,
  library-corridor-probes}.ts`, `src/server/planning/fun-generators.ts`.
- "Routing methods" panel with "Jev's read": `src/ui/planner/RoutingMethodComparison.tsx`,
  `src/application/planner/routing-method-comparison.ts`, its use in `PlannerWorkspace.tsx`.
- Jev character label: `planRide` waits up to 0.8 s for it (`plan-service.ts`,
  `environmentCharacterClassifier`).
- A real bug this hides: the curvy search borrows the fun-generator budget
  (`plan-service.ts:1074`, `sweepCalls: Math.min(CURVY_SWEEP.length, riderBudget.maxProviderCalls)`).
- Switches: `OGV_FUN_GENERATORS*`, `OGV_JEV_*`, `OGV_ATLAS_GENERATORS`, `OGV_CURVY_SEARCH` (in
  `plan-service.ts`, `route-plan-contract.ts`, `.env.example`, `scripts/scorecard/run.ts`,
  `scripts/dirt-loop-benchmark.ts` and the tests that set them).

## Build
1. Delete the files above and every import of them. Delete their unit tests, and the live tests
   `tests/real-router/{fun-best-ride-live,fun-generators-live,fun-selection-live,
   routing-method-comparison-live}.test.ts`.
2. `plan-service.ts`: remove the fun-generator call, the judge wiring and the character label wait.
   The search budget becomes two named constants in the file that uses them (calls and deadline), with
   today's effective values, so behaviour is identical: curvy sweep 2 calls, the rest as
   `funGeneratorSettingsFromEnv` returns by default.
3. Remove the four switch families from code, `.env.example`, the scorecard's `SWITCHES` and the tests.
   **Keep** `OGV_DIRT_LOOP_GENERATORS`, `OGV_ATLAS_CALLS`, `OGV_RIDER_MODES` and
   `src/application/planner/{atlas-generators,atlas-dirt-loops,corridor-prize-loop}.ts`: dirt loops use
   them in production until RM-5 replaces them. Removing `OGV_ATLAS_GENERATORS` means behaving as
   production does today, where it is `off`: atlas tours run for dirt loops only, never for A-to-B. If `atlas-generators.ts` imports anything you are
   deleting, move the few lines it needs into it; do not change what it does.
4. Remove the panel from the result screen. Screen change: read `DESIGN.md`, attach before and after
   `npm run shots` for the result panel, phone and desktop, both themes.
5. Fix or delete `tests/architecture/jev-shadow-boundary.test.ts` to match (delete if nothing is left
   to guard).
6. Do not touch the AI advisor ("Ask", `src/application/advisor/`): frozen, and not in planning.

## Pass / fail
- `npm run scorecard -- --set tuning` on the production graph: every ride's v3, v2 and v1 verdict, good
  miles and router calls identical to the RM-0 run. Shadow calls drop to 0. Any other difference is a bug.
- `git diff --shortstat` against the base shows at least 5,000 lines removed, net.
- `grep -rcE "OGV_FUN_GENERATORS|OGV_JEV_|OGV_ATLAS_GENERATORS|OGV_CURVY_SEARCH" src scripts tests .env.example`
  prints 0 for every file.
- `npm run typecheck`, `npm run lint`,
  `npx vitest run tests/architecture tests/unit/planner tests/unit/server tests/unit/application tests/unit/scorecard`.
- Shots attached; the result panel shows no "Routing methods" block.
- Production note in the PR: `/etc/opengravel/ogv.env` on docker-stable still sets
  `OGV_FUN_GENERATORS`, `OGV_JEV_FUN_JUDGE` and `OGV_ATLAS_GENERATORS`; they become harmless and can be
  removed at the next release. Do not edit that file from this package.

## Rules
- Read `CLAUDE.md`, `AGENTS.md`, and `DESIGN.md` before the panel removal.
- On docker-dev run only typecheck, lint and the tests named here. No `npm run build`, no full suite.
- Never push to `main`, never deploy. Never scan `/` or `~`.
- If a deletion would change what a rider's route looks like, stop and say which line.
- Small plain-English commits, one family of files per commit. Final message: lines removed, the
  scorecard comparison, anything you could not delete and why.
