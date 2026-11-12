# N6 (stretch): ask for twisty, get twisty

This codebase is yours. Repo OneBigHen/OpenGravel. Codex Sol only. Start only after N1's server half is merged; skip the package if quota is out.

## Goal (rider sentence)
"Ask for twisty, get twisty."

## Spec
`.fable/ROUTING-PLAN.md`, section 5, step 2, exactly as written. In short:
- The curve and arterial penalties in `src/infrastructure/routing/graphhopper/ride-formula-rules.ts` go out as **one extra request** in the Curvy and Backroads wave (`src/application/planner/curvy-search.ts`, `request-builder.ts:718`, `provider.ts:298`), and the existing bend pick chooses. Do not apply them to every call: that lost 7 of 16 on 2026-10-04.
- The planner's pick and the scorecard spend one number: `bendMeters` from `src/domain/geometry/road-bends.ts`.
- `scripts/scorecard/run.ts:117` hard-codes the rules off; make it follow production.
- Delete `OGV_RIDE_FORMULA`, the formula scorer (`src/application/planner/ride-formula.ts`, `src/domain/route/ride-formula.ts`) and their tests. No new switch.

## Pass / fail
- `npm run scorecard -- --set tuning` (tunnel: `ssh -N -L 8989:127.0.0.1:8989 docker-stable`), attached to the PR: curvy wins up by 2 or more against today's run, total wins not lower than 6, trust failures 0, router calls per plan not higher.
- `grep -rc OGV_RIDE_FORMULA src scripts .env.example` prints 0 for every file.
- `npx vitest run tests/unit/planner tests/unit/infrastructure tests/unit/scorecard tests/architecture` passes.
- If curvy wins do not rise by 2, do not merge: report the per-ride table and stop.

## Rules
- Read `CLAUDE.md`, `AGENTS.md` and (for any screen work) `DESIGN.md` first. The plan for this round is `.fable/NEXT-PLAN.md`; its section 5 holds the taste calls. Do not re-ask them.
- Work on your own branch off `round/next` in your own worktree. Never push to `main`, never deploy.
- On docker-dev run only `npm run typecheck`, `npm run lint` and the tests named here. No `npm run build`, no full suite: CI runs those.
- Never scan `/` or `~`. Search inside the repo only. Frozen areas (hiking, Spotify, cameras, Ask/Jev, wind, sun, long trip, live follow) are off limits.
- Unknown or unavailable is never shown as clear, open, paved, fine or safe.
- Small plain-English commits. Final message: what a rider now sees, the test output, anything you could not do.
