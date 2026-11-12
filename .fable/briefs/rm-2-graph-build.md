# RM-2: ask for twisty, get twisty (profiles v2, build, A/B)

This codebase is yours. Repo OneBigHen/OpenGravel, branch on top of RM-1 and RM-0. Owner model: Opus.
Machines: Windows PC for builds and the candidate router; docker-dev runs the scorecard through tunnels
(one scorecard at a time). Size: M. Plan: `.fable/ROUTING-MASTER.md` sections 4, 5 and 9.

## Goal (rider sentence)
"Ask for twisty, get twisty."

## Current state
- RM-1 gave a v2 graph with `og_curve`, `og_through`, `og_through_street`, and profiles identical to
  production, so no route has changed yet.
- Measured on production: twisty from Allentown to Stroudsburg is 34.9 miles, fastest is 34.8 on the same
  road. Riders' own lines run 0 to 4% on busy roads; our curvy routes 7 to 34%.
- Two clocks: twisty, scenic and adventure use `car_average_speed` with no speed-limit clamp; fastest
  clamps to `max_speed`. Hawk Mountain shows our 33-mile route 6 minutes quicker than the 28.7-mile
  fastest route.
- Request-time penalties cost speed: 0.58 s against 0.08 s for the same trip (measured). The default
  strength must be baked into the profile.

## Build
1. `infra/graphhopper/moto/custom-models/` (v2 set) and `config-v2.yml`:
   - `motorcycle-fastest.json`: **byte-identical to production.** It is the baseline.
   - `og-clock.json`, merged last into twisty, scenic and adventure: `limit_to car_average_speed`, then
     `limit_to max_speed`, then the unpaved caps those profiles have today (twisty and scenic 30,
     adventure 45, sand 18). Paved roads now take the same time in every profile.
   - `motorcycle-twisty.json`, starting values (`prefer-curvature.json` is dropped from this profile):
     keep the access lines of `motorcycle-base.json`; motorway and trunk 0.1; primary 0.5; residential,
     service, living street 0.6; city 0.5; residential density 0.8; `og_curve == 0` 0.5, `< 0.25` 0.7,
     `< 0.5` 0.85; `distance_influence` 60.
   - `motorcycle-scenic.json`: the same shape, milder: primary 0.6; city 0.45; `og_curve == 0` 0.8,
     `< 0.25` 0.9; rural bonus kept.
   - `motorcycle-adventure.json`: road logic unchanged; only the clock file is added.
   - Keep `curvature` in `graph.encoded_values`: today's app still asks for it as a detail.
2. Build on the Windows PC with `build-graph.sh` into a new folder per round (`graph-v2-r1`, `-r2`, `-r3`).
   A profile-only change needs just the landmarks again: delete that round's `landmarks_*` files by name,
   or start a fresh folder from a copy.
3. Re-check the Gravel Atlas against this graph: copy `gravel-atlas-v3.sqlite` to
   `gravel-atlas-v4.sqlite`, run `npx tsx scripts/validate-gravel-atlas.ts --atlas <copy> --url
   http://127.0.0.1:8988`. The scorecard on v2 uses the v4 copy (`OGV_GRAVEL_ATLAS_PATH`).
4. A/B, same commit, two worktree copies so `scorecard-out/` never mixes:
   - A: production graph, local 8989.
   - B: `GRAPHHOPPER_URL=http://127.0.0.1:8988 npm run scorecard -- --set tuning --refresh-rider-lines`.
   Do not re-freeze the threshold. Then `--set nj` on both.
5. Calibrate on the tuning set only, three rounds at most. Each round: change numbers in the two profile
   files, rebuild landmarks, run the tuning scorecard, record the row table in the PR. The NJ and hold-out
   sets are never used to choose a number.
6. Rehearse the swap and the rollback of RM-7 on the Windows PC (old folder, new folder, start, stop,
   start) and write the measured load time and memory into the PR.

## Files
`infra/graphhopper/moto/custom-models/*.json`, `infra/graphhopper/moto/config-v2.yml`,
`infra/graphhopper/custom-models/README.md` (new hashes, one paragraph on the clock),
`infra/graphhopper/README.md` (v2 section), `docs/PLAN.md` section 5 (the A/B result). No file under
`src/` changes in this package: today's app must work on the new graph as it is.

## Pass / fail
- `probe-graph.py` passes on the final round, except "no route changed" now applies to
  `motorcycle_fastest` only (20 pairs within 1% of production).
- Scorecard B against A on tuning, today's planner code:
  - v3 wins at least A + 1; v2 wins not lower; trust failures 0; yardstick still passes.
  - Every gravel row's verdict is the same or better. A gravel Win that becomes a Tie or Loss fails the
    package.
  - On the curvy rows, good miles summed are at least 25% higher than in A, and busy share summed is lower.
  - No curvy route has a residential share more than 3 points above the fastest route's (bend farming).
- NJ set: B not lower than A.
- Router speed on B: default requests p95 0.6 s or less; serving memory 3.3 GB or less.
- PR description: A and B headlines (v3, v2, v1), the row table, the profile numbers chosen and the
  round they were chosen in, build time, graph size, load time, memory.

## Stop rule
Three rounds. If the curvy rows have not moved, do not keep tuning. Ship the graph to RM-7 only if nothing
is worse than A (it still carries the through flags and the honest clock), state plainly that the field
did not earn its keep, and bring the row table back to the advisor.

## Rules
- Read `CLAUDE.md` and `AGENTS.md` first. Never push to `main`. Never touch docker-stable here.
- Do not run `--set holdout`.
- On the Windows PC: detach long runs, check PIDs before stopping anything, new folders only, never `rm`
  with a wildcard.
- Final message: what a rider gets now, the A/B table, anything you could not do.
