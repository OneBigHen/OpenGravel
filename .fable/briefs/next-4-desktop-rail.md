# N4: the laptop loop panel, repaired

This codebase is yours. Repo OneBigHen/OpenGravel.

## Goal (rider sentence)
"On the laptop the loop panel is one tidy column and the button is always green and live."

## Today (seen on production at 1440 x 900, Loop from start)
- The ride-time chips (Until sunset, 45 min, 1 h, 1 h 30, 2 h, 3 h, 4 h, 6 h) stack as a staircase to the right of a "RIDE TIME" label that is vertically centred on them (`src/ui/planner/ride-style.css:152-172` and `:272`, `RideStyleControls.tsx:290-330`).
- After a loop is planned "Make my loop" is a grey slab (`IntentComposer.tsx:148`); `DESIGN.md` section 2 says a primary action is never a grey slab.
- The Best Ride card can sit third in the result list (`PlannerResultPanel.tsx`, `planner-view-model.ts` `chooseCards`).
- The bottom of the result panel is cut off; Start ride can be below the fold.
- To-a-destination mode still asks four groups plus two switches before a route.

## Do
1. Loop time: label on its own line above; chips in one wrapping row (at most two rows at a 400 px rail). The preset line ("Twisty loop · 2 h") sits under them, left aligned.
2. The plan button is always live and green in Loop mode: "Make my loop" first, "Try another loop" once one exists. In destination mode with nothing to plan it is green at 45% with the reason in one line under it.
3. Best Ride is always the first card.
4. Result panel: scrolling body, fixed foot holding Start ride.
5. Road familiarity, Traffic, Avoid highways, Avoid tolls go under one closed "More options" line that summarises their state. Roads and Surface stay visible.
6. Remove the tagline from the top bar (`src/ui/nav/AppBar.tsx:20`, `PlannerWorkspaceFrame.tsx:178`).
Files: `ride-style.css`, `composer.css`, `gmaps-layout.css`, `RideStyleControls.tsx`, `IntentComposer.tsx`, `PlannerResultPanel.tsx`, `route-results.css`. Phone layout must not change except where a shared rule is fixed.

## Pass / fail
- `npx playwright test tests/e2e/critical/desktop-rail.spec.ts tests/e2e/critical/ride-style.spec.ts` passes, with new assertions at 1440 x 900: the loop-time chips have at most 2 distinct top positions and none overlaps the label's row; the plan button is not `disabled` in Loop mode and its background is the primary token; the first route card is the Best Ride; the Start ride button's box is fully inside the result panel.
- `npx vitest run tests/unit/ui tests/unit/planner` passes.
- `npm run css:budget` passes.
- Shots `plan-idle`, `loop-planned`, `route-choices` on desktop, both themes, before and after; phone shots unchanged or explained. Baselines re-recorded on CI with a `DESIGN.md` log line.

## Rules
- Read `CLAUDE.md`, `AGENTS.md` and (for any screen work) `DESIGN.md` first. The plan for this round is `.fable/NEXT-PLAN.md`; its section 5 holds the taste calls. Do not re-ask them.
- Work on your own branch off `round/next` in your own worktree. Never push to `main`, never deploy.
- On docker-dev run only `npm run typecheck`, `npm run lint` and the tests named here. No `npm run build`, no full suite: CI runs those.
- Never scan `/` or `~`. Search inside the repo only. Frozen areas (hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow) are off limits.
- Unknown or unavailable is never shown as clear, open, paved, fine or safe.
- Small plain-English commits. Final message: what a rider now sees, the test output, anything you could not do.
