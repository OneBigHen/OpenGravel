# N2: the handlebar ride screen

This codebase is yours. Repo OneBigHen/OpenGravel.

## Goal (rider sentence)
"On the bars I see the next turn, the surface coming up, three numbers and three big buttons. Nothing else."

## Today (seen on production)
Right edge: compass, zoom in, zoom out, Emergency, search, recenter/overview, mute (`src/ui/ride/RideFocus.tsx` about lines 1258-1372). Menu opens on a "Share live location" form and GPS diagnostics. The ride line is plain plum; the ride never learns the surface.

## Part A: surface ahead (DeepSeek V4.1 Flash)
- New pure module `src/application/ride-session/surface-ahead.ts`: given ordered surface runs (from, to in metres along the route, kind paved | gravel | dirt | unknown) and the rider's distance along the route, return the next change: `{ kind, inMeters, forMeters }` or `null`. Runs shorter than 150 m are merged into their neighbour so the line does not flicker. No runs means `null`.
- Carry the runs from the planner into the ride the way speed limits are carried: follow `SpeedLimitSpan` through `src/application/ride-session/ride-focus-handoff.ts` and `src/application/persistence/ride-focus-pointer.ts`. The source is the selected candidate's `surfaceRuns` (`src/application/roads/engine-road-evidence.ts`). A reroute or a GPX ride with no runs shows nothing.
- Expose it on `ride-focus-view-model.ts` as one optional string plus kind: "Gravel in 0.4 mi", "Pavement in 2.1 mi", "Surface not known for 1.3 mi".
- `src/application/map/build-ride-scene.ts`: the ride's selected route carries the same surface runs the planner map uses, so the stripe draws while riding.
- Tests in `tests/unit/ride-session/surface-ahead.test.ts`: unknown never becomes paved; no data gives no line; short runs merge; distances never go negative after the change is passed.

## Part B: the screen (Sonnet, Opus reviews)
- Maneuver card 96 px tall, distance 44 px Outfit, road name 20 px, the surface line as its second row with a small swatch (taste call 4).
- Right rail on phone widths: exactly three 56 px buttons: Recenter (tap again shows the whole route), Stops, Mute. Remove zoom and compass on phones (north-up becomes a Menu row); desktop keeps zoom. Emergency becomes the first Menu row; do not change what it does.
- Menu (`data-testid="ride-panel"`): one grouped list in this order: Pause / End ride, Stops and fuel, Sound, Screen, More. "Share live location" and the GPS detail collapse to one row each under More. No input field visible when Menu opens. Do not change frozen features, only where they sit.
- Bottom strip stays: Speed, Dist left, Arrive, Menu. Night stays fully dark.
- Files: `src/ui/ride/RideFocus.tsx`, `src/ui/ride/ride.css`, `RideMetricStrip.tsx`. Keep every existing `data-testid` that a test uses, or update the test in the same commit. `npm run css:budget` must pass; `ride.css` may shrink, not grow.

## Pass / fail
- `npm run ride-sim` passes with no new `it.fails`.
- `npx vitest run tests/unit/ride-session` passes.
- New `tests/e2e/critical/ride-handlebar.spec.ts` at 440 x 956, both themes: right rail has at most 3 buttons; every ride control is at least 56 x 56 px; the summed area of the maneuver card, strip and rail is at most 20% of the viewport; opening Menu shows zero `input` elements; the surface line appears on the fixture ride and is absent on a ride without runs.
- `npx playwright test tests/e2e/critical/ride-focus.spec.ts` still passes.
- Shots: `npm run shots -- --states active-ride --devices iphone17promax,desktop --themes light,dark`, before and after in the PR. Baselines are re-recorded on CI, with a `DESIGN.md` decision-log line.

## Rules
- Read `CLAUDE.md`, `AGENTS.md` and (for any screen work) `DESIGN.md` first. The plan for this round is `.fable/NEXT-PLAN.md`; its section 5 holds the taste calls. Do not re-ask them.
- Work on your own branch off `round/next` in your own worktree. Never push to `main`, never deploy.
- On docker-dev run only `npm run typecheck`, `npm run lint` and the tests named here. No `npm run build`, no full suite: CI runs those.
- Never scan `/` or `~`. Search inside the repo only. Frozen areas (hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow) are off limits.
- Unknown or unavailable is never shown as clear, open, paved, fine or safe.
- Small plain-English commits. Final message: what a rider now sees, the test output, anything you could not do.
