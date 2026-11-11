# Routing step 1: make the scorecard honest

This codebase is yours. Repo OneBigHen/OpenGravel. You work in your own worktree on a branch off `design/world-class`.

Read first: `.fable/ROUTING-PLAN.md` sections 1, 5 (step 1 row) and 6 — that is the spec. Then `CLAUDE.md`, `AGENTS.md`.

## Goal (rider sentence)
"The score means what a rider means by fun."

## What to build (scorecard v2; no file under `src/` may change behaviour)
- Curvy good miles come from the planner's own `analyzeGeometryFun` bend metres (src/domain/geometry/heading-fun.ts / geometry-fun.ts), via one shared module the scorecard imports (as PR #210 did for dead ends).
- A third contestant on every row: the rider's own line from `tests/scorecard/rides.json`, snapped to our roads with `src/server/road-matching/match-service.ts` if feasible offline, else measured raw with a clear note, measured with the same code. Never used to plan, never scored as "match the rider".
- Yardstick check: rider's line must beat fastest on good miles on >= 10 of the 12 tracked tuning rides, else the run exits non-zero with a clear message.
- Curvy share threshold = 75% of the median rider-line share on the tuning set, computed once and frozen next to the manifest hash (checked-in constant + test that recomputes it).
- Print router calls and first-route seconds per ride and the 75th percentile (instrument via a counting wrapper in the scorecard, not in src/).
- Print v1 headline beside v2 headline.
- Update `docs/PLAN.md` section 5 to describe v2 in plain English (short).

## Pass/fail (run these, paste output in your final report)
- `npm run typecheck` and `npm run lint` clean.
- `npx vitest run tests/unit/scorecard` passes, with new tests for: shared bend measure, threshold recompute, yardstick check, rider-line contestant, calls/p75 reporting.
- `git diff --stat origin/design/world-class -- src` shows no behaviour change (only an extracted shared module is allowed if needed, with identical results proven by existing tests).
- A live scorecard run needs a GraphHopper tunnel (127.0.0.1:8989). If `curl -s localhost:8989/info` fails, do NOT try to set one up: say so; the reviewer will run it.

## Rules
- Do not run `npm run build` or the full test suite. docker-dev has 10 GB RAM.
- Never scan / or ~. Search inside the repo only.
- Commit in small plain-English commits on your branch. Do not push to main, do not deploy.
- Final message: what changed in plain English, test output, anything you could not do.
