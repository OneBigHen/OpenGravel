# N3: three honest lines under every route, and gravel you can see on the line

This codebase is yours. Repo OneBigHen/OpenGravel.

## Goal (rider sentence)
"Under every route, three honest lines: how much is dirt, whether my bike can do it, and what was checked today. And I can see the gravel on the line itself."

## Today
The surface line exists (`src/application/planner/surface-facts.ts`, `PhoneRideSummary.tsx`) but its bar renders about 160 px wide on production at 440 px (`src/ui/planner/plan-sheet.css:193-195`). The bike limit and closure checks run on every plan (`src/application/planner/rider-road-eligibility.ts`, `src/server/planning/plan-service.ts` near line 945, which already puts `closures` and `access` evidence with their sources on each candidate) and the rider is told nothing. The surface stripe on the map starts at zoom 12 and is 3 px (`src/infrastructure/map/maplibre/style.ts:495-515`).

## Part A: the facts (DeepSeek V4.1 Flash)
- New pure module `src/application/planner/ride-truth.ts` returning three lines, each `{ tone: "good" | "warn" | "bad" | "unknown", text, jumpTo? }`:
  1. Surface: reuse `surfaceFacts`.
  2. Bike: "Fine for <bike name>: 12 mi gravel, 0.8 mi rough track" with `jumpTo` = the roughest stretch; "Not checked for your bike: 2 mi unknown surface" when road facts are missing or any stretch is unknown and nothing else is wrong; "bad" only when a limit is exceeded. Bike name from `src/application/garage/garage-model.ts` (`activeBike`).
  3. Checked: "Checked 9:14 AM: 4 sources, no closures on this route" only when closure evidence is known and clear; "1 seasonal road not confirmed" (warn); "Closure check did not answer" (unknown). Read the candidate's `closures` / `access` evidence and provenance.
- Server: add a compact bike-fit fact to the candidate evidence from `roadSummary.roadRuns` (rough-track metres, worst stretch from/to in metres, or absent when `roadRuns` is absent). Put it beside the surface evidence in `src/application/roads/engine-road-evidence.ts`; do not send raw road runs to the browser.
- Tests `tests/unit/planner/ride-truth.test.ts`: 6 routes x 3 bikes; no input combination with unknown or unavailable data yields tone "good".

## Part B: the screens and the map (Opus)
- `planner-view-model.ts` (`routeCards`) carries the three lines; show them in `PhoneRideSummary.tsx` under the hero and on the chosen card in `RouteDecisionCard.tsx`. Dots per taste call 5; CSS in `plan-sheet.css` / `route-results.css`, tokens only.
- Surface bar: full sheet width; it is a button; tapping it fits the map to the longest unpaved stretch. Tapping the bike line fits the roughest stretch.
- Map: surface stripe from zoom 8, about half the line width, plum casing stays; unknown stretches stay plain plum.

## Pass / fail
- `npx vitest run tests/unit/planner tests/unit/map` passes, including the new file and a view-model case.
- Browser check (extend `tests/e2e/critical/mobile-planner-ux.spec.ts` or add one): at 440 px the bar's width is within 2 px of the sheet's inner width; tapping it changes the map extent.
- Shots `route-choices` and `loop-planned`, phone and desktop, both themes, using a fixture candidate with one closed and one unconfirmed road (`src/server/planning/fixture-candidates.ts`).
- `npm run css:budget` passes.
- This package shares `planner-view-model.ts` and `PhoneRideSummary.tsx` with N1's client half: land N3 first.

## Rules
- Read `CLAUDE.md`, `AGENTS.md` and (for any screen work) `DESIGN.md` first. The plan for this round is `.fable/NEXT-PLAN.md`; its section 5 holds the taste calls. Do not re-ask them.
- Work on your own branch off `round/next` in your own worktree. Never push to `main`, never deploy.
- On docker-dev run only `npm run typecheck`, `npm run lint` and the tests named here. No `npm run build`, no full suite: CI runs those.
- Never scan `/` or `~`. Search inside the repo only. Frozen areas (hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow) are off limits.
- Unknown or unavailable is never shown as clear, open, paved, fine or safe.
- Small plain-English commits. Final message: what a rider now sees, the test output, anything you could not do.
