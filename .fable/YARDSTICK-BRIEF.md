# Brief: make the scorecard's fun measure honest (routing step 1, finish)

This codebase is yours. Worktree `/root/Vibe/wt/og-score-v2`, branch `routing/step1-honest-scorecard`. Don't push, don't deploy, never scan outside this folder.

## The problem
`npm run scorecard` (see `docs/PLAN.md` section 5 and the last lines of `scorecard-out/run2.log`) ends with:
"YARDSTICK FAILED: the rider's own line beats fastest on good miles on only 8 of 12 tracked rides (needs 10)." Missed: Bald Eagle Dual Sport Loop, Hawley Loop, Green Lane and Back Easier Ride, Out and Back Loop. On four of five Curvy loops the plain fastest loop gets 31-55% bend share, the same as riders' own lines. So "good miles" can't tell a favourite road from the fastest one.

Read `.fable/ROUTING-PLAN.md` step 1, then `scripts/scorecard/measure.ts`, `scoring.ts`, `yardstick.ts`, `geometry.ts`, `rider-line.ts`.

## Likely causes to check (prove with numbers before changing anything)
1. Turns at junctions (town grids, highway ramps, roundabouts) are counted as bends. A bend should be curvature *along one road*, not a change of road. Check whether the measure splits by road (way id / name / route-detail segments) and ignores the vertex at a road change.
2. Bend threshold too loose: gentle sweepers on a highway count. Kurviger-style curvature: radius-based (e.g. radius < ~175 m counts, weighted more under ~100 m), over a minimum length; straight-ish highways score ~0.
3. Busy/high-class roads earning good miles. Motorway/trunk/primary should earn nothing toward "good miles" unless they are truly twisty.
4. Gravel miles: check the rider lines that lose on gravel (Bald Eagle Dual Sport is 72% matched; unmatched stretches earn nothing; maybe matching drops dirt).

## Rules (honesty)
- Do not tune to make OpenGravel win. The gate is the yardstick: the rider's own line must beat fastest on good miles on 10 or more of the 12 tracked rides, on the tuning set, AND the measure must be defensible from first principles (write down why in `docs/PLAN.md` section 5, two short paragraphs).
- After it passes, re-freeze the Curvy threshold only via the script's `--freeze-threshold` path, and run the tuning set once more.
- Run `--set holdout` once at the end, report but don't tune on it.
- Keep v1 beside v2 in the report as today.

## How to run
- Scorecard needs the router: `ssh -fN -L 8989:127.0.0.1:8989 docker-stable` first (check with `curl -s localhost:8989/health`), plus the prod switch env vars documented at the top of `scripts/scorecard/run.ts` / PLAN.md. A run takes ~10 min; only one at a time; save logs to `scorecard-out/run3.log`, `run4.log`, ...
- Unit tests: `npx vitest run tests/unit/scorecard` (or wherever scorecard tests are: `rg -l scorecard tests`), plus `npx tsc --noEmit -p .`, `npm run lint`.

## Pass / fail
- Pass: yardstick passes (≥10/12) for a reason you can explain; unit tests for the new measure (a town grid of right-angle turns scores ~0 bend miles; a real switchback road scores high; a straight highway scores 0); PLAN.md updated with the new run numbers; committed with plain messages.
- If after honest work it still fails, stop and write what you learned in `docs/PLAN.md` section 5 and commit; don't fudge.
- Finish with a 6-line summary: yardstick result, v2 wins, holdout wins, what changed and why.
