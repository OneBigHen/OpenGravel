# RM-0: a fair score, an NJ set, and the wait a rider actually feels

This codebase is yours. Repo OneBigHen/OpenGravel, worktree off `round/r3b`. Owner model: Sonnet.
Machine: docker-dev. Size: M. Plan: `.fable/ROUTING-MASTER.md` section 2. Measurement only: no file
under `src/` may change behaviour.

## Goal (rider sentence)
"The score is fair, shows New Jersey, and times what I actually wait for."

## Current state
- `scripts/scorecard/scoring.ts` (`winTieLoss`) is rule v2. Last run: 7/20 wins, trust 0
  (`/root/Vibe/wt/.wt/og-next-og-n6/scorecard-out/latest.json`).
- Six rows cannot win under v2 whatever is routed: the four curvy A-to-B rides need "+3 bend miles"
  (riders' own 95-mile loops hold about 3); Old Buck and Green Buch beat the rider's own line on dirt
  miles and share but sit under a flat 35%; Phoenixville is a 72-mile rider loop stored as a 1.4-mile
  A-to-B because `select-rides.ts` only calls a track a loop when its ends are within 1 km.
- `rides.json` has no New Jersey ride in the tuning set.
- First-route seconds (`scripts/scorecard/load.ts`, `instrumentProvider`) times the first provider call
  of the full plan with requests in single file. That is not what the app does for its first answer.

## Build
1. **Rule v3** in `scoring.ts`, beside v2 (keep `winTieLoss` as is; add `winTieLossV3`). v3 differs in
   exactly two tests; trust, time budget, "not fewer than fastest" and the busy test are unchanged:
   - Curvy A-to-B gain test: `goodShare >= curvyLoopShare` and `goodMiles >= 1.5 x fastest`. Dirt A-to-B
     keeps "1.5 times and +3 miles".
   - Loops with a measured rider line: also a Win when `goodMiles >= riderLine.goodMiles` and
     `goodShare >= riderLine.goodShare` and `goodMiles >= 1.5 x fastest`.
2. **Report** (`report.ts`, `run.ts`, `types.ts`): headline is v3; v2 and v1 headlines are printed on the
   next two lines, always. Each row shows all three verdicts. `latest.json` carries `summary.winsV3`,
   `winsV2`, `winsV1`.
3. **Repair Phoenixville** by rule, in `select-rides.ts` and `tests/scorecard/rides.json`: a catalog track
   whose ends are within 5 km and whose length is over 20 times that gap is a loop, with `loopMinutes`
   from the existing 45 km/h rule. Apply the rule to both sets and list every row it changes in the PR
   (expected: Phoenixville only).
4. **NJ set**: add `"nj"` to `rides.json` with exactly the 10 rides in `ROUTING-MASTER.md` section 2
   (ids, coordinates and modes are fixed there; reserves in the stated order only if a ride cannot be
   planned at all on the production graph). `--set nj` runs it; `run.ts` must accept a 10-ride set.
   The two catalog rides keep their rider tracks.
5. **Re-freeze once, on the production graph**: `npm run scorecard -- --freeze-threshold`. The manifest
   hash changes; the rider shares must not. The threshold must still be 0.023924. If it is not, stop.
6. **First-answer timing**: before each full plan, time one real first-answer request (`planRide` with
   `includeAlternatives: false`, the way the app sends it). Report `firstAnswerSeconds` per ride and p50,
   p75, p95 in the load line, plus calls per plan p95. Keep the old number, renamed `firstCallSeconds`.

## Files
`scripts/scorecard/{scoring,run,report,types,load,select-rides}.ts`, `scripts/scorecard/frozen-threshold.ts`
(rewritten by the freeze command only), `tests/scorecard/rides.json`, new
`tests/unit/scorecard/scoring-v3.test.ts`, `docs/PLAN.md` section 5 (state the v3 rule and why, in 10
lines; say that v2 stays printed).

## Setup
Tunnel is usually up on local 8989 (`curl -s localhost:8989/health`). Copy, do not move, these from
`/root/Vibe/wt/.wt/og-next-og-n6/`: `data/scorecard/gravel-atlas-v3.sqlite`,
`scorecard-out/authority-snapshots.json`, `scorecard-out/rider-lines.json`.

## Pass / fail
- `npx vitest run tests/unit/scorecard` passes, with cases for: curvy A-to-B on share; par rule needs
  both miles and share; a shorter loop with higher share but fewer miles than the rider does not win;
  dirt A-to-B unchanged; v2 function untouched (its existing expectations still pass).
- `npm run scorecard -- --set tuning` on the production graph exits 0 and prints three headlines. On the
  19 unrepaired rows the v2 verdicts equal the N6 run exactly, and v3 turns exactly four of them into
  Wins: Green Buch, Old Buck, Allentown to Stroudsburg, Doylestown to New Hope. Any other difference is a
  bug in this package, not a result.
- Two tuning runs give identical verdicts under all three rules.
- `npm run scorecard -- --set nj` exits 0 and prints "NJ x/10" with trust failures.
- `git diff --stat round/r3b -- src` is empty. `npm run typecheck` and `npm run lint` pass.
- PR description: the three headlines for tuning, the NJ headline, first-answer p50/p75/p95, and the
  sentence "4 of the wins come from the fairer rule, not from better routes."

## Rules
- Read `CLAUDE.md` and `AGENTS.md` first. Never push to `main`, never deploy.
- On docker-dev run only typecheck, lint and the tests named here. No `npm run build`, no full suite.
- Do not run `--set holdout`. It runs once, on ship day.
- Do not change the NJ rides, the rule or the threshold to improve a number. If a row looks wrong, write
  it in the PR and stop.
- Never scan `/` or `~`. Small plain-English commits. Final message: what changed, the headlines, anything
  you could not do.
