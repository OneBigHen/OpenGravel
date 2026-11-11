# N1: the first loop is the real loop

This codebase is yours. Repo OneBigHen/OpenGravel.

## Goal (rider sentence)
"One tap on Loop and the first loop I see is already the gravel or twisty loop I asked for. It does not swap for a different ride while I am looking."

## Today (seen on production, Rothrock, 2 h Mixed loop)
6 s after "Make my loop" the rider gets a 66 mile loop up I-99 with 1% gravel, labelled Best Ride. About 20 s later it is replaced by a 61 mile loop with 21% dirt. Cause: the progressive first answer always runs the fastest profile.

## Server half (Codex Sol, or Sonnet if quota is out)
- `src/application/planner/candidate-lanes.ts`, `resolveLanes`: when `includeAlternatives` is false it returns the baseline lane (`motorcycle_fastest`). Return one lane on `input.requestedProfile` when the deployment serves it; for a rider who prefers non-paved (`prefersNonPaved`) use `motorcycle_adventure`. Fall back to the baseline only when neither is served.
- `src/server/planning/plan-service.ts:660-700` and `:816`: the first answer keeps every hard gate (bike limits, access, closures, dead-end spur). Do not add a switch; the change is on or it is not merged.
- If a loop's first answer gets slower, cut the first answer to one seed (`src/infrastructure/routing/graphhopper/provider.ts`, loop seeds). Do not go back to the fastest profile.

## Client half (Opus)
- One tap: the phone Loop pill (`src/ui/planner/IntentComposer.tsx:621`, `data-testid="loop-near-me"`) starts planning at once with the last ride time used (2 h the first time) and direction Any. Change the loop rule in `src/application/planner/auto-plan.ts` and `src/ui/planner/hooks/usePlannerAutoPlan.ts`. Time chips stay under the hero; changing one replans. Desktop keeps its button, always live and green, reading "Try another loop" once a loop exists.
- Honest label: while the session phase is `primary-ready` or `alternatives-loading` (`planner-view-model.ts`, `statusFor` and the role label) the hero eyebrow reads "First look" in neutral ink. "Best ride" in plum only when settled.
- One announced swap: if the settled pick differs, swap once and show one line under the hero with what improved, from measured numbers only ("Now 21% dirt, was 6%"). Never swap after the rider tapped a card, the map, Start or Save (`usePlannerAnswerLifecycle.ts`).

## Pass / fail
- `npx vitest run tests/unit/planner/candidate-lanes.test.ts tests/unit/planner/auto-plan.test.ts tests/unit/planner/planner-view-model.test.ts` with new cases for each rule above.
- New live case in `tests/real-router/` (run with `npm run test:real-router` through `ssh -N -L 8989:127.0.0.1:8989 docker-stable`): Rothrock (40.7200, -77.8900), 2 h, Mixed loop: first answer at least 10% unpaved, back within 8 s. Curvy A-to-B from Waterville to Slate Run: first answer was routed on `motorcycle_twisty`. The 10% and 8 s lines are estimates; if the router cannot meet them, report the measured numbers, do not loosen quietly.
- Critical browser test (`tests/e2e/critical/first-route.spec.ts` or a new one): cold load to a drawn loop in 1 tap on the phone layout.
- `npm run scorecard -- --set tuning` attached: wins not lower than 6, trust failures 0, first-route seconds 75th percentile not above 6.5.
- If the tunnel is not up (`curl -s localhost:8989/info` fails) say so and stop; the reviewer runs the live checks.

## Rules
- Read `CLAUDE.md`, `AGENTS.md` and (for any screen work) `DESIGN.md` first. The plan for this round is `.fable/NEXT-PLAN.md`; its section 5 holds the taste calls. Do not re-ask them.
- Work on your own branch off `round/next` in your own worktree. Never push to `main`, never deploy.
- On docker-dev run only `npm run typecheck`, `npm run lint` and the tests named here. No `npm run build`, no full suite: CI runs those.
- Never scan `/` or `~`. Search inside the repo only. Frozen areas (hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow) are off limits.
- Unknown or unavailable is never shown as clear, open, paved, fine or safe.
- Small plain-English commits. Final message: what a rider now sees, the test output, anything you could not do.
